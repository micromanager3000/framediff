import type * as Three from "three";
import type { CompositionSetup } from "../composition";
import { registerCanvasCapture } from "../runtime";
import { isVisualElementActive } from "../render/activeElement";
import { cameraFrameWithinCut, evaluateCameraTrack, resolveSceneCamera } from "./cameraTrack";
import { cameraRotationFromTarget, loadCameraFile, mountCameraLab, type CameraLabPose } from "./cameraLab";
import { focalLengthToFov } from "./cameraTrack";
import type { ThreeSceneDef, ThreeSceneInstance } from "./sceneDef";

export interface ThreeSceneSetupOptions {
  scene: ThreeSceneDef;
  /** Canvas selector within the composition root. Defaults to `canvas[data-fd-three]`. */
  canvas?: string;
  /** Fallback named camera when no camera-cut element is active. */
  camera?: string;
  /** Project-relative JSON of hand-flown camera keyframes; enables the Camera Lab HUD.
   *  File tracks override the scene's authored camera of the same name. */
  cameraFile?: string;
  width?: number;
  height?: number;
}

interface CameraCut {
  name: string;
  from: number;
  duration: number;
  order: number;
}

/** Bind a `defineThreeScene` scene to an ordinary authored canvas. */
export function createThreeSceneSetup(options: ThreeSceneSetupOptions): CompositionSetup {
  return async ({ root, composition, signal, onFrame, onCleanup }) => {
    const canvas = root.querySelector<HTMLCanvasElement>(options.canvas ?? "canvas[data-fd-three]");
    if (!canvas) throw new Error(`Three scene "${options.scene.id}" needs ${options.canvas ?? "canvas[data-fd-three]"}.`);
    const THREE = await import("three");
    if (signal.aborted) return;
    const width = options.width ?? composition.width;
    const height = options.height ?? composition.height;
    canvas.width = width;
    canvas.height = height;
    canvas.setAttribute("data-fd-webgpu", "");

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 500);
    let instance: ThreeSceneInstance | void;
    const ready = Promise.resolve(options.scene.create({
      scene: world,
      renderer,
      width,
      height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
    })).then((created) => { instance = created; });

    const cuts: CameraCut[] = Array.from(root.querySelectorAll<HTMLElement>("[data-fd-camera]")).map((element, order) => {
      const clip = element.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]") ?? element;
      const from = Number(clip.getAttribute("data-fd-from") ?? 0);
      const duration = Number(clip.getAttribute("data-fd-duration") ?? composition.durationInFrames);
      return { name: element.dataset.fdCamera ?? "", from, duration, order };
    });
    const cutAt = (frame: number): CameraCut | undefined => cuts
      .filter((cut) => frame >= cut.from && frame < cut.from + cut.duration)
      .sort((a, b) => a.order - b.order)
      .at(-1);
    const cameraAt = (frame: number): string | undefined => cutAt(frame)?.name ?? options.camera;

    const warned = new Set<string>();
    const fileTracks = options.cameraFile ? await loadCameraFile(options.cameraFile) : { version: 1 as const, cameras: {} };
    let lastFrame = 0;
    let lab: { draftPose: () => CameraLabPose | null; sync: () => void; dispose: () => void } | undefined;
    const poseFor = (frame: number, name: string | undefined) => {
      const fileTrack = name ? fileTracks.cameras[name] : undefined;
      if (fileTrack && fileTrack.keyframes.length > 0) {
        return evaluateCameraTrack(fileTrack.keyframes, frame, fileTrack.interpolation ?? "ease");
      }
      const definition = name ? options.scene.cameras[name] : undefined;
      const cut = cutAt(frame);
      const definitionFrame = cut && cut.name === name ? cameraFrameWithinCut(frame, cut.from) : frame;
      return definition ? resolveSceneCamera(definition, definitionFrame, composition.fps) : undefined;
    };
    const renderAt = (frame: number) => {
      instance?.update?.(frame / composition.fps, frame);
      lastFrame = frame;
      const name = cameraAt(frame);
      const definition = name ? options.scene.cameras[name] : undefined;
      const draft = lab?.draftPose();
      const pose = draft
        ? { eye: draft.eye, target: draft.target, rotation: draft.rotation, fov: focalLengthToFov(draft.focalLength) }
        : poseFor(frame, name);
      if (!pose) {
        if (name && !warned.has(name)) {
          warned.add(name);
          console.warn(`FrameDiff scene "${options.scene.id}" has no camera "${name}".`);
        }
        renderer.clear(true, true, true);
        return;
      }
      camera.near = definition?.near ?? 0.1;
      camera.far = definition?.far ?? 500;
      camera.fov = pose.fov;
      camera.aspect = width / height;
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      camera.up.set(0, 1, 0);
      if (pose.rotation) {
        camera.rotation.order = "YXZ";
        camera.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], "YXZ");
      } else {
        camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      }
      camera.updateProjectionMatrix();
      renderer.render(world, camera);
      lab?.sync();
    };

    if (options.cameraFile) {
      lab = mountCameraLab(root, { path: options.cameraFile, data: fileTracks }, {
        frame: () => lastFrame,
        durationInFrames: composition.durationInFrames,
        cameraAt: (frame) => cameraAt(frame),
        trackPose: (frame) => {
          const pose = poseFor(frame, cameraAt(frame));
          return pose
            ? { eye: [...pose.eye] as [number, number, number], target: [...pose.target] as [number, number, number],
                rotation: pose.rotation
                  ? [...pose.rotation] as [number, number, number]
                  : cameraRotationFromTarget(pose.eye, pose.target),
                focalLength: 24 / (2 * Math.tan((pose.fov * Math.PI) / 360)) }
            : { eye: [0, 0, 5], target: [0, 0, 0], rotation: [0, 0, 0], focalLength: 35 };
        },
        invalidate: () => renderAt(lastFrame),
        seek: (frame) => root.dispatchEvent(new CustomEvent("framediff:seek", {
          bubbles: true,
          detail: { frame },
        })),
      });
    }

    let renderRequest = 0;
    const stopFrames = onFrame(({ frame }) => {
      const request = ++renderRequest;
      if (!isVisualElementActive(canvas, root)) return;
      if ((window as { __FRAMEDIFF_CAPTURE_MODE__?: boolean }).__FRAMEDIFF_CAPTURE_MODE__) return;
      void ready.then(() => {
        if (request === renderRequest && isVisualElementActive(canvas, root)) renderAt(frame);
      });
    });
    const stopCapture = registerCanvasCapture(canvas, async (time) => {
      await ready;
      renderAt(time * composition.fps);
      const output = document.createElement("canvas");
      output.width = width;
      output.height = height;
      output.getContext("2d")!.drawImage(canvas, 0, 0);
      return output;
    });
    onCleanup(() => {
      lab?.dispose();
      stopFrames();
      stopCapture();
      instance?.dispose?.();
      world.traverse((object) => {
        const mesh = object as Three.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
    });
  };
}
