/**
 * Frame counts are the truth, but they are not readable.
 *
 * `2070` tells a first-time user nothing; `01:26:00` tells them the piece is a minute and a half
 * long. The Studio shows both — timecode for comprehension, frames for precision — and never
 * drops the frame number, because everything else in FrameDiff is addressed by frame.
 */

/** Split a frame index into wall-clock parts at a given rate. */
export function frameParts(frame: number, fps: number): { hours: number; minutes: number; seconds: number; frames: number } {
  const rate = fps > 0 ? fps : 24;
  const safeFrame = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(safeFrame / rate);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    frames: safeFrame % Math.round(rate),
  };
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/**
 * `MM:SS:FF`, widening to `HH:MM:SS:FF` only once there is an hour to show. Fixed-width within a
 * given composition so the readout never jitters while scrubbing.
 */
export function formatTimecode(frame: number, fps: number): string {
  const { hours, minutes, seconds, frames } = frameParts(frame, fps);
  const base = `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
  return hours > 0 ? `${pad(hours)}:${base}` : base;
}

/** A short human duration: `1.4s`, `12s`, `1m 26s`. For labels, never for precise readouts. */
export function formatDuration(frames: number, fps: number): string {
  const rate = fps > 0 ? fps : 24;
  const totalSeconds = Math.max(0, frames) / rate;
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)}s`;
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
