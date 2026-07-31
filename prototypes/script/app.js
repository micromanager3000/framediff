'use strict';
/* FrameDiff · Script Lab — the script comp as a full-height scrollable sheet.
   Five columns: TIME (derived) · DURATION (editable, ripples) · NARRATION · VISUAL · SOURCE.
   Rows reorder by drag, delete with undo, and each row points at a comp, an image, or a clip.
   Two tabs: SCRIPT (the sheet) and PREVIEW (captions + slate overlaid on the source). */

const FPS = 30;

/* ---------------------------------------------------------------- kinds */

const KINDS = {
  'rough':     { tag: 'ROUGH',      out: 'IMG', dot: 'k-rough',  label: 'Rough board' },
  'previz':    { tag: 'PREVIZ',     out: 'VID', dot: 'k-previz', label: 'Previz' },
  'gen-image': { tag: 'GEN STILL',  out: 'IMG', dot: 'k-gen',    label: 'Gen still' },
  'gen-video': { tag: 'GEN MOTION', out: 'VID', dot: 'k-gen',    label: 'Gen motion' },
  'take':      { tag: 'TAKE',       out: 'VID', dot: 'k-take',   label: 'Take' },
  'edit':      { tag: 'EDIT COMP',  out: 'VID', dot: 'k-edit',   label: 'Edit comp' },
  '3d':        { tag: '3D',         out: 'VID', dot: 'k-3d',     label: '3D' },
  'script':    { tag: 'SCRIPT',     out: '—',   dot: 'k-script' },
  'board':     { tag: 'BOARD',      out: '—',   dot: 'k-board' },
  'doc':       { tag: 'DOC',        out: '—',   dot: 'k-doc' },
};
const NEW_KINDS = ['rough', 'previz', 'gen-image', 'gen-video', 'edit', '3d'];
const MOVING = new Set(['previz', '3d', 'gen-video', 'take', 'edit']); // drift in the monitor

/* narration and dialog share one column; sound effects live with the visual */

/* ---------------------------------------------------------------- project */

let seq = 0;
const uid = (p) => `${p}-${++seq}`;

/* comps that exist in the project. `art` picks the drawn geometry; `scene` groups
   them under FOR THIS SCENE in the picker. plan/doc comps aren't attachable. */
const comps = [
  { id: 'main', name: 'Main', kind: 'edit', art: 'beam', attachable: false },
  { id: 'script', name: 'Script', kind: 'script', attachable: false, active: true },
  { id: 'storyboard', name: 'Storyboard', kind: 'board', attachable: false },
  { id: 'moodboard', name: 'Moodboard', kind: 'board', attachable: false },
  { id: 'cast', name: 'Cast', kind: 'doc', attachable: false },
  { id: 'locations', name: 'Locations', kind: 'doc', attachable: false },

  { id: 'c-rough-approach', name: 'roughs/approach-board', kind: 'rough', art: 'approach', scene: 'approach' },
  { id: 'c-previz-approach', name: 'previz/harbor · cam-A', kind: 'previz', art: 'approach', scene: 'approach' },
  { id: 'c-take-approach', name: 'takes/approach · TK-04', kind: 'take', art: 'approach', scene: 'approach' },

  { id: 'c-rough-chase', name: 'roughs/chase-board', kind: 'rough', art: 'chase', scene: 'chase' },
  { id: 'c-gen-chase', name: 'gen/chase-motion-v1', kind: 'gen-video', art: 'chase', scene: 'chase' },

  { id: 'c-previz-gallery', name: 'previz/harbor · cam-C', kind: 'previz', art: 'gallery', scene: 'gallery' },

  { id: 'c-gen-quay', name: 'gen/quay-still-v2', kind: 'gen-image', art: 'quay', scene: 'quay' },
  { id: 'c-previz-quay', name: 'previz/harbor · cam-D', kind: 'previz', art: 'quay', scene: 'quay' },

  { id: 'c-rough-ledger', name: 'roughs/ledger-board', kind: 'rough', art: 'ledger', scene: 'ledger' },
  { id: 'c-rough-stairs', name: 'roughs/stairs-board', kind: 'rough', art: 'stairs', scene: 'stairs' },

  { id: 'c-gen-beam', name: 'gen/beam-motion-v1', kind: 'gen-video', art: 'beam', scene: 'beam' },
  { id: 'c-3d-lamp', name: 'HarborPreviz · lamp rig', kind: '3d', art: 'relight', scene: 'relight' },

  { id: 'c-edit-title', name: 'edit/title-cut', kind: 'edit', art: 'title', scene: 'title' },
];

/* media files in the project — images and video clips */
const media = [
  { id: 'm-harbor-dusk', name: 'plates/harbor-dusk.jpg', type: 'image', art: 'quay' },
  { id: 'm-lamp-macro', name: 'plates/lamp-macro.jpg', type: 'image', art: 'relight' },
  { id: 'm-ledger-scan', name: 'refs/ledger-scan.png', type: 'image', art: 'ledger' },
  { id: 'm-sea-loop', name: 'stock/sea-swell-loop.mp4', type: 'video', art: 'approach', dur: 12 },
  { id: 'm-rain-glass', name: 'stock/rain-on-glass.mp4', type: 'video', art: 'beam', dur: 6.4 },
  { id: 'm-stairs-camb', name: 'footage/stairs-camB.mov', type: 'video', art: 'stairs', dur: 4.8 },
];

const compById = (id) => comps.find((c) => c.id === id);
const mediaById = (id) => media.find((m) => m.id === id);

/* ---------------------------------------------------------------- the script
   A free-form preamble above the rows — title and whatever notes the sheet
   below can't hold. Running time is derived and shown alongside it. */

const doc = {
  title: 'Harbor short — run of show',
  notes: `A boat comes home in weather and the lamp answers it. One location, no faces — hands, water, and the light.

Cutting for the festival submission, so hold the whole thing under 70 seconds. The ledger is the hinge: everything before it is the arrival, everything after is the light going back on. If we need to lose time, take it from the chase, not from the stairs.

Scenes 7 and 8 are still unshot — rough them in from previz and swap once the lamp rig is built.`,
};

/* ---------------------------------------------------------------- scenes
   source: null | {type:'comp', id} | {type:'media', id} */

