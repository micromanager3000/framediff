/* FrameDiff · Timeline Lab — twenty-two timeline-editing ideas, holistically integrated.
   Vanilla JS, no deps. Frames-based like the studio (ppf = pixels per frame). */
"use strict";

/* ============ constants ============ */
const FPS = 30;
const LABEL_W = 78;
const RULER_H = 44;            // 16 render-window strip + 28 ruler
const MAX_PPF = 40;
const BEAT_STEP = 15;          // 120 bpm at 30fps
const SNAP_ENTER = 9;          // px to engage a snap
const SNAP_EXIT = 22;          // px to break away (hysteresis = sticky ends)
const FINE_GAIN = 1 / 7;       // ⇧ drag gain
const uid = (() => { let n = 0; return (p = "c") => `${p}${++n}`; })();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const secs = (f) => (f / FPS).toFixed(2);
const fmtT = (f) => `${secs(f)}s`;
const fmtD = (f) => `${f >= 0 ? "+" : "−"}${Math.abs(Math.round(f))}f · ${f >= 0 ? "+" : "−"}${(Math.abs(f) / FPS).toFixed(2)}s`;

/* ============ single-feature pages (?feature=…) ============
   The lab shows everything; each feature page strips the project and the
   chrome down to a plain baseline timeline plus exactly one idea. */
const PAGES = {
  lab:      { label: null, ideas: null, markers: true, connected: true, tracks: null, v1Magnetic: true,
              caps: ["loupe", "fine", "hold", "snapEnds", "snapBeats", "beatDots", "wedge", "gaps", "magnetic", "blade", "takes", "stems", "skim", "minimap", "roll", "slip", "motion", "layers"] },
  loupe:    { label: "PRECISION LOUPE",    ideas: [1, 2, 3], caps: ["loupe", "fine", "hold"],         tracks: ["ov", "v1", "mx"],        v1Magnetic: false },
  snap:     { label: "STICKY SNAP",        ideas: [4, 5],    caps: ["fine", "snapEnds"],              tracks: ["ov", "v1", "sfx", "mx"], v1Magnetic: false, markers: true },
  beats:    { label: "BEAT GRID",          ideas: [6],       caps: ["snapBeats", "beatDots"],         tracks: ["v1", "sfx", "mx"],       v1Magnetic: false },
  ripple:   { label: "RIPPLE INSERT",      ideas: [7, 8],    caps: ["wedge", "gaps", "snapEnds"],     tracks: ["ov", "v1", "sfx", "mx"], v1Magnetic: true, connected: true },
  magnetic: { label: "MAGNETIC STORYLINE", ideas: [12],      caps: ["magnetic"],                      tracks: ["v1", "mx"],              v1Magnetic: true },
  blade:    { label: "BLADE",              ideas: [14],      caps: ["blade"],                         tracks: ["ov", "v1", "mx"],        v1Magnetic: false },
  takes:    { label: "TAKE STACKS",        ideas: [21],      caps: ["takes"],                         tracks: ["ov", "v1", "mx"],        v1Magnetic: true, connected: true },
  layers:   { label: "LAYERS & STACKING",  ideas: [22],      caps: ["layers"],                        tracks: ["ov", "v1", "sfx", "mx"], v1Magnetic: false, seedOverlap: true },
};
const FEATURE = (() => { const f = new URLSearchParams(location.search).get("feature"); return PAGES[f] ? f : "lab"; })();
const PAGE = PAGES[FEATURE];
const CAPS = new Set(PAGE.caps);
const has = (c) => CAPS.has(c);
const anySnap = () => has("snapEnds") || has("snapBeats");

/* tones: studio palette families */
const TONES = {
  amber:  { line: "rgb(240 180 95 / 40%)",  bg: "rgb(240 180 95 / 14%)",  text: "#ecd3ac", hue: 36 },
  blue:   { line: "rgb(143 201 236 / 34%)", bg: "rgb(143 201 236 / 14%)", text: "#b8d2e8", hue: 205 },
  pink:   { line: "rgb(213 169 232 / 36%)", bg: "rgb(213 169 232 / 14%)", text: "#d4bfe8", hue: 285 },
  green:  { line: "rgb(114 211 156 / 35%)", bg: "rgb(114 211 156 / 13%)", text: "#aadcbd", hue: 150 },
  path:   { line: "rgb(114 213 244 / 36%)", bg: "rgb(114 213 244 / 13%)", text: "#a8dcee", hue: 190 },
  red:    { line: "rgb(240 116 112 / 36%)", bg: "rgb(240 116 112 / 13%)", text: "#e8b6b4", hue: 5 },
  motion: { line: "rgb(170 156 255 / 38%)", bg: "rgb(170 156 255 / 13%)", text: "#c8beea", hue: 250 },
};

/* ============ model ============ */
let tracks = [
  { id: "ov",  label: "V2", name: "OVERLAY", kind: "overlay", h: 40, clipH: 26, clipTop: 7 },
  { id: "v1",  label: "V1", name: "SCENES",  kind: "scenes",  h: 62, clipH: 50, clipTop: 6, magnetic: true },
  { id: "sfx", label: "A1", name: "SFX",     kind: "sfx",     h: 34, clipH: 22, clipTop: 6 },
  { id: "mx",  label: "A2", name: "MUSIC",   kind: "music",   h: 50, clipH: 40, clipTop: 5, lockable: true, locked: false },
];
const trackById = (id) => tracks.find((t) => t.id === id);
const byId = (id) => clips.find((c) => c.id === id);

/* ============ ordering: doubly-linked lists (idea 22) ============
   Every visual element has an explicit order. Layers form a linked list
   (prevId/nextId — first = topmost in the composite); within each layer the
   clips form a z linked list (zPrevId/zNextId — tail = topmost). All links
   are by id so state stays JSON-serializable for undo. */
function layerOrder() {
  const out = [];
  let t = tracks.find((x) => !x.prevId);
  while (t) { out.push(t); t = tracks.find((x) => x.id === t.nextId); }
  return out.length === tracks.length ? out : tracks;      // fallback if links are cold
}
function zBottomToTop(trackId) {
  const out = [];
  let c = clips.find((x) => x.trackId === trackId && !x.zPrevId);
  while (c) { out.push(c); c = c.zNextId ? byId(c.zNextId) : null; }
  const all = clips.filter((x) => x.trackId === trackId);
  return out.length === all.length ? out : all;
}
const zTopToBottom = (trackId) => zBottomToTop(trackId).slice().reverse();
function zUnlink(c) {
  const p = c.zPrevId && byId(c.zPrevId), n = c.zNextId && byId(c.zNextId);
  if (p) p.zNextId = c.zNextId ?? null;
  if (n) n.zPrevId = c.zPrevId ?? null;
  c.zPrevId = c.zNextId = null;
}
function zPushTop(c) {
  const tail = clips.find((x) => x.trackId === c.trackId && x.id !== c.id && !x.zNextId);
  c.zPrevId = tail?.id ?? null; c.zNextId = null;
  if (tail) tail.zNextId = c.id;
}
function zInsertAbove(c, ref) {                             // c becomes ref's zNext
  c.zPrevId = ref.id; c.zNextId = ref.zNextId ?? null;
  if (ref.zNextId) byId(ref.zNextId).zPrevId = c.id;
  ref.zNextId = c.id;
}
function zInsertBelow(c, ref) {                             // c becomes ref's zPrev
  c.zNextId = ref.id; c.zPrevId = ref.zPrevId ?? null;
  if (ref.zPrevId) byId(ref.zPrevId).zNextId = c.id;
  ref.zPrevId = c.id;
}
function zSwap(c, up) {                                     // one step toward top (up) or bottom
  const other = up ? (c.zNextId && byId(c.zNextId)) : (c.zPrevId && byId(c.zPrevId));
  if (!other) return null;
  zUnlink(c);
  if (up) zInsertAbove(c, other);
  else { const below = other.zPrevId && byId(other.zPrevId); if (below) zInsertAbove(c, below); else { c.zNextId = other.id; c.zPrevId = null; other.zPrevId = c.id; } }
  return other;
}
/* rebuild all links from current array order — used at seed/prune time */
function chainOrders() {
  tracks.forEach((t, i) => { t.prevId = tracks[i - 1]?.id ?? null; t.nextId = tracks[i + 1]?.id ?? null; });
  for (const t of tracks) {
    const cs = clips.filter((c) => c.trackId === t.id);
    cs.forEach((c, i) => { c.zPrevId = cs[i - 1]?.id ?? null; c.zNextId = cs[i + 1]?.id ?? null; });
  }
}
function overlapsInLayer(c) {
  const l = liveClip(c);
  return clips.some((o) => o.trackId === c.trackId && o.id !== c.id && !o.gap &&
    l.from < o.from + o.dur - 0.01 && l.from + l.dur > o.from + 0.01);
}

let clips = [];
function C(trackId, name, from, dur, tone, extra = {}) {
  return Object.assign({ id: uid(), trackId, name, from, dur, tone, srcIn: 30, srcLen: dur + 120 }, extra);
}
function seedProject() {
  const sc = (name, dur, tone, extra) => C("v1", name, 0, dur, tone, extra);
  const scenes = [
    sc("logo-sting", 60, "amber"),
    sc("hero", 135, "blue", { badges: [["pinned", "t2"]], takes: { list: [117, 135, 150], cur: 1 } }),
    sc("feature-boards", 105, "pink"),
    sc("feature-sync", 90, "path"),
    sc("feature-analytics", 105, "green", { badges: [["proxy", "proxy"]] }),
    sc("social-proof", 90, "amber"),
    sc("cta", 105, "red"),
  ];
  let cur = 0;
  for (const s of scenes) { s.from = cur; cur += s.dur; }
  const [logo, hero, boards, sync, analytics, social, cta] = scenes;
  clips = [
    ...scenes,
    C("ov", "lower-third", hero.from + 15, 90, "motion", { parentId: hero.id, caption: "Meet Lighthouse", srcLen: 999 }),
    C("ov", "cap-ship-faster", boards.from + 20, 70, "motion", { parentId: boards.id, caption: "Ship 3× faster", srcLen: 999 }),
    C("ov", "badge-4.9", social.from + 12, 66, "motion", { parentId: social.id, caption: "★ 4.9 on G2", srcLen: 999 }),
    C("ov", "cta-button", cta.from + 18, 80, "motion", { parentId: cta.id, caption: "Start free →", srcLen: 999 }),
    C("sfx", "whoosh", hero.from - 5, 12, "yellow", { parentId: hero.id, tone: "green" }),
    C("sfx", "whoosh", boards.from - 5, 12, "green", { parentId: boards.id }),
    C("sfx", "whoosh", analytics.from - 5, 12, "green", { parentId: analytics.id }),
    C("sfx", "riser", social.from - 30, 42, "green", { parentId: social.id }),
    C("sfx", "pop", cta.from + 2, 10, "green", { parentId: cta.id }),
    C("mx", "pulse-120.wav", 0, cur, "green", { srcLen: 2400, srcIn: 0 }),
  ];
  render = { from: 0, to: cur };
  markers = [{ id: uid("m"), frame: social.from, label: "beat drop" }];
  motionKeys = [75, 96, 135, 168].map((f) => ({ id: uid("k"), frame: f }));
  motionTarget = "hero-title";
  chainOrders();
}
let render = { from: 0, to: 690 };
let markers = [];
let motionKeys = [];
let motionTarget = "hero-title";

/* prune the seeded project down to what this page demonstrates */
function applyPageConfig() {
  if (PAGE.tracks) {
    const keep = new Set(PAGE.tracks);
    tracks = tracks.filter((t) => keep.has(t.id));
    clips = clips.filter((c) => keep.has(c.trackId));
  }
  const v1 = trackById("v1");
  if (v1) v1.magnetic = PAGE.v1Magnetic !== false;
  if (!PAGE.connected) for (const c of clips) c.parentId = null;
  if (!has("takes")) for (const c of clips) {
    delete c.takes;
    if (c.badges) { c.badges = c.badges.filter(([k]) => k !== "pinned"); if (!c.badges.length) delete c.badges; }
  }
  if (!PAGE.markers) markers = [];
  if (!has("motion")) motionKeys = [];
  if (PAGE.seedOverlap) {                       // start the layers page with a real overlap
    const sync = clips.find((c) => c.name === "feature-sync");
    if (sync) sync.from -= 45;
  }
  chainOrders();
}

/* selection + tools + toggles */
let selection = new Set();
let tool = "select";           // select | blade | wedge
let snapOn = true, skimOn = true, soundOn = true;
let playing = 0;               // shuttle rate; 0 = paused
let playhead = 0;

/* ============ undo ============ */
const undoStack = [], redoStack = [];
const snapState = () => JSON.stringify({ clips, render, markers, motionKeys, tracks });
function loadState(s) {
  const o = JSON.parse(s);
  clips = o.clips; render = o.render; markers = o.markers; motionKeys = o.motionKeys;
  if (o.tracks) tracks = o.tracks;
  selection = new Set([...selection].filter((id) => clips.some((c) => c.id === id)));
}
function pushUndo() { undoStack.push(snapState()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
function undo() {
  if (!undoStack.length) return toast("Nothing to undo");
  redoStack.push(snapState()); loadState(undoStack.pop());
  recomputeAxis(); rebuild(); toast("Undid last edit", "⌘⇧Z redo");
}
function redo() {
  if (!redoStack.length) return toast("Nothing to redo");
  undoStack.push(snapState()); loadState(redoStack.pop());
  recomputeAxis(); rebuild(); toast("Redid edit");
}

/* commit transaction: undo snapshot → mutate → children ride parents → settle.
   opts.coalesce: rapid same-key commits (hold-to-repeat steppers) share one undo entry. */
let lastCoalesce = { key: null, t: 0 };
function commit(label, sub, fn, opts = {}) {
  const cont = opts.coalesce && lastCoalesce.key === opts.coalesce && performance.now() - lastCoalesce.t < 1600;
  lastCoalesce = opts.coalesce ? { key: opts.coalesce, t: performance.now() } : { key: null, t: 0 };
  if (!cont) pushUndo();
  if (cont) label = null;
  const beforeAxis = axisStart;
  const beforeFrom = new Map(clips.map((c) => [c.id, c.from]));
  fn();
  // connected clips ride their parents (idea 13)
  for (const c of clips) {
    if (!c.parentId) continue;
    const was = beforeFrom.get(c.parentId);
    const parent = clips.find((p) => p.id === c.parentId);
    if (parent && was !== undefined && beforeFrom.has(c.id)) {
      const d = parent.from - was;
      if (d) c.from += d;
    }
  }
  recomputeAxis(); rebuild();
  // FLIP spring settle for every clip whose committed position changed (idea 20).
  // WAAPI, not CSS transitions — an interrupted transition can strand a stale transform.
  for (const c of clips) {
    const was = beforeFrom.get(c.id);
    if (was === undefined) continue;
    const dPx = ((c.from - axisStart) - (was - beforeAxis)) * ppf;
    const el = clipEls.get(c.id);
    if (!el || Math.abs(dPx) < 0.5) continue;
    el.animate(
      [{ transform: `translateX(${-dPx}px)` }, { transform: "none" }],
      { duration: 260, easing: "cubic-bezier(.22, 1.35, .32, 1)" },
    );
  }
  if (label) toast(label, sub);
  updateProj();
  updateMonitor();                 // stacking/layer edits change what's visible without moving time
}

/* ============ axis / zoom ============ */
let axisStart = -60, axisEnd = 800, ppf = 1, userPpf = 0, zoomStash = null;
const scroller = document.getElementById("scroller");
const tlCanvas = document.getElementById("tlCanvas");

function contentEnd() {
  let end = render.to;
  for (const c of clips) end = Math.max(end, c.from + c.dur);
  return end;
}
function recomputeAxis() {
  axisStart = -60;
  for (const c of clips) axisStart = Math.min(axisStart, c.from - 30);
  axisEnd = contentEnd() + 90;
}
const axisLen = () => axisEnd - axisStart;
const fitPpf = () => Math.max(0.02, (scroller.clientWidth - LABEL_W - 8) / axisLen());
function resolvePpf() { ppf = userPpf > 0 ? clamp(userPpf, fitPpf(), MAX_PPF) : fitPpf(); }
const xOf = (f) => (f - axisStart) * ppf;                       // content-space px
const frameAt = (clientX) => (clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft - LABEL_W) / ppf + axisStart;

function setZoom(next, anchorClientX) {
  const rect = scroller.getBoundingClientRect();
  const anchor = anchorClientX ?? rect.left + LABEL_W + (rect.width - LABEL_W) / 2;
  const fAt = frameAt(anchor);
  userPpf = clamp(next, fitPpf(), MAX_PPF);
  resolvePpf(); rebuild();
  scroller.scrollLeft = xOf(fAt) + LABEL_W - (anchor - rect.left);
}
function zoomFit() { userPpf = 0; zoomStash = null; resolvePpf(); rebuild(); }
function zoomToRange(f0, f1) {
  const span = Math.max(12, f1 - f0);
  const pad = span * 0.18;
  userPpf = clamp((scroller.clientWidth - LABEL_W) / (span + pad * 2), fitPpf(), MAX_PPF);
  resolvePpf(); rebuild();
  scroller.scrollLeft = xOf(f0 - pad) + LABEL_W - LABEL_W;
}
function zoomSelection() {                                        // idea 16: Z toggles in ↔ back
  if (zoomStash) { userPpf = zoomStash.ppf; resolvePpf(); rebuild(); scroller.scrollLeft = zoomStash.sl; zoomStash = null; return; }
  const sel = clips.filter((c) => selection.has(c.id));
  const f0 = sel.length ? Math.min(...sel.map((c) => c.from)) : playhead - FPS;
  const f1 = sel.length ? Math.max(...sel.map((c) => c.from + c.dur)) : playhead + FPS;
  zoomStash = { ppf: userPpf, sl: scroller.scrollLeft };
  zoomToRange(f0, f1);
}

/* ============ sounds (auto-muted during playback: speakers belong to content) ============ */
let AC = null;
function beep(fn) {
  if (!soundOn || playing) return;
  try {
    AC ??= new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    fn(AC);
  } catch { /* no audio */ }
}
const env = (ac, g, t0, a, d) => { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); };
function tone(freq, dur, vol = 0.05, type = "sine", sweep = 0) {
  beep((ac) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (sweep) o.frequency.exponentialRampToValueAtTime(sweep, ac.currentTime + dur);
    env(ac, g, ac.currentTime, vol, dur);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur + 0.02);
  });
}
const sndTick = () => tone(1560, 0.03, 0.045, "sine");
const sndBreak = () => tone(660, 0.04, 0.035, "sine", 440);
const sndDrop = () => tone(190, 0.07, 0.06, "sine", 150);
const sndCut = () => { tone(2200, 0.02, 0.04, "square"); setTimeout(() => tone(1650, 0.02, 0.035, "square"), 24); };
const sndWhoosh = () => tone(320, 0.16, 0.03, "sawtooth", 90);
const sndEdge = () => tone(920, 0.035, 0.05, "sine");          // trim edge lands on the media wall
const sndThud = () => tone(130, 0.09, 0.08, "sine", 78);       // …and breaks through into hold-frame

