// Color / Harmonic FX editor.
// This version keeps the DeSonKuPik color engine, but redesigns the
// editor around real engine parameters only: Mix, Body, Warmth, Drive,
// Harmonics, Air, Stereo Mid and master Output. No fake mod tiles.

import { useCallback, useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { getPlayer } from "@/audio/player";
import { useApp } from "@/state/app";
import type { ColorSettings } from "@/audio/presets";
import { cn } from "@/lib/utils";
import {
  PluginShell,
  PluginHeader,
  PluginKnobRow,
  PresetPills,
} from "@/components/plugins/_shell/PluginShell";
import {
  drawSmartSpectrum,
  type SmartSpectrumState,
} from "@/components/plugins/_shell/spectrumCanvas";

type BandKey = "body" | "warmth" | "harmonics" | "air";
type DragTarget = BandKey | "drive" | "mix" | "stereoMid" | null;

type PointerState = {
  target: DragTarget;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  start: ColorSettings;
};

type SpectrumCache = {
  inFreq?: Uint8Array;
  outFreq?: Uint8Array;
  inTime?: Uint8Array;
  outTime?: Uint8Array;
  inSmooth: Float32Array;
  outSmooth: Float32Array;
  smartSpectrum: SmartSpectrumState;
  bandSmooth: Float32Array;
  peakIn: number;
  peakOut: number;
  rmsIn: number;
  rmsOut: number;
  lastTs: number;
};

// Calm premium palette — same hue family, only luminance/chroma differ.
const COLOR_CYAN = "rgba(170, 220, 235, 0.95)";
const COLOR_BLUE = "rgba(140, 195, 230, 0.95)";
const COLOR_GREEN = "rgba(150, 210, 220, 0.95)"; // sub band, kept cool teal
const COLOR_ORANGE = "rgba(165, 195, 230, 0.95)"; // low-mid, cool blue
const COLOR_RED = "rgba(155, 180, 225, 0.96)"; // high-mid, indigo
const COLOR_PURPLE = "rgba(180, 175, 230, 0.96)"; // high air, soft violet
const COLOR_WHITE = "rgba(238, 244, 255, 0.92)";

const COLOR_MODES = [
  { id: "mastering", label: "Mastering", hint: "one-click studio body and air" },
  { id: "clean", label: "Clean Tube", hint: "open and gentle" },
  { id: "warm", label: "Warm Tape", hint: "rounded warmth" },
  { id: "modern", label: "Modern Drive", hint: "rich and glossy" },
] as const;

const COLOR_MODE_PATCHES: Record<(typeof COLOR_MODES)[number]["id"], Partial<ColorSettings>> = {
  mastering: {
    mode: "mastering",
    mix: 24,
    bodyFreq: 152,
    body: 16.8,
    smartBass: 58,
    warmthFreq: 500,
    warmth: 15.2,
    drive: 3.32,
    harmonicsFreq: 2050,
    harmonics: 28,
    airFreq: 11300,
    air: 21.0,
    godParticles: 39.5,
    velvetTreble: 94,
    aiHighRepair: 72,
    vocalTickle: 26,
    vocalPresence: 29,
    midProjection: 49,
    stereoMid: 40,
  },
  clean: {
    mode: "clean",
    mix: 22,
    drive: 1.8,
    body: 10,
    warmth: 8,
    harmonics: 18,
    air: 12,
    stereoMid: 8,
    smartBass: 48,
    godParticles: 34,
    velvetTreble: 88,
    aiHighRepair: 58,
    vocalTickle: 22,
    vocalPresence: 28,
    midProjection: 36,
  },
  warm: {
    mode: "warm",
    mix: 30,
    drive: 3.8,
    body: 20,
    warmth: 18,
    harmonics: 22,
    air: 8,
    stereoMid: 22,
    smartBass: 63,
    godParticles: 34,
    velvetTreble: 91,
    aiHighRepair: 62,
    vocalTickle: 22,
    vocalPresence: 26,
    midProjection: 34,
  },
  modern: {
    mode: "modern",
    mix: 30,
    drive: 4.4,
    body: 16,
    warmth: 12,
    harmonics: 38,
    air: 16,
    stereoMid: 35,
    smartBass: 61,
    godParticles: 52,
    velvetTreble: 90,
    aiHighRepair: 66,
    vocalTickle: 42,
    vocalPresence: 48,
    midProjection: 58,
  },
};

const BAND_META: readonly {
  key: BandKey;
  number: number;
  label: string;
  rangeLabel: string;
  engine: string;
  color: string;
  freq: number;
  minFreq: number;
  maxFreq: number;
  min: number;
  max: number;
  unit: "dB" | "%";
  analyzerRange: [number, number];
}[] = [
  {
    key: "body",
    number: 1,
    label: "Lower Body",
    rangeLabel: "95 Hz – 260 Hz",
    engine: "lower body density",
    color: COLOR_GREEN,
    freq: 170,
    minFreq: 95,
    maxFreq: 260,
    min: -24,
    max: 24,
    unit: "dB",
    analyzerRange: [35, 180],
  },
  {
    key: "warmth",
    number: 2,
    label: "Vocal Body",
    rangeLabel: "160 Hz – 650 Hz",
    engine: "490 Hz body guard",
    color: COLOR_ORANGE,
    freq: 490,
    minFreq: 300,
    maxFreq: 760,
    min: -24,
    max: 24,
    unit: "dB",
    analyzerRange: [180, 900],
  },
  {
    key: "harmonics",
    number: 3,
    label: "High‑Mid Harmonics",
    rangeLabel: "600 Hz – 3.5 kHz",
    engine: "presence drive",
    color: COLOR_RED,
    freq: 2150,
    minFreq: 1200,
    maxFreq: 3600,
    min: 0,
    max: 100,
    unit: "%",
    analyzerRange: [900, 5200],
  },
  {
    key: "air",
    number: 4,
    label: "High Air",
    rangeLabel: "6.5 kHz – 16 kHz",
    engine: "air exciter",
    color: COLOR_PURPLE,
    freq: 11800,
    minFreq: 6500,
    maxFreq: 16000,
    min: -24,
    max: 48,
    unit: "dB",
    analyzerRange: [5200, 19000],
  },
] as const;

const CANVAS_BUCKETS = 216;
const FRAME_MS = 1000 / 30;
const TOP_DB = 6;
const BOT_DB = -60;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
function norm(v: number, min: number, max: number) {
  return clamp((v - min) / (max - min), 0, 1);
}
function fmtSigned(v: number, digits = 1) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}
function fmtBandValue(v: number, unit: "dB" | "%") {
  return unit === "%" ? `${Math.round(v)}%` : `${fmtSigned(v)} dB`;
}
function logX(freq: number, w: number, pad = 48) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const n = (Math.log10(clamp(freq, 20, 20000)) - min) / (max - min);
  return pad + n * (w - pad * 2);
}
function freqToNorm(freq: number) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return (Math.log10(clamp(freq, 20, 20000)) - min) / (max - min);
}
function dbToY(db: number, top: number, bottom: number) {
  const n = clamp((TOP_DB - db) / (TOP_DB - BOT_DB), 0, 1);
  return top + n * (bottom - top);
}
function ampToDb(v: number) {
  return v <= 1e-5 ? BOT_DB : clamp(20 * Math.log10(v), BOT_DB, TOP_DB);
}
function dbLabelFromAmp(v: number) {
  const db = ampToDb(v);
  return db <= BOT_DB + 0.5 ? "-∞" : `${db > 0 ? "+" : ""}${db.toFixed(1)}`;
}
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function getCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent | React.WheelEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    w: rect.width,
    h: rect.height,
  };
}

