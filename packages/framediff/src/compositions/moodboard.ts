// Stock moodboard: the project owns a JSON data file (items + camera), the package owns
// the entire surface — big canvas, pan, wheel zoom, corner minimap with click/drag
// navigation, card dragging, in-place text editing. Every interaction writes the data
// file back through the dev filesystem, so board edits are reviewable JSON diffs.

import { defineComposition, type CompositionConfig, type CompositionSetupContext } from "../composition";
import { readSource, writeSource } from "../studio/devfs";

export interface MoodboardItem {
  id: string;
  type: "note" | "image" | "media" | "link";
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  /** note text, or the caption for image/media cards. */
  text?: string;
  /** image/media source (url or asset://). */
  src?: string;
  /** link target. */
  href?: string;
  alt?: string;
}

export interface MoodboardCamera { x: number; y: number; zoom: number }

export interface MoodboardData {
  camera: MoodboardCamera;
  items: MoodboardItem[];
}

export interface MoodboardOptions {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationInFrames?: number;
  /** Board space size. */
  boardWidth?: number;
  boardHeight?: number;
  title?: string;
  /** Project-relative JSON file edits are persisted to (omit for read-only boards). */
  dataFile?: string;
  /** Project-relative module registering this comp (data-fd-source). */
  file?: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

const esc = (input: string): string =>
  input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

export function defineMoodboardComposition(data: MoodboardData, options: MoodboardOptions = {}): CompositionConfig {
  const id = options.id ?? "Moodboard";
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const boardW = options.boardWidth ?? 3600;
  const boardH = options.boardHeight ?? 2000;
  const html = `<!doctype html><html><head><style>
 [data-fd-composition]{position:relative;overflow:hidden;background:#080d10;color:#f3f5f2;font-family:-apple-system,"SF Pro Display","Segoe UI",sans-serif}
 .fd-mb-world{position:absolute;left:0;top:0;width:${boardW}px;height:${boardH}px;transform-origin:0 0;user-select:none;
  background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:26px 26px;
  border:1px dashed rgba(255,255,255,.12);border-radius:18px;box-sizing:border-box}
 .fd-mb-item{position:absolute;left:0;top:0;width:250px;background:rgba(20,27,32,.97);border:1px solid rgba(255,255,255,.1);border-radius:11px;box-shadow:0 14px 34px rgba(0,0,0,.45);padding:13px;box-sizing:border-box;cursor:grab}
 .fd-mb-item.note{background:linear-gradient(180deg,#242012,#1c180d);border-color:rgba(255,209,102,.28)}
 .fd-mb-item.note p{margin:0;font-size:13px;line-height:1.55;color:#ffe9b3;outline:none}
 .fd-mb-item.image,.fd-mb-item.media{padding:0;overflow:hidden}
 .fd-mb-item img{display:block;width:100%;height:140px;object-fit:cover;pointer-events:none}
 .fd-mb-cap{padding:9px 12px;font-size:11.5px;font-weight:600;outline:none}
 .fd-mb-item [contenteditable]{user-select:text;cursor:text}
 .fd-mb-item.media .fd-mb-cap{padding:12px 12px 4px}
 .fd-mb-item.media audio,.fd-mb-item.media video{width:calc(100% - 24px);margin:4px 12px 12px;height:32px;filter:invert(.85) hue-rotate(160deg)}
 .fd-mb-item.link{cursor:grab}
 .fd-mb-item.link a{color:#79dbc8;font-size:12.5px;font-weight:600;text-decoration:none}
 .fd-mb-item.link small{display:block;font:9.5px ui-monospace;color:#a6b0b5;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .fd-mb-head{position:absolute;top:24px;left:32px;z-index:6;pointer-events:none}
 .fd-mb-head h1{font-size:23px;margin:0 0 2px}.fd-mb-head p{margin:0;font-size:11.5px;color:#a6b0b5}.fd-mb-head b{color:#f3f5f2}
 .fd-mb-mm{position:absolute;right:18px;bottom:18px;z-index:6;width:212px;height:132px;cursor:crosshair;
  background:rgba(7,10,13,.96);border:1px solid rgba(255,255,255,.16);border-radius:10px;overflow:hidden;contain:paint}
 .fd-mb-mm .lbl{position:absolute;left:8px;top:6px;font:700 8.5px ui-monospace;letter-spacing:.9px;color:#69d6c0;z-index:2;pointer-events:none}
 .fd-mb-mm i{position:absolute;background:rgba(121,219,200,.4);border:1px solid rgba(121,219,200,.7);border-radius:2px;pointer-events:none}
 .fd-mb-mm i.amber{background:rgba(255,209,102,.35);border-color:rgba(255,209,102,.65)}
 .fd-mb-mm b{position:absolute;border:1.5px solid #fff;border-radius:3px;box-shadow:0 0 0 999px rgba(0,0,0,.28);pointer-events:none}
</style></head><body>
<main data-fd-composition data-fd-id="${esc(id)}"${options.name ? ` data-fd-name="${esc(options.name)}"` : ""}
 data-fd-width="${width}" data-fd-height="${height}" data-fd-fps="${options.fps ?? 30}" data-fd-duration="${options.durationInFrames ?? 240}"
 data-fd-kind="moodboard" data-fd-interactive${options.file ? ` data-fd-source="${esc(options.file)}"` : ""}>
 <div class="fd-mb-world"></div>
 <header class="fd-mb-head"><h1>${esc(options.title ?? id)}</h1><p><b>Double-click text</b> to edit · <b>drag cards</b> · <b>drag the board</b> to pan · <b>scroll</b> to zoom · the minimap navigates.</p></header>
 <div class="fd-mb-mm"><span class="lbl">BOARD</span></div>
</main></body></html>
`;

  return defineComposition(html, {
    meta: { sourceFormat: "generated", file: options.file },
    setup: createMoodboardSetup(data, { width, height, dataFile: options.dataFile }),
  });
}

function createMoodboardSetup(
  data: MoodboardData,
  bounds: { width: number; height: number; dataFile?: string },
) {
  return async ({ root, query, queryAll, signal, onCleanup }: CompositionSetupContext) => {
    // The data file is the truth: read it live so persisted edits never have to reload
    // an imported module (which would remount the comp mid-gesture). The inline data
    // argument seeds first mount and non-dev contexts.
    if (bounds.dataFile) {
      try {
        const text = await readSource(bounds.dataFile);
        if (text) {
          const parsed = JSON.parse(text) as MoodboardData;
          if (Array.isArray(parsed.items)) { data.items = parsed.items; data.camera = parsed.camera ?? data.camera; }
        }
      } catch { /* keep the seeded data */ }
    }
    const world = query<HTMLDivElement>(".fd-mb-world")!;
    const minimap = query<HTMLDivElement>(".fd-mb-mm")!;
    const camera: MoodboardCamera = { x: data.camera.x, y: data.camera.y, zoom: data.camera.zoom || 1 };
    let mmFit: { minX: number; minY: number; s: number; ox: number; oy: number } | null = null;

    const renderItem = (item: MoodboardItem): HTMLElement => {
      const card = document.createElement("article");
      card.className = `fd-mb-item ${item.type}`;
      card.dataset.itemId = item.id;
      if (item.width) card.style.width = `${item.width}px`;
      if (item.type === "note") {
        const p = document.createElement("p");
        p.textContent = item.text ?? "";
        card.appendChild(p);
      } else if (item.type === "image") {
        const img = document.createElement("img");
        img.src = item.src ?? "";
        img.alt = item.alt ?? "";
        const cap = document.createElement("div");
        cap.className = "fd-mb-cap";
        cap.textContent = item.text ?? "";
        card.append(img, cap);
      } else if (item.type === "media") {
        const cap = document.createElement("div");
        cap.className = "fd-mb-cap";
        cap.textContent = item.text ?? "";
        const media = document.createElement(/\.(m4a|mp3|wav|ogg)(\?|$)/i.test(item.src ?? "") ? "audio" : "video") as HTMLMediaElement;
        media.src = item.src ?? "";
        media.controls = true;
        media.preload = "none";
        card.append(cap, media);
      } else {
        const link = document.createElement("a");
        link.href = item.href ?? "#";
        link.textContent = item.text ?? item.href ?? "";
        const small = document.createElement("small");
        small.textContent = (item.href ?? "").replace(/^https?:\/\//, "");
        card.append(link, small);
      }
      place(card, item);
      return card;
    };
    const place = (card: HTMLElement, item: MoodboardItem) => {
      card.style.transform = `translate(${item.x}px, ${item.y}px) rotate(${item.rotation ?? 0}deg)`;
    };
    world.replaceChildren(...data.items.map(renderItem));

    const applyCamera = () => {
      world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
      drawMinimap();
    };
    const previewScale = () => {
      const rect = root.getBoundingClientRect();
      return root.offsetWidth ? rect.width / root.offsetWidth : 1;
    };
    const toComp = (event: PointerEvent | WheelEvent) => {
      const rect = root.getBoundingClientRect();
      const scale = previewScale();
      return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
    };

    function drawMinimap() {
      const cards = queryAll<HTMLElement>(".fd-mb-item");
      if (!cards.length) return;
      const rects = cards.map((card) => {
        const item = data.items.find((entry) => entry.id === card.dataset.itemId);
        return { x: item?.x ?? 0, y: item?.y ?? 0, w: card.offsetWidth, h: card.offsetHeight, amber: card.classList.contains("note") };
      });
      const PAD = 90, MMW = 212, MMH = 132;
      // fit content AND the current viewport, so the view rectangle is always in frame
      const view = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: bounds.width / camera.zoom, h: bounds.height / camera.zoom };
      const boxes = [...rects, view];
      const minX = Math.min(...boxes.map((r) => r.x)) - PAD;
      const minY = Math.min(...boxes.map((r) => r.y)) - PAD;
      const maxX = Math.max(...boxes.map((r) => r.x + r.w)) + PAD;
      const maxY = Math.max(...boxes.map((r) => r.y + r.h)) + PAD;
      const s = Math.min(MMW / (maxX - minX), MMH / (maxY - minY));
      const ox = (MMW - (maxX - minX) * s) / 2, oy = (MMH - (maxY - minY) * s) / 2;
      mmFit = { minX, minY, s, ox, oy };
      const box = (r: { x: number; y: number; w: number; h: number }) =>
        `left:${(ox + (r.x - minX) * s).toFixed(1)}px;top:${(oy + (r.y - minY) * s).toFixed(1)}px;width:${Math.max(2, r.w * s).toFixed(1)}px;height:${Math.max(2, r.h * s).toFixed(1)}px`;
      minimap.innerHTML = '<span class="lbl">BOARD</span>'
        + rects.map((r) => `<i${r.amber ? ' class="amber"' : ""} style="${box(r)}"></i>`).join("")
        + `<b style="${box(view)}"></b>`;
    }

    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      if (!bounds.dataFile) return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        void writeSource(bounds.dataFile!, `${JSON.stringify({ camera, items: data.items }, null, 2)}\n`);
      }, 600);
    };

    const navigateMinimap = (event: PointerEvent) => {
      if (!mmFit) return;
      const rect = minimap.getBoundingClientRect();
      const scale = previewScale();
      const mx = (event.clientX - rect.left) / scale;
      const my = (event.clientY - rect.top) / scale;
      const bx = mmFit.minX + (mx - mmFit.ox) / mmFit.s;
      const by = mmFit.minY + (my - mmFit.oy) / mmFit.s;
      camera.x = bounds.width / 2 - bx * camera.zoom;
      camera.y = bounds.height / 2 - by * camera.zoom;
      applyCamera();
    };

    type Drag =
      | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
      | { kind: "item"; item: MoodboardItem; card: HTMLElement; startX: number; startY: number; itemX: number; itemY: number }
      | { kind: "minimap" };
    let drag: Drag | null = null;
    // Presses arm a gesture but nothing moves until the pointer travels past the slop,
    // so plain clicks (and double-clicks, which text editing depends on) pass through
    // untouched instead of becoming zero-length drags.
    let pending: { startX: number; startY: number; card?: HTMLElement; item?: MoodboardItem } | null = null;
    const SLOP = 4;

    root.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.closest("audio,video,a")) return;
      if (target.closest(".fd-mb-mm")) {
        drag = { kind: "minimap" };
        navigateMinimap(event);
        root.setPointerCapture(event.pointerId);
        return;
      }
      const point = toComp(event);
      const card = target.closest<HTMLElement>(".fd-mb-item") ?? undefined;
      const item = card ? data.items.find((entry) => entry.id === card.dataset.itemId) : undefined;
      pending = { startX: point.x, startY: point.y, card, item };
    }, { signal });

    root.addEventListener("pointermove", (event) => {
      if (!drag && pending) {
        const point = toComp(event);
        if (Math.hypot(point.x - pending.startX, point.y - pending.startY) > SLOP) {
          drag = pending.card && pending.item
            ? { kind: "item", item: pending.item, card: pending.card, startX: pending.startX, startY: pending.startY, itemX: pending.item.x, itemY: pending.item.y }
            : { kind: "pan", startX: pending.startX, startY: pending.startY, camX: camera.x, camY: camera.y };
          pending = null;
          root.setPointerCapture(event.pointerId);
        }
      }
      if (!drag) return;
      if (drag.kind === "minimap") return navigateMinimap(event);
      const point = toComp(event);
      if (drag.kind === "pan") {
        camera.x = drag.camX + (point.x - drag.startX);
        camera.y = drag.camY + (point.y - drag.startY);
        applyCamera();
      } else {
        drag.item.x = Math.round(drag.itemX + (point.x - drag.startX) / camera.zoom);
        drag.item.y = Math.round(drag.itemY + (point.y - drag.startY) / camera.zoom);
        place(drag.card, drag.item);
        drawMinimap();
      }
    }, { signal });

    root.addEventListener("pointerup", (event) => {
      pending = null;
      if (!drag) return;
      drag = null;
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
      persist();
    }, { signal });

    root.addEventListener("wheel", (event) => {
      event.preventDefault();
      const point = toComp(event);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * Math.exp(-event.deltaY * 0.0015)));
      // keep the board point under the cursor fixed while zooming
      camera.x = point.x - ((point.x - camera.x) / camera.zoom) * next;
      camera.y = point.y - ((point.y - camera.y) / camera.zoom) * next;
      camera.zoom = next;
      applyCamera();
      persist();
    }, { signal, passive: false });

    root.addEventListener("dblclick", (event) => {
      const editable = (event.target as HTMLElement).closest<HTMLElement>(".fd-mb-item.note p, .fd-mb-cap, .fd-mb-item.link a");
      if (!editable) return;
      const card = editable.closest<HTMLElement>(".fd-mb-item")!;
      const item = data.items.find((entry) => entry.id === card.dataset.itemId);
      if (!item) return;
      editable.contentEditable = "plaintext-only";
      editable.focus();
      // put the caret where the user double-clicked, not at position zero
      const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (caret) {
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(caret);
      }
      const finish = () => {
        editable.contentEditable = "false";
        item.text = editable.textContent ?? "";
        persist();
        drawMinimap();
      };
      editable.addEventListener("blur", finish, { once: true });
      editable.addEventListener("keydown", (key) => {
        key.stopPropagation();
        if (key.key === "Escape" || (key.key === "Enter" && !key.shiftKey)) editable.blur();
      }, { signal });
    }, { signal });

    applyCamera();
    // The first draw can run before the comp stylesheet lays cards out (unstyled cards
    // measure board-wide, which smears the minimap). Card sizes are observed, so the
    // minimap redraws as layout settles — and again whenever images load or cards grow.
    const sizeObserver = new ResizeObserver(() => drawMinimap());
    for (const card of queryAll<HTMLElement>(".fd-mb-item")) sizeObserver.observe(card);
    onCleanup(() => sizeObserver.disconnect());
    // Test/debug handle: lets integration tests drive the camera deterministically.
    (root as HTMLElement & { __fdMoodboard?: unknown }).__fdMoodboard = { camera, data, applyCamera };
    onCleanup(() => clearTimeout(persistTimer));
  };
}
