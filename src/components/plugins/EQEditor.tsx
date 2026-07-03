// FabFilter Pro-Q–style parametric EQ.
//
// Interactions:
//   • Double-click empty area  → add a bell band at the cursor freq/gain
//   • Double-click a band node → remove it
//   • Drag a node              → frequency (X) + gain (Y)
//   • Scroll over a node       → Q (bells/shelves) or slope (cuts)
//   • Click a node             → select it for the inspector
//
// Visuals: live spectrum analyser behind the curve, gradient-filled total
// response, per-band ghost curves, glowing draggable handles, and a cursor
// readout with the nearest musical note.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Knob } from "@/components/Knob";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import {
  BUTTERWORTH_Q,
  EQ_TYPE_LABELS,
  type EqBand,
  type EqType,
  isCutType,
  toWebAudioType,
} from "@/audio/presets";
import { cn } from "@/lib/utils";
import { PluginHeader } from "@/components/plugins/_shell/PluginShell";
import {
  drawSmartSpectrum,
  type SmartSpectrumState,
} from "@/components/plugins/_shell/spectrumCanvas";

const F_MIN = 20;
const F_MAX = 20000;
const DB_RANGE = 18; // vertical half-range in dB
const SPECTRUM_FLOOR = -108; // dB floor for the analyser fill
const SPECTRUM_CEILING = -18;
const PINK_TILT_REF_HZ = 1000;
const HIT_RADIUS = 14;