// Resolve any CSS color (oklch / var / named) to concrete [r,g,b] via 1x1 canvas probe.
let _probeCtx: CanvasRenderingContext2D | null = null;
function resolveColorRGB(css: string): [number, number, number] {
  if (typeof document === "undefined") return [120, 200, 230];
  if (!_probeCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _probeCtx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!_probeCtx) return [120, 200, 230];
  try {
    _probeCtx.clearRect(0, 0, 1, 1);
    _probeCtx.fillStyle = "#000";
    _probeCtx.fillStyle = (css || "").trim() || "#78c8e6";
    _probeCtx.fillRect(0, 0, 1, 1);
    const d = _probeCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return [120, 200, 230];
  }
}
function bandValue(settings: ColorSettings, key: BandKey) {
  switch (key) {
    case "body":
      return settings.body;
    case "warmth":
      return settings.warmth;
    case "harmonics":
      return settings.harmonics;
    case "air":
      return settings.air;
  }
}
function bandFreq(settings: ColorSettings, key: BandKey) {
  const meta = BAND_META.find((b) => b.key === key)!;
  switch (key) {
    case "body":
      return clamp(settings.bodyFreq ?? meta.freq, meta.minFreq, meta.maxFreq);
    case "warmth":
      return clamp(settings.warmthFreq ?? meta.freq, meta.minFreq, meta.maxFreq);
    case "harmonics":
      return clamp(settings.harmonicsFreq ?? meta.freq, meta.minFreq, meta.maxFreq);
    case "air":
      return clamp(settings.airFreq ?? meta.freq, meta.minFreq, meta.maxFreq);
  }
}
function bandNodePoint(settings: ColorSettings, key: BandKey, w: number, h: number) {
  const meta = BAND_META.find((b) => b.key === key)!;
  const graphLeft = 50;
  const graphTop = 40;
  const graphBottom = h - 44;
  return {
    x: logX(bandFreq(settings, key), w, graphLeft),
    y:
      graphTop +
      (1 - norm(bandValue(settings, key), meta.min, meta.max)) *
        Math.max(1, graphBottom - graphTop),
  };
}