/* ============ snap engine (typed + weighted + sticky hysteresis) ============ */
function beatFrames() {
  const out = [];
  const mx = clips.find((c) => c.trackId === "mx");
  if (!mx) return out;
  const phase = mx.from - (mx.srcIn % BEAT_STEP);
  for (let f = Math.ceil((axisStart - phase) / BEAT_STEP) * BEAT_STEP + phase; f < axisEnd; f += BEAT_STEP)
    out.push({ f, down: Math.round((f - phase) / BEAT_STEP) % 4 === 0 });
  return out;
}
function snapTargets(excludeIds = new Set(), { beats = true, self = true } = {}) {
  const T = [];
  T.push({ f: render.from, label: "output start", w: 1 }, { f: render.to, label: "output end", w: 1 });
  T.push({ f: Math.round(playhead), label: "playhead", w: 1.1 });
  if (has("snapEnds")) {
    for (const m of markers) T.push({ f: m.frame, label: `marker ${m.label}`, w: 1 });
    for (const k of motionKeys) T.push({ f: k.frame, label: "motion key", w: 0.9 });
    if (self) for (const c of clips) {
      if (excludeIds.has(c.id) || c.gap) continue;
      T.push({ f: c.from, label: `${c.name} in`, w: 1 }, { f: c.from + c.dur, label: `${c.name} out`, w: 1 });
    }
  }
  if (beats && has("snapBeats")) for (const b of beatFrames()) T.push({ f: b.f, label: b.down ? "downbeat" : "beat", w: b.down ? 0.85 : 0.7, beat: true });
  return T;
}
/* sticky snap: engages inside ENTER px, holds until EXIT px — the user's "sticky ends" */
function stickySnap(g, raw, targets, e) {
  if (!anySnap() || !snapOn || e.altKey) { if (g.stuck) { g.stuck = null; hideGuide(); } return raw; }
  const enter = (e.shiftKey ? SNAP_ENTER * 0.6 : SNAP_ENTER) / ppf;
  const exit = (e.shiftKey ? SNAP_EXIT * 0.4 : SNAP_EXIT) / ppf;
  if (g.stuck) {
    if (Math.abs(raw - g.stuck.f) < exit * g.stuck.w) return g.stuck.f;
    g.stuck = null; hideGuide(); sndBreak();
  }
  let best = null, bestScore = Infinity;
  for (const t of targets) {
    const d = Math.abs(raw - t.f);
    if (d < enter * t.w && d / t.w < bestScore) { best = t; bestScore = d / t.w; }
  }
  if (best) { g.stuck = best; showGuide(best); sndTick(); return best.f; }
  return raw;
}
/* idea 3: the media edge is a physical wall — the trim edge sticks at the
   first/last real frame, holds through wobbles, then breaks through with a
   thud into hold-frame territory. Independent of grid snapping; ⌥ bypasses. */
function mediaDetent(g, raw, boundF, e, enabled) {
  if (!enabled || e.altKey) { g.mediaStuck = null; return raw; }
  const enter = 8 / ppf, exit = 30 / ppf;
  if (g.mediaStuck != null) {
    if (Math.abs(raw - g.mediaStuck) < exit) return g.mediaStuck;
    g.mediaStuck = null; sndThud();
  } else if (Math.abs(raw - boundF) < enter) {
    g.mediaStuck = boundF; sndEdge();
    return boundF;
  }
  return raw;
}

/* one-shot snap without sounds/guides — for hover previews and gesture starts */
function quietSnap(raw, targets, e, px = 8, force = false) {
  if ((!force && !anySnap()) || !snapOn || e.altKey) return raw;
  let best = raw, bestD = px / ppf;
  for (const t of targets) {
    const d = Math.abs(raw - t.f);
    if (d < bestD * t.w) { best = t.f; bestD = d / t.w; }
  }
  return best;
}

/* ============ DOM build ============ */
const clipEls = new Map(), markerEls = new Map(), keyEls = new Map();
let rulerBody = null, rzBar = null, playheadEl = null, skimEl = null, guideEl = null;
let laneTracks = new Map();
let rowMaps = new Map();          // trackId → { at: Map(clipId → row), count }
const ROW_GAP = 4;

/* rows: overlapping clips in a layer stack into extra rows; topmost z gets
   the top row, so vertical position reads as stacking order (idea 22) */
function computeRows(trackId) {
  const rows = [], at = new Map();
  for (const c of zTopToBottom(trackId)) {
    const l = liveClip(c);
    const f0 = l.from, f1 = l.from + l.dur;
    let r = 0;
    while ((rows[r] ?? []).some(([a, b]) => f0 < b - 0.01 && f1 > a + 0.01)) r++;
    (rows[r] ??= []).push([f0, f1]);
    at.set(c.id, r);
  }
  return { at, count: Math.max(1, rows.length) };
}
const laneHeight = (tr, count) => tr.h + (count - 1) * (tr.clipH + ROW_GAP);
const clipTopIn = (tr, trackId, id) => tr.clipTop + (rowMaps.get(trackId)?.at.get(id) ?? 0) * (tr.clipH + ROW_GAP);

function el(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

function rebuild() {
  resolvePpf();
  tlCanvas.style.width = `${LABEL_W + axisLen() * ppf}px`;
  tlCanvas.textContent = "";
  clipEls.clear(); markerEls.clear(); keyEls.clear(); laneTracks.clear();

  /* --- ruler row (render window strip + ticks + beats + markers) --- */
  const rrow = el("div", "ruler-row lane", tlCanvas);
  rrow.style.height = `${RULER_H}px`;
  const rhead = el("div", "lane-label ruler-head", rrow);
  rhead.innerHTML = `<b>OUT</b><span class="lane-kindname">${Math.round(render.to - render.from)}f</span>`;
  rhead.title = "Only the render window ships — its left edge is the output's t0";
  rulerBody = el("div", "ruler-body", rrow);

  const rwTrack = el("div", "rw-track", rulerBody);
  rzBar = el("div", "rz-bar", rwTrack);
  rzBar.dataset.gesture = "rw-move";
  rzBar.title = "Render window — what ships. Drag to slide; edges set the output bounds (I / O at playhead).";
  const hL = el("i", "rz-handle left", rzBar); hL.dataset.gesture = "rw-left";
  const hR = el("i", "rz-handle right", rzBar); hR.dataset.gesture = "rw-right";
  positionRw();

  const ruler = el("div", "ruler", rulerBody);
  ruler.dataset.gesture = "ruler";
  ruler.dataset.idea = "6 17";
  const steps = [1, 2, 5, 10, 15, 30, 60, 150, 300, 900, 1800];
  const step = steps.find((s) => s * ppf >= 64) ?? 3600;
  for (let rel = Math.ceil((axisStart - render.from) / step) * step; rel <= axisEnd - render.from; rel += step) {
    const f = render.from + rel;
    const inWin = rel >= 0 && f <= render.to;
    const t = el("span", `tick${rel === 0 ? " origin" : ""}${inWin ? "" : " outside"}`, ruler);
    t.style.left = `${xOf(f)}px`;
    const abs = Math.abs(rel);
    t.textContent = `${rel < 0 ? "-" : ""}${abs < FPS ? `${abs}f` : `${(abs / FPS).toFixed(abs % FPS ? 1 : 0)}s`}`;
  }
  if (has("beatDots")) for (const b of beatFrames()) {
    const d = el("i", `beat${b.down ? " down" : ""}`, ruler);
    d.dataset.idea = "6";
    d.style.left = `${xOf(b.f)}px`;
  }
  for (const m of markers) {
    const d = el("i", "marker", ruler);
    d.style.left = `${xOf(m.frame)}px`;
    d.title = `${m.label} · ${fmtT(m.frame)} — drag to move, double-click to delete`;
    d.dataset.gesture = "marker"; d.dataset.id = m.id;
    markerEls.set(m.id, d);
  }

  /* --- offzones + render zone (staging vs shipping) --- */
  const offL = el("div", "tl-offzone", tlCanvas);
  const offR = el("div", "tl-offzone", tlCanvas);
  const rz = el("div", "render-zone", tlCanvas);
  offL.style.left = `${LABEL_W}px`; offL.style.width = `${Math.max(0, xOf(render.from))}px`;
  offR.style.left = `${LABEL_W + xOf(render.to)}px`; offR.style.width = `${Math.max(0, (axisEnd - render.to) * ppf)}px`;
  rz.style.left = `${LABEL_W + xOf(render.from)}px`; rz.style.width = `${(render.to - render.from) * ppf}px`;

  /* --- lanes (layers, in linked-list order — first = top of the composite) --- */
  rowMaps = new Map();
  for (const tr of layerOrder()) rowMaps.set(tr.id, computeRows(tr.id));
  for (const tr of layerOrder()) {
    const lane = el("div", `lane${tr.magnetic ? " is-magnetic" : ""}`, tlCanvas);
    lane.style.height = `${laneHeight(tr, rowMaps.get(tr.id).count)}px`;
    const label = el("div", "lane-label", lane);
    label.innerHTML = `<b>${tr.label}</b><span class="lane-kindname">${tr.name}</span>`;
    if (has("layers")) {
      label.dataset.gesture = "layer"; label.dataset.layer = tr.id;
      label.classList.add("layer-grab");
      label.title = "Layer — drag ↑↓ to reorder the composite; upper layers cover lower ones";
    }
    if (tr.kind === "scenes" && has("magnetic")) {
      const b = el("button", `lane-chip${tr.magnetic ? " on" : ""}`, label);
      b.textContent = "⌁"; b.dataset.idea = "12";
      b.title = tr.magnetic ? "Magnetic storyline ON — no gaps, drag to reorder (click to free)" : "Magnetic storyline OFF — free staging (click to repack)";
      b.onclick = (ev) => { ev.stopPropagation(); toggleMagnet(tr); };
    }
    if (tr.lockable) {
      const b = el("button", `lane-chip lock${tr.locked ? " on" : ""}`, label);
      b.textContent = tr.locked ? "🔒" : "🔓";
      b.title = tr.locked ? "Locked — ripple and ＋TIME leave this track alone" : "Unlocked — rides ripple edits";
      b.onclick = (ev) => { ev.stopPropagation(); tr.locked = !tr.locked; rebuild(); toast(tr.locked ? "MUSIC locked — ＋TIME will leave it in place" : "MUSIC unlocked"); };
    }
    const trackEl = el("div", "lane-track", lane);
    trackEl.dataset.gesture = "track"; trackEl.dataset.track = tr.id;
    laneTracks.set(tr.id, trackEl);
    zBottomToTop(tr.id).forEach((c, zi) => {                 // DOM + z-index follow stacking order
      const b = buildClip(c, tr);
      b.style.top = `${clipTopIn(tr, tr.id, c.id)}px`;
      b.style.zIndex = 1 + zi;
      trackEl.appendChild(b);
    });
  }

  /* --- motion lane (GSAP keys, studio-style) --- */
  if (has("motion")) {
  const mlane = el("div", "lane motion", tlCanvas);
  mlane.style.height = "30px";
  const mlabel = el("div", "lane-label", mlane);
  mlabel.innerHTML = `<b>◆</b><span class="lane-kindname">${motionTarget}</span>`;
  mlabel.title = "GSAP motion keys — drag to retime; they snap to beats and ride ＋TIME ripples";
  const mtrack = el("div", "lane-track", mlane);
  mtrack.dataset.gesture = "track"; mtrack.dataset.track = "motion";
  if (motionKeys.length) {
    const span = el("div", "motion-span", mtrack);
    const f0 = Math.min(...motionKeys.map((k) => k.frame)), f1 = Math.max(...motionKeys.map((k) => k.frame));
    span.style.left = `${xOf(f0)}px`; span.style.width = `${Math.max(2, (f1 - f0) * ppf)}px`;
    span.style.top = "10px"; span.style.height = "10px";
    for (const k of motionKeys) {
      const d = el("button", "keyd", mtrack);
      d.style.left = `${xOf(k.frame)}px`; d.style.top = "10.5px";
      d.title = `motion key · ${fmtT(k.frame)} — drag to retime`;
      d.dataset.gesture = "key"; d.dataset.id = k.id;
      keyEls.set(k.id, d);
    }
  }
  }

  /* --- overlay furniture --- */
  if (has("stems")) connectStems();
  playheadEl = el("div", "playhead", tlCanvas);
  skimEl = el("div", "skim-ghost", tlCanvas); skimEl.hidden = true;
  el("div", "skim-tc", skimEl).className = "skim-tc";
  guideEl = el("div", "snap-guide", tlCanvas); guideEl.hidden = true;
  positionPlayhead();
  drawMinimap();
  updateProj();
  updateSelBar();
}

function buildClip(c, tr) {
  const t = TONES[c.tone] ?? TONES.blue;
  const b = document.createElement("button");
  b.className = `clip${c.gap ? " gap-clip" : ""}${selection.has(c.id) ? " selected" : ""}`;
  b.dataset.gesture = "clip"; b.dataset.id = c.id; b.dataset.track = tr.id;
  b.style.setProperty("--tone-line", t.line);
  b.style.setProperty("--tone-bg", t.bg);
  b.style.setProperty("--tone-text", t.text);
  b.style.left = `${xOf(c.from)}px`;
  b.style.width = `${Math.max(3, c.dur * ppf)}px`;
  b.style.top = `${tr.clipTop}px`;
  b.style.height = `${tr.clipH}px`;
  b.title = c.gap ? `gap · ${fmtT(c.dur)} — trim or delete to close` :
    `${c.name} · ${fmtT(c.from)} +${fmtT(c.dur)}${c.parentId ? " · connected" : ""} — drag to move · edges trim · ⌥-drag slips`;

  if (tr.kind === "scenes" && !c.gap) {
    const film = el("div", "clip-film", b);
    film.dataset.idea = "11";
    const fw = 46;
    film.style.background = `repeating-linear-gradient(90deg, rgb(0 0 0 / 38%) 0 1.5px, transparent 1.5px ${fw}px), repeating-linear-gradient(90deg, hsl(${t.hue} 42% 30% / .55) 0 ${fw}px, hsl(${t.hue} 46% 24% / .55) ${fw}px ${fw * 2}px), linear-gradient(180deg, hsl(${t.hue} 40% 26%), hsl(${t.hue} 45% 17%))`;
    film.style.backgroundPositionX = `${-Math.max(0, c.srcIn) * 1.2}px`;
  }
  if (tr.kind === "music" && !c.gap) drawWave(el("canvas", "clip-wave", b), c, t);
  const name = el("span", "clip-name", b);
  name.textContent = c.gap ? `gap · ${fmtT(c.dur)}` : c.name;
  if (c.badges) {
    const bb = el("div", "clip-badges", b);
    for (const [k, txt] of c.badges) {
      const p = el("b", `pbadge ${k}`, bb);
      p.textContent = txt;
      if (k === "pinned" && c.takes) {                          // idea 21: take stacks
        p.dataset.idea = "21";
        p.title = "Pinned generative take — click to cycle takes in place (durations ripple the storyline)";
        p.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        p.addEventListener("click", (ev) => { ev.stopPropagation(); cycleTake(c); });
      }
    }
  }
  updateOverruns(b, c);                                            // idea 3: hold-frame zones
  const hl = el("i", "trim-handle left", b); hl.dataset.gesture = "trim-l"; hl.dataset.idea = "1 2 9";
  const hr = el("i", "trim-handle right", b); hr.dataset.gesture = "trim-r"; hr.dataset.idea = "1 2 9";
  const handleTitle = tr.magnetic ? "Trim — ripples the storyline · pull away vertically for fine"
    : "Trim — upper half plain, lower half ripples · pull away vertically for fine";
  hl.title = hr.title = handleTitle;
  if (!c.gap && (tr.kind === "scenes" || tr.kind === "music") && c.dur * ppf > 70 && c.srcLen - c.dur >= 1) {
    const sp = el("i", "slip-pill", b);                             // idea 11, modeless
    sp.dataset.gesture = "slip-pill"; sp.dataset.idea = "11";
    sp.textContent = "⇄";
    sp.title = "Slip — drag to slide the source; in/out stay put";
  }
  clipEls.set(c.id, b);
  return b;
}

/* idea 3: hold-frame zones — a head zone freezes the first frame (srcIn < 0),
   a tail zone freezes the last (dur past srcLen). Rendered at build AND live
   during trims, hatched cool-blue with a ❚❚ label when there's room. */
function updateOverruns(elc, live) {
  const zones = [];
  if (!live.gap && trackById(live.trackId).kind !== "music") {
    const head = Math.max(0, -live.srcIn);
    if (head > 0.5) zones.push(["head", 0, head, "Before the source's first frame — it holds"]);
    if (live.srcLen < 900) {
      const tail = Math.max(0, live.dur - (live.srcLen - live.srcIn));
      if (tail > 0.5) zones.push(["tail", live.dur - tail, tail, "Past the source's end — the last frame holds"]);
    }
  }
  elc.querySelectorAll(".clip-overrun").forEach((o) => o.remove());
  const t = TONES[live.tone] ?? TONES.blue;
  const film = trackById(live.trackId)?.kind === "scenes";
  for (const [kind, at, len, title] of zones) {
    const o = el("i", `clip-overrun ${kind}`, elc);
    o.dataset.idea = "3";
    o.style.left = `${at * ppf}px`;
    o.style.width = `${len * ppf}px`;
    o.title = title;
    if (film) {
      // the frozen frame, literally repeated: dense identical film cells
      // (the live filmstrip advances at 46px/cell; the hold repeats one 12px cell)
      o.style.background = [
        "repeating-linear-gradient(90deg, rgb(0 0 0 / 55%) 0 1.5px, transparent 1.5px 12px)",
        "linear-gradient(rgb(143 201 236 / 9%), rgb(143 201 236 / 9%))",
        `linear-gradient(180deg, hsl(${t.hue} 30% 21%), hsl(${t.hue} 34% 13%))`,
      ].join(", ");
    }
    const px = len * ppf;
    o.dataset.hold = px > 46 ? `❚❚ ${Math.round(len)}f` : px > 18 ? "❚❚" : "";
  }
}

function drawWave(canvas, c, t) {
  const wFull = Math.max(3, Math.round(c.dur * ppf)), h = trackById(c.trackId).clipH;
  const w = Math.min(wFull, 8192);
  const dpr = w === wFull ? Math.min(2, devicePixelRatio || 1) : 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr * (w / wFull), dpr);
  ctx.fillStyle = `hsl(${t.hue} 45% 55% / .5)`;
  const mid = h / 2;
  for (let x = 0; x < w; x += 2) {
    const f = c.srcIn + x / ppf;
    const beat = Math.abs(((f % BEAT_STEP) + BEAT_STEP) % BEAT_STEP);
    const pulse = beat < 2 ? 1 : 0.45 + 0.3 * Math.abs(Math.sin(f * 0.7) * Math.sin(f * 0.13));
    const amp = mid * 0.85 * pulse * (0.55 + 0.45 * Math.abs(Math.sin(f * 0.031)));
    ctx.fillRect(x, mid - amp, 1.3, amp * 2);
  }
}

