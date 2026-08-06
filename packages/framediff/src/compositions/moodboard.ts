// Stock moodboard: the project owns a JSON data file (items + camera), the package owns
// the entire surface — big canvas, pan, wheel zoom, corner minimap with click/drag
// navigation, card dragging, in-place text editing. Every interaction writes the data
// file back through the dev filesystem, so board edits are reviewable JSON diffs.

import { defineComposition, type CompositionConfig, type CompositionSetupContext } from "../composition";
import {
  FRAMEDIFF_ASSET_DRAG_MIME,
  parseFramediffAssetDragPayload,
  type FramediffAssetDragPayload,
} from "@framediff/studio-model";
import { getAssets, readSource, uploadAsset, writeSource } from "../studio/devfs";

export interface MoodboardItem {
  id: string;
  type: "note" | "image" | "media" | "link";
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  /** Visual height for image and video cards. */
  height?: number;
  /** note text, or the caption for image/media cards. */
  text?: string;
  /** image/media source (url or asset://). */
  src?: string;
  /** MIME type, retained so extensionless asset:// media renders correctly. */
  mime?: string;
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
  module?: string;
  exportName?: string;
  /** Keep the moodboard in the reusable project library. */
  library?: boolean;
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
 .fd-mb-item:hover{border-color:rgba(121,219,200,.36)}
 .fd-mb-item.note{background:linear-gradient(180deg,#242012,#1c180d);border-color:rgba(255,209,102,.28)}
 .fd-mb-item.note p{margin:0;font-size:13px;line-height:1.55;color:#ffe9b3;outline:none}
 .fd-mb-item.image,.fd-mb-item.media{padding:0;overflow:hidden}
 .fd-mb-item img{display:block;width:100%;height:140px;object-fit:cover;pointer-events:none}
 .fd-mb-cap{padding:9px 12px;font-size:11.5px;font-weight:600;outline:none}
 .fd-mb-item [contenteditable]{user-select:text;cursor:text}
 .fd-mb-item.media .fd-mb-cap{padding:12px 12px 4px}
 .fd-mb-item.media audio{width:calc(100% - 24px);margin:4px 12px 12px;height:32px;filter:invert(.85) hue-rotate(160deg)}
 .fd-mb-item.media video{display:block;width:calc(100% - 24px);height:150px;margin:6px 12px 12px;border-radius:7px;background:#05080a;object-fit:cover}
 .fd-mb-item.link{cursor:grab}
 .fd-mb-item.link a{color:#79dbc8;font-size:12.5px;font-weight:600;text-decoration:none}
 .fd-mb-item.link small{display:block;font:9.5px ui-monospace;color:#a6b0b5;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .fd-mb-remove{position:absolute;right:7px;top:7px;z-index:3;width:24px;height:24px;display:grid;place-items:center;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:50%;opacity:0;background:rgba(7,10,13,.88);color:#dbe2e1;cursor:pointer;transition:opacity .12s,border-color .12s}
 .fd-mb-item:hover .fd-mb-remove,.fd-mb-remove:focus{opacity:1}.fd-mb-remove:hover{border-color:#e06b62;color:#ffb5ae}
 .fd-mb-head{position:absolute;top:24px;left:32px;z-index:6;pointer-events:none}
 .fd-mb-head h1{font-size:23px;margin:0 0 2px}.fd-mb-head p{margin:0;font-size:11.5px;color:#a6b0b5}.fd-mb-head b{color:#f3f5f2}
 .fd-mb-tools{position:absolute;top:22px;right:24px;z-index:7;display:flex;gap:7px}
 .fd-mb-tools button{padding:7px 10px;border:1px solid rgba(255,255,255,.18);border-radius:7px;background:rgba(7,10,13,.9);color:#c7d1d2;font:700 9px ui-monospace;letter-spacing:.05em;cursor:pointer}
 .fd-mb-tools button:hover{border-color:rgba(121,219,200,.55);color:#79dbc8}
 [data-fd-composition]::after{content:"DROP MEDIA TO ADD TO BOARD";position:absolute;inset:14px;z-index:12;display:grid;place-items:center;border:2px dashed rgba(121,219,200,.68);border-radius:16px;opacity:0;background:rgba(6,14,16,.72);color:#aaf5e6;font:800 16px ui-monospace;letter-spacing:.12em;pointer-events:none;transition:opacity .12s}
 [data-fd-composition].fd-mb-drop::after{opacity:1}
 .fd-mb-mm{position:absolute;right:18px;bottom:18px;z-index:6;width:212px;height:132px;cursor:crosshair;
  background:rgba(7,10,13,.96);border:1px solid rgba(255,255,255,.16);border-radius:10px;overflow:hidden;contain:paint}
 .fd-mb-mm .lbl{position:absolute;left:8px;top:6px;font:700 8.5px ui-monospace;letter-spacing:.9px;color:#69d6c0;z-index:2;pointer-events:none}
 .fd-mb-mm i{position:absolute;background:rgba(121,219,200,.4);border:1px solid rgba(121,219,200,.7);border-radius:2px;pointer-events:none}
 .fd-mb-mm i.amber{background:rgba(255,209,102,.35);border-color:rgba(255,209,102,.65)}
 .fd-mb-mm b{position:absolute;border:1.5px solid #fff;border-radius:3px;box-shadow:0 0 0 999px rgba(0,0,0,.28);pointer-events:none}
</style></head><body>
<main data-fd-composition data-fd-id="${esc(id)}"${options.name ? ` data-fd-name="${esc(options.name)}"` : ""}
 data-fd-width="${width}" data-fd-height="${height}" data-fd-fps="${options.fps ?? 30}" data-fd-duration="${options.durationInFrames ?? 240}"
 data-fd-kind="board" data-fd-interactive${options.file ? ` data-fd-source="${esc(options.file)}"` : ""}>
 <div class="fd-mb-world"></div>
 <header class="fd-mb-head"><h1>${esc(options.title ?? id)}</h1><p><b>Drag media from the Media rail or Finder</b> · drag cards · drag empty space to pan · scroll to zoom.</p></header>
 <div class="fd-mb-tools"><button type="button" data-fd-mb-add-note>+ NOTE</button></div>
 <div class="fd-mb-mm"><span class="lbl">BOARD</span></div>
</main></body></html>
`;

  return defineComposition(html, {
    type: "moodboard",
    document: data,
    meta: {
      sourceFormat: "generated",
      file: options.file,
      module: options.module ?? options.file,
      exportName: options.exportName,
      library: options.library,
      output: "image",
      outputFrame: 0,
      authoring: { timeline: "hidden", transport: "hidden", directManipulation: true },
      ...(options.dataFile ? { document: { file: options.dataFile, hotUpdate: "patch" } } : {}),
    },
    setup: createMoodboardSetup(data, { width, height, dataFile: options.dataFile }),
  });
}

function createMoodboardSetup(
  data: MoodboardData,
  bounds: { width: number; height: number; dataFile?: string },
) {
  return async ({ root, query, queryAll, signal, onCleanup, onDocument, resolveAsset }: CompositionSetupContext) => {
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
    const manifest = await getAssets();
    const assetMetadata = manifest?.assets ?? {};
    const world = query<HTMLDivElement>(".fd-mb-world")!;
    const minimap = query<HTMLDivElement>(".fd-mb-mm")!;
    const addNoteButton = query<HTMLButtonElement>("[data-fd-mb-add-note]")!;
    const camera: MoodboardCamera = { x: data.camera.x, y: data.camera.y, zoom: data.camera.zoom || 1 };
    let mmFit: { minX: number; minY: number; s: number; ox: number; oy: number } | null = null;

    const assetOf = (src?: string) => src?.startsWith("asset://")
      ? assetMetadata[src.slice("asset://".length)]
      : undefined;
    const mimeOf = (item: MoodboardItem) => item.mime
      ?? assetOf(item.src)?.mime
      ?? (/\.([^.?#]+)(?:[?#]|$)/.exec(item.src ?? "")?.[1]?.toLowerCase() === "mp3" ? "audio/mpeg" : "");

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
        if (item.height) img.style.height = `${item.height}px`;
        img.alt = item.alt ?? "";
        const cap = document.createElement("div");
        cap.className = "fd-mb-cap";
        cap.textContent = item.text ?? assetOf(item.src)?.name ?? "";
        card.append(img, cap);
        if (item.src) void resolveAsset(item.src).then((url) => {
          if (!signal.aborted) img.src = url;
        });
      } else if (item.type === "media") {
        const cap = document.createElement("div");
        cap.className = "fd-mb-cap";
        cap.textContent = item.text ?? assetOf(item.src)?.name ?? "";
        const audio = mimeOf(item).startsWith("audio/") || /\.(m4a|mp3|wav|ogg)(\?|$)/i.test(item.src ?? "");
        const media = document.createElement(audio ? "audio" : "video") as HTMLMediaElement;
        card.classList.add(audio ? "audio" : "video");
        if (!audio && item.height) media.style.height = `${item.height}px`;
        media.controls = true;
        media.preload = audio ? "none" : "metadata";
        card.append(cap, media);
        if (item.src) void resolveAsset(item.src).then((url) => {
          if (!signal.aborted) media.src = url;
        });
      } else {
        const link = document.createElement("a");
        link.href = item.href ?? "#";
        link.textContent = item.text ?? item.href ?? "";
        const small = document.createElement("small");
        small.textContent = (item.href ?? "").replace(/^https?:\/\//, "");
        card.append(link, small);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "fd-mb-remove";
      remove.title = `Remove ${item.text ?? assetOf(item.src)?.name ?? item.id} from moodboard`;
      remove.ariaLabel = remove.title;
      remove.textContent = "×";
      remove.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        data.items = data.items.filter((entry) => entry.id !== item.id);
        renderCards();
        drawMinimap();
        persist();
      };
      card.appendChild(remove);
      place(card, item);
      return card;
    };
    const place = (card: HTMLElement, item: MoodboardItem) => {
      card.style.transform = `translate(${item.x}px, ${item.y}px) rotate(${item.rotation ?? 0}deg)`;
    };
    let sizeObserver: ResizeObserver | undefined;
    const renderCards = () => {
      sizeObserver?.disconnect();
      world.replaceChildren(...data.items.map(renderItem));
      if (sizeObserver) for (const card of queryAll<HTMLElement>(".fd-mb-item")) sizeObserver.observe(card);
    };
    renderCards();

    const applyCamera = () => {
      world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
      drawMinimap();
    };
    const previewScale = () => {
      const rect = root.getBoundingClientRect();
      return root.offsetWidth ? rect.width / root.offsetWidth : 1;
    };
    const toComp = (event: { clientX: number; clientY: number }) => {
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

    const uniqueItemId = (prefix: string) => {
      const base = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "asset";
      let id = base;
      let suffix = 2;
      while (data.items.some((item) => item.id === id)) id = `${base}-${suffix++}`;
      return id;
    };
    const boardPoint = (point: { x: number; y: number }) => ({
      x: (point.x - camera.x) / camera.zoom,
      y: (point.y - camera.y) / camera.zoom,
    });
    const addAsset = (asset: FramediffAssetDragPayload, point: { x: number; y: number }, offset = 0) => {
      if (!/^(image|video|audio)\//.test(asset.mime)) return;
      const image = asset.mime.startsWith("image/");
      const position = boardPoint(point);
      const width = image ? 360 : asset.mime.startsWith("video/") ? 340 : 300;
      data.items.push({
        id: uniqueItemId(`asset-${asset.id}`),
        type: image ? "image" : "media",
        x: Math.round(position.x - width / 2 + offset * 28),
        y: Math.round(position.y - 90 + offset * 28),
        width,
        ...(image || asset.mime.startsWith("video/") ? { height: Math.round(width * 9 / 16) } : {}),
        src: `asset://${asset.id}`,
        mime: asset.mime,
        text: asset.name,
        alt: image ? asset.name : undefined,
      });
    };
    const commitAddedItems = () => {
      renderCards();
      drawMinimap();
      persist();
    };

    let assetDragDepth = 0;
    const isAssetDrag = (event: DragEvent) => {
      const types = event.dataTransfer?.types ?? [];
      return types.includes(FRAMEDIFF_ASSET_DRAG_MIME) || types.includes("Files");
    };
    root.addEventListener("dragenter", (event) => {
      if (!bounds.dataFile || !isAssetDrag(event)) return;
      assetDragDepth += 1;
      root.classList.add("fd-mb-drop");
    }, { signal });
    root.addEventListener("dragover", (event) => {
      if (!bounds.dataFile || !isAssetDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }, { signal });
    root.addEventListener("dragleave", (event) => {
      if (!isAssetDrag(event)) return;
      assetDragDepth = Math.max(0, assetDragDepth - 1);
      if (!assetDragDepth) root.classList.remove("fd-mb-drop");
    }, { signal });
    root.addEventListener("drop", (event) => {
      if (!bounds.dataFile || !isAssetDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      assetDragDepth = 0;
      root.classList.remove("fd-mb-drop");
      const point = toComp(event);
      const payload = parseFramediffAssetDragPayload(event.dataTransfer?.getData(FRAMEDIFF_ASSET_DRAG_MIME) ?? "");
      if (payload) {
        addAsset(payload, point);
        commitAddedItems();
        return;
      }
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => /^(image|video|audio)\//.test(file.type));
      void Promise.all(files.map(async (file, index) => {
        const id = await uploadAsset(file);
        if (id) addAsset({ id, name: file.name, mime: file.type }, point, index);
      })).then(() => commitAddedItems());
    }, { signal });

    addNoteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const center = boardPoint({ x: bounds.width / 2, y: bounds.height / 2 });
      data.items.push({
        id: uniqueItemId("note"),
        type: "note",
        x: Math.round(center.x - 130),
        y: Math.round(center.y - 55),
        width: 260,
        text: "Double-click to write a note.",
      });
      commitAddedItems();
    }, { signal });

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
    sizeObserver = new ResizeObserver(() => drawMinimap());
    for (const card of queryAll<HTMLElement>(".fd-mb-item")) sizeObserver.observe(card);
    onCleanup(() => sizeObserver?.disconnect());
    onDocument((next) => {
      if (!next || typeof next !== "object" || !Array.isArray((next as Partial<MoodboardData>).items)) return;
      const board = next as MoodboardData;
      data.items = board.items.map((item) => ({ ...item }));
      data.camera = { ...(board.camera ?? data.camera) };
      camera.x = data.camera.x;
      camera.y = data.camera.y;
      camera.zoom = data.camera.zoom || 1;
      renderCards();
      applyCamera();
    });
    // Test/debug handle: lets integration tests drive the camera deterministically.
    (root as HTMLElement & { __fdMoodboard?: unknown }).__fdMoodboard = { camera, data, applyCamera };
    onCleanup(() => clearTimeout(persistTimer));
  };
}
