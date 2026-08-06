import {
  defineComposition,
  type CompositionConfig,
  type CompositionMetadata,
  type CompositionSetup,
} from "../composition";
import { isVisualElementActive } from "../render/activeElement";
import { registerCanvasCapture } from "../runtime";
import { getFontEmbedCSS, toCanvas } from "../vendor/html-to-image";

export type ClothVec3 = readonly [number, number, number];
export type ClothUv = readonly [number, number];
export type ClothPins = "none" | "top" | "corners" | readonly number[] |
  ((column: number, row: number, index: number) => boolean);
export type ClothVectorAtTime = ClothVec3 | ((time: number) => ClothVec3);

export interface ClothImpulse {
  /** Composition-local frame at which the impulse is applied. */
  frame: number;
  /** Top-left-origin normalized coordinates on the cloth. */
  uv: ClothUv;
  /** World-space impulse. The simulation divides it by mass to obtain velocity change. */
  force: ClothVec3;
  /** Normalized UV radius. Defaults to 0.12. */
  radius?: number;
}

export interface ClothSphereCollider {
  type: "sphere";
  center: ClothVectorAtTime;
  radius: number;
}

export interface ClothCapsuleCollider {
  type: "capsule";
  start: ClothVectorAtTime;
  end: ClothVectorAtTime;
  radius: number;
}

export interface ClothPlaneCollider {
  type: "plane";
  /** Unit normal pointing toward the allowed half-space. */
  normal: ClothVec3;
  /** Points must satisfy dot(point, normal) >= offset. */
  offset: number;
}

export type ClothCollider = ClothSphereCollider | ClothCapsuleCollider | ClothPlaneCollider;

export interface ClothSimulationOptions {
  fps: number;
  width?: number;
  height?: number;
  segmentsX?: number;
  segmentsY?: number;
  mass?: number;
  gravity?: ClothVec3;
  wind?: ClothVectorAtTime | false;
  damping?: number;
  stiffness?: number;
  shearStiffness?: number;
  bendStiffness?: number;
  substeps?: number;
  iterations?: number;
  pins?: ClothPins;
  colliders?: readonly ClothCollider[];
  impulses?: readonly ClothImpulse[];
  /** Stable integer seed used only for the initial out-of-plane perturbation. */
  seed?: number;
  initialPerturbation?: number;
  /** State checkpoint cadence used for efficient backward random access. */
  checkpointIntervalFrames?: number;
}

export interface ClothSimulation {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly columns: number;
  readonly rows: number;
  readonly pinned: Uint8Array;
  readonly currentFrame: number;
  /** Deterministically derive the cloth state at an absolute composition-local frame. */
  seek(frame: number): void;
  reset(): void;
}

interface Constraint {
  a: number;
  b: number;
  rest: number;
  stiffness: number;
}