function connectStems() {
  for (const c of clips) {
    if (!c.parentId || trackById(c.trackId)?.kind !== "overlay") continue;
    const parent = byId(c.parentId);
    if (!parent) continue;
    const cTr = trackById(c.trackId), pTr = trackById(parent.trackId);
    const cLane = laneTracks.get(c.trackId)?.parentElement, pLane = laneTracks.get(parent.trackId)?.parentElement;
    if (!pTr || !cLane || !pLane) continue;
    const top = cLane.offsetTop + clipTopIn(cTr, c.trackId, c.id) + cTr.clipH;
    const bottom = pLane.offsetTop + clipTopIn(pTr, parent.trackId, parent.id);
    if (bottom - top < 3) continue;                   // parent sits above the child after a layer reorder
    const s = el("div", "stem", tlCanvas);
    s.dataset.idea = "13";
    s.style.left = `${LABEL_W + xOf(c.from) + 3}px`;
    s.style.top = `${top}px`;
    s.style.height = `${bottom - top}px`;
    s.dataset.stemFor = c.id;
  }
}

function positionRw(liveFrom = render.from, liveTo = render.to) {
  if (!rzBar) return;
  rzBar.style.left = `${xOf(liveFrom)}px`;
  rzBar.style.width = `${(liveTo - liveFrom) * ppf}px`;
}
function positionPlayhead() {
  if (playheadEl) playheadEl.style.left = `${LABEL_W + xOf(playhead)}px`;
}

/* ============ guide + HUD + loupe ============ */
const hudEl = document.getElementById("hud");
const loupeEl = document.getElementById("loupe");
const loupeCtx = loupeEl.getContext("2d");

function showGuide(target) {
  if (!guideEl) return;
  guideEl.hidden = false;
  guideEl.className = `snap-guide${target.beat ? " beat-guide" : ""}`;
  guideEl.style.left = `${LABEL_W + xOf(target.f)}px`;
}
function hideGuide() { if (guideEl) guideEl.hidden = true; }

function showHud(x, y, html) { hudEl.hidden = false; hudEl.innerHTML = html; hudEl.style.left = `${x + 14}px`; hudEl.style.top = `${y - 34}px`; }
function hideHud() { hudEl.hidden = true; }
const hudTarget = (g) => (g.stuck ? ` · <span class="hud-target">⇢ ${g.stuck.label}</span>` : "");

/* the precision loupe (idea 1): a zoomed bubble over the edit point */
const LW = 300, LH = 92;
function showLoupe(fCenter, g, e, opts = {}) {
  if (!has("loupe")) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (loupeEl.width !== LW * dpr) { loupeEl.width = LW * dpr; loupeEl.height = LH * dpr; loupeEl.style.width = `${LW}px`; loupeEl.style.height = `${LH}px`; }
  loupeEl.hidden = false; loupeEl.classList.add("show");
  const x = clamp(e.clientX - LW / 2, 8, innerWidth - LW - 8);
  const y = Math.max(8, e.clientY - LH - 46);
  loupeEl.style.left = `${x}px`; loupeEl.style.top = `${y}px`;

  const ctx = loupeCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, LW, LH);
  ctx.fillStyle = "#0c0e12"; ctx.fillRect(0, 0, LW, LH);
  const mag = clamp(ppf * (e.shiftKey ? 10 : 6), 4, 22);
  const f0 = fCenter - LW / 2 / mag;
  const fx = (f) => (f - f0) * mag;

  if (opts.source) {                                               // slip: source-space view
    const c = opts.clip, t = TONES[c.tone];
    ctx.fillStyle = "rgb(150 155 167 / 80%)"; ctx.font = "700 8px ui-monospace, monospace";
    ctx.fillText(`SOURCE · ${c.name}`, 8, 12);
    const stripY = 24, stripH = 40;
    const sx = (sf) => LW / 2 + (sf - (c.srcIn + c.dur / 2)) * mag;
    ctx.fillStyle = `hsl(${t.hue} 40% 22%)`;
    ctx.fillRect(sx(0), stripY, c.srcLen * mag, stripH);
    ctx.fillStyle = `hsl(${t.hue} 45% 30%)`;
    for (let sf = 0; sf < c.srcLen; sf += 10) ctx.fillRect(sx(sf), stripY, 5 * mag, stripH);
    ctx.strokeStyle = "#f0b45f"; ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(c.srcIn), stripY - 3, c.dur * mag, stripH + 6);
    ctx.fillStyle = "#f0b45f"; ctx.font = "700 8px ui-monospace, monospace";
    ctx.fillText(`in ${Math.round(c.srcIn)}f`, sx(c.srcIn) + 3, stripY + stripH + 16);
  } else {
    // frame ruler
    ctx.strokeStyle = "rgb(232 235 242 / 18%)"; ctx.fillStyle = "rgb(150 155 167 / 75%)";
    ctx.font = "700 7.5px ui-monospace, monospace"; ctx.lineWidth = 1;
    const tick = mag >= 7 ? 1 : mag >= 3.2 ? 5 : 15;
    for (let f = Math.ceil(f0 / tick) * tick; f < f0 + LW / mag; f += tick) {
      const major = f % FPS === 0;
      ctx.beginPath(); ctx.moveTo(fx(f), 0); ctx.lineTo(fx(f), major ? 12 : 6); ctx.stroke();
      if (major) ctx.fillText(fmtT(f), fx(f) + 3, 11);
    }
    // beats
    for (const b of beatFrames()) if (b.f > f0 && b.f < f0 + LW / mag) {
      ctx.fillStyle = b.down ? "rgb(114 211 156 / 80%)" : "rgb(114 211 156 / 40%)";
      ctx.beginPath(); ctx.arc(fx(b.f), 16, b.down ? 2.4 : 1.6, 0, 7); ctx.fill();
    }
    // gesture track clips
    const trId = opts.trackId ?? "v1";
    const y0 = 26, ch = 34;
    for (const c of clips) {
      if (c.trackId !== trId) continue;
      const live = liveClip(c);
      const t = TONES[c.tone];
      ctx.fillStyle = c.gap ? "rgb(240 180 95 / 8%)" : `hsl(${t.hue} 42% 26% / .85)`;
      ctx.strokeStyle = c.gap ? "rgb(240 180 95 / 45%)" : t.line;
      ctx.beginPath(); ctx.roundRect(fx(live.from) + 0.5, y0, Math.max(2, live.dur * mag) - 1, ch, 3);
      ctx.fill(); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(fx(live.from), y0, Math.max(2, live.dur * mag), ch); ctx.clip();
      ctx.fillStyle = "rgb(244 242 236 / 85%)"; ctx.font = "700 8px ui-monospace, monospace";
      ctx.fillText(c.gap ? "gap" : c.name, fx(live.from) + 5, y0 + 12);
      // media brackets + hold zones inside loupe (idea 3)
      if (!c.gap) {
        const holds = [];
        const head = Math.max(0, -live.srcIn);
        if (head > 0) holds.push([live.from, live.from + head]);
        if (c.srcLen < 900) {
          const mediaEnd = live.from + (c.srcLen - live.srcIn);
          if (mediaEnd < live.from + live.dur) holds.push([mediaEnd, live.from + live.dur]);
        }
        for (const [z0, z1] of holds) {
          ctx.fillStyle = "rgb(143 201 236 / 13%)";
          ctx.fillRect(fx(z0), y0, (z1 - z0) * mag, ch);
          const bracket = z0 === live.from ? z1 : z0;      // the media edge itself
          ctx.strokeStyle = "rgb(184 216 240 / 75%)"; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(fx(bracket), y0); ctx.lineTo(fx(bracket), y0 + ch); ctx.stroke(); ctx.setLineDash([]);
          if ((z1 - z0) * mag > 30) {
            ctx.fillStyle = "rgb(184 216 240 / 85%)"; ctx.font = "800 7px ui-monospace, monospace";
            ctx.fillText("HOLD", fx(z0) + 4, y0 + ch - 5);
          }
        }
      }
      ctx.restore();
    }
    // neighbor-track edges as context ticks
    ctx.strokeStyle = "rgb(143 216 255 / 35%)";
    for (const c of clips) {
      if (c.trackId === trId) continue;
      for (const f of [liveClip(c).from, liveClip(c).from + liveClip(c).dur]) if (f > f0 && f < f0 + LW / mag) {
        ctx.beginPath(); ctx.moveTo(fx(f), LH - 14); ctx.lineTo(fx(f), LH - 6); ctx.stroke();
      }
    }
    // snap target in-loupe
    if (g?.stuck) {
      ctx.strokeStyle = g.stuck.beat ? "#72d39c" : "#f0b45f";
      ctx.beginPath(); ctx.moveTo(fx(g.stuck.f), 14); ctx.lineTo(fx(g.stuck.f), LH); ctx.stroke();
    }
    // playhead
    if (playhead > f0 && playhead < f0 + LW / mag) {
      ctx.strokeStyle = "rgb(240 180 95 / 60%)";
      ctx.beginPath(); ctx.moveTo(fx(playhead), 14); ctx.lineTo(fx(playhead), LH); ctx.stroke();
    }
    // the edit point
    ctx.strokeStyle = "#f4f2ec"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(fx(fCenter), 14); ctx.lineTo(fx(fCenter), LH); ctx.stroke();
  }
  if (e.shiftKey) {
    ctx.fillStyle = "#f0b45f"; ctx.font = "800 8px ui-monospace, monospace";
    ctx.fillText("FINE ×7", LW - 46, 12);
  }
}
function hideLoupe() { loupeEl.classList.remove("show"); loupeEl.hidden = true; }

/* ============ gestures ============ */
let G = null;                   // active gesture
const liveClip = (c) => {
  if (G?.live?.has(c.id)) return { ...c, ...G.live.get(c.id) };
  const shift = G?.shift?.get(c.id);
  return shift ? { ...c, from: c.from + shift } : c;
};

function beginGesture(e, kind, extra = {}) {
  G = {
    kind, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastSL: scroller.scrollLeft,
    acc: 0, moved: false, stuck: null, live: new Map(), shift: new Map(), ...extra,
  };
  selBar?.remove(); selBar = null;
  hideCutHover?.();
  phCluster?.classList.remove("show");
  hideJunction?.();
  window.addEventListener("pointermove", onGestureMove);
  window.addEventListener("pointerup", onGestureEnd, { once: true });
  window.addEventListener("pointercancel", onGestureEnd, { once: true });
}
/* idea 2, pointer-only: precision gearing. Pull AWAY from the track vertically and the
   drag gears down smoothly to 1/10× (iOS scrubber pattern). ⇧ still forces fine. */
const GEARED = new Set(["trim", "roll", "slip", "wedge", "cutdrag", "marker", "key", "scrub"]);
function dragGain(e) {
  if (!has("fine")) return 1;
  let gain = e.shiftKey ? FINE_GAIN : 1;
  if (GEARED.has(G?.kind)) {
    const dy = Math.abs(e.clientY - G.startY);
    if (dy > 28) gain = Math.min(gain, Math.max(0.1, 1 - ((dy - 28) / 140) * 0.9));
  }
  return gain;
}
const gainNote = (e) => { const g = dragGain(e); return g < 0.9 ? ` · fine ×1/${Math.round(1 / g)}` : ""; };
function gestureDelta(e) {
  autoPan(e);
  const gain = dragGain(e);                              // idea 2: ⇧ or pull-away = fine gearing
  G.gain = gain;
  G.acc += ((e.clientX - G.lastX) * gain + (scroller.scrollLeft - G.lastSL)) / ppf;
  G.lastX = e.clientX; G.lastSL = scroller.scrollLeft;
  if (!G.moved && Math.hypot(e.clientX - G.startX, e.clientY - G.startY) > 3) G.moved = true;
  return G.acc;
}
function autoPan(e) {
  const rect = scroller.getBoundingClientRect();
  if (e.clientX > rect.right - 40) scroller.scrollLeft += 14;
  else if (e.clientX < rect.left + LABEL_W + 40) scroller.scrollLeft -= 14;
}

/* pointerdown routing */
const CUT_ZONE = 9;                                  // px strip along a clip's lower edge
function inCutZone(e, clipEl) {
  if (e.target.closest(".trim-handle, .slip-pill, .pbadge, .clip-badges")) return false;
  const r = clipEl.getBoundingClientRect();
  return e.clientY > r.bottom - CUT_ZONE && e.clientX > r.left + 10 && e.clientX < r.right - 10;
}
tlCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  closeCtxMenu();
  const t = e.target.closest("[data-gesture]");
  if (!t) return;
  const kind = t.dataset.gesture;
  activateAudio();
  if (kind === "layer") { if (e.target.closest(".lane-chip")) return; return startLayerDrag(e, t.dataset.layer); }
  if (kind === "ruler") return tool === "wedge" ? startWedge(e) : startScrub(e);
  if (kind === "marker") return startMarkerDrag(e, t.dataset.id);
  if (kind === "key") return startKeyDrag(e, t.dataset.id);
  if (kind === "rw-move" || kind === "rw-left" || kind === "rw-right") return startRw(e, kind);
  if (kind === "roll") return startRoll(e, t.dataset.a, t.dataset.b);
  if (kind === "junction-add") return startCutDrag(e, null, Number(t.dataset.f));
  if (kind === "slip-pill") return startSlip(e, clips.find((c) => c.id === t.closest(".clip").dataset.id));
  if (kind === "trim-l" || kind === "trim-r") {
    const clip = clips.find((c) => c.id === t.closest(".clip").dataset.id);
    if (tool === "wedge") return startWedge(e);
    return startTrim(e, clip, kind === "trim-l" ? "l" : "r", t);
  }
  if (kind === "clip") {
    const clip = clips.find((c) => c.id === t.dataset.id);
    if (tool === "blade") return doBlade(e, clip);
    if (tool === "wedge") return startWedge(e);
    if (!clip.gap && has("blade") && inCutZone(e, t)) return startCutDrag(e, clip); // ✂ strip: click cuts, drag tears open
    if (e.altKey && !clip.gap && has("slip")) return startSlip(e, clip);
    return startMove(e, clip);
  }
  if (kind === "track") {
    if (tool === "wedge") return startWedge(e);
    if (tool === "blade") return;
    return startMarquee(e);
  }
});
function activateAudio() { if (soundOn && !AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } }

function onGestureMove(e) {
  if (!G) return;
  ({
    scrub: moveScrub, marker: moveMarker, key: moveKey, rw: moveRw, move: moveMove,
    trim: moveTrim, roll: moveRoll, slip: moveSlip, wedge: moveWedge, marquee: moveMarquee,
    layerdrag: moveLayerDrag,
    cutdrag: moveCutDrag,
  })[G.kind]?.(e);
  drawMinimap();
}
function onGestureEnd(e) {
  window.removeEventListener("pointermove", onGestureMove);
  const g = G;
  ({
    scrub: endScrub, marker: endMarker, key: endKey, rw: endRw, move: endMove,
    trim: endTrim, roll: endRoll, slip: endSlip, wedge: endWedge, marquee: endMarquee,
    layerdrag: endLayerDrag,
    cutdrag: endCutDrag,
  })[g.kind]?.(e, g);
  G = null;
  hideHud(); hideLoupe(); hideGuide();
  document.querySelectorAll(".rippling, .parting, .will-split").forEach((el) => { el.classList.remove("rippling", "parting", "will-split"); el.style.transform = ""; });
  drawMinimap(); updateMonitor(); updateSelBar();
}

/* ---- scrub ---- */
function startScrub(e) {
  beginGesture(e, "scrub");
  moveScrub(e);
}
function moveScrub(e) {
  const gain = dragGain(e);                             // ⇧ or pull down off the ruler = fine scrub
  let f = gain < 1 ? playhead + ((e.clientX - G.lastX) * gain) / ppf : frameAt(e.clientX);
  G.lastX = e.clientX;
  f = stickySnap(G, f, snapTargets(new Set(), { beats: true }), e);
  playhead = clamp(f, axisStart, axisEnd);
  positionPlayhead(); updateMonitor();
  if (gain < 0.55) showLoupe(playhead, G, e, { trackId: "v1" });
  else hideLoupe();
  showHud(e.clientX, e.clientY, `<b>${fmtT(playhead)}</b> · ${Math.round(playhead)}f${gainNote(e)}${hudTarget(G)}`);
}
function endScrub() { playhead = Math.round(playhead); positionPlayhead(); }

/* ---- markers + motion keys ---- */
function startMarkerDrag(e, id) { e.stopPropagation(); beginGesture(e, "marker", { id, base: markers.find((m) => m.id === id).frame }); }
function moveMarker(e) {
  const m = markers.find((m) => m.id === G.id);
  const f = stickySnap(G, G.base + gestureDelta(e), snapTargets(new Set(), {}), e);
  m.frame = clamp(f, axisStart, axisEnd);
  markerEls.get(m.id).style.left = `${xOf(m.frame)}px`;
  showHud(e.clientX, e.clientY, `marker · <b>${fmtT(m.frame)}</b>${hudTarget(G)}`);
  showLoupe(m.frame, G, e, { trackId: "v1" });
}
function endMarker(e, g) {
  if (!g.moved) return;
  const m = markers.find((m) => m.id === g.id);
  const f = Math.round(m.frame);
  commit(`Moved marker to ${fmtT(f)}`, null, () => { m.frame = f; });
}
function startKeyDrag(e, id) { e.stopPropagation(); beginGesture(e, "key", { id, base: motionKeys.find((k) => k.id === id).frame }); keyEls.get(id)?.classList.add("dragging"); }
function moveKey(e) {
  const k = motionKeys.find((k) => k.id === G.id);
  k.frame = stickySnap(G, G.base + gestureDelta(e), snapTargets(new Set(), {}), e);
  keyEls.get(k.id).style.left = `${xOf(k.frame)}px`;
  showHud(e.clientX, e.clientY, `◆ key · <b>${fmtT(k.frame)}</b> · ${fmtD(k.frame - G.base)}${hudTarget(G)}`);
  showLoupe(k.frame, G, e, { trackId: "v1" });
}
function endKey(e, g) {
  const k = motionKeys.find((k) => k.id === g.id);
  if (!g.moved) return;
  const f = Math.round(k.frame); k.frame = g.base;
  commit(`Retimed motion key to ${fmtT(f)}`, null, () => { k.frame = f; });
}

/* ---- render window ---- */
function startRw(e, kind) {
  e.stopPropagation();
  beginGesture(e, "rw", { mode: kind, f0: render.from, t0: render.to });
  rzBar.classList.add("engaged");
}
function moveRw(e) {
  const d = gestureDelta(e);
  const T = snapTargets(new Set(), {});
  let { f0, t0 } = G;
  if (G.mode === "rw-move") {
    let from = stickySnap(G, f0 + d, T, e);
    G.liveFrom = from; G.liveTo = from + (t0 - f0);
  } else if (G.mode === "rw-left") {
    G.liveFrom = clamp(stickySnap(G, f0 + d, T, e), axisStart, t0 - 1); G.liveTo = t0;
  } else {
    G.liveFrom = f0; G.liveTo = clamp(stickySnap(G, t0 + d, T, e), f0 + 1, axisEnd);
  }
  positionRw(G.liveFrom, G.liveTo);
  showHud(e.clientX, e.clientY, `render <b>${fmtT(G.liveFrom)} – ${fmtT(G.liveTo)}</b> · ${fmtT(G.liveTo - G.liveFrom)} out${hudTarget(G)}`);
}
function endRw(e, g) {
  rzBar.classList.remove("engaged");
  if (!g.moved || g.liveFrom === undefined) return positionRw();
  commit(`Render window ${fmtT(g.liveFrom)} – ${fmtT(g.liveTo)}`, null, () => {
    render.from = Math.round(g.liveFrom); render.to = Math.round(g.liveTo);
  });
}

/* ---- move (free + magnetic + groups + connected) ---- */
function startMove(e, clip) {
  e.stopPropagation();
  if (e.metaKey) { selection.has(clip.id) ? selection.delete(clip.id) : selection.add(clip.id); refreshSelection(); return; }
  if (!selection.has(clip.id)) { selection = new Set([clip.id]); refreshSelection(); }
  const tr = trackById(clip.trackId);
  if (tr.magnetic && !clip.gap) return startMagneticMove(e, clip, tr);
  const ids = [...selection].filter((id) => {
    const c = clips.find((c) => c.id === id);
    return c && !trackById(c.trackId).magnetic;
  });
  if (!ids.includes(clip.id)) ids.push(clip.id);
  beginGesture(e, "move", {
    clip, ids,
    base: new Map(ids.map((id) => [id, clips.find((c) => c.id === id).from])),
    childIds: childrenOf(ids),
  });
  // drop-target grammar (idea 22): a faint ghost holds the vacated slot,
  // a bright dashed outline previews exactly where the clip will land
  const el0 = clipEls.get(clip.id);
  if (ids.length === 1 && !clip.gap && el0) {
    G.ghosting = true;
    G.grabDy = e.clientY - el0.getBoundingClientRect().top;
    const og = el("div", "clip-ghost origin", laneTracks.get(clip.trackId));
    Object.assign(og.style, { left: `${el0.offsetLeft}px`, top: `${el0.offsetTop}px`, width: `${el0.offsetWidth}px`, height: `${el0.offsetHeight}px` });
    G.originGhost = og;
  }
}

/* while dragging: pointer height picks the stack slot, and the drop ghost
   shows the landing frame + the row it will occupy after the drop */
function updateDropPreview(e, c, from) {
  const tr = trackById(c.trackId);
  const trackEl = laneTracks.get(c.trackId);
  if (!tr || !trackEl) return;
  const f0 = from, f1 = from + c.dur;
  const all = zTopToBottom(c.trackId).filter((o) => o.id !== c.id);
  const overl = all.filter((o) => !o.gap && f0 < o.from + o.dur - 0.01 && f1 > o.from + 0.01);
  const rect = trackEl.getBoundingClientRect();
  let k;
  if (has("layers") && overl.length) {
    k = 0;                                       // clips whose row-center sits above the pointer stay above
    for (const o of overl) {
      const center = rect.top + clipTopIn(tr, c.trackId, o.id) + tr.clipH / 2;
      if (e.clientY > center) k++; else break;
    }
  } else {
    const t2b = zTopToBottom(c.trackId);
    const ci = t2b.findIndex((o) => o.id === c.id);
    k = overl.filter((o) => t2b.indexOf(o) < ci).length;   // keep the current stack slot
  }
  if (has("layers")) {                           // the clip rides the pointer vertically too
    const el0 = clipEls.get(c.id);
    if (el0) el0.style.top = `${clamp(e.clientY - rect.top - G.grabDy, -6, trackEl.clientHeight - tr.clipH + 6)}px`;
  }
  // simulate the post-drop row packing for the landing outline
  const insertIdx = overl.length ? (k < overl.length ? all.indexOf(overl[k]) : all.indexOf(overl[overl.length - 1]) + 1) : all.length;
  const seq = [...all.slice(0, insertIdx), c, ...all.slice(insertIdx)];
  const rows = [];
  let rowOf = 0;
  for (const o of seq) {
    const [a, b] = o.id === c.id ? [f0, f1] : [o.from, o.from + o.dur];
    let r = 0;
    while ((rows[r] ?? []).some(([x, y]) => a < y - 0.01 && b > x + 0.01)) r++;
    (rows[r] ??= []).push([a, b]);
    if (o.id === c.id) rowOf = r;
  }
  if (!G.dropGhost) G.dropGhost = el("div", "clip-ghost drop", trackEl);
  Object.assign(G.dropGhost.style, {
    left: `${xOf(f0)}px`, width: `${Math.max(3, c.dur * ppf)}px`,
    top: `${tr.clipTop + rowOf * (tr.clipH + ROW_GAP)}px`, height: `${tr.clipH}px`,
  });
  G.stack = { overl, k };
}
function childrenOf(ids) {
  const set = new Set(ids);
  return clips.filter((c) => c.parentId && set.has(c.parentId) && !set.has(c.id)).map((c) => c.id);
}
function moveMove(e) {
  if (G.moveMagnetic) return moveMagneticMove(e);
  const d = gestureDelta(e);
  const c = G.clip;
  const exclude = new Set([...G.ids, ...G.childIds]);
  const T = snapTargets(exclude, {});
  const rawFrom = G.base.get(c.id) + d;
  // dual-edge sticky snap: whichever end is nearer to a target wins (idea 4)
  let from = rawFrom;
  if (G.stuck) {
    from = G.stuck.edge === "out" ? stickySnap(G, rawFrom + c.dur, T, e) - c.dur : stickySnap(G, rawFrom, T, e);
  } else {
    const nearest = (f) => { let b = Infinity; for (const t of T) b = Math.min(b, Math.abs(f - t.f)); return b; };
    if (nearest(rawFrom + c.dur) < nearest(rawFrom)) {
      from = stickySnap(G, rawFrom + c.dur, T, e) - c.dur;
      if (G.stuck) G.stuck.edge = "out";
    } else {
      from = stickySnap(G, rawFrom, T, e);
      if (G.stuck) G.stuck.edge = "in";
    }
  }
  const applied = from - G.base.get(c.id);
  for (const id of G.ids) {
    const cc = clips.find((x) => x.id === id);
    const nf = G.base.get(id) + applied;
    G.live.set(id, { from: nf });
    const el = clipEls.get(id);
    el.classList.add("dragging");
    el.style.zIndex = 99;                       // ride above the stack while in hand
    el.style.left = `${xOf(nf)}px`;
  }
  if (G.ghosting) updateDropPreview(e, c, from);
  for (const id of G.childIds) {
    const el = clipEls.get(id);
    el.classList.add("rippling");
    el.style.transform = `translateX(${applied * ppf}px)`;
    G.shift.set(id, applied);
  }
  moveStems();
  const n = G.ids.length > 1 ? `${G.ids.length} clips` : c.gap ? "gap" : c.name;
  const st = G.stack;
  const stackNote = st?.overl.length && has("layers")
    ? ` · <span class="hud-hold">${st.k === 0 ? "top of stack" : st.k === st.overl.length ? "bottom of stack" : `under ${st.overl[st.k - 1].name}`}</span>` : "";
  showHud(e.clientX, e.clientY, `${n} · <b>${fmtD(applied)}</b> · in ${fmtT(from)}${stackNote}${hudTarget(G)}`);
  if (e.shiftKey || G.stuck) showLoupe(G.stuck?.edge === "out" ? from + c.dur : from, G, e, { trackId: c.trackId });
  else hideLoupe();
  updateMonitor(Math.round(from));
}
function moveStems() {
  document.querySelectorAll(".stem").forEach((s) => {
    const c = clips.find((c) => c.id === s.dataset.stemFor);
    if (c) s.style.left = `${LABEL_W + xOf(liveClip(c).from) + 3}px`;
  });
}
function endMove(e, g) {
  if (g.moveMagnetic) return endMagneticMove(e, g);
  g.originGhost?.remove(); g.dropGhost?.remove();
  for (const id of g.ids) { const el = clipEls.get(id); el?.classList.remove("dragging"); if (el) el.style.zIndex = ""; }
  if (!g.moved) { rebuild(); return; }
  const applied = (g.live.get(g.clip.id)?.from ?? g.clip.from) - g.base.get(g.clip.id);
  const d = Math.round(applied);
  // the drop lands exactly where the outline said: frame, row, and stack slot (idea 22)
  const st = g.stack;
  const restack = has("layers") && g.ghosting && !!st?.overl.length && !trackById(g.clip.trackId).magnetic;
  if (!d && !restack) { rebuild(); return; }
  sndDrop();
  const idSet = new Set(g.ids);
  const roots = g.ids.filter((id) => !idSet.has(clips.find((c) => c.id === id)?.parentId));
  const n = g.ids.length > 1 ? `${g.ids.length} clips` : g.clip.gap ? "gap" : g.clip.name;
  const stackNote = restack
    ? (st.k === 0 ? "top of the stack · ⌘[ slides it under"
      : st.k === st.overl.length ? `under ${st.overl[st.overl.length - 1].name} · bottom of the stack`
      : `under ${st.overl[st.k - 1].name}`)
    : "⌘Z to undo";
  commit(!d && restack ? `Restacked ${n}` : `Moved ${n} ${fmtD(d)}`, stackNote, () => {
    for (const id of roots) { const c = clips.find((c) => c.id === id); c.from = g.base.get(id) + d; }
    if (restack) {
      zUnlink(g.clip);
      if (st.k < st.overl.length) zInsertAbove(g.clip, st.overl[st.k]);
      else zInsertBelow(g.clip, st.overl[st.overl.length - 1]);
    }
  });
}

/* magnetic reorder (idea 12): lift, neighbors part, drop inserts, pack springs */
function startMagneticMove(e, clip, tr) {
  beginGesture(e, "move", { clip, ids: [clip.id], magnetic: tr, base: new Map([[clip.id, clip.from]]), childIds: childrenOf([clip.id]) });
  G.order = clips.filter((c) => c.trackId === tr.id && c.id !== clip.id).sort((a, b) => a.from - b.from);
  G.origin = Math.min(...clips.filter((c) => c.trackId === tr.id).map((c) => c.from));
  G.caret = el("div", "caret", tlCanvas);
  const laneEl = laneTracks.get(tr.id).parentElement;
  G.caret.style.top = `${laneEl.offsetTop}px`; G.caret.style.height = `${laneEl.offsetHeight}px`;
  G.moveMagnetic = true;
}
function magneticPreview(pointerFrame) {
  // insertion index by packed midpoints
  let cursor = G.origin, index = G.order.length;
  for (let i = 0; i < G.order.length; i++) {
    if (pointerFrame < cursor + G.order[i].dur / 2) { index = i; break; }
    cursor += G.order[i].dur;
  }
  // preview pack with a hole of the lifted clip's length
  let at = G.origin;
  const caretF = G.order.slice(0, index).reduce((a, c) => a + c.dur, G.origin);
  for (let i = 0; i < G.order.length; i++) {
    if (i === index) at += G.clip.dur;
    const c = G.order[i];
    const shift = at - c.from;
    const elc = clipEls.get(c.id);
    elc.classList.add("parting");
    elc.style.transform = `translateX(${shift * ppf}px)`;
    G.shift.set(c.id, shift);
    for (const id of childrenOf([c.id])) {
      const che = clipEls.get(id);
      che.classList.add("parting");
      che.style.transform = `translateX(${shift * ppf}px)`;
      G.shift.set(id, shift);
    }
    at += c.dur;
  }
  G.insertIndex = index;
  G.caret.style.left = `${LABEL_W + xOf(caretF)}px`;
  return caretF;
}
function moveMagneticMove(e) {
  const d = gestureDelta(e);
  const from = G.base.get(G.clip.id) + d;
  G.live.set(G.clip.id, { from });
  const el = clipEls.get(G.clip.id);
  el.classList.add("lifted");
  el.style.zIndex = 99;
  el.style.left = `${xOf(from)}px`;
  const caretF = magneticPreview(from + G.clip.dur / 2);
  for (const id of G.childIds) {
    const applied = from - G.base.get(G.clip.id);
    const che = clipEls.get(id); che.classList.add("rippling"); che.style.transform = `translateX(${applied * ppf}px)`; G.shift.set(id, applied);
  }
  moveStems();
  showHud(e.clientX, e.clientY, `${G.clip.name} · storyline slot <b>${G.insertIndex + 1}</b> · lands ${fmtT(caretF)}`);
}
function endMagneticMove(e, g) {
  g.caret.remove();
  const el = clipEls.get(g.clip.id);
  el?.classList.remove("lifted");
  if (!g.moved) { rebuild(); return; }
  sndDrop();
  commit(`Moved ${g.clip.name} to slot ${g.insertIndex + 1}`, "storyline repacked", () => {
    let at = g.origin;
    for (let i = 0; i <= g.order.length; i++) {
      if (i === g.insertIndex) { g.clip.from = at; at += g.clip.dur; }
      if (i < g.order.length) { g.order[i].from = at; at += g.order[i].dur; }
    }
  });
}

