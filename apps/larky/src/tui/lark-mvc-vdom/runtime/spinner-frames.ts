/**
 * Spinner animation frames for terminal display.
 * Replaces ink-spinner with simple frame arrays.
 */

/** Dots spinner frames (same as ink-spinner's "dots" type) */
export const DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Line spinner frames */
export const LINE_FRAMES = ["|", "/", "-", "\\"];

/** Get the current frame index for a given elapsed time and frame rate */
export function getFrameIndex(elapsed: number, frameCount: number, intervalMs = 80): number {
  return Math.floor((elapsed * 1000) / intervalMs) % frameCount;
}

/** Get the current dots spinner frame for a given elapsed time (in seconds) */
export function getDotsFrame(elapsed: number): string {
  return DOTS_FRAMES[getFrameIndex(elapsed, DOTS_FRAMES.length)];
}