function setBandFreqPatch(key: BandKey, freq: number): Partial<ColorSettings> {
  const meta = BAND_META.find((b) => b.key === key)!;
  const value = Math.round(clamp(freq, meta.minFreq, meta.maxFreq));
  switch (key) {
    case "body":
      return { bodyFreq: value };
    case "warmth":
      return { warmthFreq: value };
    case "harmonics":
      return { harmonicsFreq: value };
    case "air":
      return { airFreq: value };
  }
}
function fmtFreq(freq: number) {
  return freq >= 1000
    ? `${(freq / 1000).toFixed(freq >= 10000 ? 1 : 2)} kHz`
    : `${Math.round(freq)} Hz`;
}
function freqFromX(x: number, left: number, right: number, key: BandKey) {
  const meta = BAND_META.find((b) => b.key === key)!;
  const t = clamp((x - left) / Math.max(1, right - left), 0, 1);
  const min = Math.log10(meta.minFreq);
  const max = Math.log10(meta.maxFreq);
  return Math.pow(10, min + t * (max - min));
}
function setBandPatch(key: BandKey, value: number): Partial<ColorSettings> {
  switch (key) {
    case "body":
      return { body: value };
    case "warmth":
      return { warmth: value };
    case "harmonics":
      return { harmonics: value };
    case "air":
      return { air: value };
  }
}
function valueFromY(key: BandKey, y: number, top: number, bottom: number) {
  const meta = BAND_META.find((b) => b.key === key)!;
  const n = 1 - clamp((y - top) / Math.max(1, bottom - top), 0, 1);
  const raw = meta.min + n * (meta.max - meta.min);
  return meta.unit === "%" ? Math.round(raw) : Number(raw.toFixed(2));
}
function bandWetAmount(settings: ColorSettings, key: BandKey) {
  const enabled = settings.enabled !== false;
  const mix = enabled ? clamp(settings.mix / 100, 0, 1) : 0;
  const bodyAmt = clamp(settings.body / 24, -1, 1);
  const warmthAmt = clamp(settings.warmth / 24, -1, 1);
  const airAmt = clamp(settings.air / 48, -0.5, 1);
  const harm = clamp(settings.harmonics / 100, 0, 1);
  switch (key) {
    case "body":
      return mix * (0.18 + Math.max(0, bodyAmt) * 0.34 + harm * 0.08);
    case "warmth":
      return (
        mix * (0.2 + Math.max(0, warmthAmt) * 0.33 + Math.max(0, bodyAmt) * 0.04 + harm * 0.08)
      );
    case "harmonics":
      return mix * (0.09 + harm * 0.12 + Math.max(0, warmthAmt) * 0.035);
    case "air":
      return mix * (0.105 + Math.max(0, airAmt) * 0.3 + harm * 0.13);
  }
}
function ensureArrays(
  cache: SpectrumCache,
  input: AnalyserNode | null,
  output: AnalyserNode | null,
) {
  if (input && (!cache.inTime || cache.inTime.length !== input.fftSize)) {
    cache.inTime = new Uint8Array(input.fftSize);
  }
  if (output && (!cache.outTime || cache.outTime.length !== output.fftSize)) {
    cache.outTime = new Uint8Array(output.fftSize);
  }
}
function readRmsPeak(analyser: AnalyserNode | null, buffer?: Uint8Array) {
  if (!analyser || !buffer) return { rms: 0, peak: 0 };
  analyser.getByteTimeDomainData(buffer as Uint8Array<ArrayBuffer>);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const v = (buffer[i] - 128) / 128;
    const av = Math.abs(v);
    sum += v * v;
    if (av > peak) peak = av;
  }
  return { rms: Math.sqrt(sum / Math.max(1, buffer.length)), peak };
}
function bucketFromFrequency(bytes: Uint8Array | undefined, sampleRate: number, freq: number) {
  if (!bytes?.length) return 0;
  const nyquist = sampleRate / 2;
  const idx = clamp(Math.round((freq / nyquist) * (bytes.length - 1)), 0, bytes.length - 1);
  return bytes[idx] / 255;
}
function bandEnergy(bytes: Uint8Array | undefined, sampleRate: number, range: [number, number]) {
  if (!bytes?.length) return 0;
  const nyquist = sampleRate / 2;
  const from = clamp(Math.round((range[0] / nyquist) * (bytes.length - 1)), 0, bytes.length - 1);
  const to = clamp(
    Math.round((range[1] / nyquist) * (bytes.length - 1)),
    from + 1,
    bytes.length - 1,
  );
  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i += 1) {
    const v = bytes[i] / 255;
    sum += v * v;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}