/* ---- trim (free / ⌘ ripple / magnetic auto-ripple) ---- */
function startTrim(e, clip, edge, handleEl) {
  e.stopPropagation();
  selection = new Set([clip.id]); refreshSelection();
  const tr = trackById(clip.trackId);
  let ripple = tr.magnetic || e.metaKey;
  if (!ripple && handleEl) {
    // pointer-only ripple: the handle's lower half ripples, upper half plain-trims
    const hr = handleEl.getBoundingClientRect();
    ripple = e.clientY > hr.top + hr.height / 2;
  }
  beginGesture(e, "trim", {
    clip, edge, tr, ripple,
    base: { from: clip.from, dur: clip.dur, srcIn: clip.srcIn },
    downstream: clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.from >= clip.from + (edge === "l" ? -0.5 : clip.dur - 0.5)).map((c) => c.id),
  });
  G.downstreamChildren = childrenOf(G.downstream);
}
function moveTrim(e) {
  const d = gestureDelta(e);
  const { clip, edge, base, ripple } = G;
  const T = snapTargets(new Set([clip.id]), {});
  const holdable = has("hold") && trackById(clip.trackId).kind !== "music";  // audio doesn't freeze-frame
  let dd = 0;                                    // applied delta at the edge
  G.limit = false;
  if (edge === "r") {
    let out = stickySnap(G, base.from + base.dur + d, T, e);
    out = mediaDetent(G, out, base.from - base.srcIn + clip.srcLen, e, holdable && clip.srcLen < 900);
    const dur = clamp(out - base.from, 1, 1e9);
    G.limit = dur === 1;
    dd = dur - base.dur;
    G.live.set(clip.id, { dur });
  } else if (!ripple) {
    // free head trim: the box edge follows the pointer (studio behavior);
    // past the source's first frame it holds frame 0 (srcIn goes negative)
    let raw = stickySnap(G, base.from + d, T, e);
    raw = mediaDetent(G, raw, base.from - base.srcIn, e, holdable);
    const inF = clamp(raw, holdable ? -1e9 : base.from - base.srcIn, base.from + base.dur - 1);
    G.limit = raw < inF;                          // red only at a true wall
    dd = inF - base.from;
    G.live.set(clip.id, { from: inF, dur: base.dur - dd, srcIn: base.srcIn + dd });
  } else {
    // ripple head trim: junction holds, the filmstrip is eaten, downstream closes in
    const dEff = mediaDetent(G, d, -base.srcIn, e, holdable);
    const eat = clamp(dEff, holdable ? -1e9 : -base.srcIn, base.dur - 1);
    G.limit = !holdable && dEff < -base.srcIn;
    dd = -eat;                                    // downstream shifts by -eat
    G.live.set(clip.id, { dur: base.dur - eat, srcIn: base.srcIn + eat });
  }
  const liveNow = liveClip(clip);
  const holdF = edge === "r"
    ? (clip.srcLen < 900 ? Math.max(0, Math.round(liveNow.srcIn + liveNow.dur - clip.srcLen)) : 0)
    : Math.max(0, -Math.round(liveNow.srcIn));
  const handle = clipEls.get(clip.id)?.querySelector(`.trim-handle.${edge === "r" ? "right" : "left"}`);
  handle?.classList.toggle("limit", G.limit);
  handle?.classList.toggle("hold", !G.limit && holdF > 0);
  G.holdF = holdF;
  applyClipLive(clip);
  if (ripple) {
    const shift = edge === "r" ? dd : dd;
    for (const id of [...G.downstream, ...G.downstreamChildren]) {
      const elc = clipEls.get(id);
      elc.classList.add("rippling");
      elc.style.transform = `translateX(${shift * ppf}px)`;
      G.shift.set(id, shift);
    }
  }
  moveStems();
  const live = liveClip(clip);
  const edgeF = edge === "r" ? live.from + live.dur : live.from;
  const label = edge === "r" ? "out" : "in";
  const holdNote = G.holdF > 0 ? ` · <span class="hud-hold">❚❚ ${edge === "r" ? "last" : "first"} frame ×${G.holdF}f</span>` : "";
  showHud(e.clientX, e.clientY,
    `${clip.gap ? "gap" : clip.name} ${label} <b>${fmtT(edgeF)}</b> · ${fmtT(base.dur)} → ${fmtT(live.dur)}${ripple ? " · <b>ripple</b>" : ""}${G.limit ? ' · <span style="color:#f07470">media limit</span>' : ""}${holdNote}${gainNote(e)}${hudTarget(G)}`);
  showLoupe(edgeF, G, e, { trackId: clip.trackId });          // loupe always on for trims (idea 1)
  // preview the first/last visible frame — ceil on the in side so the lookup can't round past the clip
  updateMonitor(edge === "r" ? Math.round(edgeF) - 1 : Math.ceil(edgeF - 1e-6));
}
function applyClipLive(c) {
  const live = liveClip(c);
  const el = clipEls.get(c.id);
  el.style.left = `${xOf(live.from)}px`;
  el.style.width = `${Math.max(3, live.dur * ppf)}px`;
  const film = el.querySelector(".clip-film");
  if (film) film.style.backgroundPositionX = `${-Math.max(0, live.srcIn) * 1.2}px`;
  updateOverruns(el, live);
}
function endTrim(e, g) {
  if (!g.moved) return;
  const live = liveClip(g.clip);
  const dDur = Math.round(live.dur) - g.base.dur;
  if (!dDur && Math.round(live.from) === g.base.from) { rebuild(); return; }
  sndDrop();
  const rippleNote = g.ripple ? " (ripple)" : "";
  const holdNote = g.holdF > 0 ? `${g.edge === "r" ? "last" : "first"} frame holds ×${g.holdF}f` : null;
  commit(`Trimmed ${g.clip.gap ? "gap" : g.clip.name} ${g.edge === "r" ? "out" : "in"} ${fmtD(g.edge === "r" ? dDur : -dDur)}${rippleNote}`, holdNote, () => {
    g.clip.from = Math.round(live.from); g.clip.dur = Math.max(1, Math.round(live.dur)); g.clip.srcIn = Math.round(live.srcIn);
    // ripple: downstream shifts by the duration change, both edges (junction-fixed head trims included)
    if (g.ripple) for (const id of g.downstream) { const c = clips.find((c) => c.id === id); if (c) c.from += dDur; }
    if (g.clip.gap && g.clip.dur < 1) { zUnlink(g.clip); clips = clips.filter((c) => c.id !== g.clip.id); }
  });
}

/* ---- junction pill (ideas 7 + 10): ⟷ roll on top, ＋ open-time below ---- */
let rollHandleEl = null, junctionAddEl = null;
function hideJunction() { rollHandleEl?.remove(); rollHandleEl = null; junctionAddEl?.remove(); junctionAddEl = null; }
function updateRollHandles(e) {
  if ((!has("roll") && !has("wedge")) || G || tool !== "select") { hideJunction(); return; }
  if (e.target.closest?.(".roll-handle")) return;      // stay visible while on the pills
  const trEl = e.target.closest?.(".lane-track");
  const trId = trEl?.dataset.track;
  if (!trId || trId === "motion") { hideJunction(); return; }
  const f = frameAt(e.clientX);
  const tcs = clips.filter((c) => c.trackId === trId).sort((a, b) => a.from - b.from);
  for (let i = 0; i < tcs.length - 1; i++) {
    const a = tcs[i], b = tcs[i + 1];
    if (Math.abs(a.from + a.dur - b.from) < 0.51 && Math.abs(f - b.from) * ppf < 7) {
      const tr = trackById(trId);
      // lane top by element, not by index: layers are reorderable, and the junction
      // sits in whichever stack row clip b was packed into.
      const laneTop = laneTracks.get(trId).parentElement.offsetTop + clipTopIn(tr, trId, b.id);
      const showRoll = has("roll"), showAdd = has("wedge");
      const h = showRoll && showAdd ? Math.max(10, Math.floor((tr.clipH - 2) / 2)) : tr.clipH;
      if (showRoll && !rollHandleEl) { rollHandleEl = el("div", "roll-handle", tlCanvas); rollHandleEl.textContent = "⟷"; rollHandleEl.dataset.gesture = "roll"; rollHandleEl.dataset.idea = "10"; }
      if (showAdd && !junctionAddEl) { junctionAddEl = el("div", "roll-handle junction-add", tlCanvas); junctionAddEl.textContent = "＋"; junctionAddEl.dataset.gesture = "junction-add"; junctionAddEl.dataset.idea = "7 8"; }
      const jLeft = `${LABEL_W + xOf(b.from)}px`;
      if (rollHandleEl) {
        rollHandleEl.style.left = jLeft;
        rollHandleEl.style.top = `${laneTop}px`;
        rollHandleEl.style.height = `${h}px`;
        rollHandleEl.title = `Roll ${a.name} / ${b.name} — moves the boundary, downstream stays put`;
        rollHandleEl.dataset.a = a.id; rollHandleEl.dataset.b = b.id;
      }
      if (junctionAddEl) {
        junctionAddEl.style.left = jLeft;
        junctionAddEl.style.top = `${laneTop + (showRoll ? h + 2 : 0)}px`;
        junctionAddEl.style.height = `${h}px`;
        junctionAddEl.title = "＋TIME here — click inserts 0.5s · drag right for more · drag left removes";
        junctionAddEl.dataset.f = String(Math.round(b.from));
      }
      return;
    }
  }
  hideJunction();
}
function startRoll(e, aId, bId) {
  e.stopPropagation();
  const a = clips.find((c) => c.id === aId), b = clips.find((c) => c.id === bId);
  beginGesture(e, "roll", { a, b, base: { aDur: a.dur, bFrom: b.from, bDur: b.dur, bSrcIn: b.srcIn } });
  rollHandleEl?.classList.add("engaged");
}
function moveRoll(e) {
  const d0 = gestureDelta(e);
  const { a, b, base } = G;
  const T = snapTargets(new Set([a.id, b.id]), {});
  const j = stickySnap(G, base.bFrom + d0, T, e);
  const d = clamp(j - base.bFrom, Math.max(1 - base.aDur, -base.bSrcIn), base.bDur - 1);
  G.live.set(a.id, { dur: base.aDur + d });
  G.live.set(b.id, { from: base.bFrom + d, dur: base.bDur - d, srcIn: base.bSrcIn + d });
  applyClipLive(a); applyClipLive(b);
  if (rollHandleEl) rollHandleEl.style.left = `${LABEL_W + xOf(base.bFrom + d)}px`;
  showHud(e.clientX, e.clientY, `roll <b>${fmtD(d)}</b> · ${a.name} ${fmtT(base.aDur + d)} / ${b.name} ${fmtT(base.bDur - d)}${gainNote(e)}${hudTarget(G)}`);
  showLoupe(base.bFrom + d, G, e, { trackId: a.trackId });
  updateMonitor(Math.round(base.bFrom + d));
}
function endRoll(e, g) {
  rollHandleEl?.classList.remove("engaged");
  if (!g.moved) return;
  const d = Math.round((g.live.get(g.b.id)?.from ?? g.base.bFrom) - g.base.bFrom);
  if (!d) { rebuild(); return; }
  sndDrop();
  commit(`Rolled ${g.a.name} / ${g.b.name} ${fmtD(d)}`, "downstream untouched", () => {
    g.a.dur += d; g.b.from += d; g.b.dur -= d; g.b.srcIn += d;
  });
}

/* ---- slip (idea 11) ---- */
function startSlip(e, clip) {
  e.stopPropagation();
  if (!clip || clip.srcLen - clip.dur < 1) { toast(`${clip?.name ?? "clip"} has no slip headroom`); return; }
  selection = new Set([clip.id]); refreshSelection();
  beginGesture(e, "slip", { clip, base: clip.srcIn });
}
function moveSlip(e) {
  const d = gestureDelta(e);
  const c = G.clip;
  const srcIn = clamp(G.base - d, 0, Math.max(0, c.srcLen - c.dur));
  G.live.set(c.id, { srcIn });
  applyClipLive(c);
  showHud(e.clientX, e.clientY, `slip ${c.name} <b>${fmtD(G.base - srcIn)}</b> · src in ${fmtT(srcIn)}${gainNote(e)}`);
  showLoupe(0, G, e, { source: true, clip: { ...c, srcIn } });
}
function endSlip(e, g) {
  if (!g.moved) return;
  const srcIn = Math.round(liveClip(g.clip).srcIn);
  if (srcIn === g.base) return void rebuild();
  commit(`Slipped ${g.clip.name} ${fmtD(g.base - srcIn)}`, "in/out unchanged", () => { g.clip.srcIn = srcIn; });
}

