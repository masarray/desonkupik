// Shared DeSonKuPik spectrum painter.
//
// The Web Audio API analyser exposes linear FFT bins. This helper converts
// them into a log-frequency, constant-Q / fractional-octave display so all FX
// pages feel like the EQ analyser: broad bass mountains, thinner treble detail,
// rounded paths, and pink-noise display compensation. It is visual-only and
// does not touch the audio path.
//
// Performance note:
// FFT reads are intentionally throttled, but canvas drawing can still happen at
// requestAnimationFrame speed. The painter keeps separate TARGET and VISUAL
// point buffers. New FFT data updates TARGET at ~24-30 FPS, while VISUAL points
// ease toward the target every frame with attack/release smoothing. This hides
// low-FPS stepping without raising analyser CPU cost.

export type CanvasPoint = { x: number; y: number };

export type SmartSpectrumState = {
  data?: Float32Array;
  peaks?: Float32Array;
  referenceData?: Float32Array;
  referencePeaks?: Float32Array;
  lastUpdateTs?: number;
  lastFrameTs?: number;
  targetFillPoints?: CanvasPoint[];
  visualFillPoints?: CanvasPoint[];
  targetReferencePoints?: CanvasPoint[];
  visualReferencePoints?: CanvasPoint[];
  layoutKey?: string;
};

export type SmartSpectrumOptions = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  accent: [number, number, number];
  enabled?: boolean;
  fillAlpha?: number;
  lineAlpha?: number;
  referenceAnalyser?: AnalyserNode | null;
  referenceAlpha?: number;
  postLabel?: string;
  referenceLabel?: string;
  floorDb?: number;
  ceilingDb?: number;
  maxPoints?: number;
  /** Read FFT at a lower rate, while still redrawing cached/smoothed points. */
  updateFps?: number;
  /** Set false to freeze the spectrum without touching analyser buffers. */
  readEnabled?: boolean;
  /** Milliseconds for the visual spectrum to glide toward new FFT targets. */
  motionMs?: number;
  timestamp?: number;
};

const F_MIN = 20;
const F_MAX = 20000;
const PINK_TILT_REF_HZ = 1000;
const DEFAULT_FLOOR_DB = -108;
const DEFAULT_CEILING_DB = -18;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function logFreqAt(t: number) {
  return Math.exp(Math.log(F_MIN) + t * (Math.log(F_MAX) - Math.log(F_MIN)));
}

function analyserBinFrequency(bin: number, nyquist: number, bins: number) {
  return (bin / Math.max(1, bins)) * nyquist;
}

function rgba([r, g, b]: [number, number, number], a: number) {
  return `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},${a})`;
}

export function addRoundedSpectrumPath(
  ctx: CanvasRenderingContext2D,
  points: CanvasPoint[],
  moveToStart = true,
) {
  if (!points.length) return;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (moveToStart) ctx.moveTo(points[0].x, points[0].y);
  else ctx.lineTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 2; i += 1) {
    const p = points[i];
    const next = points[i + 1];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  ctx.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
}

function pinkNoiseDisplayCompensation(frequency: number) {
  const f = clamp(frequency, F_MIN, F_MAX);
  const raw = 3.01029995664 * Math.log2(f / PINK_TILT_REF_HZ);
  const subEase = lerp(0.54, 1, smoothstep(42, 135, f));
  const airEase = lerp(1, 1.07, smoothstep(13500, 19000, f));
  return raw * subEase * airEase;
}

function spectrumVisualOctaveSpan(freq: number, peakLine: boolean) {
  const f = clamp(freq, F_MIN, F_MAX);
  const t = clamp(
    (Math.log10(f) - Math.log10(F_MIN)) / (Math.log10(F_MAX) - Math.log10(F_MIN)),
    0,
    1,
  );
  // Broad low-frequency mountains, needle-like high-frequency motion.
  const curved = Math.pow(t, 0.52);
  const lowSpan = peakLine ? 1.35 : 1.95;
  const highSpan = peakLine ? 0.0035 : 0.0055;
  return lerp(lowSpan, highSpan, curved);
}

