/**
 * Backing-store size for a canvas shown at cssWidth × cssHeight. Without scaling by
 * devicePixelRatio, lines on a 2× display are drawn at half resolution and upscaled (blurry).
 * Rounded because canvas dimensions are integers; at least 1 so contexts stay valid.
 */
export function backingStoreSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return {
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio)),
  };
}

/** Resizes only when the size actually changed: assigning width/height clears the canvas and (for WebGL) can be expensive. */
export function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): boolean {
  const { width, height } = backingStoreSize(cssWidth, cssHeight, dpr);
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