/* ---- ripple insert wedge (idea 7): +TIME opens spacetime ---- */
function ripplePlan(t0) {
  const movers = new Set(), splits = [], flows = [];
  let maxPull = Infinity;
  for (const tr of tracks) {
    if (tr.locked) continue;
    // connected clips never decide for themselves and never block a pull — they ride their parent
    const tcs = clips.filter((c) => c.trackId === tr.id && !c.parentId).sort((a, b) => a.from - b.from);
    let blockEnd = -Infinity, first = Infinity, prevNonMover = null;
    for (const c of tcs) {
      const end = c.from + c.dur;
      if (c.from >= t0 - 1e-6) { movers.add(c.id); first = Math.min(first, c.from); }
      else if (end > t0 + 1e-6 && !c.gap) {
        // straddles the point — beds flow (span + grow), everything else splits in sync
        (tr.kind === "music" ? flows : splits).push(c);
        maxPull = Math.min(maxPull, Math.max(0, end - t0 - 1));   // negative wedge eats into the tail
      } else { blockEnd = Math.max(blockEnd, end); prevNonMover = c; }
    }
    if (first < Infinity) {
      const straddled = splits.some((c) => c.trackId === tr.id) || flows.some((c) => c.trackId === tr.id);
      if (!straddled) {
        if (tr.magnetic) maxPull = Math.min(maxPull, prevNonMover?.gap ? prevNonMover.dur : blockEnd === -Infinity ? 1e9 : 0);
        else maxPull = Math.min(maxPull, first - (blockEnd === -Infinity ? axisStart : blockEnd));
      }
    }
  }
  for (const c of clips) if (c.parentId && movers.has(c.parentId)) movers.add(c.id);
  return { movers, splits, flows, maxPull: maxPull === Infinity ? 1e9 : Math.max(0, maxPull) };
}
let wedgeEl = null;
function startWedge(e) {
  const t0 = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), {}), e));
  const plan = ripplePlan(t0);
  beginGesture(e, "wedge", { t0, plan });
  wedgeEl = el("div", "wedge", tlCanvas);
  el("span", "wedge-label", wedgeEl);
  hideGuide();
}
function moveWedge(e) {
  const d = gestureDelta(e);
  const { t0, plan } = G;
  const T = snapTargets(plan.movers, {});
  let delta = stickySnap(G, t0 + d, T, e) - t0;
  delta = clamp(delta, -plan.maxPull, 1e9);
  G.delta = delta;
  const lockNote = tracks.some((t) => t.locked) ? " · A2 locked" : "";
  wedgeEl.classList.toggle("removing", delta < 0);
  wedgeEl.style.left = `${LABEL_W + xOf(Math.min(t0, t0 + delta))}px`;
  wedgeEl.style.width = `${Math.abs(delta) * ppf}px`;
  wedgeEl.querySelector(".wedge-label").textContent = `${delta >= 0 ? "+" : "−"}${(Math.abs(delta) / FPS).toFixed(2)}s`;
  for (const id of plan.movers) {
    const elc = clipEls.get(id);
    if (!elc) continue;
    elc.classList.add("rippling");
    elc.style.transform = `translateX(${delta * ppf}px)`;
    G.shift.set(id, delta);
  }
  for (const m of markers) if (m.frame >= t0) markerEls.get(m.id).style.transform = `translateX(${delta * ppf}px)`;
  for (const k of motionKeys) if (k.frame >= t0) keyEls.get(k.id).style.transform = `translateX(${delta * ppf}px)`;
  if (render.to >= t0) positionRw(render.from, render.to + delta);
  // straddlers: beds visibly grow/shrink, split clips get the dashed warning outline
  for (const c of plan.flows) { G.live.set(c.id, { dur: Math.max(1, c.dur + delta) }); applyClipLive(c); }
  for (const c of plan.splits) clipEls.get(c.id)?.classList.add("will-split");
  moveStems();
  const strad = [
    ...(plan.splits.length ? [`✂ ${plan.splits.map((c) => c.name).join(", ")}`] : []),
    ...(plan.flows.length ? [`${plan.flows.map((c) => c.name).join(", ")} flows`] : []),
  ].map((s) => ` · ${s}`).join("");
  showHud(e.clientX, e.clientY, `＋TIME at ${fmtT(t0)} · <b>${fmtD(delta)}</b> · ${plan.movers.size} clips ride${strad}${lockNote}${gainNote(e)}${hudTarget(G)}`);
  if (e.shiftKey) showLoupe(t0 + delta, G, e, { trackId: "v1" });
}
function endWedge(e, g) {
  wedgeEl?.remove(); wedgeEl = null;
  markerEls.forEach((el) => (el.style.transform = ""));
  keyEls.forEach((el) => (el.style.transform = ""));
  const delta = Math.round(g.delta ?? 0);
  if (!g.moved || !delta) {
    positionRw();
    if (g.plan.splits.length || g.plan.flows.length) rebuild();   // restore straddler previews
    return;
  }
  commitWedge(g.t0, delta, g.plan);
}
/* the wedge commit, callable from drags, junction ＋ clicks, and menus alike */
function commitWedge(t0, delta, plan) {
  const g = { t0, plan };
  sndWhoosh();
  const splitNote = plan.splits.length ? ` · split ${plan.splits.map((c) => c.name).join(", ")}` : "";
  const flowNote = plan.flows.length ? ` · ${plan.flows.map((c) => c.name).join(", ")} flows` : "";
  const label = delta > 0 ? `Inserted ${(delta / FPS).toFixed(2)}s at ${fmtT(t0)}` : `Removed ${(-delta / FPS).toFixed(2)}s at ${fmtT(t0)}`;
  commit(label, `downstream shifted${splitNote}${flowNote}`, () => {
    // straddlers first: sync clips split at the point (tails land pre-shifted), beds flow
    for (const c of g.plan.splits) {
      const headDur = g.t0 - c.from;
      const eaten = delta < 0 ? -delta : 0;
      const tail = {
        ...c, id: uid(),
        from: delta > 0 ? g.t0 + delta : g.t0,
        dur: Math.max(1, c.dur - headDur - eaten),
        srcIn: c.srcIn + headDur + eaten,
        badges: undefined, takes: undefined,
      };
      c.dur = Math.max(1, headDur);
      clips.push(tail);
      // connected clips annotating tail content ride with the tail
      for (const ch of clips) if (ch.parentId === c.id && ch.from >= g.t0 - 1e-6) { ch.parentId = tail.id; ch.from += delta; }
    }
    for (const c of g.plan.flows) c.dur = Math.max(1, c.dur + delta);
    for (const tr of tracks) {
      if (tr.locked) continue;
      const trackSplit = g.plan.splits.some((c) => c.trackId === tr.id);
      if (tr.magnetic) {
        const tcs = clips.filter((c) => c.trackId === tr.id).sort((a, b) => a.from - b.from);
        if (delta > 0 && trackSplit) {
          // the seam sits exactly at the point: head | gap | tail
          clips.push({ id: uid(), trackId: tr.id, name: "gap", gap: true, from: g.t0 + 0.1, dur: delta, srcIn: 0, srcLen: 1e9, tone: "amber" });
          for (const c of tcs) if (g.plan.movers.has(c.id)) c.from += delta;
          continue;
        }
        const firstMover = tcs.find((c) => g.plan.movers.has(c.id));
        if (!firstMover && !trackSplit) continue;
        if (delta > 0) {
          const before = tcs.filter((c) => !g.plan.movers.has(c.id));
          if (!before.length && firstMover.from >= g.t0 - 1e-6 && g.t0 < firstMover.from) {
            for (const c of tcs) c.from += delta;            // whole storyline slides
          } else {
            const gp = { id: uid(), trackId: tr.id, name: "gap", gap: true, from: firstMover.from - 0.25, dur: delta, srcIn: 0, srcLen: 1e9, tone: "amber", zPrevId: null, zNextId: null };
            clips.push(gp); zPushTop(gp);
            for (const c of tcs) if (g.plan.movers.has(c.id)) c.from += delta;
          }
        } else {
          const prev = tcs.filter((c) => !g.plan.movers.has(c.id) && !g.plan.splits.includes(c)).pop();
          if (!trackSplit && prev?.gap) { prev.dur += delta; if (prev.dur < 1) { zUnlink(prev); clips = clips.filter((c) => c.id !== prev.id); } }
          for (const c of tcs) if (g.plan.movers.has(c.id)) c.from += delta;
        }
      } else {
        for (const c of clips) if (c.trackId === tr.id && g.plan.movers.has(c.id) && !c.parentId) c.from += delta;
      }
    }
    for (const m of markers) if (m.frame >= g.t0) m.frame += delta;
    for (const k of motionKeys) if (k.frame >= g.t0) k.frame += delta;
    if (render.to >= g.t0) render.to += delta;
    if (playhead >= g.t0) playhead += delta;
  });
}

/* ---- blade (idea 14) ---- */
let cutLineEl = null;
function updateCutLine(e) {
  if (tool !== "blade" || G) { cutLineEl?.remove(); cutLineEl = null; clearCutTints(); return; }
  const overClip = e.target.closest?.(".clip");
  const f = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e, 8, true));
  if (!cutLineEl) { cutLineEl = el("div", "cut-line", tlCanvas); el("span", "cut-tc", cutLineEl); }
  cutLineEl.style.left = `${LABEL_W + xOf(f)}px`;
  cutLineEl.querySelector(".cut-tc").textContent = `✂ ${fmtT(f)}${e.shiftKey ? " · all tracks" : ""}`;
  clearCutTints();
  if (overClip) {
    const c = clips.find((c) => c.id === overClip.dataset.id);
    if (c && f > c.from + 1 && f < c.from + c.dur - 1) {
      const tint = el("i", "cut-tint", overClip);
      tint.style.left = "0"; tint.style.width = `${(f - c.from) * ppf}px`;
    }
  }
  hideGuide();
}
function clearCutTints() { document.querySelectorAll(".cut-tint").forEach((t) => t.remove()); }
function cutAt(targets, f, sub) {
  targets = targets.filter((c) => c && !c.gap && f > c.from + 1 && f < c.from + c.dur - 1);
  if (!targets.length) return toast("Nothing to cut there");
  sndCut();
  commit(`Cut ${targets.length > 1 ? `${targets.length} clips` : targets[0].name} at ${fmtT(f)}`, sub, () => {
    for (const c of targets) {
      const off = f - c.from;
      const nc = { ...c, id: uid(), from: f, dur: c.dur - off, srcIn: c.srcIn + off, parentId: c.parentId, badges: undefined, takes: undefined, zPrevId: null, zNextId: null };
      clips.push(nc);
      zInsertAbove(nc, c);                       // the new right half sits just above its source
      c.dur = off;
    }
  });
}
function doBlade(e, clip) {
  // force: cuts snap to beats and the playhead even on pages without the snap caps
  const f = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e, 8, true));
  cutAt(e.shiftKey ? clips.filter((c) => !c.gap) : [clip], f, "B again to keep cutting");
}

/* ✂ strip gesture: click = cut here · drag = tear the timeline open (idea 7, modeless) */
function startCutDrag(e, clip, forcedT0) {
  e.stopPropagation();
  const t0 = forcedT0 ?? Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e, 8, true));
  beginGesture(e, "cutdrag", { clip, t0 });
}
function moveCutDrag(e) {
  gestureDelta(e);
  if (!G.moved) return;
  hideCutHover();
  G.kind = "wedge";                                 // morph: the cut line becomes a wedge anchor
  G.plan = ripplePlan(G.t0);
  wedgeEl = el("div", "wedge", tlCanvas);
  el("span", "wedge-label", wedgeEl);
  moveWedge(e);
}
function endCutDrag(e, g) {
  if (!g.clip) return commitWedge(g.t0, BEAT_STEP, ripplePlan(g.t0));   // junction ＋ click: quick half-second
  cutAt([g.clip], g.t0, "drag the ✂ strip sideways to open time instead");
}

/* ---- ✂ strip hover preview (modeless blade) ---- */
let cutHoverEl = null, cutHoverClip = null;
function hideCutHover() {
  cutHoverEl?.remove(); cutHoverEl = null;
  if (cutHoverClip) { cutHoverClip.style.cursor = ""; cutHoverClip = null; }
  document.querySelectorAll(".cut-tint").forEach((t) => t.remove());
}
function updateCutZone(e) {
  if (G || tool !== "select") { hideCutHover(); return; }
  const clipEl = e.target.closest?.(".clip");
  const c = clipEl && clips.find((x) => x.id === clipEl.dataset.id);
  if (!c || c.gap || !inCutZone(e, clipEl)) { hideCutHover(); return; }
  if (cutHoverClip && cutHoverClip !== clipEl) cutHoverClip.style.cursor = "";
  cutHoverClip = clipEl;
  clipEl.style.cursor = "crosshair";
  const f = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e));
  if (!cutHoverEl) { cutHoverEl = el("div", "cut-line", tlCanvas); el("span", "cut-tc", cutHoverEl); }
  cutHoverEl.style.left = `${LABEL_W + xOf(f)}px`;
  cutHoverEl.querySelector(".cut-tc").textContent = `✂ ${fmtT(f)} · click cuts · drag opens time`;
  document.querySelectorAll(".cut-tint").forEach((t) => t.remove());
  if (f > c.from + 1 && f < c.from + c.dur - 1) {
    const tint = el("i", "cut-tint", clipEl);
    tint.style.left = "0"; tint.style.width = `${(f - c.from) * ppf}px`;
  }
}

/* ---- playhead cluster (ideas 14 + 19, modeless): hover the playhead → ⇤ ✂ ⇥ with previews ---- */
let phCluster = null, opTints = [];
function playheadTargets(op) {
  const f = Math.round(playhead);
  return clips.filter((c) => {
    const tr = trackById(c.trackId);
    if (tr.locked || c.gap) return false;
    if (op !== "split" && tr.kind === "music") return false;      // beds keep flowing
    return f > c.from + 1 && f < c.from + c.dur - 1;
  });
}
function clearOpTints() { opTints.forEach((t) => t.remove()); opTints = []; }
function previewPlayheadOp(op) {
  clearOpTints();
  const f = Math.round(playhead);
  for (const c of playheadTargets(op)) {
    const elc = clipEls.get(c.id);
    if (!elc) continue;
    const t = el("i", "cut-tint", elc);
    if (op === "split") { t.style.left = `${(f - c.from) * ppf - 0.75}px`; t.style.width = "1.5px"; }
    else if (op === "head") { t.style.left = "0"; t.style.width = `${(f - c.from) * ppf}px`; }
    else { t.style.left = `${(f - c.from) * ppf}px`; t.style.width = `${(c.from + c.dur - f) * ppf}px`; }
    opTints.push(t);
  }
}
function applyPlayheadOp(op) {
  clearOpTints();
  const f = Math.round(playhead);
  const targets = playheadTargets(op);
  if (!targets.length) return toast("Nothing under the playhead");
  if (op === "split") return cutAt(targets, f, "from the playhead cluster");
  trimClipsToPlayhead(targets, op === "head" ? "l" : "r");
}
function ensurePhCluster() {
  if (phCluster?.isConnected) return;
  phCluster?.remove();
  phCluster = el("div", "ph-cluster", tlCanvas);
  const mk = (txt, title, op) => {
    const b = el("button", "", phCluster);
    b.textContent = txt; b.title = title;
    b.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    b.addEventListener("mouseenter", () => previewPlayheadOp(op));
    b.addEventListener("mouseleave", clearOpTints);
    b.addEventListener("click", (ev) => { ev.stopPropagation(); applyPlayheadOp(op); });
  };
  mk("⇤", "Trim starts to the playhead — hover to preview (beds & locked tracks sit out)", "head");
  mk("✂", "Split every clip under the playhead", "split");
  mk("⇥", "Trim ends to the playhead — hover to preview (beds & locked tracks sit out)", "tail");
}
function updatePhCluster(e) {
  if (G) { phCluster?.classList.remove("show"); return; }
  ensurePhCluster();
  const overCluster = e.target.closest?.(".ph-cluster");
  const inRuler = e.target.closest?.(".ruler-row");
  const rect = scroller.getBoundingClientRect();
  const canvasX = e.clientX - rect.left + scroller.scrollLeft;
  const phX = LABEL_W + xOf(playhead);
  if (overCluster || (inRuler && Math.abs(canvasX - phX) < 14)) {
    phCluster.style.left = `${phX + 6}px`;
    phCluster.style.top = `${RULER_H + 4}px`;
    phCluster.classList.add("show");
  } else phCluster.classList.remove("show");
}

/* ---- selection bar (idea 19, modeless): nudge steppers + duration + delete ---- */
let selBar = null;
function updateSelBar() {
  const sel = clips.filter((c) => selection.has(c.id));
  if (!sel.length || G) { selBar?.remove(); selBar = null; return; }
  if (!selBar?.isConnected) {
    selBar?.remove();
    selBar = el("div", "sel-bar", document.body);
    const mk = (txt, title, fn, repeat) => {
      const b = el("button", "", selBar);
      b.textContent = txt; b.title = title;
      b.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
        if (repeat) {
          const iv = setInterval(fn, 130);
          window.addEventListener("pointerup", () => clearInterval(iv), { once: true });
        }
      });
    };
    mk("◂", "Nudge −1 frame · hold to repeat ( , on keys)", () => nudge(-1), true);
    el("span", "sel-dur", selBar);
    mk("▸", "Nudge +1 frame · hold to repeat ( . on keys)", () => nudge(1), true);
    mk("×", "Delete selection — magnetic tracks close up (⌫)", () => deleteSelection());
  }
  const first = clipEls.get(sel[0].id);
  if (!first) { selBar.remove(); selBar = null; return; }
  const r = first.getBoundingClientRect();
  const total = sel.reduce((a, c) => a + c.dur, 0);
  selBar.querySelector(".sel-dur").textContent =
    sel.length > 1 ? `${sel.length} clips · ${fmtT(total)}` : `${sel[0].gap ? "gap" : sel[0].name} · ${fmtT(sel[0].dur)}`;
  selBar.style.left = `${Math.max(8, r.left)}px`;
  selBar.style.top = `${Math.max(52, r.top - 27)}px`;
}

/* ---- layer reorder (idea 22): drag a lane label ↑↓ ---- */
function startLayerDrag(e, trId) {
  e.stopPropagation();
  beginGesture(e, "layerdrag", { trId });
  G.label = e.target.closest(".lane-label");
  G.label?.classList.add("lifting");
  G.lanes = layerOrder().map((t) => {
    const laneEl = laneTracks.get(t.id).parentElement;
    return { id: t.id, top: laneEl.offsetTop, height: laneEl.offsetHeight };
  });
  G.caret = el("div", "layer-caret", tlCanvas);
  moveLayerDrag(e);
}
function moveLayerDrag(e) {
  if (Math.abs(e.clientY - G.startY) > 4) G.moved = true;
  const y = e.clientY - tlCanvas.getBoundingClientRect().top;
  const others = G.lanes.filter((l) => l.id !== G.trId);
  let idx = others.length;
  for (let i = 0; i < others.length; i++) if (y < others[i].top + others[i].height / 2) { idx = i; break; }
  G.index = idx;
  const caretY = idx < others.length ? others[idx].top : others[others.length - 1].top + others[others.length - 1].height;
  G.caret.style.top = `${caretY - 1}px`;
  showHud(e.clientX, e.clientY, `layer <b>${trackById(G.trId).name}</b> → ${idx === 0 ? "top of the composite" : `below ${trackById(others[idx - 1].id).name}`}`);
}
function endLayerDrag(e, g) {
  g.caret?.remove();
  g.label?.classList.remove("lifting");
  if (!g.moved || g.index === undefined) return;
  const others = layerOrder().filter((t) => t.id !== g.trId);
  const cur = layerOrder().findIndex((t) => t.id === g.trId);
  const next = [...others.slice(0, g.index), trackById(g.trId), ...others.slice(g.index)];
  if (next.findIndex((t) => t.id === g.trId) === cur) return;
  sndDrop();
  commit(`Layer ${trackById(g.trId).name} → ${g.index === 0 ? "top" : `below ${others[g.index - 1].name}`}`, "upper layers cover lower", () => {
    next.forEach((t, i) => { t.prevId = next[i - 1]?.id ?? null; t.nextId = next[i + 1]?.id ?? null; });
  });
}