function spectrumSmoothingRadius(freq: number, peakLine: boolean) {
  const f = clamp(freq, F_MIN, F_MAX);
  if (f < 70) return peakLine ? 14 : 20;
  if (f < 140) return peakLine ? 11 : 16;
  if (f < 300) return peakLine ? 6 : 9;
  if (f < 800) return peakLine ? 3 : 5;
  if (f < 2500) return peakLine ? 1 : 2;
  if (f < 9000) return peakLine ? 0 : 1;
  return 0;
}

function averagedSpectrumDb(
  data: Float32Array,
  peaks: Float32Array,
  bins: number,
  nyquist: number,
  centerFreq: number,
  peakLine: boolean,
  floorDb: number,
  ceilingDb: number,
) {
  const spanOct = spectrumVisualOctaveSpan(centerFreq, peakLine);
  const f0 = Math.max(1, centerFreq / Math.pow(2, spanOct / 2));
  const f1 = Math.min(nyquist * 0.985, centerFreq * Math.pow(2, spanOct / 2));
  const binHz = nyquist / Math.max(1, bins);
  let b0 = clamp(Math.floor(f0 / binHz), 1, bins - 1);
  let b1 = clamp(Math.ceil(f1 / binHz), b0 + 1, bins - 1);

  const minBins = centerFreq < 80 ? 4 : centerFreq < 160 ? 3 : 1;
  while (b1 - b0 + 1 < minBins && (b0 > 1 || b1 < bins - 1)) {
    if (b0 > 1) b0 -= 1;
    if (b1 < bins - 1) b1 += 1;
  }

  let weightedPower = 0;
  let weightSum = 0;
  let maxDb = floorDb;
  for (let b = b0; b <= b1; b += 1) {
    const sourceDb = peakLine ? peaks[b] : data[b];
    if (!Number.isFinite(sourceDb)) continue;
    const freq = clamp(analyserBinFrequency(b, nyquist, bins), F_MIN, F_MAX);
    const distanceOct = Math.abs(Math.log2(freq / centerFreq));
    const sigma = Math.max(centerFreq < 140 ? 0.22 : 0.008, spanOct * 0.36);
    const weight = Math.exp(-0.5 * Math.pow(distanceOct / sigma, 2));
    const edgeLift = smoothstep(17000, 20000, centerFreq) * 0.65;
    const displayDb = sourceDb + pinkNoiseDisplayCompensation(freq) + edgeLift;
    const db = clamp(displayDb, floorDb, ceilingDb);
    weightedPower += Math.pow(10, db / 10) * weight;
    weightSum += weight;
    maxDb = Math.max(maxDb, db);
  }

  if (weightSum <= 0) return floorDb;
  const powerAvgDb = 10 * Math.log10(Math.max(1e-12, weightedPower / weightSum));
  return peakLine ? powerAvgDb * 0.78 + maxDb * 0.22 : powerAvgDb * 0.965 + maxDb * 0.035;
}

function smoothAdaptiveSpectrum(values: number[], freqs: number[], peakLine: boolean) {
  const out = values.slice();
  const passes = peakLine ? 1 : 2;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.slice();
    for (let i = 0; i < out.length; i += 1) {
      const radius = spectrumSmoothingRadius(freqs[i] ?? 1000, peakLine);
      if (radius <= 0) {
        next[i] = out[i];
        continue;
      }
      let sum = 0;
      let weightSum = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(out.length - 1, i + radius); j += 1) {
        const distance = Math.abs(j - i);
        const weight = Math.exp(-0.5 * Math.pow(distance / Math.max(1, radius * 0.58), 2));
        sum += out[j] * weight;
        weightSum += weight;
      }
      next[i] = weightSum > 0 ? sum / weightSum : out[i];
    }
    for (let i = 0; i < out.length; i += 1) out[i] = next[i];
  }
  return out;
}

