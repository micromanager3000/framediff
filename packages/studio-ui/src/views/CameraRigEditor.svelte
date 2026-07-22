<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import type { InspectorFieldSnapshot, InspectorSectionSnapshot } from "@framediff/studio-model";
  import {
    cameraFieldMap,
    cameraFieldOfView,
    cameraFieldValue,
    cameraVectorEdits,
    cameraVectorKeys,
    cameraVectorValue,
    type CameraEndpoint,
    type CameraRigHandle,
    type CameraVector,
  } from "../viewmodels/CameraInspector.ViewModel";

  export let section: InspectorSectionSnapshot;
  export let endpoint: CameraEndpoint;
  export let disabled = false;
  export let planePreviewUrl: string | undefined;
  export let planePreviewTime = 0;
  export let onclose: () => void;
  export let onendpoint: (endpoint: CameraEndpoint) => void;
  export let oncommit: (fieldId: string, value: number) => void | Promise<boolean>;
  export let oncommitmany: (
    edits: Array<{ fieldId: string; value: number }>,
    options?: { label?: string; groupId?: string },
  ) => void | boolean | Promise<boolean>;

  type RigTool = CameraRigHandle;
  type ViewPreset = "orbit" | "top" | "front" | "shot";

  let sceneHost: HTMLDivElement;
  let tool: RigTool = "camera";
  let transformMode: "translate" | "rotate" = "translate";
  let viewPreset: ViewPreset = "orbit";
  let draftValues: Record<string, number> = {};
  let dragging = false;
  let initialized = false;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let editorCamera: THREE.PerspectiveCamera | undefined;
  let orbit: OrbitControls | undefined;
  let transform: TransformControls | undefined;
  let transformHelper: THREE.Object3D | undefined;
  let plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
  let video: HTMLVideoElement | undefined;
  let videoTexture: THREE.VideoTexture | undefined;
  let placeholderTexture: THREE.CanvasTexture | undefined;
  let frameHandle = 0;

  const rigCameras = {} as Record<CameraEndpoint, THREE.PerspectiveCamera>;
  const cameraHelpers = {} as Record<CameraEndpoint, THREE.CameraHelper>;
  const cameraMarkers = {} as Record<CameraEndpoint, THREE.Mesh>;
  const targetMarkers = {} as Record<CameraEndpoint, THREE.Mesh>;
  const focusMarkers = {} as Record<CameraEndpoint, THREE.Mesh>;
  const sightLines = {} as Record<CameraEndpoint, THREE.Line>;
  const focusLines = {} as Record<CameraEndpoint, THREE.Line>;
  const endpoints: CameraEndpoint[] = ["start", "end"];
  const axes = ["X", "Y", "Z"] as const;
  const endpointRows = [
    { label: "Camera position", handle: "camera" as const },
    { label: "Look direction", handle: "target" as const },
    { label: "Focus point", handle: "focus" as const },
  ];

  $: fields = cameraFieldMap(section);
  $: endpointTitle = endpoint === "start" ? "Start" : "End";
  $: sceneRevision = `${endpoint}:${disabled}:${section.fields.map((entry) => `${entry.id}:${entry.value ?? entry.text ?? entry.boolean ?? ""}`).join("|")}`;
  $: if (sceneRevision && initialized && !dragging) syncSourceRevision(sceneRevision);
  $: if (video && Number.isFinite(planePreviewTime)) seekVideoFrame();

  const sourceValue = (key: string, fallback = 0): number => cameraFieldValue(fields, key, fallback);
  let value: (key: string, fallback?: number) => number;
  $: value = (key: string, fallback = 0): number => draftValues[key] ?? cameraFieldValue(fields, key, fallback);
  const field = (key: string): InspectorFieldSnapshot | undefined => fields.get(key);
  const keyFor = (side: CameraEndpoint, suffix: string, axis?: string): string => `${side}${suffix}${axis ?? ""}`;
  const rounded = (amount: number, digits = 3): string => Number.isFinite(amount) ? amount.toFixed(digits) : "—";
  const endpointVector = (side: CameraEndpoint, handle: CameraRigHandle): CameraVector =>
    cameraVectorKeys(side, handle).map((key) => value(key)) as CameraVector;
  const randomGroupId = (): string => globalThis.crypto?.randomUUID?.() ?? `camera-rig-${Date.now()}`;

  function syncSourceRevision(_revision: string): void {
    const next = { ...draftValues };
    let changed = false;
    for (const [key, draft] of Object.entries(draftValues)) {
      if (Math.abs(sourceValue(key) - draft) <= 1e-9) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) draftValues = next;
    syncScene();
  }

  function placeholder(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#142331");
    gradient.addColorStop(0.55, "#251b2f");
    gradient.addColorStop(1, "#0d1114");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(143,180,209,.34)";
    context.lineWidth = 2;
    for (let x = 0; x <= canvas.width; x += 80) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
    for (let y = 0; y <= canvas.height; y += 80) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    context.fillStyle = "rgba(245,239,221,.9)";
    context.font = "700 42px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("VIDEO PLANE", canvas.width / 2, canvas.height / 2 - 4);
    context.fillStyle = "rgba(143,180,209,.78)";
    context.font = "24px ui-monospace, monospace";
    context.fillText("source-backed scene surface", canvas.width / 2, canvas.height / 2 + 44);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function installVideoTexture(material: THREE.MeshBasicMaterial): void {
    if (!planePreviewUrl) return;
    video = document.createElement("video");
    video.src = planePreviewUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.addEventListener("loadedmetadata", seekVideoFrame);
    video.addEventListener("seeked", () => { if (videoTexture) videoTexture.needsUpdate = true; });
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    material.map = videoTexture;
    material.needsUpdate = true;
    video.load();
  }

  function seekVideoFrame(): void {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = Math.max(0, Math.min(video.duration - 0.001, planePreviewTime));
    if (Math.abs(video.currentTime - target) > 0.01) {
      try { video.currentTime = target; } catch { /* metadata may still be settling */ }
    }
  }

  function marker(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false }));
  }

  function line(color: number): THREE.Line {
    return new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false }),
    );
  }

  function setLine(target: THREE.Line, from: CameraVector, to: CameraVector): void {
    target.geometry.setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  }

  function activeObject(): THREE.Object3D | undefined {
    if (tool === "camera") return cameraMarkers[endpoint];
    if (tool === "target") return targetMarkers[endpoint];
    if (tool === "focus") return focusMarkers[endpoint];
    return plane;
  }

  function attachTransform(): void {
    if (!transform) return;
    const object = activeObject();
    if (!object) return;
    transform.attach(object);
    transform.setMode(tool === "plane" ? transformMode : "translate");
    transform.enabled = !disabled;
  }

  function syncScene(): void {
    if (!initialized || !plane) return;
    const planeScale = value("planeScale", 1);
    plane.position.set(value("planeX"), value("planeY"), value("planeZ"));
    plane.rotation.set(
      THREE.MathUtils.degToRad(value("planeRotXDeg")),
      THREE.MathUtils.degToRad(value("planeRotYDeg")),
      THREE.MathUtils.degToRad(value("planeRotZDeg")),
    );
    plane.scale.set(Math.max(0.001, value("planeW", 1.6) * planeScale), Math.max(0.001, value("planeH", 0.9) * planeScale), 1);
    const aspect = Math.max(0.01, value("planeW", 1.6) / Math.max(0.01, value("planeH", 0.9)));
    for (const side of endpoints) {
      const camera = endpointVector(side, "camera");
      const target = endpointVector(side, "target");
      const focus = endpointVector(side, "focus");
      cameraMarkers[side].position.set(...camera);
      targetMarkers[side].position.set(...target);
      focusMarkers[side].position.set(...focus);
      rigCameras[side].position.set(...camera);
      rigCameras[side].fov = cameraFieldOfView(value(`${side}FocalLength`, 50));
      rigCameras[side].aspect = aspect;
      rigCameras[side].far = Math.max(0.25, new THREE.Vector3(...camera).distanceTo(new THREE.Vector3(...target)) * 1.2);
      rigCameras[side].lookAt(...target);
      rigCameras[side].updateProjectionMatrix();
      rigCameras[side].updateMatrixWorld(true);
      cameraHelpers[side].update();
      setLine(sightLines[side], camera, target);
      setLine(focusLines[side], camera, focus);
      const active = side === endpoint;
      for (const object of [cameraMarkers[side], targetMarkers[side], focusMarkers[side]]) {
        const material = object.material as THREE.MeshBasicMaterial;
        material.opacity = active ? 1 : 0.22;
        object.visible = viewPreset !== "shot";
      }
      for (const guide of [cameraHelpers[side], sightLines[side], focusLines[side]]) {
        const material = guide.material as THREE.LineBasicMaterial;
        material.opacity = active ? (guide === focusLines[side] ? 0.42 : 0.82) : 0.12;
        material.transparent = true;
        guide.visible = viewPreset !== "shot";
      }
    }
    if (transformHelper) transformHelper.visible = viewPreset !== "shot";
    attachTransform();
  }

  function selectEndpoint(next: CameraEndpoint): void {
    endpoint = next;
    onendpoint(next);
    syncScene();
    if (viewPreset === "shot") setView("shot");
  }

  function selectTool(next: RigTool): void {
    tool = next;
    if (tool !== "plane") transformMode = "translate";
    attachTransform();
  }

  function setTransformMode(next: "translate" | "rotate"): void {
    transformMode = next;
    attachTransform();
  }

  function rigBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    if (plane) {
      plane.updateMatrixWorld(true);
      bounds.expandByObject(plane);
    }
    for (const side of endpoints) {
      bounds.expandByPoint(cameraMarkers[side].position);
      bounds.expandByPoint(targetMarkers[side].position);
      bounds.expandByPoint(focusMarkers[side].position);
    }
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
    return bounds;
  }

  function frameRig(preset: Exclude<ViewPreset, "shot"> = viewPreset === "shot" ? "orbit" : viewPreset): void {
    if (!editorCamera || !orbit) return;
    const bounds = rigBounds();
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.35, size.length() * 0.5);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(editorCamera.fov * 0.5)) * 1.35;
    const direction = preset === "top"
      ? new THREE.Vector3(0, 1, 0.001)
      : preset === "front"
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0.72, 1.2).normalize();
    editorCamera.position.copy(center).addScaledVector(direction, distance);
    editorCamera.up.set(0, preset === "top" ? 0 : 1, preset === "top" ? -1 : 0);
    editorCamera.near = Math.max(0.001, distance / 1000);
    editorCamera.far = Math.max(100, distance * 100);
    orbit.target.copy(center);
    orbit.minDistance = Math.max(0.01, radius * 0.03);
    orbit.maxDistance = Math.max(100, radius * 100);
    editorCamera.updateProjectionMatrix();
    orbit.update();
  }

  function dolly(factor: number): void {
    if (!editorCamera || !orbit || viewPreset === "shot") return;
    const offset = editorCamera.position.clone().sub(orbit.target).multiplyScalar(factor);
    editorCamera.position.copy(orbit.target).add(offset);
    orbit.update();
  }

  function setView(next: ViewPreset): void {
    if (!editorCamera || !orbit) return;
    viewPreset = next;
    if (next === "shot") {
      const camera = endpointVector(endpoint, "camera");
      const target = endpointVector(endpoint, "target");
      editorCamera.position.set(...camera);
      orbit.target.set(...target);
      editorCamera.up.set(0, 1, 0);
      editorCamera.fov = cameraFieldOfView(value(`${endpoint}FocalLength`, 50));
      editorCamera.updateProjectionMatrix();
      orbit.update();
    } else {
      editorCamera.fov = 45;
      frameRig(next);
    }
    syncScene();
  }

  function updateDraftFromTransform(): void {
    const object = activeObject();
    if (!object) return;
    const next = { ...draftValues };
    if (tool === "plane" && transformMode === "rotate") {
      next.planeRotXDeg = THREE.MathUtils.radToDeg(object.rotation.x);
      next.planeRotYDeg = THREE.MathUtils.radToDeg(object.rotation.y);
      next.planeRotZDeg = THREE.MathUtils.radToDeg(object.rotation.z);
    } else {
      const keys = cameraVectorKeys(endpoint, tool);
      next[keys[0]] = object.position.x;
      next[keys[1]] = object.position.y;
      next[keys[2]] = object.position.z;
    }
    draftValues = next;
    syncScene();
  }

  async function commitTransform(): Promise<void> {
    let edits: Array<{ fieldId: string; value: number }> = [];
    let keys: string[] = [];
    if (tool === "plane" && transformMode === "rotate") {
      keys = ["planeRotXDeg", "planeRotYDeg", "planeRotZDeg"];
      edits = keys.flatMap((key) => {
        const sourceField = field(key);
        const next = draftValues[key];
        return sourceField?.editable && Number.isFinite(next) && Math.abs(sourceValue(key) - next) > 1e-9
          ? [{ fieldId: sourceField.id, value: next }]
          : [];
      });
    } else {
      keys = cameraVectorKeys(endpoint, tool);
      const vector = keys.map((key) => draftValues[key] ?? value(key)) as CameraVector;
      edits = cameraVectorEdits(section, endpoint, tool, vector);
    }
    if (edits.length) {
      const label = tool === "plane"
        ? `${transformMode === "rotate" ? "Rotate" : "Move"} video plane`
        : `Move ${endpointTitle.toLowerCase()} ${tool === "target" ? "look target" : tool}`;
      const accepted = await oncommitmany(edits, { label, groupId: randomGroupId() });
      // Keep rendering the exact dragged pose until the JSON-backed section acknowledges it.
      // This also prevents a pre-HMR Inspector snapshot from producing a visible snap.
      if (accepted !== false) return;
    }
    const next = { ...draftValues };
    for (const key of keys) delete next[key];
    draftValues = next;
    syncScene();
  }

  async function commitNumber(sourceField: InspectorFieldSnapshot | undefined, event: Event): Promise<void> {
    if (!sourceField?.editable || disabled) return;
    const next = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(next) && next !== sourceField.value) await oncommit(sourceField.id, next);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.key === "Escape") { onclose(); return; }
    if (target?.matches("input, textarea, select")) return;
    if (event.key.toLowerCase() === "w") setTransformMode("translate");
    if (event.key.toLowerCase() === "e" && tool === "plane") setTransformMode("rotate");
  }

  onMount(() => {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090c0e);
    editorCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    editorCamera.position.set(4.8, 3.4, 5.8);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    sceneHost.appendChild(renderer.domElement);
    orbit = new OrbitControls(editorCamera, renderer.domElement);
    orbit.target.set(0, 0, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.zoomSpeed = 0.9;
    orbit.update();

    const grid = new THREE.GridHelper(14, 28, 0x304554, 0x17232b);
    grid.position.y = -2.2;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(1.2));

    placeholderTexture = placeholder();
    const planeMaterial = new THREE.MeshBasicMaterial({ map: placeholderTexture, side: THREE.DoubleSide, toneMapped: false });
    plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMaterial);
    plane.name = "Video plane";
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xe0ac57, transparent: true, opacity: 0.92 }));
    edge.position.z = 0.002;
    plane.add(edge);
    scene.add(plane);
    installVideoTexture(planeMaterial);

    for (const side of endpoints) {
      rigCameras[side] = new THREE.PerspectiveCamera(45, 16 / 9, 0.04, 8);
      cameraHelpers[side] = new THREE.CameraHelper(rigCameras[side]);
      const helperMaterial = cameraHelpers[side].material as THREE.LineBasicMaterial;
      helperMaterial.color.set(side === "start" ? 0x8fb4d1 : 0x9f8bd1);
      helperMaterial.transparent = true;
      helperMaterial.depthTest = false;
      cameraMarkers[side] = marker(new THREE.SphereGeometry(0.055, 18, 12), side === "start" ? 0x9ed7ff : 0xb9a7ff);
      targetMarkers[side] = marker(new THREE.OctahedronGeometry(0.05), 0xe4a9d2);
      focusMarkers[side] = marker(new THREE.TorusGeometry(0.04, 0.012, 8, 24), 0x7fc79b);
      sightLines[side] = line(side === "start" ? 0x8fb4d1 : 0x9f8bd1);
      focusLines[side] = line(0x7fc79b);
      for (const object of [cameraHelpers[side], cameraMarkers[side], targetMarkers[side], focusMarkers[side], sightLines[side], focusLines[side]]) scene.add(object);
    }

    transform = new TransformControls(editorCamera, renderer.domElement);
    transform.setSize(0.78);
    transformHelper = transform.getHelper();
    scene.add(transformHelper);
    const eventControl = transform as unknown as {
      addEventListener: (type: string, listener: (event: { value?: boolean }) => void) => void;
    };
    eventControl.addEventListener("dragging-changed", (event) => {
      dragging = !!event.value;
      if (orbit) orbit.enabled = !dragging;
      if (!dragging) void commitTransform();
    });
    eventControl.addEventListener("objectChange", () => updateDraftFromTransform());

    const resize = () => {
      if (!renderer || !editorCamera) return;
      const bounds = sceneHost.getBoundingClientRect();
      renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
      editorCamera.aspect = Math.max(0.01, bounds.width / Math.max(1, bounds.height));
      editorCamera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(sceneHost);
    resize();
    initialized = true;
    syncScene();
    frameRig("orbit");
    const render = () => {
      frameHandle = requestAnimationFrame(render);
      orbit?.update();
      if (renderer && scene && editorCamera) renderer.render(scene, editorCamera);
    };
    render();

    return () => {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      transform?.detach();
      transform?.dispose();
      orbit?.dispose();
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
      videoTexture?.dispose();
      placeholderTexture?.dispose();
      planeMaterial.dispose();
      scene?.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material?.dispose();
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
      initialized = false;
    };
  });
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="camera-rig-shade" role="presentation">
  <div class="camera-rig-editor" role="dialog" aria-modal="true" aria-label="3D camera rig editor">
    <header class="camera-rig-header">
      <div class="camera-rig-title">
        <strong>3D RIG EDITOR</strong>
        <span>Move the camera, look target, focus point and source plane directly.</span>
      </div>
      <div class="camera-rig-endpoints" aria-label="Camera endpoint">
        <button class:active={endpoint === "start"} aria-pressed={endpoint === "start"} onclick={() => selectEndpoint("start")}>A · START</button>
        <button class:active={endpoint === "end"} aria-pressed={endpoint === "end"} onclick={() => selectEndpoint("end")}>B · END</button>
      </div>
      <button class="camera-rig-close" aria-label="Close 3D rig editor" onclick={onclose}>×</button>
    </header>

    <div class="camera-rig-workspace">
      <div class="camera-rig-scene">
        <div class="camera-rig-toolbar" aria-label="3D rig controls">
          <div class="camera-rig-toolset">
            {#each [{ id: "camera", label: "CAMERA" }, { id: "target", label: "LOOK AT" }, { id: "focus", label: "FOCUS" }, { id: "plane", label: "PLANE" }] as item (item.id)}
              <button class:active={tool === item.id} onclick={() => selectTool(item.id as RigTool)}>{item.label}</button>
            {/each}
          </div>
          {#if tool === "plane"}
            <div class="camera-rig-toolset compact">
              <button class:active={transformMode === "translate"} onclick={() => setTransformMode("translate")}>W · MOVE</button>
              <button class:active={transformMode === "rotate"} onclick={() => setTransformMode("rotate")}>E · ROTATE</button>
            </div>
          {/if}
          <div class="camera-rig-toolset views">
            {#each [{ id: "orbit", label: "3D" }, { id: "top", label: "TOP" }, { id: "front", label: "FRONT" }, { id: "shot", label: "SHOT POV" }] as item (item.id)}
              <button class:active={viewPreset === item.id} onclick={() => setView(item.id as ViewPreset)}>{item.label}</button>
            {/each}
          </div>
          <div class="camera-rig-toolset zoom" aria-label="3D view zoom">
            <button aria-label="Zoom in" onclick={() => dolly(0.78)}>＋</button>
            <button onclick={() => frameRig()}>FIT</button>
            <button aria-label="Zoom out" onclick={() => dolly(1.28)}>−</button>
          </div>
        </div>
        <div class="camera-rig-canvas" bind:this={sceneHost}></div>
        <div class="camera-rig-legend">
          <span class="camera-dot"></span> camera
          <span class="target-dot"></span> look at
          <span class="focus-dot"></span> focus
          <span class="plane-dot"></span> video plane
        </div>
        <div class="camera-rig-hint">
          <strong>{endpointTitle} · {tool === "target" ? "look direction" : tool}</strong>
          <span>Drag the colored axes · orbit with left drag · pan with right drag · scroll to dolly</span>
          <small>{planePreviewUrl ? `Video frame ${rounded(planePreviewTime, 2)}s` : "Media unavailable — showing a source-plane placeholder"}</small>
        </div>
      </div>

      <aside class="camera-rig-properties" aria-label="3D rig numeric properties">
        <div class="camera-rig-prop-head">
          <span>{endpointTitle.toUpperCase()} CAMERA</span>
          <small>exact source values</small>
        </div>

        {#each endpointRows as row (row.handle)}
          <section class:active={tool === row.handle} class="camera-rig-prop-group">
            <button class="camera-rig-prop-title" onclick={() => selectTool(row.handle)}>
              <span>{row.label}</span><small>{tool === row.handle ? "gizmo active" : "select"}</small>
            </button>
            <div class="camera-rig-vector-head"><span></span>{#each axes as axis}<b>{axis}</b>{/each}</div>
            <div class="camera-rig-vector">
              <span>world</span>
              {#each axes as axis}
                {@const sourceField = field(keyFor(endpoint, row.handle === "camera" ? "Camera" : row.handle === "target" ? "Target" : "Focus", axis))}
                {#if sourceField}<input aria-label={`${endpointTitle} ${row.label.toLowerCase()} ${axis}`} type="number" step="0.0001" value={value(keyFor(endpoint, row.handle === "camera" ? "Camera" : row.handle === "target" ? "Target" : "Focus", axis))} disabled={disabled || !sourceField.editable} onblur={(event) => void commitNumber(sourceField, event)} onchange={(event) => void commitNumber(sourceField, event)} />{/if}
              {/each}
            </div>
          </section>
        {/each}

        <section class="camera-rig-prop-group optics">
          <div class="camera-rig-prop-title"><span>Lens + focus</span><small>{rounded(cameraFieldOfView(value(keyFor(endpoint, "FocalLength"), 50)), 1)}° FOV</small></div>
          {#each [
            { label: "Focal length", suffix: "FocalLength", step: 0.1, unit: "mm", min: 1 },
            { label: "Focus distance", suffix: "FocusDistance", step: 0.0001, unit: "world", min: 0 },
            { label: "Depth of field", suffix: "DepthOfField", step: 0.01, unit: "aperture", min: 0 },
          ] as item (item.suffix)}
            {@const sourceField = field(keyFor(endpoint, item.suffix))}
            {#if sourceField}
              <label class="camera-rig-number"><span>{item.label}</span><input aria-label={`${endpointTitle} ${item.label.toLowerCase()}`} type="number" min={item.min} step={item.step} value={value(keyFor(endpoint, item.suffix))} disabled={disabled || !sourceField.editable} onblur={(event) => void commitNumber(sourceField, event)} onchange={(event) => void commitNumber(sourceField, event)} /><small>{item.unit}</small></label>
            {/if}
          {/each}
          {#if field(keyFor(endpoint, "Frame"))}
            {@const frameField = field(keyFor(endpoint, "Frame"))!}
            <label class="camera-rig-number"><span>Key frame</span><input aria-label={`${endpointTitle} key frame`} type="number" step="0.001" value={value(keyFor(endpoint, "Frame"))} disabled={disabled || !frameField.editable} onblur={(event) => void commitNumber(frameField, event)} onchange={(event) => void commitNumber(frameField, event)} /><small>frames</small></label>
          {/if}
        </section>

        <section class:active={tool === "plane"} class="camera-rig-prop-group plane">
          <button class="camera-rig-prop-title" onclick={() => selectTool("plane")}><span>Video plane</span><small>{tool === "plane" ? `${transformMode} gizmo` : "select"}</small></button>
          {#each [
            { label: "Position", keys: ["planeX", "planeY", "planeZ"], axes: ["X", "Y", "Z"] },
            { label: "Rotation", keys: ["planeRotXDeg", "planeRotYDeg", "planeRotZDeg"], axes: ["X°", "Y°", "Z°"] },
            { label: "Size", keys: ["planeW", "planeH"], axes: ["W", "H"] },
          ] as row (row.label)}
            <div class="camera-rig-vector-head plane" style={`grid-template-columns:68px repeat(${row.keys.length},1fr)`}><span>{row.label}</span>{#each row.axes as axis}<b>{axis}</b>{/each}</div>
            <div class="camera-rig-vector plane" style={`grid-template-columns:68px repeat(${row.keys.length},1fr)`}>
              <span>world</span>
              {#each row.keys as key}
                {@const sourceField = field(key)}
                {#if sourceField}<input aria-label={`Plane ${row.label.toLowerCase()} ${row.axes[row.keys.indexOf(key)]}`} type="number" step="0.0001" value={value(key)} disabled={disabled || !sourceField.editable} onblur={(event) => void commitNumber(sourceField, event)} onchange={(event) => void commitNumber(sourceField, event)} />{/if}
              {/each}
            </div>
          {/each}
          {#if field("planeScale")}
            {@const scaleField = field("planeScale")!}
            <label class="camera-rig-number"><span>Plane scale</span><input aria-label="Plane scale" type="number" min="0.001" step="0.001" value={value("planeScale")} disabled={disabled || !scaleField.editable} onblur={(event) => void commitNumber(scaleField, event)} onchange={(event) => void commitNumber(scaleField, event)} /><small>×</small></label>
          {/if}
        </section>

        <section class="camera-rig-prop-group finishing">
          <div class="camera-rig-prop-title"><span>Finishing</span><small>exact render</small></div>
          {#each [
            { label: "Maximum blur", key: "maxBlur", step: 0.001, unit: "norm" },
            { label: "Shutter angle", key: "shutterAngle", step: 1, unit: "degrees" },
            { label: "Motion samples", key: "motionBlurSamples", step: 1, unit: "samples" },
          ] as item (item.key)}
            {@const sourceField = field(item.key)}
            {#if sourceField}<label class="camera-rig-number"><span>{item.label}</span><input aria-label={item.label} type="number" min="0" step={item.step} value={value(item.key)} disabled={disabled || !sourceField.editable} onblur={(event) => void commitNumber(sourceField, event)} onchange={(event) => void commitNumber(sourceField, event)} /><small>{item.unit}</small></label>{/if}
          {/each}
        </section>
      </aside>
    </div>
  </div>
</div>
