import { defineThreeScene, defineThreeSceneComposition } from "framediff/three";

const palette = [0x8f7cff, 0x5bd3c2, 0xef86ba, 0xf4c86f];

const playgroundWorld = defineThreeScene({
  id: "playground-world",
  async create({ scene }) {
    const THREE = await import("three");
    scene.fog = new THREE.Fog(0x080b13, 8, 32);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(13, 64),
      new THREE.MeshStandardMaterial({ color: 0x10182a, roughness: 0.88, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.2;
    scene.add(floor);

    const rig = new THREE.Group();
    scene.add(rig);
    const geometries = [
      new THREE.TorusKnotGeometry(1.2, 0.34, 96, 14),
      new THREE.IcosahedronGeometry(1.35, 1),
      new THREE.OctahedronGeometry(1.45, 0),
      new THREE.TorusGeometry(1.3, 0.28, 18, 64),
    ];
    const baseHeights = geometries.map((_, index) => index % 2 ? -0.25 : 0.55);
    const objects = geometries.map((geometry, index) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: palette[index], roughness: 0.35 + index * 0.1, metalness: 0.22, emissive: palette[index], emissiveIntensity: 0.06,
      }));
      const angle = index / geometries.length * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * 4.6, baseHeights[index], Math.sin(angle) * 4.6);
      rig.add(mesh);
      return mesh;
    });

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 32, 20),
      new THREE.MeshPhysicalMaterial({ color: 0xf1eee5, roughness: 0.15, metalness: 0.1, transmission: 0.18, thickness: 0.8 }),
    );
    rig.add(core);
    scene.add(new THREE.HemisphereLight(0xa9baff, 0x16120c, 2.1));
    const key = new THREE.DirectionalLight(0xffe0b7, 4.2);
    key.position.set(-5, 9, 7);
    scene.add(key);
    const rim = new THREE.PointLight(0x7c66ff, 22, 24, 1.5);
    rim.position.set(5, 2, -4);
    scene.add(rim);

    return {
      update(time) {
        rig.rotation.y = time * 0.22;
        core.rotation.x = time * 0.3;
        core.rotation.y = time * 0.4;
        objects.forEach((mesh, index) => {
          mesh.rotation.x = time * (0.36 + index * 0.06);
          mesh.rotation.y = time * (0.28 + index * 0.08);
          mesh.position.y = baseHeights[index] + Math.sin(time * 1.4 + index) * 0.18;
        });
      },
    };
  },
  cameras: {
    overview: {
      interpolation: "ease",
      keyframes: [
        { frame: 0, pose: { cameraPosition: [0, 3.6, 15], cameraTarget: [0, 0, 0], focalLength: 34 } },
        { frame: 239, pose: { cameraPosition: [6.5, 2.1, 11], cameraTarget: [0, 0.2, 0], focalLength: 42 } },
      ],
    },
    orbit: {
      poseAt(time) {
        const angle = time * 0.36;
        return { cameraPosition: [Math.sin(angle) * 12, 2.4 + Math.sin(time * 0.5), Math.cos(angle) * 12], cameraTarget: [0, 0.1, 0], focalLength: 38 };
      },
    },
  },
});

export const worldLabComp = defineThreeSceneComposition({
  scene: playgroundWorld,
  id: "WorldLab",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 240,
  background: "radial-gradient(circle at 50% 45%,#1d2745,#080b13 72%)",
  cameras: [
    { id: "world-overview", name: "overview camera", camera: "overview", from: 0, durationInFrames: 120 },
    { id: "world-orbit", name: "procedural orbit camera", camera: "orbit", from: 120, durationInFrames: 120 },
  ],
  defaultCamera: "overview",
  meta: {
    file: "src/compositions/playground/WorldLab.ts",
    module: "src/compositions/playground/WorldLab.ts",
    exportName: "worldLabComp",
    deps: ["src/compositions/playground/WorldLab.ts"],
    library: true,
  },
});