/* ---- marquee (multi-select) ---- */
let marqueeEl = null;
function startMarquee(e) {
  beginGesture(e, "marquee", { add: e.shiftKey, sy: e.clientY });
  marqueeEl = el("div", "marquee", document.body);
  marqueeEl.style.position = "fixed";
}
function moveMarquee(e) {
  G.moved = true;
  const x0 = Math.min(G.startX, e.clientX), x1 = Math.max(G.startX, e.clientX);
  const y0 = Math.min(G.sy, e.clientY), y1 = Math.max(G.sy, e.clientY);
  Object.assign(marqueeEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  const hits = new Set(G.add ? selection : []);
  for (const [id, elc] of clipEls) {
    const r = elc.getBoundingClientRect();
    if (r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0) hits.add(id);
  }
  selection = hits; refreshSelection();
}
function endMarquee(e, g) {
  marqueeEl?.remove(); marqueeEl = null;
  if (!g.moved) { selection = new Set(); refreshSelection(); }
  updateProj();
}
function refreshSelection() {
  for (const [id, elc] of clipEls) elc.classList.toggle("selected", selection.has(id));
  updateProj();
  updateSelBar();
}

/* ---- gap chips + seams (idea 8): close ×, or bridge ≈ two halves back into one flowing clip ---- */
let gapChipEl = null, gapHover = null;
function seamNeighbors(trId, f0, f1) {
  const tcs = clips.filter((c) => c.trackId === trId && !c.gap).sort((a, b) => a.from - b.from);
  const head = tcs.filter((c) => Math.abs(c.from + c.dur - f0) < 0.6).pop();
  const tail = tcs.find((c) => Math.abs(c.from - f1) < 0.6);
  if (head && tail && head.name === tail.name && Math.abs(head.srcIn + head.dur - tail.srcIn) < 0.6) return { head, tail };
  return null;
}
function updateGapChip(e) {
  if (!has("gaps") || G || tool !== "select") { removeGapChip(); return; }
  const trEl = e.target.closest?.(".lane-track");
  const trId = trEl?.dataset.track;
  if (!trId || trId === "motion") { removeGapChip(); return; }
  const overGapClip = e.target.closest?.(".clip.gap-clip");
  if (overGapClip) {
    const c = clips.find((x) => x.id === overGapClip.dataset.id);
    if (c) return showGapChip(trId, c.from, c.from + c.dur, { gapClipId: c.id });
  }
  if (e.target.closest(".clip")) { removeGapChip(); return; }
  const f = frameAt(e.clientX);
  const tcs = clips.filter((c) => c.trackId === trId).sort((a, b) => a.from - b.from);
  let prev = null;
  for (const c of tcs) {
    if (c.from > f) {
      const g0 = prev ? prev.from + prev.dur : null;
      if (g0 !== null && f > g0 && c.from - g0 > 2) return showGapChip(trId, g0, c.from, {});
      break;
    }
    prev = c;
  }
  removeGapChip();
}
function showGapChip(trId, f0, f1, opts) {
  const key = `${trId}:${Math.round(f0)}:${opts.gapClipId ?? ""}`;
  gapHover = { trId, f0, f1, ...opts };
  if (gapChipEl?.dataset.key !== key) {
    gapChipEl?.remove();
    gapChipEl = el("div", "gap-chip", tlCanvas);
    gapChipEl.dataset.key = key;
    const bridgeable = seamNeighbors(trId, f0, f1);
    gapChipEl.innerHTML = `<span></span>${bridgeable ? `<button class="bridge" title="Bridge — merge the halves so ${bridgeable.head.name} plays through the gap">≈</button>` : ""}<button class="close" title="Close gap — everything after slides left">×</button>`;
    gapChipEl.querySelector(".close").onpointerdown = (ev) => { ev.stopPropagation(); ev.preventDefault(); closeGap(); };
    gapChipEl.querySelector(".bridge")?.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); ev.preventDefault(); bridgeSeam(); });
  }
  gapChipEl.querySelector("span").textContent = `gap ${(Math.round(f1 - f0) / FPS).toFixed(2)}s`;
  const tr = trackById(trId);
  const laneEl = laneTracks.get(trId).parentElement;
  gapChipEl.style.left = `${LABEL_W + xOf((f0 + f1) / 2)}px`;
  gapChipEl.style.top = `${laneEl.offsetTop + laneEl.offsetHeight / 2}px`;
}
function removeGapChip() { gapChipEl?.remove(); gapChipEl = null; gapHover = null; }
function closeGap() {
  if (!gapHover) return;
  const { trId, f0, f1, gapClipId } = gapHover;
  const len = Math.round(f1 - f0);
  removeGapChip();
  sndWhoosh();
  const ds = clips.filter((c) => c.trackId === trId && c.id !== gapClipId && c.from >= f1 - 0.5).map((c) => c.id);
  commit(`Closed ${(len / FPS).toFixed(2)}s gap`, "ripple delete", () => {
    if (gapClipId) clips = clips.filter((c) => c.id !== gapClipId);
    for (const id of ds) clips.find((c) => c.id === id).from -= len;
  });
}
function bridgeSeam() {
  if (!gapHover) return;
  const { trId, f0, f1, gapClipId } = gapHover;
  const pair = seamNeighbors(trId, f0, f1);
  removeGapChip();
  if (!pair) return;
  sndTick();
  commit(`Bridged ${pair.head.name} — plays through`, "split → flow", () => {
    pair.head.dur = pair.tail.from + pair.tail.dur - pair.head.from;
    pair.head.srcLen = Math.max(pair.head.srcLen, pair.head.srcIn + pair.head.dur);
    for (const ch of clips) if (ch.parentId === pair.tail.id) ch.parentId = pair.head.id;
    clips = clips.filter((c) => c.id !== pair.tail.id && c.id !== gapClipId);
  });
}

/* ============ playback + monitor + rAF ============ */
const monFill = document.getElementById("monFill");
const monName = document.getElementById("monName");
const monTag = document.getElementById("monTag");
const monCaption = document.getElementById("monCaption");
const monTc = document.getElementById("monTc");
const monSub = document.getElementById("monSub");
const beatDot = document.getElementById("beatDot");
const tcEl = document.getElementById("tc");

let lastT = 0, lastBeat = -1, skimFrame = null;
function tickLoop(t) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (playing) {
    playhead += playing * FPS * dt;
    if (playhead >= render.to) { playhead = render.to; setPlaying(0); }
    if (playhead < axisStart) playhead = axisStart;
    positionPlayhead(); followPlayhead(); updateMonitor(); drawMinimap();
    const b = Math.floor((playhead - 0) / BEAT_STEP);
    if (b !== lastBeat) { lastBeat = b; beatDot.classList.add("hit"); setTimeout(() => beatDot.classList.remove("hit"), 90); }
  }
  requestAnimationFrame(tickLoop);
}
function followPlayhead() {
  const x = LABEL_W + xOf(playhead) - scroller.scrollLeft;
  if (x > scroller.clientWidth * 0.92) scroller.scrollTo({ left: LABEL_W + xOf(playhead) - scroller.clientWidth * 0.18, behavior: "smooth" });
}
function setPlaying(rate) {
  playing = rate;
  document.getElementById("tPlay").textContent = rate ? "⏸" : "▶";
  if (rate) { hideLoupe(); hideHud(); }
}
/* the composite is ordered: layers top→bottom, then z top→bottom within each —
   the topmost clip under the playhead is what's visible (idea 22) */
function topAt(f, kind) {
  for (const tr of layerOrder()) {
    if (tr.kind !== kind) continue;
    for (const c of zTopToBottom(tr.id)) {
      if (c.gap) continue;
      const l = liveClip(c);
      if (f >= l.from && f < l.from + l.dur) return c;
    }
  }
  return null;
}
const sceneAt = (f) => topAt(f, "scenes");
const overlayAt = (f) => topAt(f, "overlay");
function updateMonitor(previewFrame = null) {
  const f = previewFrame ?? (skimFrame ?? playhead);
  const sc = sceneAt(f);
  let frozen = false;
  if (sc) {
    const t = TONES[sc.tone];
    const live = liveClip(sc);
    const rawSrc = Math.round(f - live.from + live.srcIn);
    const srcF = clamp(rawSrc, 0, Math.max(0, Math.round(sc.srcLen) - 1));   // a hold shows the frozen frame
    frozen = sc.srcLen < 900 ? rawSrc !== srcF : rawSrc < 0;
    monFill.style.background = `linear-gradient(135deg, hsl(${t.hue} 45% 26%), hsl(${t.hue} 52% 12%) 70%)`;
    monName.textContent = sc.name;
    monSub.textContent = `frame ${Math.round(f)} · src ${srcF}f${frozen ? " · hold" : ""} · ${FPS}fps`;
  } else {
    monFill.style.background = "#08090c";
    monName.textContent = "—";
    monSub.textContent = `frame ${Math.round(f)} · ${FPS}fps`;
  }
  monTag.textContent = previewFrame != null && G
    ? (G.kind === "trim" ? `${G.edge === "r" ? "OUT" : "IN"} PREVIEW${frozen ? " · ❚❚ HOLD" : ""}` : "")
    : skimFrame != null ? "SKIM" : "";
  const ov = overlayAt(f);
  monCaption.textContent = ov?.caption ?? "";
  monTc.innerHTML = `${secs(f)}<small>s</small>`;
  tcEl.textContent = `${secs(playhead)}s · ${Math.round(playhead)}f`;
}

/* ---- skimming (idea 17) ---- */
scroller.addEventListener("pointermove", (e) => {
  updateRollHandles(e);
  updateGapChip(e);
  updateCutLine(e);
  updateCutZone(e);
  updatePhCluster(e);
  updateHint(e);
  if (!has("skim") || !skimOn || G || playing || !e.target.closest(".ruler")) {
    if (skimFrame != null && !G) { skimFrame = null; skimEl.hidden = true; updateMonitor(); }
    return;
  }
  skimFrame = frameAt(e.clientX);
  skimEl.hidden = false;
  skimEl.style.left = `${LABEL_W + xOf(skimFrame)}px`;
  skimEl.querySelector(".skim-tc").textContent = fmtT(skimFrame);
  updateMonitor();
});
scroller.addEventListener("pointerleave", () => { if (skimFrame != null) { skimFrame = null; skimEl.hidden = true; updateMonitor(); } });

/* ---- contextual hints (statusbar) ---- */
const hintEl = document.getElementById("hint");
function defaultHint() {
  const bits = ["Drag clips", "edges trim"];
  if (has("roll")) bits.push("hover junctions to roll");
  if (has("wedge")) bits.push("＋ at a junction opens time");
  if (has("blade")) bits.push("the ✂ strip cuts");
  if (has("layers")) bits.push("⌘[ ⌘] restack");
  if (has("fine")) bits.push("pull away mid-drag for fine control");
  bits.push(", . nudge", "[ ] trim to playhead");
  return `${bits.join(" · ")} — keys are shortcuts, not requirements`;
}
function updateHint(e) {
  let h = "";
  const fineBit = has("fine") ? " · pull away or ⇧ for fine" : "";
  const snapBit = anySnap() ? " · ⌥ no snap" : "";
  if (tool === "blade") h = "BLADE — click a clip to cut · ⇧-click cuts every track · snaps to the playhead · Esc exits (or just use the ✂ strip, no mode needed)";
  else if (tool === "wedge") h = "＋TIME — drag right anywhere to insert time, left to remove · locked tracks stay · Esc exits (or just drag a ✂ strip / junction ＋)";
  else if (e.target.closest(".junction-add")) h = "＋ at the junction — click inserts 0.5s · drag right for more · drag left removes time";
  else if (e.target.closest(".roll-handle")) h = "Roll the junction — one clip grows, the neighbor shrinks, downstream stays put";
  else if (e.target.closest(".slip-pill")) h = "Drag ⇄ to slip the source — in/out stay put, the filmstrip slides";
  else if (e.target.closest(".trim-handle")) h = `Drag to trim — upper half plain, lower half ripples (magnetic always ripples)${has("hold") ? " · past the footage = hold frame" : ""}${fineBit}${snapBit}`;
  else if (e.target.closest(".ph-cluster")) h = "Playhead cluster — hover a button to preview exactly what it will do, click to apply";
  else if (e.target.closest(".clip.gap-clip")) h = "Gap clip — trim it, × closes, ≈ bridges the halves back into one flowing clip";
  else if (e.target.closest(".clip")) {
    const c = clips.find((c) => c.id === e.target.closest(".clip").dataset.id);
    const tr = c && trackById(c.trackId);
    const slipBit = has("slip") ? " · ⇄ pill or ⌥-drag slips" : "";
    const cutBit = has("blade") ? " · ✂ strip cuts — drag it to open time" : "";
    const stackBit = has("layers") && tr && !tr.magnetic ? " · overlaps stack — drag ↑↓ or ⌘[ ⌘]" : "";
    h = tr?.magnetic ? `Drag to reorder the storyline · edges ripple-trim${slipBit}${fineBit}${cutBit}`
      : `Drag to move${fineBit}${snapBit}${slipBit}${stackBit} · edges trim (lower half ripples)${cutBit}`;
  }
  else if (e.target.closest(".lane-label")?.dataset.layer) h = "Layer — drag ↑↓ to reorder the composite · upper layers cover lower";
  else if (e.target.closest(".ruler")) h = `Click / drag to scrub${has("fine") ? " · pull down for fine + loupe" : ""}${has("skim") ? " · hover skims" : ""}${PAGE.markers ? " · double-click adds a marker, markers drag" : ""} · park near the playhead for ⇤ ✂ ⇥`;
  else if (e.target.closest(".minimap")) h = "Minimap — drag the window to pan · drag its edges to zoom · click to jump";
  else h = defaultHint();
  if (hintEl.textContent !== h) hintEl.textContent = h;
}

/* ============ minimap (idea 15) ============ */
const mmCanvas = document.getElementById("mmCanvas");
function drawMinimap() {
  if (!has("minimap")) return;
  const w = mmCanvas.clientWidth || mmCanvas.parentElement.clientWidth;
  const h = 33;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (mmCanvas.width !== Math.round(w * dpr)) { mmCanvas.width = Math.round(w * dpr); mmCanvas.height = Math.round(h * dpr); }
  const ctx = mmCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const mx = (f) => ((f - axisStart) / axisLen()) * w;
  ctx.fillStyle = "rgb(240 180 95 / 7%)";
  ctx.fillRect(mx(render.from), 0, mx(render.to) - mx(render.from), h);
  const order = layerOrder();
  const step = order.length > 1 ? Math.min(8, 22 / (order.length - 1)) : 0;
  const yFor = new Map(order.map((t, i) => [t.id, 4 + i * step]));
  for (const c of clips) {
    const live = liveClip(c);
    const t = TONES[c.tone];
    ctx.fillStyle = c.gap ? "rgb(240 180 95 / 25%)" : `hsl(${t.hue} 55% 55% / .75)`;
    ctx.fillRect(mx(live.from), yFor.get(c.trackId) ?? 16, Math.max(1.5, (live.dur / axisLen()) * w), trackById(c.trackId)?.kind === "scenes" ? 6 : 3);
  }
  for (const m of markers) { ctx.fillStyle = "#d5a9e8"; ctx.fillRect(mx(m.frame), 2, 1.5, 6); }
  ctx.fillStyle = "#f0b45f";
  ctx.fillRect(mx(playhead), 0, 1.5, h);
  const v0 = (scroller.scrollLeft / (axisLen() * ppf)) * w;
  const v1 = (((scroller.scrollLeft + scroller.clientWidth - LABEL_W)) / (axisLen() * ppf)) * w;
  ctx.strokeStyle = "rgb(232 235 242 / 45%)"; ctx.lineWidth = 1;
  ctx.fillStyle = "rgb(232 235 242 / 5%)";
  ctx.beginPath(); ctx.roundRect(v0 + 0.5, 0.5, Math.min(w, v1 - v0) - 1, h - 1, 3); ctx.fill(); ctx.stroke();
  mmView = { v0, v1, w };
}
let mmView = { v0: 0, v1: 0, w: 1 };
const minimapEl = document.querySelector(".minimap");
minimapEl.addEventListener("pointerdown", (e) => {
  const rect = mmCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const edge = Math.abs(x - mmView.v0) < 5 ? "l" : Math.abs(x - mmView.v1) < 5 ? "r" : null;
  const inside = x > mmView.v0 && x < mmView.v1;
  const mode = edge ?? (inside ? "pan" : "jump");
  const startSL = scroller.scrollLeft;
  const fAt = (px) => axisStart + (px / mmView.w) * axisLen();
  if (mode === "jump") {
    const f = fAt(x);
    scroller.scrollTo({ left: xOf(f) + LABEL_W - scroller.clientWidth / 2, behavior: "smooth" });
    return;
  }
  const move = (ev) => {
    const dx = ev.clientX - e.clientX;
    if (mode === "pan") { scroller.scrollLeft = startSL + (dx / mmView.w) * axisLen() * ppf; drawMinimap(); return; }
    const anchorF = mode === "l" ? fAt(mmView.v1) : fAt(mmView.v0);
    const otherF = fAt((mode === "l" ? mmView.v0 : mmView.v1) + dx);
    const span = Math.max(12, Math.abs(anchorF - otherF));
    userPpf = clamp((scroller.clientWidth - LABEL_W) / span, fitPpf(), MAX_PPF);
    resolvePpf(); rebuild();
    scroller.scrollLeft = xOf(Math.min(anchorF, otherF));
  };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
});
scroller.addEventListener("scroll", () => { if (!G) { drawMinimap(); updateSelBar(); } });

/* ============ toasts + project line ============ */
const toastsEl = document.getElementById("toasts");
function toast(label, sub) {
  const t = el("div", "toast", toastsEl);
  t.innerHTML = `<b>${label}</b>${sub ? `<small>${sub}</small>` : ""}`;
  setTimeout(() => { t.classList.add("fade"); setTimeout(() => t.remove(), 320); }, 2400);
  while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
}
function updateProj() {
  const n = clips.filter((c) => !c.gap).length;
  const sel = selection.size ? ` · ${selection.size} selected` : "";
  document.getElementById("proj").textContent =
    `${n} clips · ${FPS}fps · out ${fmtT(render.to - render.from)} · zoom ${Math.round((ppf / fitPpf()) * 100)}%${sel}`;
}