const scenes = [
  { uid: uid('s'), key: 'approach', title: 'Open-water approach', dur: 8,
    nar: '“Any light will do, when it’s the only one.”',
    vis: 'Low over the swell toward the harbor mouth; the lamp holds frame right.',
    sfx: 'swell under the hull, a bell buoy two counts apart',
    source: { type: 'comp', id: 'c-take-approach' } },
  { uid: uid('s'), key: 'chase', title: 'Boat chase', dur: 6,
    nar: '',
    vis: 'Tracking with the boat along the breakwater; wake crosses the lens.',
    sfx: 'engine, chop, one gull',
    source: { type: 'comp', id: 'c-gen-chase' } },
  { uid: uid('s'), key: 'gallery', title: 'From the lamp', dur: 7,
    nar: '“Home is whatever answers.”',
    vis: 'Reverse from the gallery rail as the boat clears the breakwater.',
    sfx: 'wind across the gallery rail',
    source: { type: 'comp', id: 'c-previz-gallery' } },
  { uid: uid('s'), key: 'quay', title: 'Harbor interior', dur: 9,
    nar: 'KEEPER — “You’re late.”   PILOT — “Tide argued.”',
    vis: 'Wide from the quay; the boat slides into still water, town lights doubling.',
    sfx: 'rope on bollard, water slapping stone',
    source: { type: 'media', id: 'm-harbor-dusk' } },
  { uid: uid('s'), key: 'ledger', title: 'The ledger', dur: 6,
    nar: '“Every arrival gets a line in the harbor ledger…”',
    vis: 'Close on lamplight over the open ledger; a pen hovers, then commits.',
    sfx: 'pen scratch, a page settling',
    source: { type: 'comp', id: 'c-rough-ledger' } },
  { uid: uid('s'), key: 'stairs', title: 'Stairs to the lamp', dur: 5,
    nar: '',
    vis: 'Spiral stair up the tower; light slits rake the treads.',
    sfx: 'boots on iron, storm shutters breathing',
    source: { type: 'media', id: 'm-stairs-camb' } },
  { uid: uid('s'), key: 'relight', title: 'Relight', dur: 8,
    nar: '“…and every line gets a light.”',
    vis: 'Match strike; the mantle blooms and the beam wheels across the rain.',
    sfx: 'match, then the mantle catching',
    source: null },
  { uid: uid('s'), key: 'beam', title: 'Beam over water', dur: 7,
    nar: '',
    vis: 'High wide over black water; the beam sweeps and finds the boat, small below.',
    sfx: 'low horn, rain on glass',
    source: { type: 'comp', id: 'c-gen-beam' } },
  { uid: uid('s'), key: 'title', title: 'Title', dur: 6,
    nar: '“Moth & Lantern.”',
    vis: 'The beam settles into a line and becomes the title underline; hold on black.',
    sfx: '',
    source: { type: 'comp', id: 'c-edit-title' } },
];

/* ---------------------------------------------------------------- scene art
   Tiny semantic shape lists rendered per mode:
   rough → pencil board · wire → previz camera · color/photo → finished frame. */

const ROLE_COLOR = {
  sky: '#152638', sky2: '#0b131e', sea: '#0d2033', sea2: '#132f47',
  ink: '#04070b', hull: '#0a0f15', stone: '#3d4c5c', rail: '#0a0e13',
  lamp: '#f0c874', glow: 'rgba(240,200,116,.16)', beam: 'rgba(240,200,116,.26)',
  town: '#f0b45f', cool: '#8fc9ec', foam: 'rgba(205,226,238,.42)',
  paper: '#b9b2a0', inkline: '#5c5546', text: '#eae7dc',
};

const GEO = {
  approach: [
    ['rect', 'sky', 0, 0, 320, 118], ['rect', 'sky2', 0, 0, 320, 56],
    ['rect', 'sea', 0, 118, 320, 62], ['rect', 'sea2', 0, 152, 320, 28],
    ['path', 'foam', 'M0,133 Q60,127 120,133 T240,133 T320,131', 1.4],
    ['path', 'foam', 'M0,152 Q80,145 160,152 T320,150', 1.4],
    ['poly', 'beam', '297,64 128,38 128,94'],
    ['rect', 'hull', 291, 74, 11, 44], ['rect', 'hull', 287, 68, 19, 8],
    ['circle', 'glow', 297, 64, 15], ['circle', 'lamp', 297, 64, 5],
  ],
  chase: [
    ['rect', 'sky', 0, 0, 320, 112], ['rect', 'sky2', 0, 0, 320, 50],
    ['rect', 'sea', 0, 112, 320, 68], ['rect', 'sea2', 0, 150, 320, 30],
    ['poly', 'hull', '0,140 210,114 210,124 0,162'],
    ['path', 'stone', 'M0,140 L210,114', 2],
    ['path', 'cool', 'M58,52 q6,-7 12,0 M74,54 q6,-7 12,0', 1.6],
    ['path', 'foam', 'M40,146 Q86,140 128,142', 2],
    ['path', 'foam', 'M30,154 Q90,147 132,150', 1.4],
    ['poly', 'hull', '124,128 168,128 160,142 130,142'],
    ['rect', 'hull', 138, 118, 14, 11], ['rect', 'lamp', 141, 121, 4, 4],
    ['rect', 'hull', 306, 84, 7, 30], ['circle', 'lamp', 309, 81, 3],
  ],
  gallery: [
    ['rect', 'sky2', 0, 0, 320, 58], ['rect', 'sea', 0, 58, 320, 122], ['rect', 'sea2', 0, 130, 320, 50],
    ['poly', 'beam', '0,0 96,0 320,118 320,166'],
    ['poly', 'hull', '150,96 320,78 320,86 150,104'],
    ['poly', 'hull', '208,116 232,116 228,124 211,124'], ['rect', 'hull', 215, 110, 8, 6],
    ['path', 'foam', 'M170,124 Q200,118 214,120', 1.4],
    ['path', 'rail', 'M0,148 Q90,116 210,180', 5],
    ['path', 'stone', 'M18,142 L22,180 M62,132 L72,180 M116,130 L134,180', 2.4],
  ],
  quay: [
    ['rect', 'sky', 0, 0, 320, 104], ['rect', 'sky2', 0, 0, 320, 44],
    ['poly', 'ink', '0,104 0,66 26,66 26,80 58,80 58,58 86,58 86,74 120,74 120,84 158,84 158,64 190,64 190,78 228,78 228,70 258,70 258,82 292,82 292,74 320,74 320,104'],
    ['rect', 'sea', 0, 104, 320, 76], ['rect', 'sea2', 0, 146, 320, 34],
    ['rect', 'town', 40, 86, 4, 5], ['rect', 'town', 96, 78, 4, 5], ['rect', 'lamp', 168, 70, 4, 5],
    ['rect', 'town', 240, 76, 4, 5], ['rect', 'cool', 274, 78, 4, 5],
    ['path', 'foam', 'M42,110 L42,128 M98,110 L98,132 M170,110 L170,126 M242,110 L242,130', 1.6],
    ['poly', 'hull', '236,124 288,124 280,140 242,140'], ['rect', 'hull', 254, 112, 16, 13], ['rect', 'lamp', 258, 116, 5, 5],
  ],
  ledger: [
    ['rect', 'ink', 0, 0, 320, 180],
    ['circle', 'glow', 64, 30, 58], ['circle', 'glow', 64, 30, 30], ['circle', 'lamp', 64, 30, 9],
    ['rect', 'hull', 0, 148, 320, 32],
    ['poly', 'paper', '60,72 158,64 162,148 64,158'], ['poly', 'paper', '162,64 260,72 256,158 162,148'],
    ['path', 'inkline', 'M76,88 L146,82 M76,102 L146,96 M76,116 L130,111 M178,88 L246,94 M178,102 L246,108', 2],
    ['path', 'stone', 'M226,128 L268,96', 3], ['poly', 'lamp', '222,132 228,124 232,128'],
  ],
  stairs: [
    ['rect', 'ink', 0, 0, 320, 180],
    ['path', 'stone', 'M40,178 A120,74 0 0 1 280,178', 3],
    ['path', 'stone', 'M64,146 A96,58 0 0 1 256,146', 3],
    ['path', 'stone', 'M88,116 A72,44 0 0 1 232,116', 3],
    ['path', 'stone', 'M110,90 A50,32 0 0 1 210,90', 3],
    ['path', 'stone', 'M128,68 A32,22 0 0 1 192,68', 3],
    ['rect', 'lamp', 282, 40, 7, 18], ['poly', 'beam', '282,44 160,96 160,132 282,56'],
    ['circle', 'glow', 160, 40, 22], ['circle', 'lamp', 160, 40, 4],
  ],
  relight: [
    ['rect', 'ink', 0, 0, 320, 180],
    ['poly', 'beam', '160,90 0,52 0,120'], ['poly', 'beam', '160,90 320,60 320,128'],
    ['circle', 'glow', 160, 90, 52], ['circle', 'glow', 160, 90, 26], ['circle', 'lamp', 160, 90, 8],
    ['path', 'lamp', 'M160,58 L160,44 M160,122 L160,136 M128,90 L114,90 M192,90 L206,90 M138,68 L128,58 M182,68 L192,58 M138,112 L128,122 M182,112 L192,122', 2],
    ['path', 'foam', 'M40,20 L32,42 M84,10 L78,28 M250,16 L242,38 M290,30 L284,46 M60,140 L52,162 M270,140 L262,160', 1.2],
  ],
  beam: [
    ['rect', 'sky2', 0, 0, 320, 70], ['rect', 'sea', 0, 70, 320, 110], ['rect', 'sea2', 0, 132, 320, 48],
    ['poly', 'beam', '30,118 320,26 320,84'],
    ['rect', 'hull', 24, 118, 9, 40], ['rect', 'hull', 20, 112, 17, 8], ['circle', 'lamp', 28, 108, 5], ['circle', 'glow', 28, 108, 16],
    ['poly', 'hull', '224,144 250,144 246,152 227,152'],
    ['path', 'foam', 'M196,150 Q218,145 230,147', 1.3],
    ['path', 'foam', 'M0,96 L320,96', 0.6],
  ],
  title: [
    ['rect', 'ink', 0, 0, 320, 180],
    ['text', 'text', 160, 96, 21, 6, 'MOTH &amp; LANTERN', 'Georgia, "Times New Roman", serif'],
    ['rect', 'lamp', 74, 112, 172, 2.5], ['circle', 'glow', 160, 113, 26],
    ['text', 'inkline', 160, 136, 7.5, 4, 'A HARBOR SHORT', 'inherit'],
  ],
  _blank: [
    ['rect', 'sky2', 0, 0, 320, 180], ['rect', 'sea', 0, 104, 320, 76],
    ['path', 'foam', 'M0,104 L320,104', 1],
    ['circle', 'glow', 250, 52, 26], ['circle', 'lamp', 250, 52, 5],
  ],
};

