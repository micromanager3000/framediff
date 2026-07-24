(() => {
  const TOTAL_FRAMES = 420;
  const FPS = 30;
  const CANVAS = { width: 1280, height: 720 };
  const media = {
    dialogue: "/__framediff-cache/sha256%3Ad004a703d7305c4b6b7901b243524ac27fae3be4903b8a4743513749fa1db4e0",
    mara: "/__framediff-cache/sha256%3A614148cd6e6e4533482ad8231a27ed780a67e20fd7e6eecf367b80a5ee10ac8a",
    elias: "/__framediff-cache/sha256%3A3cd25d3edf7a736e2c1e03eb76ffb3e5dbc41a5df74c6bfe5573471edf23c1ff",
    concept: "/__framediff-cache/sha256%3Aceee1f317c162ef2e13df64844fa81401ddbf2311f1e658cc25ee7272ad05969"
  };

  const defaultShape = (type) => ({
    type,
    fill: type === "polygon" ? "#76d7c2" : "#e8b95f",
    stroke: type === "line" ? "#e8b95f" : "#f7e4bd",
    strokeWidth: type === "line" ? 6 : 1,
    angle: type === "line" ? -18 : 0,
    points: "50% 0%, 61% 35%, 100% 35%, 68% 57%, 80% 100%, 50% 73%, 20% 100%, 32% 57%, 0% 35%, 39% 35%"
  });

  const initialNodes = [
    {
      id: "workflow-final", name: "Final dialogue video", kind: "comp", comp: "lighthouse-dialogue",
      rect: { x: 430, y: 31, width: 348, height: 658 }, fit: "cover", focal: { x: 50, y: 34 },
      radius: 28, opacity: 1, layer: 4, from: 0, durationInFrames: 420, trimStart: 0, src: media.dialogue
    },
    {
      id: "workflow-mara", name: "Mara portrait", kind: "image",
      rect: { x: 822, y: 84, width: 205, height: 260 }, fit: "cover", focal: { x: 50, y: 36 },
      radius: 12, opacity: 1, layer: 5, from: 0, durationInFrames: 330, src: media.mara
    },
    {
      id: "workflow-elias", name: "Elias portrait", kind: "image",
      rect: { x: 1037, y: 84, width: 209, height: 260 }, fit: "cover", focal: { x: 50, y: 38 },
      radius: 12, opacity: 1, layer: 6, from: 0, durationInFrames: 390, src: media.elias
    },
    {
      id: "workflow-concept", name: "Reference board", kind: "image",
      rect: { x: 822, y: 354, width: 424, height: 214 }, fit: "cover", focal: { x: 50, y: 50 },
      radius: 12, opacity: 1, layer: 3, from: 0, durationInFrames: 300, src: media.concept
    },
    {
      id: "headline", name: "The light went dark.", kind: "text", text: "The light went dark.",
      rect: { x: 34, y: 42, width: 350, height: 46 }, fit: "none", focal: { x: 50, y: 50 },
      radius: 0, opacity: 1, layer: 2, from: 0, durationInFrames: 360
    },
    {
      id: "workflow-audio", name: "Approval gate", kind: "note",
      text: "<b>@Audio1 · approval gate:</b>&nbsp; pin the performance before spending video credits.",
      rect: { x: 34, y: 610, width: 330, height: 76 }, fit: "none", focal: { x: 50, y: 50 },
      radius: 0, opacity: 1, layer: 1, from: 0, durationInFrames: 420
    }
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));
  let nodes = clone(initialNodes);
  let selectedId = "workflow-final";
  let currentFrame = 0;
  let playing = false;
  let playTimer = 0;
  let canvasDrag = null;
  let timelineDrag = null;
  let shapeSequence = 0;

  document.querySelector(".intro-copy").innerHTML = `
    <div class="eyebrow">Inline rectangles · interaction pass</div>
    <h1>One JSON item now owns time, layer order, rectangle, fit and radius.</h1>
    <p>Move and resize on canvas, scrub time below, or drag clips between timeline rows. The visually top timeline row is always the front-most compositing layer.</p>
  `;
  document.querySelector(".recommendation").innerHTML = `
    <b>Decision in this prototype</b>
    <code>items[].layer</code> is the only writable stacking value. Timeline rows and canvas paint order are derived views.
  `;
  document.querySelector(".top-actions").innerHTML = `
    <a class="quiet-button fd2-plan-link" href="/edit-layout-authority-plan.html">Authority plan ↗</a>
    <button class="quiet-button" id="fd2Reset" type="button">Reset prototype</button>
    <button class="add-button" id="fd2AddRect" type="button">+ Rectangle</button>
  `;

  const workspace = document.querySelector(".workspace");
  workspace.innerHTML = `
    <aside class="fd2-rail">
      <div class="panel-head"><span>Inline rectangles</span><span>v2</span></div>
      <div class="fd2-model">
        <div class="fd2-model-title"><span class="prototype-num">01</span> Spatial + temporal items <span class="badge">Active</span></div>
        <div class="fd2-model-copy">Canvas and timeline edit the same JSON object. There is no separate stacking rule hidden in CSS.</div>
      </div>
      <div class="fd2-shape-palette">
        <div class="section-label"><span>Add shape layer</span><span>JSON-native</span></div>
        <div class="fd2-shape-grid">
          <button class="fd2-shape-button" data-add-shape="rect" type="button"><span class="fd2-shape-symbol rect"></span><span>Rectangle</span></button>
          <button class="fd2-shape-button" data-add-shape="ellipse" type="button"><span class="fd2-shape-symbol ellipse"></span><span>Ellipse</span></button>
          <button class="fd2-shape-button" data-add-shape="line" type="button"><span class="fd2-shape-symbol line"></span><span>Line</span></button>
          <button class="fd2-shape-button" data-add-shape="polygon" type="button"><span class="fd2-shape-symbol polygon"></span><span>Polygon</span></button>
        </div>
      </div>
      <div class="fd2-layer-section">
        <div class="section-label"><span>Layer stack</span><span>Top = front</span></div>
        <div class="fd2-layer-list" id="fd2LayerList"></div>
      </div>
    </aside>

    <section class="fd2-canvas-area">
      <div class="fd2-canvas-toolbar">
        <strong>Canvas</strong>
        <small>8-point resize handles · drag inside to move</small>
        <span class="fd2-toolbar-spacer"></span>
        <label class="fd2-toolbar-toggle"><input id="fd2Grid" type="checkbox"> Grid</label>
        <label class="fd2-toolbar-toggle"><input id="fd2Safe" type="checkbox" checked> Safe area</label>
        <span class="zoom">1280 × 720</span>
      </div>
      <div class="fd2-stage-wrap">
        <div class="fd2-stage-shell" id="fd2StageShell">
          <div class="fd2-stage" id="fd2Stage" aria-label="Editable 1280 by 720 composition canvas">
            <div class="fd2-safe-area" id="fd2SafeArea"></div>
          </div>
        </div>
      </div>
      <div class="fd2-canvas-status">
        <span id="fd2StatusHint">Drag any amber handle to resize. Drag the layer body to move.</span>
        <span class="fd2-status-coords" id="fd2StatusCoords"></span>
      </div>
      <section class="fd2-timeline" aria-label="Composition timeline">
        <div class="fd2-transport">
          <button class="fd2-transport-button" id="fd2Start" type="button" aria-label="Go to first frame">|◀</button>
          <button class="fd2-transport-button" id="fd2Play" type="button" aria-label="Play timeline">▶</button>
          <button class="fd2-transport-button" id="fd2End" type="button" aria-label="Go to last frame">▶|</button>
          <span class="fd2-timecode" id="fd2Timecode">000f · 00:00.00</span>
          <span class="fd2-timeline-hint">Vertical drag rewrites <code>item.layer</code></span>
          <span class="fd2-front-rule">DERIVED VIEW · TOP = FRONT</span>
        </div>
        <div class="fd2-timeline-scroll">
          <div class="fd2-timeline-grid" id="fd2TimelineGrid"></div>
        </div>
      </section>
    </section>

    <aside class="fd2-inspector">
      <div class="panel-head"><span>Inspector</span><span>JSON authority</span></div>
      <div class="selection-summary">
        <div class="selection-kicker" id="fd2SelectionKind">Nested composition</div>
        <div class="selection-name"><span class="fd2-layer-icon" id="fd2SelectionIcon">C</span><span id="fd2SelectionName">Final dialogue video</span></div>
        <div class="selection-path" id="fd2SelectionPath">items.workflow-final</div>
      </div>
      <section class="fd2-section">
        <h2>Rectangle · px</h2>
        <div class="fd2-form-grid four">
          <div class="fd2-field"><label for="fd2X">X</label><input id="fd2X" type="number" step="1"></div>
          <div class="fd2-field"><label for="fd2Y">Y</label><input id="fd2Y" type="number" step="1"></div>
          <div class="fd2-field"><label for="fd2W">W</label><input id="fd2W" type="number" min="8" step="1"></div>
          <div class="fd2-field"><label for="fd2H">H</label><input id="fd2H" type="number" min="8" step="1"></div>
        </div>
      </section>
      <section class="fd2-section" id="fd2FitSection">
        <h2>Fit inside rectangle</h2>
        <div class="fd2-segmented">
          <button data-fd2-fit="cover" type="button" aria-pressed="true">Crop</button>
          <button data-fd2-fit="contain" type="button" aria-pressed="false">Letterbox</button>
          <button data-fd2-fit="fill" type="button" aria-pressed="false">Stretch</button>
        </div>
        <div class="fd2-range"><input id="fd2FocalX" type="range" min="0" max="100"><span id="fd2FocalXValue">50%</span></div>
        <div class="fd2-range"><input id="fd2FocalY" type="range" min="0" max="100"><span id="fd2FocalYValue">34%</span></div>
      </section>
      <section class="fd2-section">
        <h2>Appearance</h2>
        <div class="fd2-form-grid">
          <div class="fd2-field"><label for="fd2Radius">Radius</label><input id="fd2Radius" type="number" min="0" step="1"></div>
          <div class="fd2-field"><label for="fd2Opacity">Opacity</label><input id="fd2Opacity" type="number" min="0" max="1" step=".05"></div>
        </div>
      </section>
      <section class="fd2-section fd2-shape-fields" id="fd2ShapeSection" hidden>
        <h2>Arbitrary shape</h2>
        <div class="fd2-form-grid">
          <div class="fd2-field"><label for="fd2ShapeType">Primitive</label><select id="fd2ShapeType"><option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="line">Line</option><option value="polygon">Polygon</option></select></div>
          <div class="fd2-field"><label for="fd2ShapeFill">Fill</label><input id="fd2ShapeFill" type="color"></div>
          <div class="fd2-field"><label for="fd2ShapeStroke">Stroke</label><input id="fd2ShapeStroke" type="color"></div>
          <div class="fd2-field"><label for="fd2ShapeStrokeWidth">Stroke</label><input id="fd2ShapeStrokeWidth" type="number" min="0" step="1"></div>
        </div>
        <div class="fd2-field" id="fd2PointsField" style="margin-top:8px">
          <label for="fd2ShapePoints">Normalized polygon points</label>
          <input id="fd2ShapePoints" type="text">
        </div>
      </section>
      <section class="fd2-section">
        <h2>Timeline placement</h2>
        <div class="fd2-form-grid">
          <div class="fd2-field"><label for="fd2From">From · frame</label><input id="fd2From" type="number" min="0" max="419" step="1"></div>
          <div class="fd2-field"><label for="fd2Duration">Duration · frames</label><input id="fd2Duration" type="number" min="1" max="420" step="1"></div>
          <div class="fd2-field"><label for="fd2Layer">Layer</label><input id="fd2Layer" type="number" min="1" step="1"></div>
          <div class="fd2-field"><label>Stack rule</label><input value="higher = front" disabled></div>
        </div>
      </section>
      <section class="fd2-section fd2-authority-section" id="fd2AuthoritySection">
        <div class="fd2-authority-heading">
          <h2>Single stacking authority</h2>
          <span>no dual state</span>
        </div>
        <div class="fd2-authority-flow" aria-label="Layer authority projection">
          <div class="fd2-authority-node is-source">
            <small>WRITABLE SOURCE</small>
            <code>items[].layer</code>
            <strong id="fd2AuthorityJson">L4</strong>
          </div>
          <span class="fd2-authority-arrow" aria-hidden="true">→</span>
          <div class="fd2-authority-node">
            <small>DERIVED VIEW</small>
            <span>Timeline row</span>
            <strong id="fd2AuthorityRow">Row 3</strong>
          </div>
          <span class="fd2-authority-arrow" aria-hidden="true">→</span>
          <div class="fd2-authority-node">
            <small>DERIVED VIEW</small>
            <span>Canvas paint</span>
            <strong id="fd2AuthorityPaint">z ← L4</strong>
          </div>
        </div>
        <p>Timeline drag writes JSON once. The row and renderer order are recalculated; neither is stored separately.</p>
      </section>
      <section class="json-section">
        <div class="fd2-json-toolbar"><strong>EDIT JSON · LIVE</strong><button id="fd2Copy" type="button">Copy</button></div>
        <pre class="fd2-json" id="fd2Json" aria-label="Live edit composition JSON"></pre>
      </section>
    </aside>
  `;

  const stage = document.getElementById("fd2Stage");
  const stageShell = document.getElementById("fd2StageShell");
  const timelineGrid = document.getElementById("fd2TimelineGrid");
  const layerList = document.getElementById("fd2LayerList");
  const jsonPreview = document.getElementById("fd2Json");
  const statusCoords = document.getElementById("fd2StatusCoords");
  const statusHint = document.getElementById("fd2StatusHint");
  const timecode = document.getElementById("fd2Timecode");
  const playButton = document.getElementById("fd2Play");

  const fields = {
    x: document.getElementById("fd2X"),
    y: document.getElementById("fd2Y"),
    width: document.getElementById("fd2W"),
    height: document.getElementById("fd2H"),
    radius: document.getElementById("fd2Radius"),
    opacity: document.getElementById("fd2Opacity"),
    from: document.getElementById("fd2From"),
    durationInFrames: document.getElementById("fd2Duration"),
    layer: document.getElementById("fd2Layer")
  };

  const selectedNode = () => nodes.find((node) => node.id === selectedId) || nodes[0];
  const layerOrder = () => [...nodes].sort((a, b) => b.layer - a.layer || a.id.localeCompare(b.id));
  const kindIcon = (kind) => ({ comp: "C", image: "I", text: "T", note: "N", shape: "S" }[kind] || "L");
  const kindLabel = (kind) => ({ comp: "Nested composition", image: "Image asset", text: "Text layer", note: "Graphic note", shape: "Shape layer" }[kind] || "Layer");
  const isMedia = (node) => node.kind === "comp" || node.kind === "image";

  function clampRect(rect) {
    rect.width = Math.max(8, Math.round(rect.width));
    rect.height = Math.max(8, Math.round(rect.height));
    rect.x = Math.round(Math.max(-rect.width + 8, Math.min(CANVAS.width - 8, rect.x)));
    rect.y = Math.round(Math.max(-rect.height + 8, Math.min(CANVAS.height - 8, rect.y)));
  }

  function normalizeLayers(ids) {
    const orderedIds = ids || layerOrder().map((node) => node.id);
    const total = orderedIds.length;
    orderedIds.forEach((id, index) => {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) node.layer = total - index;
    });
  }

  function contentFor(node) {
    if (node.kind === "comp") return { type: "nested", composition: node.comp, trimStart: node.trimStart || 0 };
    if (node.kind === "image") return { type: "image", src: `asset://${node.id}` };
    if (node.kind === "text") return { type: "text", text: node.text };
    if (node.kind === "note") return { type: "shape", primitive: "roundRect", text: "Approval gate" };
    return {
      type: "shape",
      primitive: node.shape.type,
      fill: node.shape.fill,
      stroke: node.shape.stroke,
      strokeWidth: node.shape.strokeWidth,
      ...(node.shape.type === "polygon" ? { points: node.shape.points } : {}),
      ...(node.shape.type === "line" ? { angle: node.shape.angle } : {})
    };
  }

  function documentValue() {
    return {
      version: 2,
      canvas: { ...CANVAS, fps: FPS, durationInFrames: TOTAL_FRAMES },
      items: layerOrder().map((node) => ({
        id: node.id,
        from: node.from,
        durationInFrames: node.durationInFrames,
        layer: node.layer,
        content: contentFor(node),
        layout: {
          rect: [node.rect.x, node.rect.y, node.rect.width, node.rect.height],
          ...(isMedia(node) ? {
            fit: node.fit,
            focalPoint: [node.focal.x / 100, node.focal.y / 100]
          } : {}),
          cornerRadius: node.radius,
          opacity: node.opacity
        }
      }))
    };
  }

  function renderJson() {
    jsonPreview.textContent = JSON.stringify(documentValue(), null, 2);
  }

  function nodeMarkup(node) {
    if (node.kind === "comp") return `<video muted playsinline preload="auto" src="${node.src}"></video><span class="fd2-media-label">@Comp · ${node.comp}</span>`;
    if (node.kind === "image") return `<img src="${node.src}" alt=""><span class="fd2-media-label">@Asset · ${node.name}</span>`;
    if (node.kind === "text" || node.kind === "note") return node.text;
    return `<span class="fd2-shape-body"></span>`;
  }

  function renderStage() {
    stage.querySelectorAll(".fd2-stage-node").forEach((element) => element.remove());
    stage.querySelector(".fd2-selection-overlay")?.remove();
    const fragment = document.createDocumentFragment();
    for (const node of layerOrder().slice().reverse()) {
      const element = document.createElement("div");
      element.className = `fd2-stage-node kind-${node.kind}${node.kind === "shape" ? ` shape-${node.shape.type}` : ""}${node.id === selectedId ? " is-selected" : ""}`;
      element.dataset.nodeId = node.id;
      element.style.left = `${node.rect.x / CANVAS.width * 100}%`;
      element.style.top = `${node.rect.y / CANVAS.height * 100}%`;
      element.style.width = `${node.rect.width / CANVAS.width * 100}%`;
      element.style.height = `${node.rect.height / CANVAS.height * 100}%`;
      element.style.zIndex = String(node.layer);
      element.style.setProperty("--node-radius", `${node.radius / CANVAS.width * stageShell.clientWidth}px`);
      element.style.setProperty("--node-opacity", String(node.opacity));
      element.style.setProperty("--node-fit", node.fit || "cover");
      element.style.setProperty("--focal-x", `${node.focal?.x ?? 50}%`);
      element.style.setProperty("--focal-y", `${node.focal?.y ?? 50}%`);
      if (node.shape) {
        element.style.setProperty("--shape-fill", node.shape.fill);
        element.style.setProperty("--shape-stroke", node.shape.stroke);
        element.style.setProperty("--shape-stroke-width", `${node.shape.strokeWidth}px`);
        element.style.setProperty("--shape-points", node.shape.points);
        element.style.setProperty("--shape-angle", `${node.shape.angle}deg`);
      }
      element.innerHTML = nodeMarkup(node);

      element.addEventListener("pointerdown", onCanvasPointerDown);
      fragment.appendChild(element);
    }
    stage.appendChild(fragment);

    const selected = selectedNode();
    const overlay = document.createElement("div");
    overlay.className = "fd2-selection-overlay";
    overlay.dataset.nodeId = selected.id;
    overlay.style.left = `${selected.rect.x / CANVAS.width * 100}%`;
    overlay.style.top = `${selected.rect.y / CANVAS.height * 100}%`;
    overlay.style.width = `${selected.rect.width / CANVAS.width * 100}%`;
    overlay.style.height = `${selected.rect.height / CANVAS.height * 100}%`;
    overlay.style.setProperty("--node-radius", `${selected.radius / CANVAS.width * stageShell.clientWidth}px`);
    const label = document.createElement("span");
    label.className = "fd2-selection-label";
    label.textContent = `${selected.id} · L${selected.layer}`;
    overlay.appendChild(label);
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const grip = document.createElement("span");
      grip.className = "fd2-resize-handle";
      grip.dataset.handle = handle;
      overlay.appendChild(grip);
    }
    overlay.addEventListener("pointerdown", onCanvasPointerDown);
    stage.appendChild(overlay);
    applyFrame();
  }

  function renderLayerList() {
    layerList.innerHTML = layerOrder().map((node) => `
      <button class="fd2-layer-row${node.id === selectedId ? " is-selected" : ""}" data-fd2-select="${node.id}" type="button">
        <span class="fd2-layer-icon">${kindIcon(node.kind)}</span>
        <span class="fd2-layer-name">${node.name}</span>
        <span class="fd2-layer-rank">L${node.layer}</span>
      </button>
    `).join("");
    layerList.querySelectorAll("[data-fd2-select]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedId = button.dataset.fd2Select;
        renderAll();
      });
    });
  }

  function rulerMarkup() {
    return Array.from({ length: 8 }, (_, index) => {
      const frame = index * 60;
      return `<span class="fd2-ruler-tick" style="left:${frame / TOTAL_FRAMES * 100}%">${index * 2}s</span>`;
    }).join("");
  }

  function renderTimeline() {
    const ordered = layerOrder();
    timelineGrid.innerHTML = `
      <div class="fd2-ruler">${rulerMarkup()}</div>
      ${ordered.map((node, index) => `
        <div class="fd2-lane" data-fd2-lane="${index}">
          <div class="fd2-lane-label"><strong>ROW ${index + 1}</strong><span>← L${node.layer}</span></div>
          <div class="fd2-lane-track">
            <button
              class="fd2-clip kind-${node.kind}${node.id === selectedId ? " is-selected" : ""}"
              data-fd2-clip="${node.id}"
              type="button"
              style="left:${node.from / TOTAL_FRAMES * 100}%;width:${node.durationInFrames / TOTAL_FRAMES * 100}%"
            >
              ${node.kind === "comp" ? '<span class="fd2-trim-handle left" data-trim="left"></span>' : ""}
              <span class="fd2-clip-name">${node.name}</span>
              <span class="fd2-trim-handle right" data-trim="right"></span>
            </button>
          </div>
        </div>
      `).join("")}
      <div class="fd2-playhead" id="fd2Playhead"></div>
    `;

    timelineGrid.querySelectorAll("[data-fd2-clip]").forEach((clip) => clip.addEventListener("pointerdown", onTimelinePointerDown));
    applyFrame();
  }

  function renderInspector() {
    const node = selectedNode();
    const row = layerOrder().findIndex((candidate) => candidate.id === node.id) + 1;
    document.getElementById("fd2SelectionKind").textContent = kindLabel(node.kind);
    document.getElementById("fd2SelectionIcon").textContent = kindIcon(node.kind);
    document.getElementById("fd2SelectionName").textContent = node.name;
    document.getElementById("fd2SelectionPath").textContent = `items.${node.id}`;
    fields.x.value = node.rect.x;
    fields.y.value = node.rect.y;
    fields.width.value = node.rect.width;
    fields.height.value = node.rect.height;
    fields.radius.value = node.radius;
    fields.opacity.value = node.opacity;
    fields.from.value = node.from;
    fields.durationInFrames.value = node.durationInFrames;
    fields.layer.value = node.layer;
    document.getElementById("fd2AuthorityJson").textContent = `L${node.layer}`;
    document.getElementById("fd2AuthorityRow").textContent = `Row ${row}`;
    document.getElementById("fd2AuthorityPaint").textContent = `z ← L${node.layer}`;

    const fitSection = document.getElementById("fd2FitSection");
    fitSection.hidden = !isMedia(node);
    document.querySelectorAll("[data-fd2-fit]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.fd2Fit === node.fit));
    });
    document.getElementById("fd2FocalX").value = node.focal?.x ?? 50;
    document.getElementById("fd2FocalY").value = node.focal?.y ?? 50;
    document.getElementById("fd2FocalXValue").textContent = `${node.focal?.x ?? 50}%`;
    document.getElementById("fd2FocalYValue").textContent = `${node.focal?.y ?? 50}%`;

    const shapeSection = document.getElementById("fd2ShapeSection");
    shapeSection.hidden = node.kind !== "shape";
    if (node.shape) {
      document.getElementById("fd2ShapeType").value = node.shape.type;
      document.getElementById("fd2ShapeFill").value = node.shape.fill;
      document.getElementById("fd2ShapeStroke").value = node.shape.stroke;
      document.getElementById("fd2ShapeStrokeWidth").value = node.shape.strokeWidth;
      document.getElementById("fd2ShapePoints").value = node.shape.points;
      document.getElementById("fd2PointsField").hidden = node.shape.type !== "polygon";
    }
    statusCoords.textContent = `x ${node.rect.x} · y ${node.rect.y} · w ${node.rect.width} · h ${node.rect.height} · L${node.layer}`;
  }

  function renderAll() {
    renderLayerList();
    renderStage();
    renderTimeline();
    renderInspector();
    renderJson();
  }

  function applyFrame() {
    document.querySelectorAll(".fd2-stage-node").forEach((element) => {
      const node = nodes.find((candidate) => candidate.id === element.dataset.nodeId);
      const active = node && currentFrame >= node.from && currentFrame < node.from + node.durationInFrames;
      element.classList.toggle("is-inactive", !active);
      const video = element.querySelector("video");
      if (video && !playing) {
        const target = Math.max(0, currentFrame - node.from) / FPS + (node.trimStart || 0);
        if (Math.abs(video.currentTime - target) > .08) {
          try { video.currentTime = target; } catch {}
        }
      }
    });
    const selectionOverlay = document.querySelector(".fd2-selection-overlay");
    if (selectionOverlay) {
      const node = nodes.find((candidate) => candidate.id === selectionOverlay.dataset.nodeId);
      const active = node && currentFrame >= node.from && currentFrame < node.from + node.durationInFrames;
      selectionOverlay.classList.toggle("is-inactive", !active);
    }
    const playhead = document.getElementById("fd2Playhead");
    if (playhead) {
      playhead.style.left = `calc(76px + (100% - 76px) * ${currentFrame / TOTAL_FRAMES})`;
    }
    timecode.textContent = `${String(currentFrame).padStart(3, "0")}f · 00:${String(Math.floor(currentFrame / FPS)).padStart(2, "0")}.${String(Math.floor(currentFrame % FPS / FPS * 100)).padStart(2, "0")}`;
    playButton.textContent = playing ? "❚❚" : "▶";
    playButton.classList.toggle("is-playing", playing);
    playButton.setAttribute("aria-label", playing ? "Pause timeline" : "Play timeline");
  }

  function onCanvasPointerDown(event) {
    const element = event.currentTarget;
    const node = nodes.find((candidate) => candidate.id === element.dataset.nodeId);
    if (!node) return;
    selectedId = node.id;
    const shellRect = stageShell.getBoundingClientRect();
    canvasDrag = {
      pointerId: event.pointerId,
      handle: event.target.dataset.handle || "move",
      startX: event.clientX,
      startY: event.clientY,
      scaleX: CANVAS.width / shellRect.width,
      scaleY: CANVAS.height / shellRect.height,
      rect: { ...node.rect }
    };
    element.setPointerCapture(event.pointerId);
    renderAll();
    event.preventDefault();
  }

  function moveCanvasDrag(event) {
    if (!canvasDrag || canvasDrag.pointerId !== event.pointerId) return;
    const node = selectedNode();
    const dx = (event.clientX - canvasDrag.startX) * canvasDrag.scaleX;
    const dy = (event.clientY - canvasDrag.startY) * canvasDrag.scaleY;
    const handle = canvasDrag.handle;
    const next = { ...canvasDrag.rect };

    if (handle === "move") {
      next.x += dx;
      next.y += dy;
    } else {
      if (handle.includes("e")) next.width += dx;
      if (handle.includes("s")) next.height += dy;
      if (handle.includes("w")) {
        next.x += dx;
        next.width -= dx;
      }
      if (handle.includes("n")) {
        next.y += dy;
        next.height -= dy;
      }
      if (next.width < 8) {
        if (handle.includes("w")) next.x -= 8 - next.width;
        next.width = 8;
      }
      if (next.height < 8) {
        if (handle.includes("n")) next.y -= 8 - next.height;
        next.height = 8;
      }
    }
    node.rect = next;
    clampRect(node.rect);
    renderStage();
    renderInspector();
    renderJson();
  }

  function onTimelinePointerDown(event) {
    event.stopPropagation();
    const clip = event.currentTarget;
    const node = nodes.find((candidate) => candidate.id === clip.dataset.fd2Clip);
    if (!node) return;
    selectedId = node.id;
    const track = clip.closest(".fd2-lane-track").getBoundingClientRect();
    const lanes = timelineGrid.querySelectorAll(".fd2-lane");
    timelineDrag = {
      pointerId: event.pointerId,
      mode: event.target.dataset.trim || "move",
      startX: event.clientX,
      startY: event.clientY,
      pixelsPerFrame: track.width / TOTAL_FRAMES,
      from: node.from,
      duration: node.durationInFrames,
      order: layerOrder().map((candidate) => candidate.id),
      laneTop: lanes[0]?.getBoundingClientRect().top || 0,
      laneHeight: lanes[0]?.getBoundingClientRect().height || 31
    };
    clip.setPointerCapture(event.pointerId);
    renderAll();
    event.preventDefault();
  }

  function moveTimelineDrag(event) {
    if (!timelineDrag || timelineDrag.pointerId !== event.pointerId) return;
    const node = selectedNode();
    const deltaFrames = Math.round((event.clientX - timelineDrag.startX) / timelineDrag.pixelsPerFrame);

    if (timelineDrag.mode === "right") {
      node.durationInFrames = Math.max(1, Math.min(TOTAL_FRAMES - node.from, timelineDrag.duration + deltaFrames));
    } else if (timelineDrag.mode === "left") {
      const nextFrom = Math.max(0, Math.min(timelineDrag.from + timelineDrag.duration - 1, timelineDrag.from + deltaFrames));
      const consumed = nextFrom - timelineDrag.from;
      node.from = nextFrom;
      node.durationInFrames = timelineDrag.duration - consumed;
      node.trimStart = Math.max(0, (node.trimStart || 0) + consumed / FPS);
      timelineDrag.from = nextFrom;
      timelineDrag.duration = node.durationInFrames;
      timelineDrag.startX = event.clientX;
    } else {
      node.from = Math.max(0, Math.min(TOTAL_FRAMES - node.durationInFrames, timelineDrag.from + deltaFrames));
      const targetIndex = Math.max(0, Math.min(nodes.length - 1, Math.floor((event.clientY - timelineDrag.laneTop) / timelineDrag.laneHeight)));
      const currentIndex = timelineDrag.order.indexOf(node.id);
      if (targetIndex !== currentIndex) {
        timelineDrag.order.splice(currentIndex, 1);
        timelineDrag.order.splice(targetIndex, 0, node.id);
        normalizeLayers(timelineDrag.order);
        statusHint.textContent = `${node.name}: items[].layer → L${node.layer}. Timeline row and canvas paint order were re-derived.`;
      }
    }

    renderLayerList();
    renderStage();
    renderTimeline();
    renderInspector();
    renderJson();
  }

  function onScrubPointerDown(event) {
    if (event.target.closest("[data-fd2-clip]")) return;
    const track = timelineGrid.querySelector(".fd2-lane-track");
    if (!track) return;
    const rect = track.getBoundingClientRect();
    currentFrame = Math.max(0, Math.min(TOTAL_FRAMES - 1, Math.round((event.clientX - rect.left) / rect.width * TOTAL_FRAMES)));
    applyFrame();
  }

  function endPointerDrag(event) {
    if (canvasDrag?.pointerId === event.pointerId) canvasDrag = null;
    if (timelineDrag?.pointerId === event.pointerId) {
      timelineDrag = null;
      renderAll();
    }
  }

  function addShape(type) {
    shapeSequence += 1;
    const id = `${type}-${shapeSequence}`;
    const sizes = {
      rect: { width: 260, height: 130 },
      ellipse: { width: 170, height: 170 },
      line: { width: 280, height: 70 },
      polygon: { width: 180, height: 180 }
    };
    const size = sizes[type];
    nodes.push({
      id,
      name: `${type[0].toUpperCase()}${type.slice(1)} ${shapeSequence}`,
      kind: "shape",
      shape: defaultShape(type),
      rect: { x: 490 + shapeSequence * 10, y: 260 + shapeSequence * 8, ...size },
      fit: "none",
      focal: { x: 50, y: 50 },
      radius: type === "rect" ? 18 : 0,
      opacity: .9,
      layer: nodes.length + 1,
      from: currentFrame,
      durationInFrames: TOTAL_FRAMES - currentFrame
    });
    normalizeLayers([id, ...layerOrder().filter((node) => node.id !== id).map((node) => node.id)]);
    selectedId = id;
    renderAll();
    statusHint.textContent = `${type} added as a first-class JSON shape. Drag it in the timeline to change its stacking order.`;
  }

  document.addEventListener("pointermove", (event) => {
    moveCanvasDrag(event);
    moveTimelineDrag(event);
  });
  document.addEventListener("pointerup", endPointerDrag);
  document.addEventListener("pointercancel", endPointerDrag);
  timelineGrid.addEventListener("pointerdown", onScrubPointerDown);

  for (const [key, input] of Object.entries(fields)) {
    input.addEventListener("input", () => {
      const node = selectedNode();
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (["x", "y", "width", "height"].includes(key)) {
        node.rect[key] = value;
        clampRect(node.rect);
      } else if (key === "opacity") {
        node.opacity = Math.max(0, Math.min(1, value));
      } else if (key === "radius") {
        node.radius = Math.max(0, Math.round(value));
      } else if (key === "from") {
        node.from = Math.max(0, Math.min(TOTAL_FRAMES - node.durationInFrames, Math.round(value)));
      } else if (key === "durationInFrames") {
        node.durationInFrames = Math.max(1, Math.min(TOTAL_FRAMES - node.from, Math.round(value)));
      } else if (key === "layer") {
        const order = layerOrder().filter((candidate) => candidate.id !== node.id).map((candidate) => candidate.id);
        const targetFromTop = Math.max(0, Math.min(order.length, nodes.length - Math.round(value)));
        order.splice(targetFromTop, 0, node.id);
        normalizeLayers(order);
        statusHint.textContent = `${node.name}: items[].layer → L${node.layer}. Timeline row and canvas paint order were re-derived.`;
      }
      renderAll();
    });
  }

  document.querySelectorAll("[data-fd2-fit]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedNode().fit = button.dataset.fd2Fit;
      renderAll();
    });
  });

  document.getElementById("fd2FocalX").addEventListener("input", (event) => {
    selectedNode().focal.x = Number(event.target.value);
    renderAll();
  });
  document.getElementById("fd2FocalY").addEventListener("input", (event) => {
    selectedNode().focal.y = Number(event.target.value);
    renderAll();
  });

  document.getElementById("fd2ShapeType").addEventListener("change", (event) => {
    const node = selectedNode();
    if (!node.shape) return;
    node.shape.type = event.target.value;
    renderAll();
  });
  document.getElementById("fd2ShapeFill").addEventListener("input", (event) => {
    if (selectedNode().shape) selectedNode().shape.fill = event.target.value;
    renderAll();
  });
  document.getElementById("fd2ShapeStroke").addEventListener("input", (event) => {
    if (selectedNode().shape) selectedNode().shape.stroke = event.target.value;
    renderAll();
  });
  document.getElementById("fd2ShapeStrokeWidth").addEventListener("input", (event) => {
    if (selectedNode().shape) selectedNode().shape.strokeWidth = Math.max(0, Number(event.target.value));
    renderAll();
  });
  document.getElementById("fd2ShapePoints").addEventListener("input", (event) => {
    if (selectedNode().shape) selectedNode().shape.points = event.target.value;
    renderAll();
  });

  document.querySelectorAll("[data-add-shape]").forEach((button) => button.addEventListener("click", () => addShape(button.dataset.addShape)));
  document.getElementById("fd2AddRect").addEventListener("click", () => addShape("rect"));

  document.getElementById("fd2Grid").addEventListener("change", (event) => stage.classList.toggle("show-grid", event.target.checked));
  document.getElementById("fd2Safe").addEventListener("change", (event) => {
    document.getElementById("fd2SafeArea").hidden = !event.target.checked;
  });

  document.getElementById("fd2Start").addEventListener("click", () => {
    currentFrame = 0;
    applyFrame();
  });
  document.getElementById("fd2End").addEventListener("click", () => {
    currentFrame = TOTAL_FRAMES - 1;
    applyFrame();
  });
  playButton.addEventListener("click", () => {
    playing = !playing;
    clearInterval(playTimer);
    if (playing) {
      document.querySelectorAll(".fd2-stage-node video").forEach((video) => video.play().catch(() => {}));
      playTimer = window.setInterval(() => {
        currentFrame = currentFrame >= TOTAL_FRAMES - 1 ? 0 : currentFrame + 1;
        applyFrame();
      }, 1000 / FPS);
    } else {
      document.querySelectorAll(".fd2-stage-node video").forEach((video) => video.pause());
    }
    applyFrame();
  });

  document.getElementById("fd2Reset").addEventListener("click", () => {
    clearInterval(playTimer);
    playing = false;
    nodes = clone(initialNodes);
    selectedId = "workflow-final";
    currentFrame = 0;
    shapeSequence = 0;
    statusHint.textContent = "Drag any amber handle to resize. Drag the layer body to move.";
    renderAll();
  });

  document.getElementById("fd2Copy").addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText(jsonPreview.textContent);
      event.currentTarget.textContent = "Copied";
      setTimeout(() => { event.currentTarget.textContent = "Copy"; }, 1000);
    } catch {
      statusHint.textContent = "Clipboard permission was unavailable; the JSON remains selectable below.";
    }
  });

  window.addEventListener("resize", renderStage);
  renderAll();
})();
