// The previz scene recipe: a low-poly harbor at dusk — a lighthouse on a rocky point with a
// rotating beacon, a fishing boat rounding the island, and three named virtual cameras:
// "approach" (keyframed push-in from open water), "boat" (procedural chase that trails the
// boat along its own arc), "beacon" (from the lamp gallery, looking down the beam at the
// boat). Everything is a pure function of time: update(t) re-derives every transform from t,
// so scrub/preview/export/bake all agree exactly — the bake is what feeds the generator.

import type * as Three from "three";
import { defineThreeScene } from "framediff/three";

// ---- shared path math (the chase camera trails the same arc the boat sails) -----------------

const BOAT_RADIUS = 9;
const LAP_SECONDS = 24;
const PHASE = -0.8; // start the boat already in frame on the approach side

export function boatAt(time: number): { x: number; z: number; theta: number; heading: number } {
  const theta = (2 * Math.PI * time) / LAP_SECONDS + PHASE;
  const x = BOAT_RADIUS * Math.sin(theta);
  const z = BOAT_RADIUS * Math.cos(theta);
  return { x, z, theta, heading: Math.atan2(Math.cos(theta), -Math.sin(theta)) };
}

// ---- palette ---------------------------------------------------------------------------------

const SEA = 0x10182a;
const ROCK = 0x2a3040;
const ROCK_D = 0x1d2230;
const HULL = 0x30465e;
const TRIM = 0xd8dde8;
const RED = 0xb8422f;
const LAMP = 0xffd98a;

// deterministic rock cluster + buoys (literal placements — no Math.random anywhere)
const ROCKS: [x: number, z: number, w: number, h: number, ry: number][] = [
  [0, 0, 3.6, 1.4, 0.3], [1.7, 0.9, 2.0, 0.9, 0.9], [-1.6, 1.2, 1.8, 0.7, 1.7],
  [0.8, -1.8, 2.2, 1.0, 2.4], [-1.4, -1.3, 1.5, 0.6, 0.5], [2.4, -0.6, 1.2, 0.5, 1.2],
];
const BUOYS: [x: number, z: number, phase: number][] = [[6.2, -7.4, 0.0], [-8.8, 4.6, 2.1], [4.4, 10.6, 4.2]];