function shapeSVG(sh, mode) {
  const [type, role, ...g] = sh;
  const wire = mode === 'wire', rough = mode === 'rough';
  const strokeCol = wire ? '#5fd8c0' : rough ? '#8f99a8' : ROLE_COLOR[role];
  const fillCol = wire ? 'none' : rough ? 'rgba(148,158,173,.10)' : ROLE_COLOR[role];
  const dim = (role === 'beam' || role === 'glow');
  const op = wire ? (dim ? .35 : .85) : rough ? (dim ? .5 : .9) : 1;
  const attrs = `fill="${fillCol}" ${wire || rough ? `stroke="${strokeCol}" stroke-width="1.2"` : ''} opacity="${op}"`;
  switch (type) {
    case 'rect': { const [x, y, w, h] = g; return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`; }
    case 'circle': { const [cx, cy, r] = g; return `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs}/>`; }
    case 'poly': { const [pts] = g; return `<polygon points="${pts}" ${attrs}/>`; }
    case 'path': { const [d, w] = g;
      return `<path d="${d}" fill="none" stroke="${strokeCol}" stroke-width="${w || 1.4}" stroke-linecap="round" opacity="${op}"/>`; }
    case 'text': { const [x, y, size, ls, str, ff] = g;
      const col = wire ? '#5fd8c0' : rough ? '#98a2b3' : ROLE_COLOR[role];
      return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" letter-spacing="${ls}" fill="${col}" font-family='${ff}'>${str}</text>`; }
  }
  return '';
}

function artSVG(artKey, mode) {
  const shapes = GEO[artKey] || GEO._blank;
  const bg = mode === 'wire' ? `<rect width="320" height="180" fill="#08121a"/>`
    : mode === 'rough' ? `<rect width="320" height="180" fill="#12151b"/>` : '';
  const body = shapes.map((s) => shapeSVG(s, mode)).join('');
  let over = '';
  if (mode === 'wire') {
    over = `<g stroke="#5fd8c0" opacity=".16"><path d="M0,60 H320 M0,120 H320 M107,0 V180 M214,0 V180" stroke-width="0.7"/></g>
      <g stroke="#5fd8c0" opacity=".7" stroke-width="1.5" fill="none">
      <path d="M8,20 V8 H20 M300,8 H312 V20 M312,160 V172 H300 M20,172 H8 V160"/></g>`;
  } else if (mode === 'rough') {
    over = `<g stroke="#8f99a8" opacity=".10"><path d="M-20,200 L120,-30 M40,210 L190,-30 M110,215 L260,-25" stroke-width="10"/></g>`;
  } else if (mode === 'photo') {
    over = `<radialGradient id="v"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
      <rect width="320" height="180" fill="url(#v)"/>
      <g fill="#cfd8e0" opacity=".05"><rect x="30" y="24" width="1" height="1"/><rect x="88" y="140" width="1" height="1"/><rect x="210" y="60" width="1" height="1"/><rect x="270" y="120" width="1" height="1"/><rect x="140" y="96" width="1" height="1"/></g>`;
  }
  return `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${bg}${body}${over}</svg>`;
}

const modeForKind = (kind) => kind === 'rough' ? 'rough' : (kind === 'previz' || kind === '3d') ? 'wire' : 'color';

/* ---------------------------------------------------------------- source resolution */

/* Everything the UI needs to draw a row's source, whatever it points at. */
function resolve(scene) {
  const src = scene && scene.source;
  if (!src) return null;
  if (src.type === 'comp') {
    const c = compById(src.id);
    if (!c) return null;
    const k = KINDS[c.kind];
    return { kind: 'comp', name: c.name, tag: k.tag, out: k.out, dot: k.dot,
      badge: `st-${c.kind}`, mode: modeForKind(c.kind), art: c.art || scene.key,
      moving: MOVING.has(c.kind), tc: c.kind === 'take', strip: c.kind === 'edit' };
  }
  const m = mediaById(src.id);
  if (!m) return null;
  return { kind: 'media', name: m.name, tag: m.type === 'video' ? 'VIDEO' : 'IMAGE',
    out: m.type === 'video' ? 'VID' : 'IMG', dot: 'k-media', badge: `st-${m.type}`,
    mode: 'photo', art: m.art, url: m.url || null, type: m.type,
    dur: m.dur || null, moving: m.type === 'video' && !m.url };
}