function freqToX(f: number, w: number) {
  const r = (Math.log(f) - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN));
  return r * w;
}
function xToFreq(x: number, w: number) {
  const r = x / w;
  return Math.exp(Math.log(F_MIN) + r * (Math.log(F_MAX) - Math.log(F_MIN)));
}
function dbToY(db: number, h: number) {
  return h / 2 - (db / DB_RANGE) * (h / 2);
}
function yToDb(y: number, h: number) {
  return -((y - h / 2) / (h / 2)) * DB_RANGE;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function freqToNote(f: number): string {
  const midi = Math.round(12 * Math.log2(f / 440) + 69);
  if (!Number.isFinite(midi)) return "";
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

const BAND_COLORS = [
  "oklch(0.80 0.17 25)",
  "oklch(0.82 0.16 65)",
  "oklch(0.84 0.16 120)",
  "oklch(0.84 0.15 175)",
  "oklch(0.82 0.16 215)",
  "oklch(0.80 0.17 270)",
  "oklch(0.80 0.18 320)",
  "oklch(0.80 0.18 350)",
];
const colorFor = (i: number) => BAND_COLORS[i % BAND_COLORS.length];

// Canvas can't resolve CSS custom properties or color-mix(), so we resolve any
// CSS color string to concrete [r,g,b] by painting it onto a 1x1 canvas and
// reading the sRGB bytes back (robust across oklch / color() / named colors).
let _probeCtx: CanvasRenderingContext2D | null = null;
function resolveRGB(css: string): [number, number, number] {
  if (typeof document === "undefined") return [56, 214, 232];
  if (!_probeCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _probeCtx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!_probeCtx) return [56, 214, 232];
  try {
    _probeCtx.clearRect(0, 0, 1, 1);
    _probeCtx.fillStyle = "#000";
    _probeCtx.fillStyle = css.trim();
    _probeCtx.fillRect(0, 0, 1, 1);
    const d = _probeCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return [56, 214, 232];
  }
}
const rgba = ([r, g, b]: [number, number, number], a: number) =>
  `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},${a})`;
const rgb = (c: [number, number, number]) => rgba(c, 1);

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
type CanvasPoint = { x: number; y: number };

function addRoundedPath(ctx: CanvasRenderingContext2D, points: CanvasPoint[], moveToStart = true) {
  if (points.length === 0) return;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (moveToStart) ctx.moveTo(points[0].x, points[0].y);
  else ctx.lineTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 2; i++) {
    const p = points[i];
    const next = points[i + 1];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  ctx.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
}

function smoothValues(values: number[], passes = 2) {
  let out = values.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next = out.slice();
    for (let i = 1; i < out.length - 1; i++) {
      next[i] = out[i - 1] * 0.22 + out[i] * 0.56 + out[i + 1] * 0.22;
    }
    out = next;
  }
  return out;
}

function sampledCurvePoints(
  arr: Float64Array,
  w: number,
  h: number,
  maxPoints = 220,
): CanvasPoint[] {
  const n = arr.length;
  if (n === 0) return [];
  const target = clamp(Math.floor(w / 4), 72, maxPoints);
  const step = Math.max(1, Math.ceil(n / target));
  const points: CanvasPoint[] = [];
  for (let i = 0; i < n; i += step) {
    points.push({ x: (i / Math.max(1, n - 1)) * w, y: dbToY(arr[i], h) });
  }
  if (points[points.length - 1]?.x !== w) {
    points.push({ x: w, y: dbToY(arr[n - 1], h) });
  }
  return points;
}

function pinkNoiseDisplayCompensation(frequency: number) {
  // Constant-Q / fractional-octave visualisation should not use a raw linear
  // FFT-bin slope. We keep a calibrated +3 dB/oct pink-noise tilt, but soften
  // it at the sub edge so 20–60 Hz does not collapse into a fake flat floor.
  // This is display-only; the audio path is untouched.
  const f = clamp(frequency, F_MIN, F_MAX);
  const raw = 3.01029995664 * Math.log2(f / PINK_TILT_REF_HZ);
  const subEase = lerp(0.58, 1, smoothstep(46, 130, f));
  const airEase = lerp(1, 1.09, smoothstep(13500, 19000, f));
  return raw * subEase * airEase;
}

function spectrumVisualOctaveSpan(freq: number, peakLine: boolean) {
  // Constant-Q / fractional-octave display window. The visual bandwidth must
  // not be linear: low-frequency energy is perceived and measured in wide
  // octave bands, while high-frequency detail needs a much narrower window.
  // This produces broad, natural bass mountains and thin/responsive treble.
  const f = clamp(freq, F_MIN, F_MAX);
  const t = clamp(
    (Math.log10(f) - Math.log10(F_MIN)) / (Math.log10(F_MAX) - Math.log10(F_MIN)),
    0,
    1,
  );
  const curved = Math.pow(t, 0.72);
  const lowSpan = peakLine ? 0.86 : 1.18;
  const highSpan = peakLine ? 0.012 : 0.018;
  return lerp(lowSpan, highSpan, curved);
}

function spectrumSmoothingRadius(freq: number, peakLine: boolean) {
  // Additional log-bucket smoothing after the power average. Keep it strongly
  // frequency-dependent: sub/bass is a wide envelope, treble is almost raw.
  const f = clamp(freq, F_MIN, F_MAX);
  if (f < 70) return peakLine ? 8 : 11;
  if (f < 140) return peakLine ? 6 : 9;
  if (f < 300) return peakLine ? 4 : 6;
  if (f < 800) return peakLine ? 3 : 4;
  if (f < 2500) return peakLine ? 2 : 3;
  if (f < 9000) return peakLine ? 1 : 2;
  return 1;
}

function analyserBinFrequency(bin: number, nyquist: number, bins: number) {
  return (bin / Math.max(1, bins)) * nyquist;
}

function averagedSpectrumDb(
  data: Float32Array,
  peaks: Float32Array,
  bins: number,
  nyquist: number,
  centerFreq: number,
  peakLine: boolean,
) {
  const spanOct = spectrumVisualOctaveSpan(centerFreq, peakLine);
  const f0 = Math.max(1, centerFreq / Math.pow(2, spanOct / 2));
  const f1 = Math.min(nyquist * 0.985, centerFreq * Math.pow(2, spanOct / 2));
  const binHz = nyquist / Math.max(1, bins);

  // Use the real FFT bin frequencies. With fftSize 16384 this gives about
  // 2.7–3 Hz low-end resolution at common sample rates, so 20–60 Hz can be
  // drawn from actual bins instead of a fake horizontal end-cap.
  let b0 = clamp(Math.floor(f0 / binHz), 1, bins - 1);
  let b1 = clamp(Math.ceil(f1 / binHz), b0 + 1, bins - 1);

  // Ensure every bucket has enough bins for a stable power average without
  // smearing the whole sub-bass range into a flat line.
  const minBins = centerFreq < 80 ? 3 : centerFreq < 160 ? 2 : 1;
  while (b1 - b0 + 1 < minBins && (b0 > 1 || b1 < bins - 1)) {
    if (b0 > 1) b0 -= 1;
    if (b1 < bins - 1) b1 += 1;
  }

  let weightedPower = 0;
  let weightSum = 0;
  let maxDb = SPECTRUM_FLOOR;
  for (let b = b0; b <= b1; b++) {
    const sourceDb = peakLine ? peaks[b] : data[b];
    if (!Number.isFinite(sourceDb)) continue;
    const freq = clamp(analyserBinFrequency(b, nyquist, bins), F_MIN, F_MAX);
    const distanceOct = Math.abs(Math.log2(freq / centerFreq));
    const sigma = Math.max(centerFreq < 120 ? 0.12 : 0.018, spanOct * 0.42);
    const weight = Math.exp(-0.5 * Math.pow(distanceOct / sigma, 2));
    const edgeLift = smoothstep(17000, 20000, centerFreq) * 0.75;
    const displayDb = sourceDb + pinkNoiseDisplayCompensation(freq) + edgeLift;
    const db = clamp(displayDb, SPECTRUM_FLOOR, SPECTRUM_CEILING);
    weightedPower += Math.pow(10, db / 10) * weight;
    weightSum += weight;
    maxDb = Math.max(maxDb, db);
  }

  if (weightSum <= 0) return SPECTRUM_FLOOR;
  const powerAvgDb = 10 * Math.log10(Math.max(1e-12, weightedPower / weightSum));
  return peakLine ? powerAvgDb * 0.76 + maxDb * 0.24 : powerAvgDb * 0.96 + maxDb * 0.04;
}

function smoothAdaptiveSpectrum(values: number[], freqs: number[], peakLine: boolean) {
  const out = values.slice();
  const passes = peakLine ? 1 : 2;
  for (let pass = 0; pass < passes; pass++) {
    const next = out.slice();
    for (let i = 0; i < out.length; i++) {
      const f = freqs[i] ?? 1000;
      const radius = spectrumSmoothingRadius(f, peakLine);
      let sum = 0;
      let weightSum = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(out.length - 1, i + radius); j++) {
        const distance = Math.abs(j - i);
        const weight = Math.exp(-0.5 * Math.pow(distance / Math.max(1, radius * 0.62), 2));
        sum += out[j] * weight;
        weightSum += weight;
      }
      next[i] = weightSum > 0 ? sum / weightSum : out[i];
    }
    for (let i = 0; i < out.length; i++) out[i] = next[i];
  }
  return out;
}

