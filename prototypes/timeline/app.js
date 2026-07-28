/* FrameDiff · Timeline Lab — twenty timeline-editing ideas, holistically integrated.
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
const tracks = [
  { id: "ov",  label: "V2", name: "OVERLAY", kind: "overlay", h: 40, clipH: 26, clipTop: 7 },
  { id: "v1",  label: "V1", name: "SCENES",  kind: "scenes",  h: 62, clipH: 50, clipTop: 6, magnetic: true },
  { id: "sfx", label: "A1", name: "SFX",     kind: "sfx",     h: 34, clipH: 22, clipTop: 6 },
  { id: "mx",  label: "A2", name: "MUSIC",   kind: "music",   h: 50, clipH: 40, clipTop: 5, lockable: true, locked: false },
];
const trackById = (id) => tracks.find((t) => t.id === id);

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
}
let render = { from: 0, to: 690 };
let markers = [];
let motionKeys = [];
let motionTarget = "hero-title";

/* selection + tools + toggles */
let selection = new Set();
let tool = "select";           // select | blade | wedge
let snapOn = true, skimOn = true, soundOn = true;
let playing = 0;               // shuttle rate; 0 = paused
let playhead = 0;

/* ============ undo ============ */
const undoStack = [], redoStack = [];
const snapState = () => JSON.stringify({ clips, render, markers, motionKeys });
function loadState(s) {
  const o = JSON.parse(s);
  clips = o.clips; render = o.render; markers = o.markers; motionKeys = o.motionKeys;
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

/* commit transaction: undo snapshot → mutate → children ride parents → settle */
function commit(label, sub, fn) {
  pushUndo();
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
  for (const m of markers) T.push({ f: m.frame, label: `marker ${m.label}`, w: 1 });
  for (const k of motionKeys) T.push({ f: k.frame, label: "motion key", w: 0.9 });
  if (self) for (const c of clips) {
    if (excludeIds.has(c.id) || c.gap) continue;
    T.push({ f: c.from, label: `${c.name} in`, w: 1 }, { f: c.from + c.dur, label: `${c.name} out`, w: 1 });
  }
  if (beats) for (const b of beatFrames()) T.push({ f: b.f, label: b.down ? "downbeat" : "beat", w: b.down ? 0.85 : 0.7, beat: true });
  return T;
}
/* sticky snap: engages inside ENTER px, holds until EXIT px — the user's "sticky ends" */
function stickySnap(g, raw, targets, e) {
  if (!snapOn || e.altKey) { if (g.stuck) { g.stuck = null; hideGuide(); } return raw; }
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
/* one-shot snap without sounds/guides — for hover previews and gesture starts */
function quietSnap(raw, targets, e, px = 8) {
  if (!snapOn || e.altKey) return raw;
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
  for (const b of beatFrames()) {
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

  /* --- lanes --- */
  for (const tr of tracks) {
    const lane = el("div", `lane${tr.magnetic ? " is-magnetic" : ""}`, tlCanvas);
    lane.style.height = `${tr.h}px`;
    const label = el("div", "lane-label", lane);
    label.innerHTML = `<b>${tr.label}</b><span class="lane-kindname">${tr.name}</span>`;
    if (tr.kind === "scenes") {
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
    for (const c of clips) if (c.trackId === tr.id) trackEl.appendChild(buildClip(c, tr));
  }

  /* --- motion lane (GSAP keys, studio-style) --- */
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

  /* --- overlay furniture --- */
  connectStems();
  playheadEl = el("div", "playhead", tlCanvas);
  skimEl = el("div", "skim-ghost", tlCanvas); skimEl.hidden = true;
  el("div", "skim-tc", skimEl).className = "skim-tc";
  guideEl = el("div", "snap-guide", tlCanvas); guideEl.hidden = true;
  positionPlayhead();
  drawMinimap();
  updateProj();
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
    film.style.backgroundPositionX = `${-c.srcIn * 1.2}px`;
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
  if (!c.gap && c.srcLen < 900) {                                  // idea 3: hold-frame overrun
    const over = c.dur - (c.srcLen - c.srcIn);
    if (over > 0) {
      const o = el("i", "clip-overrun", b);
      o.dataset.idea = "3";
      o.style.left = `${(c.srcLen - c.srcIn) * ppf}px`;
      o.style.width = `${over * ppf}px`;
      o.title = "Past the source's end — the last frame holds";
    }
  }
  const hl = el("i", "trim-handle left", b); hl.dataset.gesture = "trim-l"; hl.dataset.idea = "1 2 9";
  const hr = el("i", "trim-handle right", b); hr.dataset.gesture = "trim-r"; hr.dataset.idea = "1 2 9";
  clipEls.set(c.id, b);
  return b;
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
    if (!c.parentId || c.trackId !== "ov") continue;
    const parent = clips.find((p) => p.id === c.parentId);
    if (!parent) continue;
    const s = el("div", "stem", tlCanvas);
    s.dataset.idea = "13";
    const ovTop = RULER_H + 7 + 26;
    s.style.left = `${LABEL_W + xOf(c.from) + 3}px`;
    s.style.top = `${ovTop}px`;
    s.style.height = `${RULER_H + 40 + 6 - ovTop + 0}px`;
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
      // media limit inside loupe (idea 3)
      if (!c.gap && c.srcLen < 900) {
        const limX = fx(live.from + (c.srcLen - live.srcIn));
        if (limX < fx(live.from + live.dur)) {
          ctx.strokeStyle = "rgb(244 242 236 / 55%)"; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(limX, y0); ctx.lineTo(limX, y0 + ch); ctx.stroke(); ctx.setLineDash([]);
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
  window.addEventListener("pointermove", onGestureMove);
  window.addEventListener("pointerup", onGestureEnd, { once: true });
  window.addEventListener("pointercancel", onGestureEnd, { once: true });
}
function gestureDelta(e) {
  autoPan(e);
  const gain = e.shiftKey ? FINE_GAIN : 1;               // idea 2: ⇧ = fine gearing
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
tlCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const t = e.target.closest("[data-gesture]");
  if (!t) return;
  const kind = t.dataset.gesture;
  activateAudio();
  if (kind === "ruler") return tool === "wedge" ? startWedge(e) : startScrub(e);
  if (kind === "marker") return startMarkerDrag(e, t.dataset.id);
  if (kind === "key") return startKeyDrag(e, t.dataset.id);
  if (kind === "rw-move" || kind === "rw-left" || kind === "rw-right") return startRw(e, kind);
  if (kind === "roll") return startRoll(e, t.dataset.a, t.dataset.b);
  if (kind === "trim-l" || kind === "trim-r") {
    const clip = clips.find((c) => c.id === t.closest(".clip").dataset.id);
    if (tool === "wedge") return startWedge(e);
    return startTrim(e, clip, kind === "trim-l" ? "l" : "r");
  }
  if (kind === "clip") {
    const clip = clips.find((c) => c.id === t.dataset.id);
    if (tool === "blade") return doBlade(e, clip);
    if (tool === "wedge") return startWedge(e);
    if (e.altKey && !clip.gap) return startSlip(e, clip);
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
  })[G.kind]?.(e);
  drawMinimap();
}
function onGestureEnd(e) {
  window.removeEventListener("pointermove", onGestureMove);
  const g = G;
  ({
    scrub: endScrub, marker: endMarker, key: endKey, rw: endRw, move: endMove,
    trim: endTrim, roll: endRoll, slip: endSlip, wedge: endWedge, marquee: endMarquee,
  })[g.kind]?.(e, g);
  G = null;
  hideHud(); hideLoupe(); hideGuide();
  document.querySelectorAll(".rippling, .parting").forEach((el) => { el.classList.remove("rippling", "parting"); el.style.transform = ""; });
  drawMinimap(); updateMonitor();
}

/* ---- scrub ---- */
function startScrub(e) {
  beginGesture(e, "scrub");
  moveScrub(e);
}
function moveScrub(e) {
  let f;
  if (e.shiftKey) {                                     // fine gearing applies to scrubbing too
    f = playhead + (e.clientX - G.lastX) * FINE_GAIN / ppf;
  } else {
    f = frameAt(e.clientX);
  }
  G.lastX = e.clientX;
  f = stickySnap(G, f, snapTargets(new Set(), { beats: true }), e);
  playhead = clamp(f, axisStart, axisEnd);
  positionPlayhead(); updateMonitor();
  if (e.shiftKey) showLoupe(playhead, G, e, { trackId: "v1" });
  else hideLoupe();
  showHud(e.clientX, e.clientY, `<b>${fmtT(playhead)}</b> · ${Math.round(playhead)}f${hudTarget(G)}`);
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
    el.style.left = `${xOf(nf)}px`;
  }
  for (const id of G.childIds) {
    const el = clipEls.get(id);
    el.classList.add("rippling");
    el.style.transform = `translateX(${applied * ppf}px)`;
    G.shift.set(id, applied);
  }
  moveStems();
  const n = G.ids.length > 1 ? `${G.ids.length} clips` : c.gap ? "gap" : c.name;
  showHud(e.clientX, e.clientY, `${n} · <b>${fmtD(applied)}</b> · in ${fmtT(from)}${hudTarget(G)}`);
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
  for (const id of g.ids) clipEls.get(id)?.classList.remove("dragging");
  if (!g.moved) return;
  const applied = (g.live.get(g.clip.id)?.from ?? g.clip.from) - g.base.get(g.clip.id);
  const d = Math.round(applied);
  if (!d) { rebuild(); return; }
  sndDrop();
  const idSet = new Set(g.ids);
  const roots = g.ids.filter((id) => !idSet.has(clips.find((c) => c.id === id)?.parentId));
  const n = g.ids.length > 1 ? `${g.ids.length} clips` : g.clip.gap ? "gap" : g.clip.name;
  commit(`Moved ${n} ${fmtD(d)}`, "⌘Z to undo", () => {
    for (const id of roots) { const c = clips.find((c) => c.id === id); c.from = g.base.get(id) + d; }
  });
}

/* magnetic reorder (idea 12): lift, neighbors part, drop inserts, pack springs */
function startMagneticMove(e, clip, tr) {
  beginGesture(e, "move", { clip, ids: [clip.id], magnetic: tr, base: new Map([[clip.id, clip.from]]), childIds: childrenOf([clip.id]) });
  G.order = clips.filter((c) => c.trackId === tr.id && c.id !== clip.id).sort((a, b) => a.from - b.from);
  G.origin = Math.min(...clips.filter((c) => c.trackId === tr.id).map((c) => c.from));
  G.caret = el("div", "caret", tlCanvas);
  G.caret.style.top = `${RULER_H + 40}px`; G.caret.style.height = `${trackById("v1").h}px`;
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
function startTrim(e, clip, edge) {
  e.stopPropagation();
  selection = new Set([clip.id]); refreshSelection();
  const tr = trackById(clip.trackId);
  const ripple = tr.magnetic || e.metaKey;
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
  let dd = 0;                                    // applied delta at the edge
  G.limit = false;
  if (edge === "r") {
    const out = stickySnap(G, base.from + base.dur + d, T, e);
    const dur = clamp(out - base.from, 1, 1e9);
    G.limit = dur === 1;
    dd = dur - base.dur;
    G.live.set(clip.id, { dur });
  } else if (!ripple) {
    // free head trim: the box edge follows the pointer (studio behavior)
    const raw = stickySnap(G, base.from + d, T, e);
    const inF = clamp(raw, base.from - base.srcIn, base.from + base.dur - 1);
    G.limit = inF !== raw && raw < inF;                 // red = out of media handles
    dd = inF - base.from;
    G.live.set(clip.id, { from: inF, dur: base.dur - dd, srcIn: base.srcIn + dd });
  } else {
    // ripple head trim: junction holds, the filmstrip is eaten, downstream closes in
    const eat = clamp(d, -base.srcIn, base.dur - 1);
    G.limit = d < -base.srcIn;
    dd = -eat;                                    // downstream shifts by -eat
    G.live.set(clip.id, { dur: base.dur - eat, srcIn: base.srcIn + eat });
  }
  clipEls.get(clip.id)?.querySelector(`.trim-handle.${edge === "r" ? "right" : "left"}`)?.classList.toggle("limit", G.limit);
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
  showHud(e.clientX, e.clientY,
    `${clip.gap ? "gap" : clip.name} ${label} <b>${fmtT(edgeF)}</b> · ${fmtT(base.dur)} → ${fmtT(live.dur)}${ripple ? " · <b>ripple</b>" : ""}${G.limit ? ' · <span style="color:#f07470">media limit</span>' : ""}${hudTarget(G)}`);
  showLoupe(edgeF, G, e, { trackId: clip.trackId });          // loupe always on for trims (idea 1)
  updateMonitor(Math.round(edge === "r" ? edgeF - 1 : edgeF));
}
function applyClipLive(c) {
  const live = liveClip(c);
  const el = clipEls.get(c.id);
  el.style.left = `${xOf(live.from)}px`;
  el.style.width = `${Math.max(3, live.dur * ppf)}px`;
  const film = el.querySelector(".clip-film");
  if (film) film.style.backgroundPositionX = `${-live.srcIn * 1.2}px`;
}
function endTrim(e, g) {
  if (!g.moved) return;
  const live = liveClip(g.clip);
  const dDur = Math.round(live.dur) - g.base.dur;
  if (!dDur && Math.round(live.from) === g.base.from) { rebuild(); return; }
  sndDrop();
  const rippleNote = g.ripple ? " (ripple)" : "";
  commit(`Trimmed ${g.clip.gap ? "gap" : g.clip.name} ${g.edge === "r" ? "out" : "in"} ${fmtD(g.edge === "r" ? dDur : -dDur)}${rippleNote}`, null, () => {
    g.clip.from = Math.round(live.from); g.clip.dur = Math.max(1, Math.round(live.dur)); g.clip.srcIn = Math.round(live.srcIn);
    // ripple: downstream shifts by the duration change, both edges (junction-fixed head trims included)
    if (g.ripple) for (const id of g.downstream) { const c = clips.find((c) => c.id === id); if (c) c.from += dDur; }
    if (g.clip.gap && g.clip.dur < 1) clips = clips.filter((c) => c.id !== g.clip.id);
  });
}

/* ---- roll at junctions (idea 10) ---- */
let rollHandleEl = null;
function updateRollHandles(e) {
  if (G || tool !== "select") { rollHandleEl?.remove(); rollHandleEl = null; return; }
  const trEl = e.target.closest?.(".lane-track");
  const trId = trEl?.dataset.track;
  if (!trId || trId === "motion") { rollHandleEl?.remove(); rollHandleEl = null; return; }
  const f = frameAt(e.clientX);
  const tcs = clips.filter((c) => c.trackId === trId).sort((a, b) => a.from - b.from);
  for (let i = 0; i < tcs.length - 1; i++) {
    const a = tcs[i], b = tcs[i + 1];
    if (Math.abs(a.from + a.dur - b.from) < 0.51 && Math.abs(f - b.from) * ppf < 7) {
      if (!rollHandleEl) rollHandleEl = el("div", "roll-handle", tlCanvas);
      const tr = trackById(trId);
      const laneTop = tlCanvas.querySelectorAll(".lane")[tracks.indexOf(tr) + 1].offsetTop;
      rollHandleEl.style.left = `${LABEL_W + xOf(b.from)}px`;
      rollHandleEl.style.top = `${laneTop + tr.clipTop}px`;
      rollHandleEl.style.height = `${tr.clipH}px`;
      rollHandleEl.textContent = "⟷";
      rollHandleEl.title = `Roll ${a.name} / ${b.name} — moves the boundary, downstream stays put`;
      rollHandleEl.dataset.gesture = "roll"; rollHandleEl.dataset.a = a.id; rollHandleEl.dataset.b = b.id;
      return;
    }
  }
  rollHandleEl?.remove(); rollHandleEl = null;
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
  showHud(e.clientX, e.clientY, `roll <b>${fmtD(d)}</b> · ${a.name} ${fmtT(base.aDur + d)} / ${b.name} ${fmtT(base.bDur - d)}${hudTarget(G)}`);
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
  if (clip.srcLen - clip.dur < 1) { toast(`${clip.name} has no slip headroom`); return; }
  selection = new Set([clip.id]); refreshSelection();
  beginGesture(e, "slip", { clip, base: clip.srcIn });
}
function moveSlip(e) {
  const d = gestureDelta(e);
  const c = G.clip;
  const srcIn = clamp(G.base - d, 0, Math.max(0, c.srcLen - c.dur));
  G.live.set(c.id, { srcIn });
  applyClipLive(c);
  showHud(e.clientX, e.clientY, `slip ${c.name} <b>${fmtD(G.base - srcIn)}</b> · src in ${fmtT(srcIn)}`);
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
  const movers = new Set();
  let maxPull = Infinity;
  for (const tr of tracks) {
    if (tr.locked) continue;
    // connected clips never decide for themselves and never block a pull — they ride their parent
    const tcs = clips.filter((c) => c.trackId === tr.id && !c.parentId).sort((a, b) => a.from - b.from);
    let blockEnd = -Infinity, first = Infinity, prevNonMover = null;
    for (const c of tcs) {
      if (c.from >= t0 - 1e-6) { movers.add(c.id); first = Math.min(first, c.from); }
      else { blockEnd = Math.max(blockEnd, c.from + c.dur); prevNonMover = c; }
    }
    if (first < Infinity) {
      if (tr.magnetic) maxPull = Math.min(maxPull, prevNonMover?.gap ? prevNonMover.dur : blockEnd === -Infinity ? 1e9 : 0);
      else maxPull = Math.min(maxPull, first - (blockEnd === -Infinity ? axisStart : blockEnd));
    }
  }
  for (const c of clips) if (c.parentId && movers.has(c.parentId)) movers.add(c.id);
  return { movers, maxPull: maxPull === Infinity ? 1e9 : Math.max(0, maxPull) };
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
  moveStems();
  showHud(e.clientX, e.clientY, `＋TIME at ${fmtT(t0)} · <b>${fmtD(delta)}</b> · ${plan.movers.size} clips ride${lockNote}${hudTarget(G)}`);
  if (e.shiftKey) showLoupe(t0 + delta, G, e, { trackId: "v1" });
}
function endWedge(e, g) {
  wedgeEl?.remove(); wedgeEl = null;
  markerEls.forEach((el) => (el.style.transform = ""));
  keyEls.forEach((el) => (el.style.transform = ""));
  const delta = Math.round(g.delta ?? 0);
  if (!g.moved || !delta) { positionRw(); return; }
  sndWhoosh();
  const label = delta > 0 ? `Inserted ${(delta / FPS).toFixed(2)}s at ${fmtT(g.t0)}` : `Removed ${(-delta / FPS).toFixed(2)}s at ${fmtT(g.t0)}`;
  commit(label, "everything downstream shifted", () => {
    for (const tr of tracks) {
      if (tr.locked) continue;
      if (tr.magnetic) {
        const tcs = clips.filter((c) => c.trackId === tr.id).sort((a, b) => a.from - b.from);
        const firstMover = tcs.find((c) => g.plan.movers.has(c.id));
        if (!firstMover) continue;
        if (delta > 0) {
          const before = tcs.filter((c) => !g.plan.movers.has(c.id));
          if (!before.length && firstMover.from >= g.t0 - 1e-6 && g.t0 < firstMover.from) {
            for (const c of tcs) c.from += delta;            // whole storyline slides
          } else {
            clips.push({ id: uid(), trackId: tr.id, name: "gap", gap: true, from: firstMover.from - 0.25, dur: delta, srcIn: 0, srcLen: 1e9, tone: "amber" });
            for (const c of tcs) if (g.plan.movers.has(c.id)) c.from += delta;
          }
        } else {
          const prev = tcs.filter((c) => !g.plan.movers.has(c.id)).pop();
          if (prev?.gap) { prev.dur += delta; if (prev.dur < 1) clips = clips.filter((c) => c.id !== prev.id); }
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
  const f = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e));
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
function doBlade(e, clip) {
  const f = Math.round(quietSnap(frameAt(e.clientX), snapTargets(new Set(), { self: false }), e));
  const targets = e.shiftKey ? clips.filter((c) => !c.gap && f > c.from + 1 && f < c.from + c.dur - 1)
    : clip && !clip.gap && f > clip.from + 1 && f < clip.from + clip.dur - 1 ? [clip] : [];
  if (!targets.length) return toast("Nothing to cut there");
  sndCut();
  commit(`Cut ${targets.length > 1 ? `${targets.length} clips` : targets[0].name} at ${fmtT(f)}`, "B again to keep cutting", () => {
    for (const c of targets) {
      const off = f - c.from;
      clips.push({ ...c, id: uid(), from: f, dur: c.dur - off, srcIn: c.srcIn + off, parentId: c.parentId, badges: undefined });
      c.dur = off;
    }
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
}

/* ---- gap chips (idea 8) ---- */
let gapChipEl = null, gapHover = null;
function updateGapChip(e) {
  if (G || tool !== "select") { removeGapChip(); return; }
  const trEl = e.target.closest?.(".lane-track");
  const trId = trEl?.dataset.track;
  if (!trId || trId === "motion" || e.target.closest(".clip")) { removeGapChip(); return; }
  const tr = trackById(trId);
  const f = frameAt(e.clientX);
  const tcs = clips.filter((c) => c.trackId === trId).sort((a, b) => a.from - b.from);
  let prev = null;
  for (const c of tcs) {
    if (c.from > f) {
      const g0 = prev ? prev.from + prev.dur : null;
      if (g0 !== null && f > g0 && c.from - g0 > 2) return showGapChip(trId, g0, c.from, e);
      break;
    }
    prev = c;
  }
  removeGapChip();
}
function showGapChip(trId, f0, f1, e) {
  const key = `${trId}:${Math.round(f0)}`;
  gapHover = { trId, f0, f1 };
  if (!gapChipEl) {
    gapChipEl = el("div", "gap-chip", tlCanvas);
    gapChipEl.innerHTML = `<span></span><button title="Close gap — everything after slides left">×</button>`;
    gapChipEl.querySelector("button").onpointerdown = (ev) => { ev.stopPropagation(); ev.preventDefault(); closeGap(); };
  }
  gapChipEl.dataset.key = key;
  gapChipEl.querySelector("span").textContent = `gap ${(Math.round(f1 - f0) / FPS).toFixed(2)}s`;
  const tr = trackById(trId);
  const laneEl = laneTracks.get(trId).parentElement;
  gapChipEl.style.left = `${LABEL_W + xOf((f0 + f1) / 2)}px`;
  gapChipEl.style.top = `${laneEl.offsetTop + tr.h / 2}px`;
}
function removeGapChip() { gapChipEl?.remove(); gapChipEl = null; gapHover = null; }
function closeGap() {
  if (!gapHover) return;
  const { trId, f0, f1 } = gapHover;
  const len = Math.round(f1 - f0);
  removeGapChip();
  sndWhoosh();
  const ds = clips.filter((c) => c.trackId === trId && c.from >= f1 - 0.5).map((c) => c.id);
  commit(`Closed ${(len / FPS).toFixed(2)}s gap`, "ripple delete", () => {
    for (const id of ds) clips.find((c) => c.id === id).from -= len;
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
function sceneAt(f) {
  for (const c of clips) if (c.trackId === "v1" && !c.gap) {
    const l = liveClip(c);
    if (f >= l.from && f < l.from + l.dur) return c;
  }
  return null;
}
function overlayAt(f) {
  for (const c of clips) if (c.trackId === "ov") {
    const l = liveClip(c);
    if (f >= l.from && f < l.from + l.dur) return c;
  }
  return null;
}
function updateMonitor(previewFrame = null) {
  const f = previewFrame ?? (skimFrame ?? playhead);
  const sc = sceneAt(f);
  if (sc) {
    const t = TONES[sc.tone];
    const srcF = Math.round(f - liveClip(sc).from + liveClip(sc).srcIn);
    monFill.style.background = `linear-gradient(135deg, hsl(${t.hue} 45% 26%), hsl(${t.hue} 52% 12%) 70%)`;
    monName.textContent = sc.name;
    monSub.textContent = `frame ${Math.round(f)} · src ${srcF}f · ${FPS}fps`;
  } else {
    monFill.style.background = "#08090c";
    monName.textContent = "—";
    monSub.textContent = `frame ${Math.round(f)} · ${FPS}fps`;
  }
  monTag.textContent = previewFrame != null && G ? (G.kind === "trim" ? (G.edge === "r" ? "OUT PREVIEW" : "IN PREVIEW") : "") : skimFrame != null ? "SKIM" : "";
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
  updateHint(e);
  if (!skimOn || G || playing || !e.target.closest(".ruler")) {
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
function updateHint(e) {
  let h = "";
  if (tool === "blade") h = "BLADE — click a clip to cut · ⇧-click cuts every track · snaps to beats & playhead · Esc to exit";
  else if (tool === "wedge") h = "＋TIME — drag right anywhere to insert time, left to remove · locked tracks stay · Esc to exit";
  else if (e.target.closest(".trim-handle")) h = "Drag to trim · magnetic track ripples downstream · ⌘-drag ripples on free tracks · ⇧ fine · ⌥ no snap";
  else if (e.target.closest(".roll-handle")) h = "Roll the junction — one clip grows, the neighbor shrinks, downstream stays put";
  else if (e.target.closest(".clip.gap-clip")) h = "Gap clip — trim its edges or ⌫ to close it (storyline repacks)";
  else if (e.target.closest(".clip")) {
    const c = clips.find((c) => c.id === e.target.closest(".clip").dataset.id);
    const tr = c && trackById(c.trackId);
    h = tr?.magnetic ? "Drag to reorder the storyline · edges ripple-trim · ⌥-drag slips the source · ⇧ fine"
      : "Drag to move (⇧ fine, ⌥ no snap) · ⌥-drag slips · edges trim · ⌘-edge ripple-trims";
  }
  else if (e.target.closest(".ruler")) h = "Click / drag to scrub · hover skims · ⇧-scrub for fine + loupe · markers drag, dbl-click deletes";
  else if (e.target.closest(".minimap")) h = "Minimap — drag the window to pan · drag its edges to zoom · click to jump";
  else h = "Drag clips · edges trim · hover junctions to roll · R opens time · B cuts · , . nudge · [ ] trim to playhead";
  if (hintEl.textContent !== h) hintEl.textContent = h;
}

/* ============ minimap (idea 15) ============ */
const mmCanvas = document.getElementById("mmCanvas");
function drawMinimap() {
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
  const rows = { ov: 5, v1: 12, sfx: 21, mx: 27 };
  for (const c of clips) {
    const live = liveClip(c);
    const t = TONES[c.tone];
    ctx.fillStyle = c.gap ? "rgb(240 180 95 / 25%)" : `hsl(${t.hue} 55% 55% / .75)`;
    ctx.fillRect(mx(live.from), rows[c.trackId] ?? 16, Math.max(1.5, (live.dur / axisLen()) * w), c.trackId === "v1" ? 6 : 3);
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
scroller.addEventListener("scroll", () => { if (!G) drawMinimap(); });

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
function setTool(next) {
  tool = tool === next ? "select" : next;
  document.getElementById("toolSelect").classList.toggle("active", tool === "select");
  document.getElementById("toolBlade").classList.toggle("active", tool === "blade");
  document.getElementById("toolWedge").classList.toggle("active", tool === "wedge");
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
  });
}
function trimToPlayhead(edge) {
  const ph = Math.round(playhead);
  const sel = clips.filter((c) => selection.has(c.id) && ph > c.from && ph < c.from + c.dur);
  if (!sel.length) return toast("Park the playhead inside a selected clip first");
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
    case "b": case "B": setTool("blade"); break;
    case "r": case "R": setTool("wedge"); break;
    case "v": case "V": setTool("select"); break;
    case "m": case "M": commit(`Marker at ${fmtT(Math.round(playhead))}`, null, () => markers.push({ id: uid("m"), frame: Math.round(playhead), label: `m${markers.length + 1}` })); break;
    case "s": case "S": skimOn = !skimOn; document.getElementById("chipSkim").classList.toggle("on", skimOn); toast(skimOn ? "Skimming on — hover the ruler" : "Skimming off"); break;
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

/* double-click: marker delete */
tlCanvas.addEventListener("dblclick", (e) => {
  const m = e.target.closest(".marker");
  if (m) {
    const mk = markers.find((x) => x.id === m.dataset.id);
    commit(`Deleted marker ${mk.label}`, null, () => { markers = markers.filter((x) => x.id !== mk.id); });
  }
});

/* wheel zoom (⌘/Ctrl) — studio convention, anchored at cursor (idea 16) */
scroller.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(ppf * Math.exp(-e.deltaY * 0.0024), e.clientX);
}, { passive: false });

/* ============ topbar wiring ============ */
document.getElementById("tPlay").onclick = () => setPlaying(playing ? 0 : 1);
document.getElementById("tHome").onclick = () => { playhead = render.from; positionPlayhead(); updateMonitor(); drawMinimap(); };
document.getElementById("toolSelect").onclick = () => setTool("select");
document.getElementById("toolBlade").onclick = () => setTool("blade");
document.getElementById("toolWedge").onclick = () => setTool("wedge");
document.getElementById("zIn").onclick = () => setZoom(ppf * 2);
document.getElementById("zOut").onclick = () => setZoom(ppf / 2);
document.getElementById("zFit").onclick = zoomFit;
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
recomputeAxis();
resolvePpf();
rebuild();
updateMonitor();
requestAnimationFrame(tickLoop);
window.addEventListener("resize", () => { resolvePpf(); rebuild(); });