/* thumbnail / monitor artwork for a resolved source */
function sourceArt(r, { live = false } = {}) {
  if (!r) return '';
  if (r.url && r.type === 'video') {
    return `<video src="${r.url}" muted playsinline preload="metadata" ${live ? 'data-mon-video' : ''}></video>`;
  }
  if (r.url) return `<img src="${r.url}" alt="" />`;
  return `<div class="${r.moving ? 'kb' : ''}" style="position:absolute;inset:0">${artSVG(r.art, r.mode)}</div>`;
}

function sourceChrome(r) {
  if (!r) return '';
  let html = `<span class="stage-tag ${r.badge}">${r.tag}</span>`;
  if (r.tc) html += `<span class="tk-tc">00:12:07:${String(14 + (r.name.length % 9)).padStart(2, '0')}</span>`;
  html += `<span class="vid-chip">${r.out === 'VID' ? '▶ VID' : 'IMG'}</span>`;
  if (r.strip) html += `<span class="edit-strip"><i></i><i></i><i></i><i></i><i></i></span>`;
  return html;
}

/* ---------------------------------------------------------------- helpers */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const snap1 = (v) => Math.round(v * 10) / 10;
const clampDur = (v) => Math.min(120, Math.max(0.5, snap1(v)));

function mmss(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  const whole = Math.floor(s), tenth = Math.round((s - whole) * 10);
  const ss = String(tenth === 10 ? whole + 1 : whole).padStart(2, '0');
  return (tenth && tenth !== 10) ? `${m}:${ss}.${tenth}` : `${m}:${ss}`;
}
const mmssT = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

const startOf = (i) => scenes.slice(0, i).reduce((a, s) => a + s.dur, 0);
const totalDur = () => scenes.reduce((a, s) => a + s.dur, 0);
const sceneAt = (t) => {
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) { acc += scenes[i].dur; if (t < acc) return i; }
  return scenes.length - 1;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* fields are free-form and may hold newlines — flatten them for single-line chrome */
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const state = { view: 'script', t: 0, playing: false, monUid: null, monSig: '', raf: 0, lastTick: 0 };
const rowsEl = $('#rows');
const rowFor = new Map(); // scene.uid -> row element

/* ---------------------------------------------------------------- header */

function renderHead() {
  const title = $('.sh-title'), notes = $('.sh-notes');
  title.textContent = doc.title;
  notes.textContent = doc.notes;
  wireFreeText(title, (text) => {
    doc.title = text;
    $('.crumb-cur').textContent = `Script — ${oneLine(text) || 'Untitled'}`;
  });
  wireFreeText(notes, (text) => { doc.notes = text; });
}

/* ---------------------------------------------------------------- rail */

function renderRail(freshId) {
  const list = $('#railList');
  list.innerHTML = comps.map((c) => {
    const k = KINDS[c.kind];
    return `<button class="rail-item ${c.active ? 'active' : ''} ${c.id === freshId ? 'fresh' : ''}">
      <i class="dot ${k.dot}"></i><span class="nm">${esc(c.name)}</span><b>${k.tag}</b></button>`;
  }).join('');
}

/* ---------------------------------------------------------------- rows */

function buildRow(scene) {
  const row = document.createElement('div');
  row.className = 'srow';
  row.dataset.uid = scene.uid;
  row.innerHTML = `
    <div class="c-gut">
      <span class="sc-num"></span>
      <button class="g-btn g-drag" title="Drag to reorder · ↑ ↓ to move" tabindex="0">⠿</button>
      <button class="g-btn g-play" title="Preview from this scene">▶</button>
      <button class="g-btn g-del" title="Delete scene">✕</button>
    </div>
    <div class="c-time">
      <div class="t-range"></div>
      <div class="t-in"></div>
    </div>
    <div class="c-dur">
      <div class="dur-pill" tabindex="0" title="Drag ↑↓ · click to type · ripples the sheet">
        <span class="dur-val"></span>
        <span class="dur-nudge"><button class="nup" title="+0.5s">▲</button><button class="ndn" title="−0.5s">▼</button></span>
      </div>
      <div class="dur-sub"></div>
    </div>
    <div class="c-nar">
      <div class="nar-text" contenteditable="true" spellcheck="false" data-ph="narration or dialog…"></div>
    </div>
    <div class="c-vis">
      <span class="vis-label" contenteditable="true" spellcheck="false" data-ph="SCENE"></span>
      <div class="vis-text" contenteditable="true" spellcheck="false" data-ph="describe the visual…"></div>
      <div class="sfx-row">
        <span class="sfx-label">SFX</span>
        <div class="sfx-text" contenteditable="true" spellcheck="false" data-ph="sound effects…"></div>
      </div>
    </div>
    <div class="c-src"></div>`;
  $('.nar-text', row).textContent = scene.nar;
  $('.vis-label', row).textContent = scene.title.toUpperCase();
  $('.vis-text', row).textContent = scene.vis;
  $('.sfx-text', row).textContent = scene.sfx;
  rowFor.set(scene.uid, row);
  renderSourceCell(scene);
  wireRow(row, scene);
  return row;
}

const sceneOfRow = (row) => scenes.find((s) => s.uid === row.dataset.uid);
const idxOfRow = (row) => scenes.findIndex((s) => s.uid === row.dataset.uid);

function renderSourceCell(scene, { animate = false } = {}) {
  const row = rowFor.get(scene.uid);
  if (!row) return;
  const cell = $('.c-src', row);
  const r = resolve(scene);
  if (!r) {
    cell.innerHTML = `<button class="src-empty" title="Pick a comp, create one, or use an image / video">
      <b>＋ comp or media</b><span>or drop a file here</span></button>`;
  } else {
    const fit = (r.dur && Math.abs(r.dur - scene.dur) > 0.05)
      ? `<button class="src-fit" title="Set the scene duration to the clip length">clip <b>${r.dur.toFixed(1)}s</b> — fit scene</button>` : '';
    cell.innerHTML = `<div class="src-card ${animate ? 'swapped' : ''}">
      <div class="src-thumb">${sourceArt(r)}${sourceChrome(r)}</div>
      <div class="src-bar">
        <i class="dot ${r.dot}"></i>
        <span class="src-name" title="${esc(r.name)}">${esc(r.name)}</span>
        <button class="src-swap" title="Change source">⇄</button>
      </div>${fit}</div>`;
    const fitBtn = $('.src-fit', cell);
    if (fitBtn) fitBtn.addEventListener('click', () => {
      setDur(idxOfRow(row), r.dur);
      renderSourceCell(scene);
    });
    $('.src-swap', cell).addEventListener('click', (e) => openPicker(scene, e.currentTarget));
    if (animate) setTimeout(() => $('.src-card', cell)?.classList.remove('swapped'), 400);
  }
  const opener = $('.src-empty', cell);
  if (opener) opener.addEventListener('click', (e) => openPicker(scene, e.currentTarget));
  wireFileDrop(cell, scene);
}

