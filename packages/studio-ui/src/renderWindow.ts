import type { RenderProgressSnapshot, RenderResult, RenderState } from "@framediff/studio-model";

const RENDER_WINDOW_NAME_PREFIX = "framediff-render:";
const LEGACY_RENDER_WINDOW_QUERY_PARAM = "framediff-render-window";

export interface RenderWindowRequest {
  token: string;
  compositionKey: string;
}

type RenderWindowProgressMessage = {
  type: "framediff:render-window";
  token: string;
  status: "rendering";
  progress: RenderProgressSnapshot;
};

type RenderWindowDoneMessage = {
  type: "framediff:render-window";
  token: string;
  status: "done";
  result: RenderResult;
};

type RenderWindowErrorMessage = {
  type: "framediff:render-window";
  token: string;
  status: "error";
  error: string;
};

export type RenderWindowMessage =
  | RenderWindowProgressMessage
  | RenderWindowDoneMessage
  | RenderWindowErrorMessage;

export interface RenderWindowHandle {
  popup: Window;
  token: string;
  url: string;
  origin: string;
}

export function buildRenderWindowName(compositionKey: string, token: string): string {
  return `${RENDER_WINDOW_NAME_PREFIX}${encodeURIComponent(JSON.stringify({ token, compositionKey }))}`;
}

export function renderWindowRequest(name: string): RenderWindowRequest | null {
  if (!name.startsWith(RENDER_WINDOW_NAME_PREFIX)) return null;
  try {
    const value = JSON.parse(decodeURIComponent(name.slice(RENDER_WINDOW_NAME_PREFIX.length))) as Partial<RenderWindowRequest>;
    return typeof value.token === "string" && value.token
      && typeof value.compositionKey === "string" && value.compositionKey
      ? { token: value.token, compositionKey: value.compositionKey }
      : null;
  } catch {
    return null;
  }
}

export function buildRenderWindowUrl(href: string): string {
  const url = new URL(href);
  // Normalize URLs copied from older Studio builds. Render routing now travels in window.name,
  // so opening a project or renderer never needs composition state in its URL.
  url.searchParams.delete("comp");
  url.searchParams.delete(LEGACY_RENDER_WINDOW_QUERY_PARAM);
  return url.href;
}

function randomToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Must be called synchronously from the render-button click so Chrome permits the popup. */
export function openRenderWindow(compositionKey: string): RenderWindowHandle | null {
  const token = randomToken();
  const url = buildRenderWindowUrl(window.location.href);
  const width = 560;
  const height = 280;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(
    "about:blank",
    `framediff-render-${token}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!popup) return null;

  // Avoid a white flash while the Studio route loads in the new document.
  popup.name = buildRenderWindowName(compositionKey, token);
  popup.document.title = "FrameDiff — Opening renderer…";
  popup.document.documentElement.style.cssText = "color-scheme:dark;background:#0e0d0b";
  popup.document.body.style.cssText = "margin:0;background:#0e0d0b";
  popup.focus();
  return { popup, token, url, origin: new URL(url).origin };
}

export function isRenderWindowMessage(value: unknown): value is RenderWindowMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<RenderWindowMessage>;
  if (message.type !== "framediff:render-window" || typeof message.token !== "string") return false;
  if (message.status === "rendering") {
    const progress = message.progress;
    return !!progress
      && ["prepare", "audio", "render", "finalize"].includes(progress.phase)
      && typeof progress.completed === "number"
      && typeof progress.total === "number";
  }
  if (message.status === "done") {
    return !!message.result
      && typeof message.result.bytes === "number"
      && typeof message.result.filename === "string";
  }
  return message.status === "error" && typeof message.error === "string";
}

export function postRenderWindowState(token: string, state: RenderState): void {
  if (!window.opener || window.opener.closed || state.status === "idle") return;
  let message: RenderWindowMessage | null = null;
  if (state.status === "rendering" && state.progress) {
    message = { type: "framediff:render-window", token, status: "rendering", progress: state.progress };
  } else if (state.status === "done" && state.filename) {
    message = {
      type: "framediff:render-window",
      token,
      status: "done",
      result: { bytes: state.bytes, filename: state.filename },
    };
  } else if (state.status === "error") {
    message = { type: "framediff:render-window", token, status: "error", error: state.error ?? "Render failed" };
  }
  if (message) window.opener.postMessage(message, window.location.origin);
}

export function postRenderWindowError(token: string, error: unknown): void {
  if (!window.opener || window.opener.closed) return;
  window.opener.postMessage(
    {
      type: "framediff:render-window",
      token,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies RenderWindowErrorMessage,
    window.location.origin,
  );
}

/** Wait for the renderer document to mirror progress and its final result back to the Studio. */
export function runInRenderWindow(
  handle: RenderWindowHandle,
  onProgress: (progress: RenderProgressSnapshot) => void,
): Promise<RenderResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(closedPoll);
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (event.source !== handle.popup || event.origin !== handle.origin || !isRenderWindowMessage(message)) return;
      if (message.token !== handle.token) return;
      if (message.status === "rendering") onProgress(message.progress);
      else if (message.status === "done") finish(() => resolve(message.result));
      else finish(() => reject(new Error(message.error)));
    };
    const closedPoll = window.setInterval(() => {
      if (handle.popup.closed) finish(() => reject(new Error("The render window was closed before rendering finished.")));
    }, 500);

    window.addEventListener("message", onMessage);
    try {
      handle.popup.location.replace(handle.url);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}