function buildSpectrumPoints(
  data: Float32Array,
  peaks: Float32Array,
  sampleRate: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
  peakLine: boolean,
  floorDb: number,
  ceilingDb: number,
  maxPoints: number,
): CanvasPoint[] {
  const bins = data.length;
  const nyquist = sampleRate / 2;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const count = clamp(Math.floor(width / 2.6), 180, maxPoints);
  const dbs: number[] = [];
  const freqs: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1);
    const freq = logFreqAt(t);
    freqs.push(freq);
    dbs.push(averagedSpectrumDb(data, peaks, bins, nyquist, freq, peakLine, floorDb, ceilingDb));
  }

  const smooth = smoothAdaptiveSpectrum(dbs, freqs, peakLine);
  return smooth.map((db, i) => {
    const n = (clamp(db, floorDb, ceilingDb) - floorDb) / (ceilingDb - floorDb);
    return {
      x: left + (i / Math.max(1, count - 1)) * width,
      y: bottom - n * height,
    };
  });
}

function resetIfLayoutChanged(state: SmartSpectrumState, options: SmartSpectrumOptions) {
  const key = `${Math.round(options.left)}:${Math.round(options.right)}:${Math.round(options.top)}:${Math.round(options.bottom)}:${options.maxPoints ?? 360}`;
  if (state.layoutKey === key) return;
  state.layoutKey = key;
  state.targetFillPoints = undefined;
  state.visualFillPoints = undefined;
  state.targetReferencePoints = undefined;
  state.visualReferencePoints = undefined;
  state.lastFrameTs = undefined;
  state.lastUpdateTs = undefined;
}