function wireRow(row, scene) {
  $('.g-play', row).addEventListener('click', () => {
    setT(startOf(idxOfRow(row)) + 0.001);
    activateView('preview');
    setPlaying(true);
  });
  $('.g-del', row).addEventListener('click', () => deleteScene(idxOfRow(row)));
  wireDragHandle($('.g-drag', row), row);

  /* duration: drag to scrub, click to type, nudge buttons */
  const pill = $('.dur-pill', row);
  $('.nup', row).addEventListener('click', () => setDur(idxOfRow(row), scene.dur + 0.5));
  $('.ndn', row).addEventListener('click', () => setDur(idxOfRow(row), scene.dur - 0.5));
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.dur-nudge') || pill.classList.contains('editing')) return;
    e.preventDefault();
    const startY = e.clientY, startDur = scene.dur;
    let dragged = false;
    const move = (ev) => {
      const dy = startY - ev.clientY;
      if (!dragged && Math.abs(dy) < 4) return;
      dragged = true;
      setDur(idxOfRow(row), startDur + dy * 0.02, { silent: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragged) flashTimesFrom(idxOfRow(row));
      else openDurInput(row, scene);
    };
    try { pill.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !pill.classList.contains('editing')) openDurInput(row, scene);
    if (e.key === 'ArrowUp') { e.preventDefault(); setDur(idxOfRow(row), scene.dur + 0.5); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setDur(idxOfRow(row), scene.dur - 0.5); }
  });

  for (const [sel, key] of [['.nar-text', 'nar'], ['.vis-text', 'vis'], ['.sfx-text', 'sfx'], ['.vis-label', 'title']]) {
    wireFreeText($(sel, row), (text) => {
      scene[key] = text;
      if (key === 'title') buildScrub();
      syncOverlays(true);
    });
  }
}

/* every free-form field behaves the same: Enter is a newline, Escape drops focus,
   edits commit as you type. innerText (not textContent) so line breaks survive. */
function wireFreeText(el, onInput) {
  el.addEventListener('input', () => {
    const text = el.innerText.replace(/\n+$/, '');
    // deleting back to nothing can leave a stray <br>, which defeats :empty and the placeholder
    if (!text && el.innerHTML) el.innerHTML = '';
    onInput(text, el);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); el.blur(); return; }
    if (e.key === 'Enter') { e.preventDefault(); insertLineBreak(el); }
  });
}

/* Enter is a newline in every free-form field. Done explicitly rather than left to
   the contenteditable default, which differs by browser (<div> vs <p> vs <br>) and
   doesn't fire at all under automation. */
function insertLineBreak(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
    el.appendChild(document.createElement('br'));
  } else if (!document.execCommand('insertLineBreak')) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function openDurInput(row, scene) {
  const pill = $('.dur-pill', row), val = $('.dur-val', row);
  if (pill.classList.contains('editing')) return;
  pill.classList.add('editing');
  val.innerHTML = `<input class="dur-input" type="text" value="${scene.dur.toFixed(1)}" />`;
  const input = $('input', val);
  input.focus(); input.select();
  const commit = (apply) => {
    const raw = parseFloat(input.value.replace(',', '.'));
    pill.classList.remove('editing');
    val.textContent = `${scene.dur.toFixed(1)}s`;
    if (apply && isFinite(raw)) setDur(idxOfRow(row), raw);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function setDur(idx, v, { silent } = {}) {
  if (idx < 0) return;
  const next = clampDur(v);
  if (next === scenes[idx].dur) return;
  scenes[idx].dur = next;
  updateTimes();
  if (!silent) flashTimesFrom(idx);
}

/* recompute every derived readout — the "flows through" moment */
function updateTimes() {
  scenes.forEach((s, i) => {
    const row = rowFor.get(s.uid);
    if (!row) return;
    const a = startOf(i);
    $('.sc-num', row).textContent = `S${i + 1}`;
    $('.t-range', row).textContent = `${mmss(a)} – ${mmss(a + s.dur)}`;
    $('.t-in', row).textContent = `in ${Math.round(a * FPS)} f`;
    if (!$('.dur-pill', row).classList.contains('editing')) $('.dur-val', row).textContent = `${s.dur.toFixed(1)}s`;
    $('.dur-sub', row).textContent = `${Math.round(s.dur * FPS)} f @ ${FPS}`;
  });
  const total = totalDur();
  if (state.t >= total) state.t = 0;
  const runVal = $('#runVal'), label = mmss(total);
  if (runVal.textContent !== label) {
    runVal.textContent = label;
    runVal.classList.remove('bump'); void runVal.offsetWidth; runVal.classList.add('bump');
  }
  $('#runSub').textContent = `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`;
  $('#stats').textContent = `${Math.round(total * FPS)} frames @ ${FPS} fps`;
  $('#tcTotal').textContent = mmss(total);
  $('#sheetEmpty').hidden = scenes.length > 0;
  $$('.seg', $('#scrub')).forEach((seg, i) => { if (scenes[i]) seg.style.flexGrow = scenes[i].dur; });
  syncOverlays();
  paintScrub();
}

function flashTimesFrom(idx) {
  scenes.forEach((s, i) => {
    if (i < idx) return;
    const row = rowFor.get(s.uid);
    if (!row) return;
    $('.c-time', row).animate(
      [{ color: '#f0b45f' }, { color: '' }],
      { duration: 700, delay: (i - idx) * 55, easing: 'ease-out' });
  });
}

/* ---------------------------------------------------------------- reorder */

let drag = null;

function flip(mutate) {
  const rows = [...rowsEl.children];
  const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
  mutate();
  for (const r of rowsEl.children) {
    if (drag && r === drag.row) continue;
    const dy = (before.get(r) ?? r.getBoundingClientRect().top) - r.getBoundingClientRect().top;
    if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
      { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

function commitOrder() {
  const order = [...rowsEl.children].map((r) => r.dataset.uid);
  scenes.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
  updateTimes();
  buildScrub();
}

function wireDragHandle(handle, row) {
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = idxOfRow(row), to = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (to < 0 || to >= scenes.length) return;
    flip(() => {
      if (e.key === 'ArrowUp') rowsEl.insertBefore(row, rowFor.get(scenes[to].uid));
      else rowsEl.insertBefore(rowFor.get(scenes[to].uid), row);
    });
    commitOrder();
    flashTimesFrom(Math.min(i, to));
    handle.focus();
  });

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('row-ghost');
    ghost.classList.remove('active', 'dragging');
    ghost.style.width = `${rect.width}px`;
    $$('[contenteditable]', ghost).forEach((n) => n.setAttribute('contenteditable', 'false'));
    document.body.appendChild(ghost);
    document.body.classList.add('reordering');
    row.classList.add('dragging');

    drag = { row, ghost, from: idxOfRow(row), dx: e.clientX - rect.left, dy: e.clientY - rect.top, y: e.clientY, scroll: 0 };
    place(e.clientX, e.clientY);
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    requestAnimationFrame(autoScroll);
  });
}

function place(x, y) {
  drag.ghost.style.left = `${x - drag.dx}px`;
  drag.ghost.style.top = `${y - drag.dy}px`;
}

function onDragMove(e) {
  if (!drag) return;
  drag.y = e.clientY;
  place(e.clientX, e.clientY);
  reposition();
}

/* move the real row among its siblings so the gap tracks the pointer */
function reposition() {
  const y = drag.y;
  const others = [...rowsEl.children].filter((r) => r !== drag.row);
  const after = others.find((r) => {
    const b = r.getBoundingClientRect();
    return y < b.top + b.height / 2;
  }) || null;
  if (after === drag.row.nextElementSibling || (!after && !drag.row.nextElementSibling)) return;
  flip(() => rowsEl.insertBefore(drag.row, after));
}

function autoScroll() {
  if (!drag) return;
  const sheet = $('#sheet'), b = sheet.getBoundingClientRect(), EDGE = 78;
  let v = 0;
  if (drag.y < b.top + EDGE) v = -Math.ceil((b.top + EDGE - drag.y) / 5);
  else if (drag.y > b.bottom - EDGE) v = Math.ceil((drag.y - (b.bottom - EDGE)) / 5);
  if (v) { sheet.scrollTop += v; reposition(); }
  requestAnimationFrame(autoScroll);
}

function onDragUp() {
  if (!drag) return;
  const { row, ghost, from } = drag;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragUp);
  const target = row.getBoundingClientRect();
  ghost.animate([{ left: ghost.style.left, top: ghost.style.top }, { left: `${target.left}px`, top: `${target.top}px` }],
    { duration: 150, easing: 'ease-out' }).finished.catch(() => {}).finally(() => ghost.remove());
  row.classList.remove('dragging');
  document.body.classList.remove('reordering');
  drag = null;
  commitOrder();
  const to = idxOfRow(row);
  if (to !== from) flashTimesFrom(Math.min(from, to));
  renderMonitor(sceneAt(state.t), true);
}