interface Checkpoint {
  positions: Float32Array;
  previous: Float32Array;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const finitePositive = (value: number | undefined, fallback: number) =>
  value != null && Number.isFinite(value) && value > 0 ? value : fallback;

function stableNoise(seed: number, index: number): number {
  let value = (seed | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function vectorAt(value: ClothVectorAtTime | false | undefined, time: number): ClothVec3 {
  if (!value) return [0, 0, 0];
  return typeof value === "function" ? value(time) : value;
}

function buildIndices(segmentsX: number, segmentsY: number): Uint32Array {
  const indices = new Uint32Array(segmentsX * segmentsY * 6);
  let cursor = 0;
  for (let row = 0; row < segmentsY; row++) {
    for (let column = 0; column < segmentsX; column++) {
      const topLeft = row * (segmentsX + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + segmentsX + 1;
      const bottomRight = bottomLeft + 1;
      indices[cursor++] = topLeft;
      indices[cursor++] = bottomLeft;
      indices[cursor++] = topRight;
      indices[cursor++] = topRight;
      indices[cursor++] = bottomLeft;
      indices[cursor++] = bottomRight;
    }
  }
  return indices;
}

function recalculateNormals(positions: Float32Array, indices: Uint32Array, normals: Float32Array): void {
  normals.fill(0);
  for (let cursor = 0; cursor < indices.length; cursor += 3) {
    const ia = indices[cursor] * 3;
    const ib = indices[cursor + 1] * 3;
    const ic = indices[cursor + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const index of [ia, ib, ic]) {
      normals[index] += nx;
      normals[index + 1] += ny;
      normals[index + 2] += nz;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]);
    if (length <= 1e-12) {
      normals[index] = 0;
      normals[index + 1] = 0;
      normals[index + 2] = 1;
    } else {
      normals[index] /= length;
      normals[index + 1] /= length;
      normals[index + 2] /= length;
    }
  }
}

/** Pure fixed-step cloth simulation with checkpointed absolute-frame seeking. */
export function createClothSimulation(options: ClothSimulationOptions): ClothSimulation {
  const fps = finitePositive(options.fps, 30);
  const width = finitePositive(options.width, 3.2);
  const height = finitePositive(options.height, 1.8);
  const segmentsX = Math.max(2, Math.floor(finitePositive(options.segmentsX, 24)));
  const segmentsY = Math.max(2, Math.floor(finitePositive(options.segmentsY, 16)));
  const columns = segmentsX + 1;
  const rows = segmentsY + 1;
  const pointCount = columns * rows;
  const mass = finitePositive(options.mass, 1);
  const gravity = options.gravity ?? [0, -9.8, 0];
  const wind = options.wind ?? false;
  const damping = clamp01(options.damping ?? 0.035);
  const stiffness = clamp01(options.stiffness ?? 0.92);
  const shearStiffness = clamp01(options.shearStiffness ?? stiffness * 0.8);
  const bendStiffness = clamp01(options.bendStiffness ?? stiffness * 0.3);
  const substeps = Math.max(1, Math.min(16, Math.floor(finitePositive(options.substeps, 4))));
  const iterations = Math.max(1, Math.min(24, Math.floor(finitePositive(options.iterations, 8))));
  const dt = 1 / (fps * substeps);
  const dtSquared = dt * dt;
  const dampingPerStep = Math.pow(1 - damping, 60 * dt);
  const seed = options.seed ?? 1;
  const perturbation = Math.max(0, options.initialPerturbation ?? 0.0025);
  const checkpointInterval = Math.max(1, Math.round(
    finitePositive(options.checkpointIntervalFrames, 30) * substeps,
  ));
  const colliders = options.colliders ?? [];
  const impulsesByStep = new Map<number, ClothImpulse[]>();
  for (const impulse of options.impulses ?? []) {
    const step = Math.max(1, Math.round(Math.max(0, impulse.frame) * substeps));
    const bucket = impulsesByStep.get(step) ?? [];
    bucket.push(impulse);
    impulsesByStep.set(step, bucket);
  }

  const positions = new Float32Array(pointCount * 3);
  const previous = new Float32Array(pointCount * 3);
  const normals = new Float32Array(pointCount * 3);
  const uvs = new Float32Array(pointCount * 2);
  const pinned = new Uint8Array(pointCount);
  const anchors = new Float32Array(pointCount * 3);
  const pinOption = options.pins ?? "top";
  const pinSet = Array.isArray(pinOption) ? new Set<number>(pinOption) : undefined;

  for (let row = 0; row <= segmentsY; row++) {
    for (let column = 0; column <= segmentsX; column++) {
      const point = row * columns + column;
      const positionIndex = point * 3;
      positions[positionIndex] = (column / segmentsX - 0.5) * width;
      positions[positionIndex + 1] = (0.5 - row / segmentsY) * height;
      positions[positionIndex + 2] = stableNoise(seed, point) * perturbation;
      uvs[point * 2] = column / segmentsX;
      uvs[point * 2 + 1] = 1 - row / segmentsY;

      const isPinned = typeof pinOption === "function"
        ? pinOption(column, row, point)
        : pinSet
          ? pinSet.has(point)
          : pinOption === "top"
            ? row === 0
            : pinOption === "corners"
              ? row === 0 && (column === 0 || column === segmentsX)
              : false;
      pinned[point] = isPinned ? 1 : 0;
    }
  }
  previous.set(positions);
  anchors.set(positions);

  const indices = buildIndices(segmentsX, segmentsY);
  const constraints: Constraint[] = [];
  const addConstraint = (a: number, b: number, rest: number, constraintStiffness: number) => {
    constraints.push({ a, b, rest, stiffness: constraintStiffness });
  };
  const dx = width / segmentsX;
  const dy = height / segmentsY;
  const diagonal = Math.hypot(dx, dy);
  for (let row = 0; row <= segmentsY; row++) {
    for (let column = 0; column <= segmentsX; column++) {
      const point = row * columns + column;
      if (column < segmentsX) addConstraint(point, point + 1, dx, stiffness);
      if (row < segmentsY) addConstraint(point, point + columns, dy, stiffness);
      if (column < segmentsX && row < segmentsY) {
        addConstraint(point, point + columns + 1, diagonal, shearStiffness);
        addConstraint(point + 1, point + columns, diagonal, shearStiffness);
      }
      if (column + 2 <= segmentsX) addConstraint(point, point + 2, dx * 2, bendStiffness);
      if (row + 2 <= segmentsY) addConstraint(point, point + columns * 2, dy * 2, bendStiffness);
    }
  }

  const iterationStrength = (value: number) => 1 - Math.pow(1 - value, 1 / iterations);
  for (const constraint of constraints) constraint.stiffness = iterationStrength(constraint.stiffness);

  const checkpoints = new Map<number, Checkpoint>();
  checkpoints.set(0, { positions: positions.slice(), previous: previous.slice() });
  let currentStep = 0;

  const restorePins = () => {
    for (let point = 0; point < pointCount; point++) {
      if (!pinned[point]) continue;
      const index = point * 3;
      positions[index] = anchors[index];
      positions[index + 1] = anchors[index + 1];
      positions[index + 2] = anchors[index + 2];
      previous[index] = anchors[index];
      previous[index + 1] = anchors[index + 1];
      previous[index + 2] = anchors[index + 2];
    }
  };

  const solveConstraint = (constraint: Constraint) => {
    const ia = constraint.a * 3;
    const ib = constraint.b * 3;
    const deltaX = positions[ib] - positions[ia];
    const deltaY = positions[ib + 1] - positions[ia + 1];
    const deltaZ = positions[ib + 2] - positions[ia + 2];
    const distance = Math.hypot(deltaX, deltaY, deltaZ);
    if (distance <= 1e-10) return;
    const weightA = pinned[constraint.a] ? 0 : 1;
    const weightB = pinned[constraint.b] ? 0 : 1;
    const weight = weightA + weightB;
    if (!weight) return;
    const correction = ((distance - constraint.rest) / distance) * constraint.stiffness;
    const aScale = correction * weightA / weight;
    const bScale = correction * weightB / weight;
    positions[ia] += deltaX * aScale;
    positions[ia + 1] += deltaY * aScale;
    positions[ia + 2] += deltaZ * aScale;
    positions[ib] -= deltaX * bScale;
    positions[ib + 1] -= deltaY * bScale;
    positions[ib + 2] -= deltaZ * bScale;
  };

  const pushOutsideSphere = (point: number, center: ClothVec3, radius: number) => {
    const index = point * 3;
    const deltaX = positions[index] - center[0];
    const deltaY = positions[index + 1] - center[1];
    const deltaZ = positions[index + 2] - center[2];
    const distance = Math.hypot(deltaX, deltaY, deltaZ);
    if (distance >= radius) return;
    const inverse = distance > 1e-10 ? 1 / distance : 0;
    const normalX = distance > 1e-10 ? deltaX * inverse : 0;
    const normalY = distance > 1e-10 ? deltaY * inverse : 0;
    const normalZ = distance > 1e-10 ? deltaZ * inverse : 1;
    positions[index] = center[0] + normalX * radius;
    positions[index + 1] = center[1] + normalY * radius;
    positions[index + 2] = center[2] + normalZ * radius;
  };

  const solveCollisions = (time: number) => {
    for (let point = 0; point < pointCount; point++) {
      if (pinned[point]) continue;
      const index = point * 3;
      for (const collider of colliders) {
        if (collider.type === "sphere") {
          pushOutsideSphere(point, vectorAt(collider.center, time), Math.max(0, collider.radius));
        } else if (collider.type === "capsule") {
          const start = vectorAt(collider.start, time);
          const end = vectorAt(collider.end, time);
          const segmentX = end[0] - start[0];
          const segmentY = end[1] - start[1];
          const segmentZ = end[2] - start[2];
          const lengthSquared = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
          const projection = lengthSquared > 1e-12
            ? ((positions[index] - start[0]) * segmentX +
              (positions[index + 1] - start[1]) * segmentY +
              (positions[index + 2] - start[2]) * segmentZ) / lengthSquared
            : 0;
          const amount = clamp01(projection);
          pushOutsideSphere(point, [
            start[0] + segmentX * amount,
            start[1] + segmentY * amount,
            start[2] + segmentZ * amount,
          ], Math.max(0, collider.radius));
        } else {
          const normalLength = Math.hypot(...collider.normal) || 1;
          const normalX = collider.normal[0] / normalLength;
          const normalY = collider.normal[1] / normalLength;
          const normalZ = collider.normal[2] / normalLength;
          const distance = positions[index] * normalX + positions[index + 1] * normalY +
            positions[index + 2] * normalZ - collider.offset;
          if (distance < 0) {
            positions[index] -= distance * normalX;
            positions[index + 1] -= distance * normalY;
            positions[index + 2] -= distance * normalZ;
          }
        }
      }
    }
  };

  const applyImpulses = (step: number) => {
    const impulses = impulsesByStep.get(step);
    if (!impulses) return;
    for (const impulse of impulses) {
      const radius = Math.max(1e-4, impulse.radius ?? 0.12);
      for (let row = 0; row <= segmentsY; row++) {
        for (let column = 0; column <= segmentsX; column++) {
          const point = row * columns + column;
          if (pinned[point]) continue;
          const distance = Math.hypot(column / segmentsX - impulse.uv[0], row / segmentsY - impulse.uv[1]);
          if (distance >= radius) continue;
          const falloff = 1 - distance / radius;
          const index = point * 3;
          previous[index] -= impulse.force[0] / mass * dt * falloff;
          previous[index + 1] -= impulse.force[1] / mass * dt * falloff;
          previous[index + 2] -= impulse.force[2] / mass * dt * falloff;
        }
      }
    }
  };

  const stepSimulation = () => {
    const nextStep = currentStep + 1;
    const time = nextStep * dt;
    applyImpulses(nextStep);
    const windVector = vectorAt(wind, time);
    for (let point = 0; point < pointCount; point++) {
      if (pinned[point]) continue;
      const index = point * 3;
      const x = positions[index];
      const y = positions[index + 1];
      const z = positions[index + 2];
      const velocityX = (x - previous[index]) * dampingPerStep;
      const velocityY = (y - previous[index + 1]) * dampingPerStep;
      const velocityZ = (z - previous[index + 2]) * dampingPerStep;
      previous[index] = x;
      previous[index + 1] = y;
      previous[index + 2] = z;
      positions[index] = x + velocityX + (gravity[0] + windVector[0]) * dtSquared;
      positions[index + 1] = y + velocityY + (gravity[1] + windVector[1]) * dtSquared;
      positions[index + 2] = z + velocityZ + (gravity[2] + windVector[2]) * dtSquared;
    }
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (const constraint of constraints) solveConstraint(constraint);
      solveCollisions(time);
      restorePins();
    }
    currentStep = nextStep;
    if (currentStep % checkpointInterval === 0) {
      checkpoints.set(currentStep, { positions: positions.slice(), previous: previous.slice() });
    }
  };

  const restoreCheckpoint = (targetStep: number) => {
    let checkpointStep = 0;
    for (const step of checkpoints.keys()) {
      if (step <= targetStep && step > checkpointStep) checkpointStep = step;
    }
    const checkpoint = checkpoints.get(checkpointStep)!;
    positions.set(checkpoint.positions);
    previous.set(checkpoint.previous);
    currentStep = checkpointStep;
  };

  const seek = (frame: number) => {
    const targetStep = Math.max(0, Math.round((Number.isFinite(frame) ? frame : 0) * substeps));
    if (targetStep < currentStep) restoreCheckpoint(targetStep);
    while (currentStep < targetStep) stepSimulation();
    recalculateNormals(positions, indices, normals);
  };

  const reset = () => {
    const initial = checkpoints.get(0)!;
    positions.set(initial.positions);
    previous.set(initial.previous);
    currentStep = 0;
    recalculateNormals(positions, indices, normals);
  };

  recalculateNormals(positions, indices, normals);
  return {
    positions,
    normals,
    uvs,
    indices,
    columns,
    rows,
    pinned,
    get currentFrame() { return currentStep / substeps; },
    seek,
    reset,
  };
}

export interface ClothCameraOptions {
  position?: ClothVec3;
  target?: ClothVec3;
  fov?: number;
  near?: number;
  far?: number;
}

export interface ClothMaterialOptions {
  color?: number | string;
  roughness?: number;
  metalness?: number;
  emissive?: number | string;
  emissiveIntensity?: number;
  /** Thin-film, view-dependent color shift. Set from 0–1. */
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: readonly [number, number];
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: number | string;
  transparent?: boolean;
}

export interface ClothTransformOptions {
  position?: ClothVec3;
  rotation?: ClothVec3;
  scale?: number | ClothVec3;
}

export interface ClothRendererOptions {
  simulation: ClothSimulationOptions;
  camera?: ClothCameraOptions;
  material?: ClothMaterialOptions;
  transform?: ClothTransformOptions;
  clearColor?: number | string;
  clearAlpha?: number;
  ambientLight?: { color?: number | string; intensity?: number };
  directionalLight?: { color?: number | string; intensity?: number; position?: ClothVec3 };
}

export type ClothTextureSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap | HTMLImageElement;

export interface ClothRenderer {
  readonly simulation: ClothSimulation;
  render(source: ClothTextureSource | undefined, frame: number): void;
  capture(source: ClothTextureSource | undefined, frame: number): HTMLCanvasElement;
  destroy(): void;
}

/** Three.js-backed cloth renderer. Three remains an optional peer and is loaded only when used. */
export async function createClothRenderer(
  canvas: HTMLCanvasElement,
  pixelWidth: number,
  pixelHeight: number,
  options: ClothRendererOptions,
): Promise<ClothRenderer> {
  const THREE = await import("three");
  const simulation = createClothSimulation(options.simulation);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(pixelWidth, pixelHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(options.clearColor ?? 0x000000, options.clearAlpha ?? 0);

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(simulation.positions, 3);
  const normalAttribute = new THREE.BufferAttribute(simulation.normals, 3);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("normal", normalAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(simulation.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(simulation.indices, 1));

  const blank = document.createElement("canvas");
  blank.width = 2;
  blank.height = 2;
  blank.getContext("2d")!.fillRect(0, 0, 2, 2);
  const texture = new THREE.CanvasTexture(blank);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;

  const materialOptions = options.material ?? {};
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    color: materialOptions.color ?? 0xffffff,
    roughness: clamp01(materialOptions.roughness ?? 0.72),
    metalness: clamp01(materialOptions.metalness ?? 0.05),
    emissive: materialOptions.emissive ?? 0x000000,
    emissiveIntensity: materialOptions.emissiveIntensity ?? 0,
    iridescence: clamp01(materialOptions.iridescence ?? 0),
    iridescenceIOR: materialOptions.iridescenceIOR ?? 1.3,
    iridescenceThicknessRange: [...(materialOptions.iridescenceThicknessRange ?? [100, 400])],
    clearcoat: clamp01(materialOptions.clearcoat ?? 0),
    clearcoatRoughness: clamp01(materialOptions.clearcoatRoughness ?? 0),
    sheen: clamp01(materialOptions.sheen ?? 0),
    sheenRoughness: clamp01(materialOptions.sheenRoughness ?? 1),
    sheenColor: materialOptions.sheenColor ?? 0xffffff,
    side: THREE.DoubleSide,
    transparent: materialOptions.transparent ?? true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const transform = options.transform ?? {};
  if (transform.position) mesh.position.set(...transform.position);
  if (transform.rotation) mesh.rotation.set(...transform.rotation);
  if (typeof transform.scale === "number") mesh.scale.setScalar(transform.scale);
  else if (transform.scale) mesh.scale.set(...transform.scale);

  const scene = new THREE.Scene();
  scene.add(mesh);
  const ambient = options.ambientLight ?? {};
  scene.add(new THREE.AmbientLight(ambient.color ?? 0xffffff, ambient.intensity ?? 1.35));
  const directionalOptions = options.directionalLight ?? {};
  const directional = new THREE.DirectionalLight(
    directionalOptions.color ?? 0xffffff,
    directionalOptions.intensity ?? 2.2,
  );
  directional.position.set(...(directionalOptions.position ?? [-2.5, 4, 4]));
  scene.add(directional);

  const cameraOptions = options.camera ?? {};
  const fov = cameraOptions.fov ?? 35;
  const aspect = pixelWidth / pixelHeight;
  const simulationWidth = options.simulation.width ?? 3.2;
  const simulationHeight = options.simulation.height ?? 1.8;
  const fitDistance = Math.max(
    simulationHeight / (2 * Math.tan((fov * Math.PI) / 360)),
    simulationWidth / (2 * aspect * Math.tan((fov * Math.PI) / 360)),
  ) * 1.12;
  const camera = new THREE.PerspectiveCamera(fov, aspect, cameraOptions.near ?? 0.01, cameraOptions.far ?? 100);
  camera.position.set(...(cameraOptions.position ?? [0, 0, fitDistance]));
  camera.lookAt(...(cameraOptions.target ?? [0, 0, 0]));
  camera.updateProjectionMatrix();

  let currentSource: ClothTextureSource | undefined;
  const render = (source: ClothTextureSource | undefined, frame: number) => {
    simulation.seek(frame);
    positionAttribute.needsUpdate = true;
    normalAttribute.needsUpdate = true;
    if (source && source !== currentSource) {
      currentSource = source;
      (texture as unknown as { image: ClothTextureSource }).image = source;
      texture.needsUpdate = true;
    }
    renderer.render(scene, camera);
  };
  const capture = (source: ClothTextureSource | undefined, frame: number) => {
    render(source, frame);
    const output = document.createElement("canvas");
    output.width = pixelWidth;
    output.height = pixelHeight;
    output.getContext("2d")!.drawImage(canvas, 0, 0);
    return output;
  };
  const destroy = () => {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
  };
  return { simulation, render, capture, destroy };
}

export type ClothTextureRefresh = "once" | "mutation" | "frame";

export interface ClothSetupOptions {
  /** Canvas selector. Defaults to `canvas[data-fd-cloth]`. */
  selector?: string;
  /** DOM source selector, or resolver for each canvas. Defaults to `data-fd-cloth-source`. */
  source?: string | ((canvas: HTMLCanvasElement, root: HTMLElement) => HTMLElement | null);
  textureRefresh?: ClothTextureRefresh;
  texturePixelRatio?: number;
  textureWidth?: number;
  textureHeight?: number;
  /** Make the source transparent in the composition while retaining its layout for rasterization. */
  hideSource?: boolean;
  simulation?: Omit<ClothSimulationOptions, "fps">;
  camera?: ClothCameraOptions;
  material?: ClothMaterialOptions;
  transform?: ClothTransformOptions;
  clearColor?: number | string;
  clearAlpha?: number;
  ambientLight?: ClothRendererOptions["ambientLight"];
  directionalLight?: ClothRendererOptions["directionalLight"];
}

export interface ClothCompositionOptions {
  /** Registry key used to mount the input composition. Defaults to the input composition id. */
  sourceKey?: string;
  id?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationInFrames?: number;
  fit?: "cover" | "contain" | "fill";
  background?: string;
  document?: unknown;
  meta?: CompositionMetadata;
  /**
   * Static cloth settings, or a resolver used when the wrapper owns an editable document.
   * Document changes rebuild only the cloth resources and keep the composition mounted.
   */
  cloth?: ClothSetupOptions | ((document: unknown) => ClothSetupOptions);
}

const htmlAttribute = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

/**
 * Turn any registered visual composition into a deterministic cloth composition.
 * The child stays mounted on the parent clock and is rasterized as the cloth texture,
 * so authored animation, nested media, preview, and exact capture all share one frame.
 */
export function createClothComposition(
  sourceComposition: CompositionConfig,
  options: ClothCompositionOptions = {},
): CompositionConfig {
  const id = options.id ?? `${sourceComposition.id}Cloth`;
  const width = options.width ?? sourceComposition.width;
  const height = options.height ?? sourceComposition.height;
  const fps = options.fps ?? sourceComposition.fps;
  const durationInFrames = options.durationInFrames ?? sourceComposition.durationInFrames;
  const sourceKey = options.sourceKey ?? sourceComposition.id;
  const fit = options.fit ?? "contain";
  const background = options.background ?? "#090a08";
  const source = `<!doctype html>
<html>
<head>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;width:100%;height:100%;overflow:hidden}
    [data-fd-composition]{position:relative;overflow:hidden;background:${htmlAttribute(background)}}
    [data-fd-cloth-input]{position:absolute;inset:0;overflow:hidden}
    [data-fd-cloth-output]{position:absolute;inset:0;width:100%;height:100%}
    .fd-cloth-error{display:none;position:absolute;z-index:5;left:50%;top:50%;max-width:min(520px,calc(100% - 40px));padding:14px 16px;transform:translate(-50%,-50%);border:1px solid rgba(255,186,160,.34);border-radius:10px;background:rgba(26,12,9,.92);color:#ffd9cb;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.5)}
    [data-fd-error] .fd-cloth-error{display:block}
  </style>
</head>
<body>
  <main data-fd-composition data-fd-id="${htmlAttribute(id)}" data-fd-width="${width}" data-fd-height="${height}" data-fd-fps="${fps}" data-fd-duration="${durationInFrames}" data-fd-kind="scene">
    <section id="fd-cloth-input" data-fd-cloth-input data-fd-type="nested" data-fd-comp="${htmlAttribute(sourceKey)}" data-fd-layout-space="composition" data-fd-x="0" data-fd-y="0" data-fd-width="${width}" data-fd-height="${height}" data-fd-fit="${fit}" aria-hidden="true"></section>
    <canvas data-fd-cloth-output data-fd-cloth data-fd-cloth-source="#fd-cloth-input" data-fd-cloth-refresh="frame" aria-label="${htmlAttribute(sourceComposition.id)} rendered as animated cloth"></canvas>
    <div class="fd-cloth-error" role="alert"></div>
  </main>
</body>
</html>`;

  const clothOptions = options.cloth;
  const resolveOptions: (document: unknown) => ClothSetupOptions = typeof clothOptions === "function"
    ? clothOptions
    : () => clothOptions ?? {};
  const setup: CompositionSetup = async (context) => {
    let generation = 0;
    let disposed = false;
    let activeCleanups: Array<() => void> = [];
    let reconfiguration = Promise.resolve();
    const disposeCleanups = (cleanups: Array<() => void>) => {
      for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
    };
    const configure = (document: unknown): Promise<void> => {
      const currentGeneration = ++generation;
      reconfiguration = reconfiguration.catch(() => {}).then(async () => {
        if (disposed || currentGeneration !== generation) return;
        disposeCleanups(activeCleanups);
        activeCleanups = [];
        const nextCleanups: Array<() => void> = [];
        try {
          await createClothSetup(resolveOptions(document))({
            ...context,
            document,
            onCleanup: (cleanup) => nextCleanups.push(cleanup),
          });
        } catch (error) {
          disposeCleanups(nextCleanups);
          const message = error instanceof Error ? error.message : String(error);
          context.root.dataset.fdError = message;
          const errorElement = context.root.querySelector<HTMLElement>(".fd-cloth-error");
          if (errorElement) errorElement.textContent = `Cloth preview failed. ${message}`;
          throw error;
        }
        if (disposed || currentGeneration !== generation) disposeCleanups(nextCleanups);
        else {
          delete context.root.dataset.fdError;
          const errorElement = context.root.querySelector<HTMLElement>(".fd-cloth-error");
          if (errorElement) errorElement.textContent = "";
          activeCleanups = nextCleanups;
        }
      });
      return reconfiguration;
    };

    await configure(context.document);
    const stopDocument = context.onDocument((document) => configure(document));
    context.onCleanup(() => {
      disposed = true;
      generation += 1;
      stopDocument();
      disposeCleanups(activeCleanups);
      activeCleanups = [];
    });
  };

  return defineComposition(source, {
    type: "three",
    setup,
    document: options.document,
    meta: {
      ...options.meta,
      deps: [...new Set([...(options.meta?.deps ?? []), sourceComposition.meta?.module].filter((value): value is string => !!value))],
      authoring: {
        timeline: "hidden",
        transport: "always",
        directManipulation: false,
        ...options.meta?.authoring,
      },
    },
  });
}

const numericAttribute = (element: Element, name: string, fallback: number): number => {
  const owner = element.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  const source = owner?.hasAttribute(name) ? owner : element;
  const value = Number(source.getAttribute(name));
  return source.hasAttribute(name) && Number.isFinite(value) ? value : fallback;
};

const localFrame = (canvas: HTMLCanvasElement, fallback: number) => {
  const clip = canvas.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  const value = Number(clip?.dataset.fdLocalFrame);
  return Number.isFinite(value) ? value : fallback;
};

function createLatestFrameQueue(work: (frame: number) => Promise<void>) {
  let pending: number | undefined;
  let running = false;
  let disposed = false;
  const pump = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed && pending !== undefined) {
        const frame = pending;
        pending = undefined;
        try { await work(frame); } catch (error) {
          if (!disposed) console.error("FrameDiff cloth preview failed.", error);
        }
      }
    } finally {
      running = false;
      if (!disposed && pending !== undefined) void pump();
    }
  };
  return {
    push(frame: number) { if (!disposed) { pending = frame; void pump(); } },
    clear() { pending = undefined; },
    dispose() { disposed = true; pending = undefined; },
    get disposed() { return disposed; },
  };
}

/** Bind authored DOM to deterministic cloth canvases with exact preview/export capture. */
export function createClothSetup(options: ClothSetupOptions = {}): CompositionSetup {
  return async ({ root, composition, onFrame, onCleanup }) => {
    const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>(options.selector ?? "canvas[data-fd-cloth]"));
    await Promise.all(canvases.map(async (canvas) => {
      const sourceSelector = typeof options.source === "string"
        ? options.source
        : canvas.getAttribute("data-fd-cloth-source") ?? "";
      const source = typeof options.source === "function"
        ? options.source(canvas, root)
        : sourceSelector
          ? root.querySelector<HTMLElement>(sourceSelector)
          : null;
      if (!source) {
        throw new Error("FrameDiff cloth needs a DOM source via `source` or `data-fd-cloth-source`.");
      }
      if (source === canvas) throw new Error("FrameDiff cloth source must be a DOM element other than its render canvas.");

      const renderWidth = numericAttribute(canvas, "data-fd-render-width", composition.width);
      const renderHeight = numericAttribute(canvas, "data-fd-render-height", composition.height);
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width ||= "100%";
      canvas.style.height ||= "100%";
      const base = options.simulation ?? {};
      const gravityY = numericAttribute(canvas, "data-fd-cloth-gravity", base.gravity?.[1] ?? -9.8);
      const simulation: ClothSimulationOptions = {
        ...base,
        fps: composition.fps,
        width: numericAttribute(canvas, "data-fd-cloth-width", base.width ?? 3.2),
        height: numericAttribute(canvas, "data-fd-cloth-height", base.height ?? 1.8),
        segmentsX: numericAttribute(canvas, "data-fd-cloth-segments-x", base.segmentsX ?? 24),
        segmentsY: numericAttribute(canvas, "data-fd-cloth-segments-y", base.segmentsY ?? 16),
        mass: numericAttribute(canvas, "data-fd-cloth-mass", base.mass ?? 1),
        damping: numericAttribute(canvas, "data-fd-cloth-damping", base.damping ?? 0.035),
        stiffness: numericAttribute(canvas, "data-fd-cloth-stiffness", base.stiffness ?? 0.92),
        bendStiffness: numericAttribute(canvas, "data-fd-cloth-bend-stiffness", base.bendStiffness ?? 0.276),
        substeps: numericAttribute(canvas, "data-fd-cloth-substeps", base.substeps ?? 4),
        iterations: numericAttribute(canvas, "data-fd-cloth-iterations", base.iterations ?? 8),
        gravity: [base.gravity?.[0] ?? 0, gravityY, base.gravity?.[2] ?? 0],
      };
      const renderer = await createClothRenderer(canvas, renderWidth, renderHeight, {
        simulation,
        camera: options.camera,
        material: {
          ...options.material,
          roughness: numericAttribute(canvas, "data-fd-cloth-roughness", options.material?.roughness ?? 0.72),
          metalness: numericAttribute(canvas, "data-fd-cloth-metalness", options.material?.metalness ?? 0.05),
        },
        transform: options.transform,
        clearColor: options.clearColor,
        clearAlpha: options.clearAlpha,
        ambientLight: options.ambientLight,
        directionalLight: options.directionalLight,
      });

      const hideSource = options.hideSource ?? true;
      const originalOpacity = source.style.opacity;
      const originalPointerEvents = source.style.pointerEvents;
      const textureOpacity = getComputedStyle(source).opacity || "1";
      if (hideSource) {
        source.style.opacity = "0";
        source.style.pointerEvents = "none";
        source.setAttribute("data-framediff-cloth-source", "");
      }
      const restoreSource = () => {
        if (!hideSource) return;
        source.style.opacity = originalOpacity;
        source.style.pointerEvents = originalPointerEvents;
        source.removeAttribute("data-framediff-cloth-source");
      };
      const refreshAttribute = canvas.getAttribute("data-fd-cloth-refresh") as ClothTextureRefresh | null;
      const refresh = refreshAttribute === "once" || refreshAttribute === "mutation" || refreshAttribute === "frame"
        ? refreshAttribute
        : options.textureRefresh ?? "frame";
      let textureDirty = true;
      let textureCanvas: HTMLCanvasElement | undefined;
      let fontEmbedCSS = "";
      try { fontEmbedCSS = await getFontEmbedCSS(source); } catch { /* fonts remain optional */ }
      const observer = refresh === "mutation" ? new MutationObserver(() => { textureDirty = true; }) : undefined;
      observer?.observe(source, { attributes: true, childList: true, characterData: true, subtree: true });

      const rasterSource = async () => {
        if (textureCanvas && (refresh === "once" || (refresh === "mutation" && !textureDirty))) return textureCanvas;
        textureCanvas = await toCanvas(source, {
          pixelRatio: finitePositive(options.texturePixelRatio, 1),
          canvasWidth: options.textureWidth,
          canvasHeight: options.textureHeight,
          fontEmbedCSS,
          cacheBust: false,
          style: { opacity: textureOpacity },
        });
        textureDirty = false;
        return textureCanvas;
      };

      let latestRequestedFrame = 0;
      const previewQueue = createLatestFrameQueue(async (frame) => {
        latestRequestedFrame = frame;
        const textureSource = await rasterSource();
        if (previewQueue.disposed || frame !== latestRequestedFrame || !isVisualElementActive(canvas, root)) return;
        renderer.render(textureSource, frame);
        canvas.dataset.framediffRenderedTime = String(frame / composition.fps);
      });
      try {
        const initialTexture = await rasterSource();
        renderer.render(initialTexture, 0);
      } catch (error) {
        previewQueue.dispose();
        observer?.disconnect();
        renderer.destroy();
        restoreSource();
        throw error;
      }

      const stopFrame = onFrame((state) => {
        if (!isVisualElementActive(canvas, root)) {
          previewQueue.clear();
          return;
        }
        const frame = localFrame(canvas, state.frame);
        canvas.dataset.framediffTime = String(frame / composition.fps);
        if ((window as { __FRAMEDIFF_CAPTURE_MODE__?: boolean }).__FRAMEDIFF_CAPTURE_MODE__) {
          previewQueue.clear();
          return;
        }
        previewQueue.push(frame);
      });
      const stopCapture = registerCanvasCapture(canvas, async (time) => {
        const frame = time * composition.fps;
        const textureSource = await rasterSource();
        return renderer.capture(textureSource, frame);
      });
      onCleanup(() => {
        stopFrame();
        stopCapture();
        previewQueue.dispose();
        observer?.disconnect();
        renderer.destroy();
        restoreSource();
      });
    }));
  };
}
