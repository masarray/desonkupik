// Shared canvas / DPR / colour helpers used by every plugin editor.
// Centralising these avoids per-module probe canvases and per-frame
// resize allocations.

/** Cap DPR to keep canvas backing buffers from exploding on retina screens. */
export const MAX_DPR = 2;

export function getDpr(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(MAX_DPR, window.devicePixelRatio || 1);
}

/**
 * Resize a canvas only when CSS size or DPR actually changed. Hoist this
 * out of per-frame draw loops; pair with a ResizeObserver on the wrapper.
 * Returns true if a resize happened.
 */
export function resizeCanvasIfNeeded(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  dpr: number = getDpr(),
): boolean {
  const targetW = Math.max(1, Math.floor(cssW * dpr));
  const targetH = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width === targetW && canvas.height === targetH) return false;
  canvas.width = targetW;
  canvas.height = targetH;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  return true;
}

// --- colour probe ---------------------------------------------------------
// Resolves any CSS colour string (oklch / color() / named) to concrete sRGB
// bytes. One shared 1x1 canvas across the whole app.
let _probeCtx: CanvasRenderingContext2D | null | undefined;
function probe(): CanvasRenderingContext2D | null {
  if (_probeCtx !== undefined) return _probeCtx;
  if (typeof document === "undefined") return (_probeCtx = null);
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  _probeCtx = c.getContext("2d", { willReadFrequently: true });
  return _probeCtx;
}

export type RGB = readonly [number, number, number];

export function resolveRGB(css: string, fallback: RGB = [56, 214, 232]): RGB {
  const ctx = probe();
  if (!ctx) return fallback;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css.trim();
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return fallback;
  }
}

export const rgba = (c: RGB, a: number) =>
  `rgba(${c[0].toFixed(0)},${c[1].toFixed(0)},${c[2].toFixed(0)},${a})`;
export const rgb = (c: RGB) => rgba(c, 1);

/** Resolve a CSS custom property (e.g. "--fx-eq") to sRGB. */
export function resolveCssVar(name: string, fallback: RGB = [56, 214, 232]): RGB {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? resolveRGB(v, fallback) : fallback;
}