/* ---------------------------------------------------------------- delete + undo */

let undoTimer = 0, undoHandler = null;

function deleteScene(idx) {
  if (idx < 0) return;
  const scene = scenes[idx], row = rowFor.get(scene.uid);
  row.classList.add('leaving');
  setTimeout(() => {
    flip(() => { row.remove(); });
    rowFor.delete(scene.uid);
    scenes.splice(idx, 1);
    updateTimes();
    buildScrub();
    if (scenes.length) { setT(Math.min(state.t, Math.max(0, totalDur() - 0.001))); renderMonitor(sceneAt(state.t), true); }
    else { setPlaying(false); renderMonitor(-1, true); }
    toast(`Deleted S${idx + 1} · ${oneLine(scene.title)}`, () => {
      scenes.splice(idx, 0, scene);
      const el = buildRow(scene);
      rowsEl.insertBefore(el, rowsEl.children[idx] || null);
      updateTimes();
      buildScrub();
      renderMonitor(sceneAt(state.t), true);
      el.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    });
  }, 170);
}

function toast(msg, undo) {
  const el = $('#toast'), undoBtn = $('#toastUndo');
  clearTimeout(undoTimer);
  if (undoHandler) undoBtn.removeEventListener('click', undoHandler); // a queued toast owns the button alone
  $('#toastMsg').textContent = msg;
  el.hidden = false;
  const hide = () => {
    el.hidden = true;
    undoBtn.removeEventListener('click', undoHandler);
    undoHandler = null;
  };
  undoHandler = () => { undo(); hide(); };
  undoBtn.addEventListener('click', undoHandler);
  undoTimer = setTimeout(hide, 7000);
}

/* ---------------------------------------------------------------- source picker */

const picker = $('#picker');
let pickerFor = null, pickerTab = 'comps', newKind = 'rough';

function openPicker(scene, anchor, tab) {
  pickerFor = scene;
  pickerTab = tab || (scene.source ? 'comps' : 'comps');
  renderPicker(anchor);
}

function renderPicker(anchor) {
  const scene = pickerFor;
  if (!scene) return;
  const idx = scenes.indexOf(scene);
  const cur = scene.source;
  const tabBtn = (id, label) => `<button class="pk-tab ${pickerTab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`;
  let body = '';

  if (pickerTab === 'comps') {
    const attachable = comps.filter((c) => c.attachable !== false);
    const mine = attachable.filter((c) => scene.key && c.scene === scene.key);
    const rest = attachable.filter((c) => !mine.includes(c));
    const item = (c) => {
      const k = KINDS[c.kind];
      const on = cur && cur.type === 'comp' && cur.id === c.id;
      return `<button class="pk-item ${on ? 'current' : ''}" data-comp="${c.id}">
        <i class="dot ${k.dot}"></i><span class="nm">${esc(c.name)}</span><span class="st">${k.tag}</span></button>`;
    };
    body = (mine.length ? `<div class="pk-group">FOR THIS SCENE</div>${mine.map(item).join('')}` : '')
      + `<div class="pk-group">${mine.length ? 'OTHER COMPS' : 'PROJECT COMPS'}</div>${rest.map(item).join('')}`;
  } else if (pickerTab === 'new') {
    const slug = (scene.title || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'scene';
    const prefix = { rough: 'roughs/', previz: 'previz/', 'gen-image': 'gen/', 'gen-video': 'gen/', edit: 'edit/', '3d': 'previz/' }[newKind];
    body = `<div class="pk-form">
      <div class="pk-field"><label>KIND</label><div class="pk-kinds">
        ${NEW_KINDS.map((k) => `<button class="pk-kind ${k === newKind ? 'on' : ''}" data-kind="${k}">
          <i class="dot ${KINDS[k].dot}"></i>${KINDS[k].label}</button>`).join('')}
      </div></div>
      <div class="pk-field"><label>NAME</label>
        <input class="pk-input" id="pkName" value="${esc(prefix + slug)}" spellcheck="false" /></div>
      <button class="pk-create" id="pkCreate">Create &amp; attach to S${idx + 1}</button>
      <p class="pk-note">Creates an empty ${KINDS[newKind].label.toLowerCase()} comp in the project and points this row at it — open it later to fill it in.</p>
    </div>`;
  } else {
    const on = (m) => cur && cur.type === 'media' && cur.id === m.id;
    body = `<div class="pk-grid">${media.map((m) => `
      <button class="pk-media ${on(m) ? 'current' : ''}" data-media="${m.id}" title="${esc(m.name)}">
        <span class="pm-art">${m.url ? (m.type === 'video'
          ? `<video src="${m.url}" muted playsinline preload="metadata"></video>`
          : `<img src="${m.url}" alt="" />`) : artSVG(m.art, 'photo')}
          <span class="pm-badge">${m.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
          ${m.dur ? `<span class="pm-dur">${m.dur.toFixed(1)}s</span>` : ''}</span>
        <span class="pm-nm">${esc(m.name)}</span></button>`).join('')}</div>`;
  }

  const foot = (pickerTab === 'media' ? `<button class="pk-drop" id="pkDrop"><b>＋ Drop a file — or click to browse</b><span>IMAGE OR VIDEO</span></button>` : '')
    + (cur ? `<button class="pk-detach">Detach — script only</button>` : '');

  picker.innerHTML = `
    <div class="pk-head">SOURCE — S${idx + 1} · ${esc(oneLine(scene.title).toUpperCase() || 'SCENE')}</div>
    <div class="pk-tabs">${tabBtn('comps', 'COMPS')}${tabBtn('new', 'NEW COMP')}${tabBtn('media', 'MEDIA')}</div>
    <div class="pk-body">${body}</div>
    ${foot ? `<div class="pk-foot">${foot}</div>` : ''}`;
  picker.hidden = false;
  positionPicker(anchor);
  wirePicker(anchor);
}

function positionPicker(anchor) {
  if (!anchor || !anchor.isConnected) return;
  const r = anchor.getBoundingClientRect(), w = picker.offsetWidth, h = picker.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 10);
  picker.style.left = `${Math.max(10, left)}px`;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  picker.style.top = `${top}px`;
}

function wirePicker(anchor) {
  $$('.pk-tab', picker).forEach((b) => b.addEventListener('click', () => { pickerTab = b.dataset.tab; renderPicker(anchor); }));
  $$('.pk-item', picker).forEach((b) => b.addEventListener('click', () => attach(pickerFor, { type: 'comp', id: b.dataset.comp })));
  $$('.pk-media', picker).forEach((b) => b.addEventListener('click', () => attach(pickerFor, { type: 'media', id: b.dataset.media })));
  $$('.pk-kind', picker).forEach((b) => b.addEventListener('click', () => { newKind = b.dataset.kind; renderPicker(anchor); }));
  const detach = $('.pk-detach', picker);
  if (detach) detach.addEventListener('click', () => attach(pickerFor, null));

  const create = $('#pkCreate', picker);
  if (create) {
    const submit = () => {
      const name = ($('#pkName', picker).value || '').trim();
      if (!name) return;
      const c = { id: uid('c'), name, kind: newKind, art: pickerFor.key, scene: pickerFor.key };
      comps.push(c);
      renderRail(c.id);
      attach(pickerFor, { type: 'comp', id: c.id });
    };
    create.addEventListener('click', submit);
    $('#pkName', picker).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }

  const drop = $('#pkDrop', picker);
  if (drop) {
    drop.addEventListener('click', () => pickFiles(pickerFor));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('file-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('file-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('file-over');
      ingestFiles(e.dataTransfer.files, pickerFor);
    });
  }
}

