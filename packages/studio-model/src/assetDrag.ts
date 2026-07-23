export const FRAMEDIFF_ASSET_DRAG_MIME = "application/x-framediff-asset";

export interface FramediffAssetDragPayload {
  id: string;
  name: string;
  mime: string;
}

export function parseFramediffAssetDragPayload(raw: string): FramediffAssetDragPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<FramediffAssetDragPayload>;
    return typeof value.id === "string" && !!value.id
      && typeof value.name === "string" && !!value.name
      && typeof value.mime === "string" && !!value.mime
      ? { id: value.id, name: value.name, mime: value.mime }
      : null;
  } catch {
    return null;
  }
}