export const harborScene = defineThreeScene({
  id: "harbor-previz",

  async create({ scene }) {
    const THREE = await import("three");
    const std = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const box = (w: number, h: number, d: number, mat: Three.Material, x = 0, y = 0, z = 0): Three.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const cyl = (rTop: number, rBot: number, h: number, mat: Three.Material, y = 0): Three.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 24), mat);
      mesh.position.y = y;
      return mesh;
    };
    scene.fog = new THREE.Fog(0x0d1120, 24, 70);

    // ---- the sea (a calm disc; motion reads through the boat and buoys) ----
    const sea = new THREE.Mesh(new THREE.CircleGeometry(40, 72), std(SEA, 0.35));
    sea.rotation.x = -Math.PI / 2;
    scene.add(sea);

    // foam line where the water meets the rocks
    const foam = new THREE.Mesh(
      new THREE.RingGeometry(3.1, 3.45, 64),
      new THREE.MeshBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.22 }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.02;
    scene.add(foam);

    // ---- the rocky point + lighthouse ----
    for (const [rx, rz, w, h, ry] of ROCKS) {
      const r = box(w, h, w * 0.85, std(rx * rz > 0 ? ROCK : ROCK_D, 0.95), rx, h / 2 - 0.1, rz);
      r.rotation.y = ry;
      scene.add(r);
    }

    const tower = new THREE.Group();
    tower.position.y = 1.1;
    scene.add(tower);
    tower.add(cyl(0.52, 0.8, 5.4, std(TRIM, 0.6), 2.7)); // the tapered white tower
    tower.add(cyl(0.62, 0.62, 0.7, std(RED, 0.7), 1.2)); // red bands
    tower.add(cyl(0.56, 0.56, 0.7, std(RED, 0.7), 3.4));
    tower.add(cyl(0.85, 0.85, 0.18, std(ROCK_D, 0.8), 5.5)); // gallery deck
    // gallery rail — foreground for the "from the lamp" cut (the beacon camera sits just
    // inside it, so the frame gets a real anchor instead of empty air)
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.025, 10, 48), std(TRIM, 0.6));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 5.92;
    tower.add(rail);
    for (let i = 0; i < 10; i++) {
      const post = cyl(0.018, 0.018, 0.34, std(TRIM, 0.6), 5.75);
      post.position.x = 0.88 * Math.sin((i * 2 * Math.PI) / 10);
      post.position.z = 0.88 * Math.cos((i * 2 * Math.PI) / 10);
      tower.add(post);
    }
    const lampRoom = cyl(0.42, 0.42, 0.7, new THREE.MeshStandardMaterial({
      color: 0x1a1f2c, roughness: 0.4, emissive: LAMP, emissiveIntensity: 0.55,
    }), 5.95);
    tower.add(lampRoom);
    tower.add(cyl(0.02, 0.52, 0.5, std(RED, 0.7), 6.45)); // roof cone

    const LAMP_Y = 1.1 + 5.95; // world height of the lamp — the beacon + camera share it

    // ---- the beacon: two opposed volumetric-ish cones swinging from the lamp ----
    const beacon = new THREE.Group();
    beacon.position.y = LAMP_Y;
    scene.add(beacon);
    // faint + narrow on purpose: r2v models re-render hard bright cones as literal geometry;
    // a dim shaft reads as light and comes back volumetric
    const beamMat = new THREE.MeshBasicMaterial({
      color: LAMP, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const BEAM_LEN = 22;
    const beamA = new THREE.Mesh(new THREE.ConeGeometry(1.25, BEAM_LEN, 20, 1, true), beamMat);
    beamA.rotation.z = Math.PI / 2; // apex at the lamp, base out over the water
    beamA.position.x = BEAM_LEN / 2;
    const beamB = beamA.clone();
    beamB.rotation.z = -Math.PI / 2;
    beamB.position.x = -BEAM_LEN / 2;
    beacon.add(beamA, beamB);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff3cf }),
    );
    beacon.add(glow);
    const lampLight = new THREE.PointLight(LAMP, 26, 30, 1.6);
    beacon.add(lampLight);

    // ---- the boat: hull + cabin + mast, sailing the arc ----
    const boat = new THREE.Group();
    scene.add(boat);
    boat.add(box(0.9, 0.4, 2.2, std(HULL, 0.7), 0, 0.28, 0)); // hull
    boat.add(box(0.7, 0.12, 0.7, std(TRIM, 0.6), 0, 0.54, -0.5)); // deck
    boat.add(box(0.6, 0.5, 0.8, std(TRIM, 0.6), 0, 0.78, 0.25)); // cabin
    boat.add(box(0.66, 0.06, 0.86, std(RED, 0.7), 0, 1.06, 0.25)); // cabin roof
    const mast = cyl(0.03, 0.03, 1.5, std(ROCK_D, 0.5), 1.6);
    mast.position.z = -0.55;
    boat.add(mast);
    const masthead = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x7fe08c }),
    );
    masthead.position.set(0, 2.38, -0.55);
    boat.add(masthead);

    // wake: a fading strip trailing the stern
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x8ea6cc, transparent: true, opacity: 0.22 }),
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(0, 0.03, 2.6);
    boat.add(wake);

    // ---- buoys ----
    const buoys = BUOYS.map(([bx, bz]) => {
      const b = new THREE.Group();
      b.position.set(bx, 0, bz);
      b.add(cyl(0.14, 0.2, 0.5, std(RED, 0.7), 0.2));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffb27a }));
      dot.position.y = 0.52;
      b.add(dot);
      scene.add(b);
      return b;
    });

    // ---- dusk light ----
    // bright enough that the chase/beacon cuts keep readable environment — frames the
    // generator can't see, it can't make real
    scene.add(new THREE.HemisphereLight(0x5c6f9e, 0x131722, 1.9));
    const moon = new THREE.DirectionalLight(0x9fb4e0, 2.2);
    moon.position.set(-8, 12, -5);
    scene.add(moon);
    const horizon = new THREE.DirectionalLight(0xd88a5a, 0.5); // last of the sunset
    horizon.position.set(10, 2, 8);
    scene.add(horizon);

    return {
      update(time: number) {
        // the boat sails the arc; bob/roll/pitch are independent pure oscillations
        const b = boatAt(time);
        boat.position.set(b.x, 0.14 * Math.sin((2 * Math.PI * time) / 2.8) * 0.5, b.z);
        boat.rotation.y = b.heading;
        boat.rotation.z = 0.05 * Math.sin((2 * Math.PI * time) / 3.4);
        boat.rotation.x = 0.03 * Math.sin((2 * Math.PI * time) / 2.1 + 1);

        // the beacon sweeps a full turn every 6 seconds
        beacon.rotation.y = (2 * Math.PI * time) / 6;

        for (let i = 0; i < buoys.length; i++) {
          buoys[i].position.y = 0.06 * Math.sin((2 * Math.PI * time) / 3.0 + BUOYS[i][2]);
          buoys[i].rotation.z = 0.08 * Math.sin((2 * Math.PI * time) / 3.7 + BUOYS[i][2]);
        }
      },
    };
  },

  // ---- the droppable cameras (scene-time frames @ 30fps) ----
  cameras: {
    approach: {
      interpolation: "ease",
      keyframes: [
        { frame: 0, pose: { cameraPosition: [-3, 2.0, 27], cameraTarget: [0, 3.4, 0], focalLength: 28 } },
        { frame: 240, pose: { cameraPosition: [3.5, 3.4, 15], cameraTarget: [0, 4.2, 0], focalLength: 36 } },
      ],
    },
    boat: {
      poseAt(time) {
        const b = boatAt(time);
        // trail wide and slightly high: the frame needs sea + rocks + tower around the
        // boat, or the generator has only the CG hull to reinterpret
        const back = b.theta - 0.52;
        return {
          cameraPosition: [(BOAT_RADIUS + 3.6) * Math.sin(back), 1.9, (BOAT_RADIUS + 3.6) * Math.cos(back)],
          // aim past the boat toward the point: boat rides the right third, island + tower
          // fill the left — context the generator can build a real world from
          cameraTarget: [b.x * 0.5, 1.1, b.z * 0.5],
          focalLength: 30,
        };
      },
    },
    beacon: {
      poseAt(time) {
        // off the gallery rail facing the boat — pulled out and wide so sea and horizon
        // carry the frame instead of the flat-shaded lamp room
        const b = boatAt(time);
        const dir = Math.atan2(b.x, b.z);
        // just past the rail and above the beam plane: the rail + deck arc anchor the
        // frame bottom, the beam sweeps beneath the lens, the boat rides center
        return {
          cameraPosition: [1.05 * Math.sin(dir), 7.3, 1.05 * Math.cos(dir)],
          cameraTarget: [b.x, 0.3, b.z],
          focalLength: 26,
        };
      },
    },
  },
});