function attach(scene, source) {
  scene.source = source;
  renderSourceCell(scene, { animate: true });
  closePicker();
  if (state.monUid === scene.uid) renderMonitor(scenes.indexOf(scene), true);
  else syncOverlays();
}

function closePicker() { picker.hidden = true; pickerFor = null; }

window.addEventListener('pointerdown', (e) => {
  if (!picker.hidden && !e.target.closest('.picker') && !e.target.closest('.src-swap') && !e.target.closest('.src-empty')) closePicker();
}, true);

/* ---------------------------------------------------------------- real files */

function pickFiles(scene) {
  const input = $('#fileInput');
  input.value = '';
  input.onchange = () => ingestFiles(input.files, scene);
  input.click();
}

function ingestFiles(fileList, scene) {
  const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (!files.length) return;
  let first = null;
  for (const f of files) {
    const type = f.type.startsWith('video/') ? 'video' : 'image';
    const item = { id: uid('m'), name: f.name, type, url: URL.createObjectURL(f), art: scene?.key };
    media.unshift(item);
    if (!first) first = item;
    if (type === 'video') {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        item.dur = snap1(probe.duration);
        if (scene && scene.source && scene.source.id === item.id) renderSourceCell(scene);
        if (!picker.hidden) renderPicker(null);
      };
      probe.src = item.url;
    }
  }
  if (scene) attach(scene, { type: 'media', id: first.id });
}

function wireFileDrop(cell, scene) {
  cell.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); cell.classList.add('file-over');
  });
  cell.addEventListener('dragleave', (e) => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('file-over'); });
  cell.addEventListener('drop', (e) => {
    e.preventDefault(); cell.classList.remove('file-over');
    ingestFiles(e.dataTransfer.files, scene);
  });
}
/* dropping anywhere else shouldn't navigate away */
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });

/* ---------------------------------------------------------------- preview */

const monitor = $('#monitor'), monFrame = $('#monFrame');
let monVideo = null;

function fitMonitor() {
  const wrap = $('#monWrap');
  const availW = wrap.clientWidth - 56, availH = wrap.clientHeight - 34;
  if (availW <= 0 || availH <= 0) return;
  const w = Math.min(availW, availH * 16 / 9, 1240);
  monitor.style.width = `${w}px`;
  monitor.style.height = `${w * 9 / 16}px`;
}
new ResizeObserver(fitMonitor).observe($('#monWrap'));

function renderMonitor(idx, force = false) {
  const scene = scenes[idx];
  if (!scene) {
    monVideo = null;
    monFrame.innerHTML = `<div class="mon-none"><span>NO SCENES</span></div>`;
    state.monUid = null;
    $('#ovSlate').style.display = $('#ovCap').style.display = $('#ovComp').style.display = 'none';
    return;
  }
  $('#ovSlate').style.display = $('#ovComp').style.display = '';
  const r = resolve(scene);
  const sig = `${scene.uid}|${scene.source ? scene.source.type + scene.source.id : '~'}`;
  if (!force && state.monSig === sig) return;
  const changed = state.monUid !== scene.uid;
  state.monUid = scene.uid; state.monSig = sig;

  monFrame.innerHTML = r
    ? `<div class="art">${sourceArt(r, { live: true })}</div>${sourceChrome(r)}`
    : `<div class="mon-none"><span>NO SOURCE — SCRIPT ONLY</span></div>`;
  monVideo = $('[data-mon-video]', monFrame);
  if (monVideo) { monVideo.muted = true; syncVideo(true); }

  syncOverlays();
  if (changed) for (const el of [$('#ovCap'), $('#ovSlate')]) { el.classList.remove('slide'); void el.offsetWidth; el.classList.add('slide'); }
}

/* real dropped clips play in sync with the scrubber */
function syncVideo(seek = false) {
  if (!monVideo) return;
  const idx = scenes.findIndex((s) => s.uid === state.monUid);
  if (idx < 0) return;
  const local = Math.max(0, state.t - startOf(idx));
  const dur = monVideo.duration;
  const want = isFinite(dur) ? Math.min(local, Math.max(0, dur - 0.02)) : local;
  if (seek || !state.playing || Math.abs(monVideo.currentTime - want) > 0.25) {
    try { monVideo.currentTime = want; } catch { /* not ready */ }
  }
  if (state.playing && monVideo.paused) monVideo.play().catch(() => {});
  if (!state.playing && !monVideo.paused) monVideo.pause();
}