function clonePoints(points: CanvasPoint[]) {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

function animateSpectrumPoints(
  visual: CanvasPoint[] | undefined,
  target: CanvasPoint[] | undefined,
  dtMs: number,
  motionMs: number,
): CanvasPoint[] | undefined {
  if (!target?.length) return visual;
  if (!visual || visual.length !== target.length) return clonePoints(target);

  const dt = clamp(dtMs, 0, 50) / 1000;
  const baseTau = clamp(motionMs, 38, 220) / 1000;
  const out: CanvasPoint[] = new Array(target.length);

  for (let i = 0; i < target.length; i += 1) {
    const current = visual[i];
    const next = target[i];
    const dy = next.y - current.y;
    // Upward spectrum movement is attack; downward movement is release. The
    // different constants hide stepped FFT updates but keep transients alive.
    const tau = dy < 0 ? baseTau * 0.48 : baseTau * 1.35;
    const alpha = clamp(1 - Math.exp(-dt / Math.max(0.001, tau)), 0.05, 0.62);
    out[i] = { x: next.x, y: Math.abs(dy) < 0.08 ? next.y : current.y + dy * alpha };
  }

  return out;
}

export function drawSmartSpectrum(
  ctx: CanvasRenderingContext2D,
  analyser: AnalyserNode | null,
  state: SmartSpectrumState,
  options: SmartSpectrumOptions,
) {
  const enabled = options.enabled ?? true;
  if (!enabled || !analyser) return;

  resetIfLayoutChanged(state, options);

  const now = options.timestamp ?? performance.now();
  const updateFps = clamp(options.updateFps ?? 26, 10, 60);
  const readEnabled = options.readEnabled ?? true;
  const floorDb = options.floorDb ?? DEFAULT_FLOOR_DB;
  const ceilingDb = options.ceilingDb ?? DEFAULT_CEILING_DB;
  const shouldRead =
    readEnabled &&
    (!state.lastUpdateTs ||
      now - state.lastUpdateTs >= 1000 / updateFps ||
      !state.targetFillPoints);

  if (shouldRead) {
    const bins = analyser.frequencyBinCount;
    if (!state.data || state.data.length !== bins) state.data = new Float32Array(bins);
    if (!state.peaks || state.peaks.length !== bins)
      state.peaks = new Float32Array(bins).fill(floorDb);

    const data = state.data;
    const peaks = state.peaks;
    analyser.getFloatFrequencyData(data as Float32Array<ArrayBuffer>);
    for (let i = 1; i < bins; i += 1) peaks[i] = Math.max(data[i], peaks[i] - 0.42);

    state.targetFillPoints = buildSpectrumPoints(
      data,
      peaks,
      analyser.context.sampleRate,
      options.left,
      options.right,
      options.top,
      options.bottom,
      false,
      floorDb,
      ceilingDb,
      options.maxPoints ?? 360,
    );

    const referenceAnalyser = options.referenceAnalyser ?? null;
    if (referenceAnalyser && (options.referenceAlpha ?? 0.42) > 0) {
      const refBins = referenceAnalyser.frequencyBinCount;
      if (!state.referenceData || state.referenceData.length !== refBins) {
        state.referenceData = new Float32Array(refBins);
      }
      if (!state.referencePeaks || state.referencePeaks.length !== refBins) {
        state.referencePeaks = new Float32Array(refBins).fill(floorDb);
      }
      const referenceData = state.referenceData;
      const referencePeaks = state.referencePeaks;
      referenceAnalyser.getFloatFrequencyData(referenceData as Float32Array<ArrayBuffer>);
      for (let i = 1; i < refBins; i += 1) {
        referencePeaks[i] = Math.max(referenceData[i], referencePeaks[i] - 0.42);
      }
      state.targetReferencePoints = buildSpectrumPoints(
        referenceData,
        referencePeaks,
        referenceAnalyser.context.sampleRate,
        options.left,
        options.right,
        options.top,
        options.bottom,
        false,
        floorDb,
        ceilingDb,
        options.maxPoints ?? 360,
      );
    } else {
      state.targetReferencePoints = undefined;
      state.visualReferencePoints = undefined;
    }

    state.lastUpdateTs = now;
  }

  const dtMs = state.lastFrameTs ? now - state.lastFrameTs : 16.7;
  state.lastFrameTs = now;
  const motionMs = options.motionMs ?? 92;
  state.visualFillPoints = animateSpectrumPoints(
    state.visualFillPoints,
    state.targetFillPoints,
    dtMs,
    motionMs,
  );
  state.visualReferencePoints = animateSpectrumPoints(
    state.visualReferencePoints,
    state.targetReferencePoints,
    dtMs,
    motionMs * 1.15,
  );

  const fillPoints = state.visualFillPoints;
  if (!fillPoints?.length) return;

  ctx.beginPath();
  ctx.moveTo(options.left, options.bottom);
  addRoundedSpectrumPath(ctx, fillPoints, false);
  ctx.lineTo(options.right, options.bottom);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, options.top, 0, options.bottom);
  grad.addColorStop(0, rgba(options.accent, options.fillAlpha ?? 0.32));
  grad.addColorStop(1, rgba(options.accent, 0.03));
  ctx.fillStyle = grad;
  ctx.fill();

  const lineAlpha = options.lineAlpha ?? 0;
  if (lineAlpha > 0) {
    ctx.beginPath();
    addRoundedSpectrumPath(ctx, fillPoints);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = rgba(options.accent, lineAlpha);
    ctx.stroke();
  }

  const referencePoints = state.visualReferencePoints;
  const referenceAlpha = options.referenceAlpha ?? 0.42;
  if (referencePoints?.length && referenceAlpha > 0) {
    ctx.save();
    ctx.beginPath();
    addRoundedSpectrumPath(ctx, referencePoints);
    ctx.lineWidth = 1.05;
    ctx.strokeStyle = `rgba(245,248,255,${referenceAlpha})`;
    ctx.shadowColor = `rgba(210,230,255,${Math.min(0.28, referenceAlpha * 0.6)})`;
    ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.restore();

    const postLabel = options.postLabel ?? "POST";
    const refLabel = options.referenceLabel ?? "BEFORE";
    const x = options.left + 10;
    const y = options.top + 12;
    ctx.save();
    ctx.font = "9.5px 'Sometype Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = rgba(options.accent, 0.86);
    ctx.fillText(postLabel, x, y);
    ctx.fillStyle = `rgba(245,248,255,${Math.min(0.74, referenceAlpha + 0.22)})`;
    ctx.fillText(refLabel, x + Math.max(56, postLabel.length * 6.2 + 18), y);
    ctx.restore();
  }
}