function buildSpectrumPoints(
  data: Float32Array,
  peaks: Float32Array,
  sampleRate: number,
  w: number,
  h: number,
  specY: (db: number) => number,
  peakLine: boolean,
): CanvasPoint[] {
  const bins = data.length;
  const nyquist = sampleRate / 2;
  const count = clamp(Math.floor(w / 3.6), 140, 340);
  const dbs: number[] = [];
  const freqs: number[] = [];

  for (let i = 0; i < count; i++) {
    const x = (i / Math.max(1, count - 1)) * w;
    const freq = xToFreq(x, w);
    freqs.push(freq);
    dbs.push(averagedSpectrumDb(data, peaks, bins, nyquist, freq, peakLine));
  }

  const smooth = smoothAdaptiveSpectrum(dbs, freqs, peakLine);

  return smooth.map((db, i) => ({
    x: (i / Math.max(1, count - 1)) * w,
    y: specY(db),
  }));
}

export function EQEditor() {
  const eqEnabled = useApp((s) => s.settings.eqEnabled);
  const bypass = useApp((s) => s.settings.output.bypass);
  const bands = useApp((s) => s.settings.eq);
  const setEqEnabled = useApp((s) => s.setEqEnabled);
  const updateBand = useApp((s) => s.updateEqBand);
  const addBand = useApp((s) => s.addEqBand);
  const removeBand = useApp((s) => s.removeEqBand);
  const beginUserEdit = useApp((s) => s.beginUserEdit);
  const endUserEdit = useApp((s) => s.endUserEdit);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Live refs so the rAF render loop reads the freshest values without
  // re-subscribing every frame.
  const bandsRef = useRef(bands);
  const enabledRef = useRef(eqEnabled);
  const bypassRef = useRef(bypass);
  const selRef = useRef<string | null>(selectedId);
  const hoverRef = useRef<string | null>(hoverId);
  const cursorRef = useRef<{ x: number; y: number } | null>(cursor);
  const sizeRef = useRef({ w: 0, h: 0 });
  bandsRef.current = bands;
  enabledRef.current = eqEnabled;
  bypassRef.current = bypass;
  selRef.current = selectedId;
  hoverRef.current = hoverId;
  cursorRef.current = cursor;

  // Cached frequency response, recomputed only when bands/size change.
  const responseRef = useRef<{ total: Float64Array; perBand: Float64Array[]; w: number }>({
    total: new Float64Array(0),
    perBand: [],
    w: 0,
  });

  // Shared spectrum renderer state. EQ, Color, and Width now use the same
  // calibration, peak-hold decay, constant-Q smoothing, and rounded animation.
  const spectrumRef = useRef<SmartSpectrumState>({});

  // Resolved colors (primary + per-band) so the canvas can use rgba().
  const paletteRef = useRef<{
    primary: [number, number, number];
    bands: [number, number, number][];
  }>({
    primary: [56, 214, 232],
    bands: BAND_COLORS.map(() => [56, 214, 232] as [number, number, number]),
  });

  const dragRef = useRef<{ id: string } | null>(null);
  const downRef = useRef<{ x: number; y: number; bandId: string | null; moved: boolean } | null>(
    null,
  );
  const tapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const selected = bands.find((b) => b.id === selectedId) ?? null;

  // --- Response computation (offline biquad eval) -------------------------
  const computeResponse = useCallback(() => {
    const w = sizeRef.current.w;
    if (w <= 0) return;
    const N = clamp(Math.floor(w / 3), 96, 260);
    const sampleRate = 48000;
    const off = new OfflineAudioContext({ length: 1, sampleRate, numberOfChannels: 1 });
    const freqArr = new Float32Array(N);
    for (let i = 0; i < N; i++) freqArr[i] = xToFreq((i / Math.max(1, N - 1)) * w, w);
    const mag = new Float32Array(N);
    const phase = new Float32Array(N);

    const total = new Float64Array(N);
    const perBand: Float64Array[] = [];
    const list = bandsRef.current;
    const on = enabledRef.current;

    for (const band of list) {
      const bandDb = new Float64Array(N);
      if (!on || !band.enabled) {
        perBand.push(bandDb);
        continue;
      }
      const qs = isCutType(band.type) ? (BUTTERWORTH_Q[band.slope] ?? [band.q]) : [band.q];
      for (let g = 0; g < qs.length; g++) {
        const f = off.createBiquadFilter();
        f.type = toWebAudioType(band.type);
        f.frequency.value = band.frequency;
        f.gain.value = isCutType(band.type) ? 0 : band.gain;
        f.Q.value = qs[g] ?? band.q;
        f.getFrequencyResponse(freqArr, mag, phase);
        for (let i = 0; i < N; i++) bandDb[i] += 20 * Math.log10(Math.max(mag[i], 1e-12));
      }
      for (let i = 0; i < N; i++) total[i] += bandDb[i];
      perBand.push(bandDb);
    }
    responseRef.current = { total, perBand, w };
  }, []);

  useEffect(() => {
    computeResponse();
  }, [bands, eqEnabled, computeResponse]);

  // --- Sizing -------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    // Resolve theme colors once (and whenever this mounts).
    const cs = getComputedStyle(wrap);
    const primaryCss =
      cs.getPropertyValue("--color-primary").trim() ||
      cs.getPropertyValue("--primary").trim() ||
      "oklch(0.82 0.16 210)";
    paletteRef.current = {
      primary: resolveRGB(primaryCss),
      bands: BAND_COLORS.map((c) => resolveRGB(c)),
    };
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      computeResponse();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [computeResponse]);

  // --- Render loop --------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    const draw = (ts = performance.now()) => {
      raf = requestAnimationFrame(draw);
      const targetFps = dragRef.current ? 60 : 30;
      if (lastPaint && ts - lastPaint < 1000 / targetFps) return;
      lastPaint = ts;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { w, h } = sizeRef.current;
      if (w <= 0 || h <= 0) return;

      const on = enabledRef.current;
      const list = bandsRef.current;
      const sel = selRef.current;
      const hov = hoverRef.current;
      const cur = cursorRef.current;
      const PRI = paletteRef.current.primary;
      const BANDC = paletteRef.current.bands;
      const bandRGB = (i: number) => BANDC[i % BANDC.length];

      ctx.clearRect(0, 0, w, h);

      // Background grid -----------------------------------------------------
      for (let d = -12; d <= 12; d += 6) {
        const y = dbToY(d, h);
        ctx.strokeStyle = d === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.045)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.font = "10px 'Sometype Mono', monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(`${d > 0 ? "+" : ""}${d}`, w - 5, y - 7);
      }
      const labelFreqs = [
        [30, "30"],
        [50, "50"],
        [100, "100"],
        [200, "200"],
        [500, "500"],
        [1000, "1k"],
        [2000, "2k"],
        [5000, "5k"],
        [10000, "10k"],
        [20000, "20k"],
      ] as const;
      const tickFreqs = [
        20, 30, 40, 50, 70, 100, 200, 300, 500, 700, 1000, 2000, 3000, 5000, 7000, 10000, 20000,
      ];
      for (const f of tickFreqs) {
        const x = freqToX(f, w);
        const major = labelFreqs.some(([lf]) => lf === f);
        ctx.strokeStyle = major ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.font = "10px 'Sometype Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const [f, label] of labelFreqs) ctx.fillText(label, freqToX(f, w), h - 3);

      // Live spectrum -------------------------------------------------------
      // Single source of truth: EQ, Color, and Width all use the same shared
      // constant-Q spectrum renderer. The only intentional difference on FX
      // pages is tint color and the active/open gate.
      const player = getPlayer();
      const beforeAnalyser = player.inputAnalyser;
      // EQ shows the signal after the EQ section as the main filled spectrum.
      // The thin white line is the before/reference signal from the staged file input.
      const postAnalyser = bypassRef.current
        ? beforeAnalyser
        : (player.compInAnalyser ?? player.outputAnalyser ?? beforeAnalyser);
      drawSmartSpectrum(ctx, postAnalyser, spectrumRef.current, {
        left: 0,
        right: w,
        top: 0,
        bottom: h,
        accent: PRI,
        enabled: true,
        readEnabled: useApp.getState().isPlaying && !document.hidden,
        timestamp: ts,
        updateFps: dragRef.current ? 36 : 26,
        motionMs: dragRef.current ? 62 : 96,
        fillAlpha: 0.34,
        lineAlpha: 0.18,
        referenceAnalyser:
          postAnalyser && beforeAnalyser && postAnalyser !== beforeAnalyser ? beforeAnalyser : null,
        referenceAlpha: 0.4,
        postLabel: "POST EQ",
        referenceLabel: "BEFORE",
        floorDb: SPECTRUM_FLOOR,
        ceilingDb: SPECTRUM_CEILING,
        maxPoints: 360,
      });

      const { total, perBand } = responseRef.current;
      const N = total.length;

      // Per-band ghost curves ----------------------------------------------
      if (N > 1) {
        list.forEach((band, idx) => {
          const arr = perBand[idx];
          if (!arr) return;
          const isSel = band.id === sel || band.id === hov;
          ctx.strokeStyle = rgb(bandRGB(idx));
          ctx.globalAlpha = band.enabled && on ? (isSel ? 0.7 : 0.28) : 0.08;
          ctx.lineWidth = isSel ? 1.5 : 1;
          ctx.beginPath();
          addRoundedPath(ctx, sampledCurvePoints(arr, w, h, 170));
          ctx.stroke();
        });
        ctx.globalAlpha = 1;

        // Total curve — fewer sampled points, rounded path, filled to 0 dB.
        const totalPoints = sampledCurvePoints(total, w, h, 220);
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        if (totalPoints.length) addRoundedPath(ctx, totalPoints, false);
        ctx.lineTo(w, h / 2);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
        fillGrad.addColorStop(0, rgba(PRI, 0.15));
        fillGrad.addColorStop(0.5, rgba(PRI, 0.06));
        fillGrad.addColorStop(1, rgba(PRI, 0.15));
        ctx.fillStyle = on ? fillGrad : "transparent";
        ctx.fill();

        ctx.strokeStyle = on ? rgb(PRI) : "rgba(255,255,255,0.25)";
        ctx.lineWidth = 2.35;
        ctx.shadowColor = rgba(PRI, 0.62);
        ctx.shadowBlur = on ? 9 : 0;
        ctx.beginPath();
        addRoundedPath(ctx, totalPoints);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Cursor crosshair ----------------------------------------------------
      if (cur && !dragRef.current) {
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cur.x, 0);
        ctx.lineTo(cur.x, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Band handles --------------------------------------------------------
      list.forEach((band, idx) => {
        const x = freqToX(band.frequency, w);
        const y = isCutType(band.type) ? h / 2 : dbToY(band.gain, h);
        const isSel = band.id === sel;
        const isHov = band.id === hov;
        const base = band.enabled ? 7 : 5;
        const r = isSel ? base + 2 : isHov ? base + 1 : base;
        const active = band.enabled && on;

        // selection halo
        if (isSel) {
          ctx.beginPath();
          ctx.arc(x, y, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = rgba(bandRGB(idx), 0.16);
          ctx.fill();
        }
        // vertical tether to 0 line for bells/shelves
        if (!isCutType(band.type) && Math.abs(y - h / 2) > 2) {
          ctx.strokeStyle = rgba(bandRGB(idx), 0.35);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(x, h / 2);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.globalAlpha = active ? 1 : 0.4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgb(bandRGB(idx));
        if (isSel || isHov) {
          ctx.shadowColor = rgb(bandRGB(idx));
          ctx.shadowBlur = 12;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(8,10,14,0.65)";
        ctx.stroke();

        ctx.fillStyle = "#07090d";
        ctx.font = "600 9px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(idx + 1), x, y + 0.5);
        ctx.globalAlpha = 1;
      });

      // Active node readout -------------------------------------------------
      const activeBand = list.find((b) => b.id === (dragRef.current?.id ?? sel ?? hov));
      if (activeBand) {
        const x = freqToX(activeBand.frequency, w);
        const y = isCutType(activeBand.type) ? h / 2 : dbToY(activeBand.gain, h);
        const fTxt =
          activeBand.frequency >= 1000
            ? `${(activeBand.frequency / 1000).toFixed(2)}k`
            : `${activeBand.frequency.toFixed(0)}`;
        const parts = [`${fTxt}Hz`, freqToNote(activeBand.frequency)];
        if (!isCutType(activeBand.type))
          parts.push(`${activeBand.gain >= 0 ? "+" : ""}${activeBand.gain.toFixed(1)}dB`);
        parts.push(
          isCutType(activeBand.type) ? `${activeBand.slope}dB/oct` : `Q ${activeBand.q.toFixed(2)}`,
        );
        const txt = parts.join("  ·  ");
        ctx.font = "11px 'Sometype Mono', monospace";
        const tw = ctx.measureText(txt).width + 16;
        let bx = x - tw / 2;
        bx = Math.max(4, Math.min(w - tw - 4, bx));
        const by = Math.max(6, y - 30);
        ctx.fillStyle = "rgba(12,15,20,0.92)";
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, tw, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, bx + tw / 2, by + 10.5);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- Hit testing & pointer handlers ------------------------------------
  const hitTest = (x: number, y: number): EqBand | null => {
    const { w, h } = sizeRef.current;
    const list = bandsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const bx = freqToX(b.frequency, w);
      const by = isCutType(b.type) ? h / 2 : dbToY(b.gain, h);
      if (Math.hypot(x - bx, y - by) <= HIT_RADIUS) return b;
    }
    return null;
  };

  const localPos = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
  };

  const addBandAt = (x: number, y: number, w: number, h: number) => {
    const freq = Math.max(F_MIN, Math.min(F_MAX, xToFreq(x, w)));
    const gain = Math.max(-DB_RANGE, Math.min(DB_RANGE, yToDb(y, h)));
    const id = `band-${Date.now()}`;
    addBand({
      id,
      label: "Bell",
      type: "bell",
      frequency: freq,
      gain: Math.round(gain * 10) / 10,
      q: 1,
      slope: 12,
      enabled: true,
    });
    setSelectedId(id);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = localPos(e);
    const b = hitTest(x, y);
    downRef.current = { x, y, bandId: b?.id ?? null, moved: false };
    if (b) {
      beginUserEdit("Move EQ band");
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { id: b.id };
      setSelectedId(b.id);
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y, rect } = localPos(e);
    setCursor({ x, y });
    if (!dragRef.current) {
      const b = hitTest(x, y);
      setHoverId(b?.id ?? null);
      return;
    }
    const down = downRef.current;
    if (down && Math.hypot(x - down.x, y - down.y) > 4) down.moved = true;
    const cx = Math.max(0, Math.min(rect.width, x));
    const cy = Math.max(0, Math.min(rect.height, y));
    const band = bandsRef.current.find((b) => b.id === dragRef.current!.id);
    if (!band) return;
    const patch: Partial<EqBand> = {
      frequency: Math.max(F_MIN, Math.min(F_MAX, xToFreq(cx, rect.width))),
    };
    if (!isCutType(band.type)) {
      patch.gain = Math.max(-DB_RANGE, Math.min(DB_RANGE, yToDb(cy, rect.height)));
    }
    updateBand(band.id, patch);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const { rect } = localPos(e);
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    const down = downRef.current;
    const wasDrag = Boolean(dragRef.current && down?.moved);
    if (dragRef.current) endUserEdit("Move EQ band");
    dragRef.current = null;
    downRef.current = null;
    if (!down || wasDrag) {
      tapRef.current = null;
      return;
    }
    // Tap (no meaningful movement). Detect double-tap → add / remove.
    const now = performance.now();
    const prev = tapRef.current;
    const isDouble =
      prev && now - prev.t < 320 && Math.hypot(down.x - prev.x, down.y - prev.y) < 14;
    if (isDouble) {
      tapRef.current = null;
      if (down.bandId) {
        removeBand(down.bandId);
        if (selRef.current === down.bandId) setSelectedId(null);
      } else {
        addBandAt(down.x, down.y, rect.width, rect.height);
      }
    } else {
      tapRef.current = { t: now, x: down.x, y: down.y };
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const { x, y } = localPos(e);
    const b =
      hitTest(x, y) ?? (selectedId ? bandsRef.current.find((bb) => bb.id === selectedId) : null);
    if (!b) return;
    e.preventDefault();
    if (isCutType(b.type)) {
      const slopes: (12 | 24 | 36 | 48)[] = [12, 24, 36, 48];
      const idx = slopes.indexOf(b.slope);
      const next = slopes[Math.max(0, Math.min(slopes.length - 1, idx + (e.deltaY > 0 ? -1 : 1)))];
      updateBand(b.id, { slope: next });
    } else {
      const factor = e.deltaY > 0 ? 0.9 : 1.111;
      updateBand(b.id, { q: Math.max(0.1, Math.min(24, b.q * factor)) });
    }
  };

  const onLeave = () => {
    setCursor(null);
    if (!dragRef.current) setHoverId(null);
  };

  const activeCount = bands.filter((b) => b.enabled).length;

  return (
    <div className={cn("flex h-full flex-col", bypass && "ms-bypass-muted-shell")}>
      <PluginHeader
        title="Parametric EQ"
        accent="eq"
        rightSlot={
          <>
            <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
              {bands.length} bands · {activeCount} active
            </span>
            <span className="hidden text-[10px] text-muted-foreground md:inline">
              dbl-click add · drag move · scroll Q
            </span>
          </>
        }
        enabled={eqEnabled}
        onToggleEnabled={() => setEqEnabled(!eqEnabled)}
      />

      {/* Graph */}
      <div
        ref={wrapRef}
        className={cn(
          "relative flex-1 touch-none select-none bg-panel",
          dragRef.current ? "cursor-grabbing" : hoverId ? "cursor-grab" : "cursor-crosshair",
        )}
        style={{ minHeight: 240 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onPointerLeave={onLeave}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>

      {/* Band chips + inspector */}
      <div className="border-t border-border bg-panel-soft">
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pt-2.5 pb-2">
          {bands.map((b, idx) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedId(b.id)}
              onMouseEnter={() => setHoverId(b.id)}
              onMouseLeave={() => setHoverId(null)}
              className={cn(
                "group inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition",
                selectedId === b.id
                  ? "border-border bg-panel"
                  : "border-transparent bg-transparent hover:bg-panel/60",
              )}
              style={selectedId === b.id ? { borderColor: colorFor(idx) } : undefined}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background:
                    b.enabled && eqEnabled ? colorFor(idx) : "var(--color-muted-foreground)",
                  opacity: b.enabled && eqEnabled ? 1 : 0.4,
                }}
              />
              <span className="ms-mono tabular-nums text-foreground/80">
                {b.frequency >= 1000
                  ? `${(b.frequency / 1000).toFixed(1)}k`
                  : b.frequency.toFixed(0)}
              </span>
              <span className="text-muted-foreground">{EQ_TYPE_LABELS[b.type]}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const id = `band-${Date.now()}`;
              addBand({
                id,
                label: "Bell",
                type: "bell",
                frequency: 1000,
                gain: 0,
                q: 1,
                slope: 12,
                enabled: true,
              });
              setSelectedId(id);
            }}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            Add band
          </button>
        </div>

        <BandInspector
          band={selected}
          index={selected ? bands.findIndex((b) => b.id === selected.id) : -1}
          updateBand={updateBand}
          removeBand={(id) => {
            removeBand(id);
            setSelectedId(null);
          }}
        />
      </div>
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function BandInspector({
  band,
  index,
  updateBand,
  removeBand,
}: {
  band: EqBand | null;
  index: number;
  updateBand: (id: string, patch: Partial<EqBand>) => void;
  removeBand: (id: string) => void;
}) {
  if (!band) {
    return (
      <div className="flex h-[92px] items-center justify-center border-t border-border px-4 text-[11px] text-muted-foreground">
        Select a band — or double-click the graph to add one
      </div>
    );
  }
  const color = colorFor(index);
  const cut = isCutType(band.type);

  return (
    <div className="flex items-center gap-4 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => updateBand(band.id, { enabled: !band.enabled })}
          title={band.enabled ? "Disable band" : "Enable band"}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md border transition",
            band.enabled ? "border-transparent" : "border-border opacity-50",
          )}
          style={band.enabled ? { background: color, color: "#07090d" } : undefined}
        >
          <span className="text-[11px] font-bold">{index + 1}</span>
        </button>
        <select
          value={band.type}
          onChange={(e) => updateBand(band.id, { type: e.target.value as EqType })}
          className="h-8 rounded-md border border-border bg-panel px-2 text-[11px] text-foreground/85 outline-none focus:border-primary/50"
        >
          {(Object.keys(EQ_TYPE_LABELS) as EqType[]).map((t) => (
            <option key={t} value={t}>
              {EQ_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <Knob
          value={band.frequency}
          min={20}
          max={20000}
          size={48}
          label="Freq"
          logScale
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : v.toFixed(0))}
          onChange={(v) => updateBand(band.id, { frequency: v })}
        />
        <Knob
          value={band.gain}
          min={-24}
          max={24}
          size={48}
          label="Gain"
          bipolar
          defaultValue={0}
          format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
          onChange={(v) => updateBand(band.id, { gain: v })}
          className={cut ? "pointer-events-none opacity-35" : ""}
        />
        <Knob
          value={band.q}
          min={0.1}
          max={24}
          size={48}
          label="Q"
          logScale
          format={(v) => v.toFixed(2)}
          onChange={(v) => updateBand(band.id, { q: v })}
          className={cut ? "pointer-events-none opacity-35" : ""}
        />
      </div>

      {cut && (
        <div className="flex flex-col items-center gap-1">
          <select
            value={band.slope}
            onChange={(e) =>
              updateBand(band.id, { slope: Number(e.target.value) as 12 | 24 | 36 | 48 })
            }
            className="h-8 rounded-md border border-border bg-panel px-2 text-[11px] text-foreground/85 outline-none focus:border-primary/50"
          >
            {[12, 24, 36, 48].map((s) => (
              <option key={s} value={s}>
                {s} dB/oct
              </option>
            ))}
          </select>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Slope</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => removeBand(band.id)}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove
      </button>
    </div>
  );
}