function drawSpectrumPath(
  ctx: CanvasRenderingContext2D,
  smooth: Float32Array,
  bytes: Uint8Array | undefined,
  sampleRate: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
  mode: "fill" | "line",
) {
  const h = bottom - top;
  ctx.beginPath();
  if (mode === "fill") ctx.moveTo(left, bottom);
  for (let i = 0; i < smooth.length; i += 1) {
    const t = i / (smooth.length - 1);
    const freq = Math.pow(10, Math.log10(20) + t * (Math.log10(20000) - Math.log10(20)));
    const raw = bucketFromFrequency(bytes, sampleRate, freq);
    const weighted = Math.pow(raw, 0.66);
    smooth[i] += (weighted - smooth[i]) * (weighted > smooth[i] ? 0.2 : 0.075);
    const x = left + t * (right - left);
    const y = bottom - smooth[i] * h * 0.92;
    if (mode === "fill") ctx.lineTo(x, y);
    else if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (mode === "fill") {
    ctx.lineTo(right, bottom);
    ctx.closePath();
  }
}

export function ColorEditor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const rafRef = useRef<number | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DragTarget>(null);
  const [selectedBand, setSelectedBand] = useState<BandKey>("harmonics");
  const c = useApp((s) => s.settings.color);
  const outputGain = useApp((s) => s.settings.output.outputGain);
  const setColor = useApp((s) => s.setColor);
  const setOutput = useApp((s) => s.setOutput);
  const beginUserEdit = useApp((s) => s.beginUserEdit);
  const endUserEdit = useApp((s) => s.endUserEdit);

  const cacheRef = useRef<SpectrumCache>({
    inSmooth: new Float32Array(CANVAS_BUCKETS),
    outSmooth: new Float32Array(CANVAS_BUCKETS),
    smartSpectrum: {},
    bandSmooth: new Float32Array(BAND_META.length),
    peakIn: 0,
    peakOut: 0,
    rmsIn: 0,
    rmsOut: 0,
    lastTs: 0,
  });

  // (Per-knob accent now flows from PluginShell via --color-primary.)

  const hitTest = useCallback(
    (x: number, y: number, w: number, h: number, settings: ColorSettings): DragTarget => {
      const graphLeft = 50;
      const graphRight = w - 50;
      const graphTop = 40;
      const graphBottom = h - 44;
      if (x < graphLeft || x > graphRight || y < graphTop || y > graphBottom) return null;

      for (const band of BAND_META) {
        const { x: bx, y: by } = bandNodePoint(settings, band.key, w, h);
        if (Math.hypot(x - bx, y - by) < 30) return band.key;
      }

      // Empty analyzer drag works as Drive because it is the most common Color move.
      return "drive";
    },
    [],
  );

  const draw = useCallback(
    (timestamp = performance.now()) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cache = cacheRef.current;
      if (timestamp - cache.lastTs < FRAME_MS) return;
      cache.lastTs = timestamp;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      const w = rect.width;
      const h = rect.height;
      const left = 50;
      const right = w - 50;
      const top = 40;
      const bottom = h - 44;
      const player = getPlayer();
      const inputAnalyser = player.colorInAnalyser;
      const outputAnalyser = player.colorOutAnalyser;
      const sampleRate = player.sampleRate || 48000;
      const liveRead = useApp.getState().isPlaying && c.enabled && !document.hidden;
      if (liveRead) {
        ensureArrays(cache, inputAnalyser, outputAnalyser);
        const inMeters = readRmsPeak(inputAnalyser, cache.inTime);
        const outMeters = readRmsPeak(outputAnalyser, cache.outTime);
        cache.peakIn +=
          (inMeters.peak - cache.peakIn) * (inMeters.peak > cache.peakIn ? 0.26 : 0.05);
        cache.peakOut +=
          (outMeters.peak - cache.peakOut) * (outMeters.peak > cache.peakOut ? 0.26 : 0.05);
        cache.rmsIn += (inMeters.rms - cache.rmsIn) * (inMeters.rms > cache.rmsIn ? 0.18 : 0.045);
        cache.rmsOut +=
          (outMeters.rms - cache.rmsOut) * (outMeters.rms > cache.rmsOut ? 0.18 : 0.045);
      }

      ctx.clearRect(0, 0, w, h);

      // Resolve accent (Color plugin uses --accent-color, falls back to primary).
      const wrapEl = canvas.parentElement;
      const cs = wrapEl ? getComputedStyle(wrapEl) : null;
      const accentCss =
        cs?.getPropertyValue("--color-primary").trim() ||
        cs?.getPropertyValue("--accent-color").trim() ||
        "oklch(0.82 0.16 210)";
      const ACC = resolveColorRGB(accentCss);
      const accRGBA = (a: number) => `rgba(${ACC[0]},${ACC[1]},${ACC[2]},${a})`;

      const graphTop = top;
      const graphBottom = bottom;

      // Grid — dB lines + freq ticks (EQ-style, no band rectangles).
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => {
        const x = logX(f, w, left);
        ctx.beginPath();
        ctx.moveTo(x, graphTop);
        ctx.lineTo(x, graphBottom);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.font = "10px 'Sometype Mono', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, graphBottom + 16);
      });
      [-48, -36, -24, -12, 0, 6].forEach((db) => {
        const y = dbToY(db, graphTop, graphBottom);
        ctx.strokeStyle = db === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.font = "10px 'Sometype Mono', ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(String(db), left - 6, y + 3);
      });

      // Live spectrum — same smart constant-Q renderer as EQ, tinted for Color.
      // The analyser is read only while this FX page is open and enabled.
      drawSmartSpectrum(ctx, outputAnalyser, cache.smartSpectrum, {
        left,
        right,
        top: graphTop,
        bottom: graphBottom,
        accent: ACC,
        enabled: c.enabled,
        readEnabled: liveRead,
        timestamp,
        updateFps: pointerRef.current?.target ? 34 : 26,
        motionMs: pointerRef.current?.target ? 64 : 96,
        fillAlpha: 0.3,
        lineAlpha: 0.14,
        referenceAnalyser: inputAnalyser,
        referenceAlpha: 0.38,
        postLabel: "POST COLOR",
        referenceLabel: "BEFORE",
      });

      // Saturation response curve — single accent line, EQ-style.
      const drive = c.enabled ? c.drive : 0;
      const mix = c.enabled ? c.mix : 0;
      const midY = (graphTop + graphBottom) / 2;
      const curveYs: number[] = [];
      const STEPS = 260;
      for (let i = 0; i <= STEPS; i += 1) {
        const t = i / STEPS;
        const bodyLift =
          -c.body * 0.62 * Math.exp(-Math.pow((t - freqToNorm(bandFreq(c, "body"))) / 0.16, 2));
        const warmthLift =
          -c.warmth * 0.58 * Math.exp(-Math.pow((t - freqToNorm(bandFreq(c, "warmth"))) / 0.18, 2));
        const harmonicLift =
          -(c.harmonics * 0.15 + (c.vocalPresence ?? 0) * 0.09) *
          Math.exp(-Math.pow((t - freqToNorm(bandFreq(c, "harmonics"))) / 0.16, 2));
        const airLift =
          -c.air * 0.28 * Math.exp(-Math.pow((t - freqToNorm(bandFreq(c, "air"))) / 0.15, 2));
        const particleLift =
          -(c.godParticles ?? 0) * 0.075 * Math.exp(-Math.pow((t - freqToNorm(7600)) / 0.11, 2)) -
          (c.godParticles ?? 0) * 0.045 * Math.exp(-Math.pow((t - freqToNorm(3300)) / 0.16, 2));
        const driveWave = Math.sin(t * Math.PI * 2.2) * drive * 0.18;
        const dryBlend = (100 - mix) * 0.005;
        curveYs.push(
          midY +
            bodyLift +
            warmthLift +
            harmonicLift +
            airLift +
            particleLift +
            driveWave +
            dryBlend,
        );
      }

      // Curve fill to mid-line.
      ctx.beginPath();
      ctx.moveTo(left, midY);
      for (let i = 0; i <= STEPS; i += 1) {
        const x = left + (i / STEPS) * (right - left);
        ctx.lineTo(x, curveYs[i]);
      }
      ctx.lineTo(right, midY);
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, graphTop, 0, graphBottom);
      fillGrad.addColorStop(0, accRGBA(c.enabled ? 0.18 : 0.04));
      fillGrad.addColorStop(0.5, accRGBA(c.enabled ? 0.08 : 0.02));
      fillGrad.addColorStop(1, accRGBA(c.enabled ? 0.18 : 0.04));
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // Curve stroke with subtle glow.
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i += 1) {
        const x = left + (i / STEPS) * (right - left);
        if (i === 0) ctx.moveTo(x, curveYs[i]);
        else ctx.lineTo(x, curveYs[i]);
      }
      ctx.strokeStyle = c.enabled ? accRGBA(0.95) : "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.shadowColor = accRGBA(0.6);
      ctx.shadowBlur = c.enabled ? 10 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Saturation nodes — flat dots in accent color, EQ-style with tether.
      type Readout = { x: number; y: number; band: (typeof BAND_META)[number]; value: number };
      let activeReadout: Readout | null = null;
      BAND_META.forEach((band, idx) => {
        const value = bandValue(c, band.key);
        const currentFreq = bandFreq(c, band.key);
        const bx = logX(currentFreq, w, left);
        const by =
          graphTop + (1 - norm(value, band.min, band.max)) * Math.max(1, graphBottom - graphTop);
        const active =
          hoverTarget === band.key ||
          pointerRef.current?.target === band.key ||
          selectedBand === band.key;
        const r = active ? 8.5 : 7;

        // Vertical dashed tether from dot to mid-line (EQ-style).
        if (Math.abs(by - midY) > 2) {
          ctx.strokeStyle = accRGBA(c.enabled ? 0.4 : 0.15);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(bx, midY);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (active) {
          ctx.beginPath();
          ctx.arc(bx, by, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = accRGBA(0.16);
          ctx.fill();
        }

        ctx.globalAlpha = c.enabled && band ? 1 : 0.45;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = accRGBA(c.enabled ? 0.95 : 0.5);
        if (active) {
          ctx.shadowColor = accRGBA(0.7);
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
        ctx.fillText(String(idx + 1), bx, by + 0.5);
        ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = 1;

        if (active) activeReadout = { x: bx, y: by, band, value };
      });

      // EQ-style readout pill above active node.
      if (activeReadout) {
        const { x, y, band, value } = activeReadout as Readout;
        const currentFreq = bandFreq(c, band.key);
        const fTxt = fmtFreq(currentFreq);
        const txt = `${band.label.toUpperCase()}  ·  ${fTxt}  ·  ${fmtBandValue(value, band.unit)}`;
        ctx.font = "11px 'Sometype Mono', ui-monospace, monospace";
        const tw = ctx.measureText(txt).width + 16;
        const bx = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
        const by = Math.max(6, y - 30);
        drawRoundRect(ctx, bx, by, tw, 20, 5);
        ctx.fillStyle = "rgba(12,15,20,0.92)";
        ctx.fill();
        ctx.strokeStyle = accRGBA(0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, bx + tw / 2, by + 10.5);
        ctx.textBaseline = "alphabetic";
      }

      // Sparse pre/post readouts (top-left, top-right).
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px 'Sometype Mono', ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `PRE ${dbLabelFromAmp(cache.peakIn)} dB   POST ${dbLabelFromAmp(cache.peakOut)} dB`,
        left,
        top - 12,
      );
      ctx.textAlign = "right";
      ctx.fillText(
        "drag nodes: horizontal = frequency · vertical = amount · wheel = Drive",
        right,
        top - 12,
      );

      ctx.restore();
    },
    [c, hoverTarget, selectedBand],
  );

  useEffect(() => {
    let mounted = true;
    const tick = (timestamp: number) => {
      if (!mounted) return;
      if (document.visibilityState === "visible") draw(timestamp);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const resize = () => draw(performance.now() + FRAME_MS);
    window.addEventListener("resize", resize);
    return () => {
      mounted = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [draw]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = getCanvasPoint(canvas, event);
      const drag = pointerRef.current;
      if (!drag?.target) {
        setHoverTarget(hitTest(point.x, point.y, point.w, point.h, c));
        return;
      }

      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      const nodeX = point.x - drag.offsetX;
      const nodeY = point.y - drag.offsetY;
      const graphLeft = 50;
      const graphRight = point.w - 50;
      const graphTop = 40;
      const graphBottom = point.h - 44;
      switch (drag.target) {
        case "body":
        case "warmth":
        case "harmonics":
        case "air":
          setColor({
            ...setBandPatch(drag.target, valueFromY(drag.target, nodeY, graphTop, graphBottom)),
            ...setBandFreqPatch(drag.target, freqFromX(nodeX, graphLeft, graphRight, drag.target)),
          });
          break;
        case "drive":
          setColor({ drive: clamp(drag.start.drive + dx * 0.025 - dy * 0.06, 0, 24) });
          break;
        case "mix":
          setColor({ mix: clamp(drag.start.mix + dx * 0.22 - dy * 0.16, 0, 100) });
          break;
        case "stereoMid":
          setColor({ stereoMid: clamp(drag.start.stereoMid + dx * 0.2 - dy * 0.16, 0, 100) });
          break;
      }
    },
    [c, hitTest, setColor],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = getCanvasPoint(canvas, event);
      const target = hitTest(point.x, point.y, point.w, point.h, c);
      let offsetX = 0;
      let offsetY = 0;
      if (target === "body" || target === "warmth" || target === "harmonics" || target === "air") {
        setSelectedBand(target);
        const node = bandNodePoint(c, target, point.w, point.h);
        offsetX = point.x - node.x;
        offsetY = point.y - node.y;
      }
      beginUserEdit("Adjust color curve");
      pointerRef.current = { target, x: point.x, y: point.y, offsetX, offsetY, start: c };
      canvas.setPointerCapture(event.pointerId);
      setHoverTarget(target);
      event.preventDefault();
    },
    [beginUserEdit, c, hitTest],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (pointerRef.current) endUserEdit("Adjust color curve");
      pointerRef.current = null;
      if (canvas && canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    },
    [endUserEdit],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (event.shiftKey) setColor({ mix: clamp(c.mix - event.deltaY * 0.08, 0, 100) });
      else setColor({ drive: clamp(c.drive - event.deltaY * 0.012, 0, 24) });
    },
    [c.drive, c.mix, setColor],
  );

  void BAND_META;
  void selectedBand;

  const modeOptions = COLOR_MODES.map((m) => ({ id: m.id as string, label: m.label }));

  return (
    <PluginShell
      accent="color"
      header={
        <PluginHeader
          title="Color Harmonic FX"
          accent="color"
          presets={
            <PresetPills
              options={modeOptions}
              value={c.mode as string}
              accent="color"
              onChange={(id) => setColor(COLOR_MODE_PATCHES[id as keyof typeof COLOR_MODE_PATCHES])}
            />
          }
          enabled={c.enabled}
          onToggleEnabled={() => setColor({ enabled: !c.enabled })}
        />
      }
      footer={
        <>
          <div className="grid grid-cols-4 border-b border-border">
            {BAND_META.map((band) => (
              <BandButton
                key={band.key}
                band={band}
                selected={selectedBand === band.key}
                value={fmtBandValue(bandValue(c, band.key), band.unit)}
                freq={fmtFreq(bandFreq(c, band.key))}
                wet={`${Math.round(bandWetAmount(c, band.key) * 100)}% wet`}
                onClick={() => setSelectedBand(band.key)}
              />
            ))}
          </div>
          <PluginKnobRow>
            <Knob
              value={c.mix}
              min={0}
              max={100}
              defaultValue={34}
              size={56}
              label="Mix"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ mix: v })}
            />
            <Knob
              value={c.body}
              min={-24}
              max={24}
              defaultValue={0}
              size={56}
              label="Body"
              bipolar
              format={(v) => `${fmtSigned(v)} dB`}
              onChange={(v) => setColor({ body: v })}
            />
            <Knob
              value={c.warmth}
              min={-24}
              max={24}
              defaultValue={0}
              size={56}
              label="Warmth"
              bipolar
              format={(v) => `${fmtSigned(v)} dB`}
              onChange={(v) => setColor({ warmth: v })}
            />
            <Knob
              value={c.drive}
              min={0}
              max={24}
              defaultValue={4.35}
              size={56}
              label="Drive"
              format={(v) => `${v.toFixed(1)} dB`}
              onChange={(v) => setColor({ drive: v })}
            />
            <Knob
              value={c.harmonics}
              min={0}
              max={100}
              defaultValue={38}
              size={56}
              label="Harmonics"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ harmonics: v })}
            />
            <Knob
              value={c.air}
              min={-24}
              max={48}
              defaultValue={0}
              size={56}
              label="Air"
              bipolar
              format={(v) => `${fmtSigned(v)} dB`}
              onChange={(v) => setColor({ air: v })}
            />
            <Knob
              value={c.godParticles}
              min={0}
              max={100}
              defaultValue={56}
              size={56}
              label="God Particles"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ godParticles: v })}
            />
            <Knob
              value={c.stereoMid}
              min={0}
              max={100}
              defaultValue={55}
              size={56}
              label="Stereo Mid"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ stereoMid: v })}
            />
            <Knob
              value={c.smartBass}
              min={0}
              max={100}
              defaultValue={62}
              size={56}
              label="Smart Bass"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ smartBass: v })}
            />
            <Knob
              value={c.vocalTickle}
              min={0}
              max={100}
              defaultValue={35}
              size={56}
              label="Vocal Tickle"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ vocalTickle: v })}
            />
            <Knob
              value={c.vocalPresence}
              min={0}
              max={100}
              defaultValue={40}
              size={56}
              label="Vocal 2K"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ vocalPresence: v })}
            />
            <Knob
              value={c.midProjection}
              min={0}
              max={100}
              defaultValue={62}
              size={56}
              label="Mid Project"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ midProjection: v })}
            />
            <Knob
              value={c.aiHighRepair}
              min={0}
              max={100}
              defaultValue={31}
              size={56}
              label="AI Repair"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setColor({ aiHighRepair: v })}
            />
            <Knob
              value={outputGain}
              min={-24}
              max={12}
              defaultValue={-1.6}
              size={56}
              label="Output"
              bipolar
              format={(v) => `${fmtSigned(v)} dB`}
              onChange={(v) => setOutput({ outputGain: v })}
            />
          </PluginKnobRow>
        </>
      }
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none select-none cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    </PluginShell>
  );
}

function BandButton({
  band,
  selected,
  value,
  freq,
  wet,
  onClick,
}: {
  band: (typeof BAND_META)[number];
  selected: boolean;
  value: string;
  freq: string;
  wet: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center justify-between border-l border-border bg-panel-soft px-3 py-2 text-left transition first:border-l-0",
        selected ? "bg-accent/40" : "hover:bg-accent/20",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="grid h-5 w-5 place-items-center rounded-full border text-[10px] font-bold"
            style={{ borderColor: band.color, color: band.color }}
          >
            {band.number}
          </span>
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/85">
            {band.label}
          </div>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {freq} · {band.rangeLabel}
        </div>
      </div>
      <div className="ml-3 shrink-0 text-right ms-mono">
        <div className="text-[11px] text-foreground/90">{value}</div>
        <div className="text-[10px] text-muted-foreground">{wet}</div>
      </div>
    </button>
  );
}