function syncOverlays(soft = false) {
  const idx = scenes.findIndex((s) => s.uid === state.monUid);
  const scene = scenes[idx];
  if (!scene) return;
  const a = startOf(idx);
  $('#ovSlateTc').textContent = `S${idx + 1} · ${oneLine(scene.title).toUpperCase() || 'SCENE'} · ${mmss(a)} – ${mmss(a + scene.dur)}`;
  $('#ovSlateVis').textContent = scene.vis || '—';
  const sfxEl = $('#ovSlateSfx');
  sfxEl.textContent = scene.sfx ? `SFX  ${scene.sfx}` : '';
  sfxEl.style.display = scene.sfx ? '' : 'none';
  const cap = $('#ovCap');
  cap.style.display = scene.nar ? '' : 'none';
  $('#ovCapText').textContent = scene.nar;
  const r = resolve(scene);
  $('#ovComp').innerHTML = r
    ? `<i class="dot ${r.dot}"></i>${esc(r.name)} · ${r.tag}`
    : `<i class="dot k-rough"></i>no source — pick one in the SCRIPT tab`;
  if (!soft) paintScrub();
}

function buildScrub() {
  const scrub = $('#scrub');
  scrub.innerHTML = scenes.map((s, i) =>
    `<div class="seg" data-idx="${i}" style="flex-grow:${s.dur}"><div class="seg-fill"></div></div>`).join('');
  paintScrub();
}

function timeFromClientX(x) {
  const segs = $$('.seg', $('#scrub'));
  if (!segs.length) return null;
  const first = segs[0].getBoundingClientRect(), last = segs[segs.length - 1].getBoundingClientRect();
  if (x <= first.left) return 0;
  if (x >= last.right) return totalDur() - 0.05;
  for (let i = 0; i < segs.length; i++) {
    const r = segs[i].getBoundingClientRect();
    if (x <= r.right + 1.5) return startOf(i) + Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width))) * scenes[i].dur;
  }
  return null;
}

function paintScrub() {
  const act = sceneAt(state.t);
  $$('.seg', $('#scrub')).forEach((seg, i) => {
    const fill = $('.seg-fill', seg);
    if (i < act) { seg.classList.add('done'); fill.style.width = ''; }
    else if (i === act) {
      seg.classList.remove('done');
      fill.style.width = `${Math.min(100, ((state.t - startOf(i)) / scenes[i].dur) * 100)}%`;
    } else { seg.classList.remove('done'); fill.style.width = '0'; }
  });
  $('#tcNow').textContent = mmssT(state.t);
}

function setT(t) {
  state.t = Math.min(Math.max(0, t), Math.max(0, totalDur() - 0.001));
  if (!scenes.length) { paintScrub(); return; }
  const idx = sceneAt(state.t);
  const wasScene = state.monUid;
  renderMonitor(idx);
  syncVideo(wasScene !== state.monUid);
  paintScrub();
}

function setPlaying(on) {
  state.playing = on && scenes.length > 0;
  $('#tPlay').textContent = state.playing ? '❚❚' : '▶';
  monitor.classList.toggle('paused', !state.playing);
  syncVideo();
  if (state.playing) { state.lastTick = performance.now(); state.raf = requestAnimationFrame(tick); }
  else cancelAnimationFrame(state.raf);
}

function tick(now) {
  if (!state.playing) return;
  const dt = Math.min(0.1, (now - state.lastTick) / 1000);
  state.lastTick = now;
  let t = state.t + dt;
  if (t >= totalDur()) t = 0;
  setT(t);
  state.raf = requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------- tabs / chrome */

function activateView(view) {
  state.view = view;
  $('#tabScript').classList.toggle('active', view === 'script');
  $('#tabPreview').classList.toggle('active', view === 'preview');
  $('#viewScript').hidden = view !== 'script';
  $('#viewPreview').hidden = view !== 'preview';
  $('#hint').textContent = view === 'script'
    ? 'Drag ⠿ to reorder · duration ripples every start below it · ⇄ picks a comp, image, or clip'
    : 'Space plays · ← → jump scenes · the slate and captions come straight from the sheet';
  if (view === 'preview') { fitMonitor(); renderMonitor(sceneAt(state.t), true); paintScrub(); }
  else setPlaying(false);
}

const isTyping = () => {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.isContentEditable);
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePicker(); return; }
  if (isTyping()) return;
  if (e.key === '1') activateView('script');
  else if (e.key === '2') activateView('preview');
  else if (e.key === ' ' && state.view === 'preview') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowLeft' && state.view === 'preview') { e.preventDefault(); jump(-1); }
  else if (e.key === 'ArrowRight' && state.view === 'preview') { e.preventDefault(); jump(1); }
});

function jump(dir) {
  if (!scenes.length) return;
  const i = sceneAt(state.t), a = startOf(i);
  if (dir < 0) setT(state.t - a > 0.35 ? a : startOf(Math.max(0, i - 1)));
  else setT(startOf(Math.min(scenes.length - 1, i + 1)));
}

$('#tabScript').addEventListener('click', () => activateView('script'));
$('#tabPreview').addEventListener('click', () => activateView('preview'));
$('#tPlay').addEventListener('click', () => setPlaying(!state.playing));
$('#tPrev').addEventListener('click', () => jump(-1));
$('#tNext').addEventListener('click', () => jump(1));

$('#scrub').addEventListener('pointermove', (e) => {
  const tip = $('#scrubTip'), seg = e.target.closest('.seg');
  if (!seg) { tip.hidden = true; return; }
  const i = +seg.dataset.idx, a = startOf(i);
  tip.textContent = `S${i + 1} · ${oneLine(scenes[i].title)} · ${mmss(a)} – ${mmss(a + scenes[i].dur)}`;
  tip.style.left = `${e.clientX}px`;
  tip.style.top = `${seg.getBoundingClientRect().top}px`;
  tip.hidden = false;
});
$('#scrub').addEventListener('pointerleave', () => { $('#scrubTip').hidden = true; });
$('#scrub').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { $('#scrub').setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  const seek = (ev) => { const t = timeFromClientX(ev.clientX); if (t != null) setT(t); };
  seek(e);
  const up = () => { window.removeEventListener('pointermove', seek); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', seek);
  window.addEventListener('pointerup', up);
});

$('#addScene').addEventListener('click', () => {
  const scene = { uid: uid('s'), key: null, title: `Scene ${scenes.length + 1}`, dur: 4,
    nar: '', vis: '', sfx: '', source: null };
  scenes.push(scene);
  rowsEl.appendChild(buildRow(scene));
  buildScrub();
  updateTimes();
  const row = rowFor.get(scene.uid);
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('.nar-text', row).focus(), 250);
});

window.addEventListener('resize', () => { if (!picker.hidden) closePicker(); });

/* ---------------------------------------------------------------- boot */

renderHead();
renderRail();
scenes.forEach((s) => rowsEl.appendChild(buildRow(s)));
buildScrub();
updateTimes();
renderMonitor(0, true);
setT(0);
activateView('script');