/* ============ tools / chips / magnet ============ */
/* modes survive only as keyboard accelerators (B/R for repeated cuts/inserts) — no UI requires them */
function setTool(next) {
  tool = tool === next ? "select" : next;
  document.getElementById("toolSelect")?.classList.toggle("active", tool === "select");
  document.getElementById("toolBlade")?.classList.toggle("active", tool === "blade");
  document.getElementById("toolWedge")?.classList.toggle("active", tool === "wedge");
  document.body.classList.toggle("mode-blade", tool === "blade");
  document.body.classList.toggle("mode-wedge", tool === "wedge");
  const banner = document.getElementById("banner");
  if (tool === "blade") { banner.hidden = false; banner.textContent = "BLADE — click cuts · ⇧-click cuts all tracks · Esc exits"; }
  else if (tool === "wedge") { banner.hidden = false; banner.textContent = "＋TIME — drag right to insert · drag left to remove · Esc exits"; }
  else banner.hidden = true;
  if (tool !== "blade") { cutLineEl?.remove(); cutLineEl = null; clearCutTints(); }
}
function toggleMagnet(tr) {
  if (tr.magnetic) { tr.magnetic = false; rebuild(); toast("SCENES set free — gaps and overlaps allowed", "⌁ repacks"); return; }
  commit("SCENES magnetic — storyline repacked", "no gaps, no overlaps", () => {
    tr.magnetic = true;
    const tcs = clips.filter((c) => c.trackId === tr.id && !c.gap).sort((a, b) => a.from - b.from);
    for (const gcl of clips) if (gcl.trackId === tr.id && gcl.gap) zUnlink(gcl);
    clips = clips.filter((c) => !(c.trackId === tr.id && c.gap));
    let at = Math.min(...tcs.map((c) => c.from));
    for (const c of tcs) { c.from = at; at += c.dur; }
  });
}

/* ============ keyboard ============ */
function nudge(d) {
  const sel = clips.filter((c) => selection.has(c.id) && !trackById(c.trackId).magnetic);
  if (!sel.length) return toast("Select a clip on a free track to nudge", "magnetic clips ride the storyline");
  commit(`Nudged ${sel.length > 1 ? `${sel.length} clips` : sel[0].name} ${fmtD(d)}`, null, () => {
    for (const c of sel) c.from += d;
  }, { coalesce: "nudge" });
  updateSelBar();
}
function trimToPlayhead(edge) {
  const ph = Math.round(playhead);
  const sel = clips.filter((c) => selection.has(c.id) && ph > c.from && ph < c.from + c.dur);
  if (!sel.length) return toast("Park the playhead inside a selected clip first");
  trimClipsToPlayhead(sel, edge);
}
function trimClipsToPlayhead(sel, edge) {
  const ph = Math.round(playhead);
  commit(`Trimmed ${sel.length > 1 ? `${sel.length} clips` : sel[0].name} ${edge === "l" ? "in" : "out"} to playhead`, null, () => {
    for (const c of sel) {
      const tr = trackById(c.trackId);
      const d = edge === "l" ? ph - c.from : c.from + c.dur - ph;
      if (edge === "l") {
        if (tr.magnetic) {
          c.dur -= d; c.srcIn += d;
          for (const o of clips) if (o.trackId === c.trackId && o.from > c.from) o.from -= d;
        } else { c.from = ph; c.dur -= d; c.srcIn += d; }
      } else {
        c.dur -= d;
        if (tr.magnetic) for (const o of clips) if (o.trackId === c.trackId && o.from > c.from) o.from -= d;
      }
    }
  });
}
function deleteSelection() {
  const sel = clips.filter((c) => selection.has(c.id));
  if (!sel.length) return;
  sndWhoosh();
  commit(`Deleted ${sel.length > 1 ? `${sel.length} clips` : sel[0].gap ? "gap" : sel[0].name}`, "magnetic tracks close up", () => {
    for (const c of sel) {
      const tr = trackById(c.trackId);
      zUnlink(c);
      clips = clips.filter((x) => x.id !== c.id);
      if (tr.magnetic) for (const o of clips) if (o.trackId === c.trackId && o.from > c.from) o.from -= c.dur;
      for (const o of clips) if (o.parentId === c.id) o.parentId = null;
    }
    selection = new Set();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.target instanceof Element && e.target.matches("input, textarea, select")) return;
  const k = e.key;
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (cmd && k.toLowerCase() === "a") { e.preventDefault(); selection = new Set(clips.filter((c) => !c.gap).map((c) => c.id)); refreshSelection(); return; }
  if (cmd && (k === "[" || k === "]") && has("layers")) {           // idea 22: restack within the layer
    e.preventDefault();
    const sel = clips.filter((c) => selection.has(c.id));
    if (sel.length !== 1) { toast("Select one clip to restack", "⌘[ sends back · ⌘] brings forward"); return; }
    const c = sel[0], up = k === "]";
    const neighborId = up ? c.zNextId : c.zPrevId;
    if (!neighborId) { toast(`${c.name} is already at the ${up ? "top" : "bottom"} of its layer`); return; }
    const nb = byId(neighborId);
    sndTick();
    commit(`${c.name} ${up ? "over" : "under"} ${nb.name}`, "stacking order", () => zSwap(c, up));
    return;
  }
  if (cmd) return;
  switch (k) {
    case " ": e.preventDefault(); setPlaying(playing ? 0 : 1); break;
    case "j": case "J": setPlaying(playing < 0 ? Math.max(-8, playing * 2) : -1); break;
    case "k": case "K": setPlaying(0); break;
    case "l": case "L": setPlaying(playing > 0 ? Math.min(8, playing * 2) : 1); break;
    case "ArrowLeft": e.preventDefault(); playhead = Math.round(playhead) - (e.shiftKey ? 10 : 1); positionPlayhead(); updateMonitor(); drawMinimap(); break;
    case "ArrowRight": e.preventDefault(); playhead = Math.round(playhead) + (e.shiftKey ? 10 : 1); positionPlayhead(); updateMonitor(); drawMinimap(); break;
    case "Home": playhead = render.from; positionPlayhead(); updateMonitor(); drawMinimap(); break;
    case "End": playhead = render.to; positionPlayhead(); updateMonitor(); drawMinimap(); break;
    case ",": nudge(e.shiftKey ? -10 : -1); break;
    case ".": nudge(e.shiftKey ? 10 : 1); break;
    case "<": nudge(-10); break;
    case ">": nudge(10); break;
    case "[": trimToPlayhead("l"); break;
    case "]": trimToPlayhead("r"); break;
    case "b": case "B": if (has("blade")) setTool("blade"); break;
    case "r": case "R": if (has("wedge")) setTool("wedge"); break;
    case "v": case "V": setTool("select"); break;
    case "m": case "M": if (!PAGE.markers) break; commit(`Marker at ${fmtT(Math.round(playhead))}`, null, () => markers.push({ id: uid("m"), frame: Math.round(playhead), label: `m${markers.length + 1}` })); break;
    case "s": case "S": if (!has("skim")) break; skimOn = !skimOn; document.getElementById("chipSkim")?.classList.toggle("on", skimOn); toast(skimOn ? "Skimming on — hover the ruler" : "Skimming off"); break;
    case "z": case "Z": zoomSelection(); break;
    case "f": case "F": zoomFit(); break;
    case "i": case "I": commit(`Output starts at ${fmtT(Math.round(playhead))}`, null, () => { render.from = Math.min(Math.round(playhead), render.to - 1); }); break;
    case "o": case "O": commit(`Output ends at ${fmtT(Math.round(playhead))}`, null, () => { render.to = Math.max(Math.round(playhead), render.from + 1); }); break;
    case "Backspace": case "Delete": e.preventDefault(); deleteSelection(); break;
    case "Escape":
      if (tool !== "select") setTool("select");
      else if (!document.getElementById("keysOverlay").hidden) document.getElementById("keysOverlay").hidden = true;
      else { selection = new Set(); refreshSelection(); }
      break;
    case "?": document.getElementById("keysOverlay").hidden = !document.getElementById("keysOverlay").hidden; break;
  }
});

/* double-click: marker on the ruler — add on empty, delete on a marker */
tlCanvas.addEventListener("dblclick", (e) => {
  const m = e.target.closest(".marker");
  if (m) {
    const mk = markers.find((x) => x.id === m.dataset.id);
    commit(`Deleted marker ${mk.label}`, null, () => { markers = markers.filter((x) => x.id !== mk.id); });
    return;
  }
  if (e.target.closest(".ruler")) {
    const f = Math.round(frameAt(e.clientX));
    commit(`Marker at ${fmtT(f)}`, "double-click a marker to delete it", () => markers.push({ id: uid("m"), frame: f, label: `m${markers.length + 1}` }));
  }
});

/* right-click: the pointer-native catch-all */
let ctxMenu = null;
function closeCtxMenu() { ctxMenu?.remove(); ctxMenu = null; }
tlCanvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  closeCtxMenu();
  const items = [];
  const clipEl = e.target.closest(".clip");
  const c = clipEl && clips.find((x) => x.id === clipEl.dataset.id);
  const f = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e));
  if (c && !c.gap) {
    items.push([`✂ Split ${c.name} here`, () => cutAt([c], f)]);
    items.push(["✂ Split all tracks here", () => cutAt(clips.filter((x) => !x.gap), f)]);
    items.push(["⧉ Open 0.5s here", () => commitWedge(f, BEAT_STEP, ripplePlan(f))]);
    items.push([`× Delete ${c.name}`, () => { selection = new Set([c.id]); deleteSelection(); }]);
  } else if (c?.gap) {
    if (seamNeighbors(c.trackId, c.from, c.from + c.dur))
      items.push(["≈ Bridge — play through", () => { gapHover = { trId: c.trackId, f0: c.from, f1: c.from + c.dur, gapClipId: c.id }; bridgeSeam(); }]);
    items.push(["× Close gap", () => { gapHover = { trId: c.trackId, f0: c.from, f1: c.from + c.dur, gapClipId: c.id }; closeGap(); }]);
  } else if (e.target.closest(".ruler")) {
    items.push([`◆ Marker at ${fmtT(f)}`, () => commit(`Marker at ${fmtT(f)}`, null, () => markers.push({ id: uid("m"), frame: f, label: `m${markers.length + 1}` }))]);
    items.push(["⧉ Open 0.5s here", () => commitWedge(f, BEAT_STEP, ripplePlan(f))]);
  } else {
    items.push(["⧉ Open 0.5s here", () => commitWedge(f, BEAT_STEP, ripplePlan(f))]);
    items.push(["Fit timeline", zoomFit]);
  }
  ctxMenu = el("div", "ctx-menu", document.body);
  for (const [label, fn] of items) {
    const b = el("button", "", ctxMenu);
    b.textContent = label;
    b.onclick = () => { closeCtxMenu(); fn(); };
  }
  ctxMenu.style.left = `${Math.min(e.clientX, innerWidth - 200)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, innerHeight - items.length * 32 - 14)}px`;
});
window.addEventListener("pointerdown", (e) => { if (ctxMenu && !e.target.closest?.(".ctx-menu")) closeCtxMenu(); }, true);

/* wheel zoom (⌘/Ctrl) — studio convention, anchored at cursor (idea 16) */
scroller.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(ppf * Math.exp(-e.deltaY * 0.0024), e.clientX);
}, { passive: false });

/* ============ topbar wiring ============ */
function stepFrames(d) { playhead = Math.round(playhead) + d; positionPlayhead(); updateMonitor(); drawMinimap(); }
const holdRepeat = (id, fn) => {
  const b = document.getElementById(id);
  if (!b) return;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fn();
    const iv = setInterval(fn, 110);
    window.addEventListener("pointerup", () => clearInterval(iv), { once: true });
  });
};
document.getElementById("tPlay").onclick = () => setPlaying(playing ? 0 : 1);
document.getElementById("tHome").onclick = () => { playhead = render.from; positionPlayhead(); updateMonitor(); drawMinimap(); };
document.getElementById("toolSelect").onclick = () => setTool("select");
document.getElementById("toolBlade").onclick = () => setTool("blade");
document.getElementById("toolWedge").onclick = () => setTool("wedge");
document.getElementById("toolSelect").dataset.need = "blade wedge";
document.getElementById("toolBlade").dataset.need = "blade";
document.getElementById("toolWedge").dataset.need = "wedge";
document.getElementById("chipSnap").dataset.need = "snapEnds snapBeats";
document.getElementById("chipSkim").dataset.need = "skim";
holdRepeat("stepBack", () => stepFrames(-1));
holdRepeat("stepFwd", () => stepFrames(1));
document.getElementById("undoBtn").onclick = () => undo();
document.getElementById("redoBtn").onclick = () => redo();
document.getElementById("zIn").onclick = () => setZoom(ppf * 2);
document.getElementById("zOut").onclick = () => setZoom(ppf / 2);
document.getElementById("zFit").onclick = zoomFit;
document.getElementById("zSel").onclick = zoomSelection;
const chip = (id, get, set) => {
  const c = document.getElementById(id);
  c.onclick = () => { set(!get()); c.classList.toggle("on", get()); };
};
chip("chipSnap", () => snapOn, (v) => { snapOn = v; toast(v ? "Snapping on — hold ⌥ to bypass" : "Snapping off"); });
chip("chipSkim", () => skimOn, (v) => { skimOn = v; });
chip("chipSound", () => soundOn, (v) => { soundOn = v; if (v) sndTick(); });
document.getElementById("chipKeys").onclick = () => { const o = document.getElementById("keysOverlay"); o.hidden = !o.hidden; };
document.getElementById("keysClose").onclick = () => { document.getElementById("keysOverlay").hidden = true; };
document.getElementById("keysOverlay").addEventListener("click", (e) => { if (e.target.id === "keysOverlay") e.target.hidden = true; });

/* ideas drawer */
const drawer = document.getElementById("ideasDrawer");
document.getElementById("chipIdeas").onclick = () => { drawer.classList.toggle("hidden"); document.getElementById("chipIdeas").classList.toggle("on", !drawer.classList.contains("hidden")); };
document.getElementById("ideasClose").onclick = () => { drawer.classList.add("hidden"); document.getElementById("chipIdeas").classList.remove("on"); };
for (const idea of drawer.querySelectorAll(".idea")) {
  idea.addEventListener("mouseenter", () => {
    const n = idea.dataset.flash;
    document.querySelectorAll(`[data-idea~="${n}"]`).forEach((el) => el.classList.add("flash"));
  });
  idea.addEventListener("mouseleave", () => document.querySelectorAll(".flash").forEach((el) => el.classList.remove("flash")));
}

/* ============ single-feature page chrome ============ */
function applyPageChrome() {
  if (FEATURE === "lab") return;
  document.title = `FrameDiff · ${PAGE.label.charAt(0) + PAGE.label.slice(1).toLowerCase()}`;
  document.querySelector(".edition").textContent = `${PAGE.label} · PROTOTYPE`;
  if (!anySnap()) snapOn = false;
  if (!has("skim")) skimOn = false;
  // strip chrome whose capability is off (tools, chips, minimap, keys rows)
  document.querySelectorAll("[data-need]").forEach((n) => {
    if (n.dataset.need.split(" ").some((c) => (c === "markers" ? PAGE.markers : has(c)))) return;
    if (n.closest(".keys-grid")) n.nextElementSibling?.remove();
    n.remove();
  });
  if (!has("blade") && !has("wedge")) document.querySelector(".tools")?.remove();
  if (!has("minimap")) {
    document.querySelector(".minimap")?.remove();
    document.querySelector(".timeline").style.gridTemplateRows = "minmax(0, 1fr)";
  }
  // drawer: only this page's idea cards, plus routes back out
  const want = new Set(PAGE.ideas.map(String));
  const head = drawer.querySelector("header");
  head.childNodes[0].nodeValue = PAGE.ideas.length > 1 ? "THE IDEAS" : "THE IDEA";
  const scrollEl = drawer.querySelector(".ideas-scroll");
  scrollEl.querySelectorAll(".idea").forEach((n) => { if (!want.has(n.dataset.flash)) n.remove(); });
  scrollEl.querySelectorAll(".ig").forEach((g) => {
    let sib = g.nextElementSibling, live = false;
    while (sib && !sib.classList.contains("ig")) { if (sib.classList.contains("idea")) live = true; sib = sib.nextElementSibling; }
    if (!live) g.remove();
  });
  const more = el("div", "ideas-more", scrollEl);
  more.innerHTML = `<a href="./">the full lab — all 22 ideas together</a><a href="../">all single-feature prototypes</a>`;
  document.getElementById("hint").textContent = defaultHint();
}

/* idea 21: cycle generative takes in place — different durations ripple the storyline */
function cycleTake(c) {
  const next = (c.takes.cur + 1) % c.takes.list.length;
  const newDur = c.takes.list[next];
  const dDur = newDur - c.dur;
  sndTick();
  commit(`${c.name} → take ${next + 1} (${fmtT(newDur)})`, dDur ? "storyline rippled to fit" : null, () => {
    c.takes.cur = next;
    c.dur = newDur;
    c.srcLen = newDur + 120;
    c.badges = c.badges.map(([k, t]) => (k === "pinned" ? [k, `t${next + 1}`] : [k, t]));
    if (trackById(c.trackId).magnetic) {
      for (const o of clips) if (o.trackId === c.trackId && o.id !== c.id && o.from > c.from) o.from += dDur;
    }
  });
}

/* ============ init ============ */
seedProject();
applyPageConfig();
applyPageChrome();
recomputeAxis();
resolvePpf();
rebuild();
updateMonitor();
requestAnimationFrame(tickLoop);
window.addEventListener("resize", () => { resolvePpf(); rebuild(); });
