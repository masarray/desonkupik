// Axis-inspired Width / Stereo Imaging editor.
// The audio engine remains the DeSonKuPik source-protected M/S stage. This editor
// exposes only real engine parameters and adds passive live analysers so the
// stereo image can be tweaked quickly without decorative/fake controls.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Knob } from "@/components/Knob";
import { getPlayer } from "@/audio/player";
import { useApp } from "@/state/app";
import type { WidthSettings } from "@/audio/presets";
import { cn } from "@/lib/utils";
import {
  PluginShell,
  PluginHeader,
  PluginKnobRow,
  PresetPills,
  InspectorSection,
  InspectorRow,
  InspectorReadout,
} from "@/components/plugins/_shell/PluginShell";
import {
  drawSmartSpectrum,
  type SmartSpectrumState,
} from "@/components/plugins/_shell/spectrumCanvas";

type BandKey = "lowWidth" | "lowMidWidth" | "midWidth" | "highWidth";
type DragTarget = BandKey | "monoBassFreq" | null;

type PointerState = {
  target: DragTarget;
  x: number;
  y: number;
  start: WidthSettings;
};

type AnalyzerCache = {
  preFreq?: Uint8Array;
  postFreq?: Uint8Array;
  preTime?: Float32Array;
  postTime?: Float32Array;
  smoothPre: Float32Array;
  smoothPost: Float32Array;
  smartSpectrum: SmartSpectrumState;
  corrL: Float32Array;
  corrR: Float32Array;
  peakPre: number;
  peakPost: number;
  rmsPre: number;
  rmsPost: number;
  correlation: number;
  lastTs: number;
};

const FRAME_MS = 1000 / 30;
const BUCKETS = 220;
const TOP_DB = 6;
const BOT_DB = -60;
// Calm premium palette: all bands cool blue/violet family.
const CYAN = "rgba(170, 220, 235, 0.95)";
const GREEN = "rgba(150, 210, 220, 0.95)"; // sub — teal
const AMBER = "rgba(160, 195, 230, 0.95)"; // low-mid — cool blue
const ORANGE = "rgba(155, 180, 225, 0.96)"; // mid — indigo
const VIOLET = "rgba(180, 175, 230, 0.94)"; // high — soft violet
const WHITE = "rgba(235, 244, 255, 0.92)";

const BANDS: readonly {
  key: BandKey;
  number: number;
  label: string;
  short: string;
  range: string;
  color: string;
  minFreq: number;
  maxFreq: number;
}[] = [
  {
    key: "lowWidth",
    number: 1,
    label: "Sub / Low",
    short: "LOW",
    range: "20 Hz – mono",
    color: GREEN,
    minFreq: 20,
    maxFreq: 150,
  },
  {
    key: "lowMidWidth",
    number: 2,
    label: "Low‑Mid",
    short: "LOW‑MID",
    range: "120 Hz – 600 Hz",
    color: AMBER,
    minFreq: 120,
    maxFreq: 600,
  },
  {
    key: "midWidth",
    number: 3,
    label: "Mid Image",
    short: "MID",
    range: "600 Hz – 3.5 kHz",
    color: ORANGE,
    minFreq: 600,
    maxFreq: 3500,
  },
  {
    key: "highWidth",
    number: 4,
    label: "High Air",
    short: "HIGH",
    range: "3.5 kHz – 20 kHz",
    color: VIOLET,
    minFreq: 3500,
    maxFreq: 20000,
  },
];

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
function formatDb(v: number) {
  if (v <= BOT_DB + 0.5) return "-∞";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function ampToDb(v: number) {
  return v <= 1e-6 ? BOT_DB : clamp(20 * Math.log10(v), BOT_DB, TOP_DB);
}
function dbToY(db: number, top: number, bottom: number) {
  const n = clamp((TOP_DB - db) / (TOP_DB - BOT_DB), 0, 1);
  return top + n * (bottom - top);
}
function logX(freq: number, width: number, pad = 46) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const n = (Math.log10(clamp(freq, 20, 20000)) - min) / (max - min);
  return pad + n * (width - pad * 2);
}
function freqFromX(x: number, width: number, pad = 46) {
  const n = clamp((x - pad) / Math.max(1, width - pad * 2), 0, 1);
  return Math.pow(10, Math.log10(20) + n * (Math.log10(20000) - Math.log10(20)));
}
function widthToY(width: number, top: number, bottom: number) {
  // 0% sits near the bottom, 100% at the center line, 200% near the top.
  const n = clamp(width / 200, 0, 1);
  return bottom - n * (bottom - top);
}
function yToWidth(y: number, top: number, bottom: number) {
  const n = 1 - clamp((y - top) / Math.max(1, bottom - top), 0, 1);
  return Math.round(clamp(n * 200, 0, 200));
}
function bandValue(settings: WidthSettings, key: BandKey) {
  return settings[key];
}
function setBandPatch(key: BandKey, value: number): Partial<WidthSettings> {
  return { [key]: value } as Partial<WidthSettings>;
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
function freqBucket(bytes: Uint8Array | undefined, sampleRate: number, freq: number) {
  if (!bytes?.length) return 0;
  const nyquist = sampleRate / 2;
  const idx = clamp(Math.round((freq / nyquist) * (bytes.length - 1)), 0, bytes.length - 1);
  return bytes[idx] / 255;
}
function ensureArrays(cache: AnalyzerCache, pre: AnalyserNode | null, post: AnalyserNode | null) {
  if (pre && (!cache.preTime || cache.preTime.length !== pre.fftSize)) {
    cache.preTime = new Float32Array(pre.fftSize);
  }
  if (post && (!cache.postTime || cache.postTime.length !== post.fftSize)) {
    cache.postTime = new Float32Array(post.fftSize);
  }
}
function readRmsPeak(analyser: AnalyserNode | null, buf?: Float32Array) {
  if (!analyser || !buf) return { rms: 0, peak: 0 };
  analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i];
    const a = Math.abs(v);
    sum += v * v;
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sum / Math.max(1, buf.length)), peak };
}
function computeCorrelation(
  l: AnalyserNode | null,
  r: AnalyserNode | null,
  lBuf: Float32Array,
  rBuf: Float32Array,
) {
  if (!l || !r) return 0;
  l.getFloatTimeDomainData(lBuf as Float32Array<ArrayBuffer>);
  r.getFloatTimeDomainData(rBuf as Float32Array<ArrayBuffer>);
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < lBuf.length; i += 1) {
    const lv = lBuf[i];
    const rv = rBuf[i];
    lr += lv * rv;
    ll += lv * lv;
    rr += rv * rv;
  }
  const den = Math.sqrt(ll * rr) || 1;
  return clamp(lr / den, -1, 1);
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
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function BandButton({
  band,
  value,
  selected,
  onSelect,
}: {
  band: (typeof BANDS)[number];
  value: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const state =
    value < 85 ? "center safe" : value <= 120 ? "natural" : value <= 150 ? "wide" : "very wide";
  return (
    <button
      type="button"
      onClick={onSelect}
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
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{band.range}</div>
      </div>
      <div className="ml-3 shrink-0 text-right ms-mono">
        <div className="text-[11px] text-foreground/90">{Math.round(value)}%</div>
        <div className="text-[10px] text-muted-foreground">{state}</div>
      </div>
    </button>
  );
}

function AxisKnob({
  label,
  value,
  min,
  max,
  defaultValue,
  format,
  onChange,
  accent,
  size = 72,
  bipolar = false,
  logScale = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  accent: string;
  size?: number;
  bipolar?: boolean;
  logScale?: boolean;
}) {
  return (
    <div
      style={{ "--color-primary": accent } as CSSProperties}
      className="rounded-lg border border-border bg-panel-soft/45 px-3 py-3"
    >
      <Knob
        value={value}
        min={min}
        max={max}
        defaultValue={defaultValue}
        size={size}
        label={label}
        bipolar={bipolar}
        logScale={logScale}
        format={format}
        onChange={onChange}
      />
    </div>
  );
}

// Resolve any CSS color (oklch / var / named) to concrete [r,g,b] via 1x1 canvas.
let _probeCtx: CanvasRenderingContext2D | null = null;
function resolveColorRGB(css: string): [number, number, number] {
  if (typeof document === "undefined") return [180, 175, 230];
  if (!_probeCtx) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    _probeCtx = cv.getContext("2d", { willReadFrequently: true });
  }
  if (!_probeCtx) return [180, 175, 230];
  try {
    _probeCtx.clearRect(0, 0, 1, 1);
    _probeCtx.fillStyle = "#000";
    _probeCtx.fillStyle = (css || "").trim() || "#b4afe6";
    _probeCtx.fillRect(0, 0, 1, 1);
    const d = _probeCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return [180, 175, 230];
  }
}

function WidthMixControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div
      className="hidden items-center gap-2 rounded-md border border-border bg-background/35 px-2 py-1 sm:flex"
      title="Parallel Width Mix: lower values keep more dry center/vocal focus; higher values add more stereo width."
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Mix
      </span>
      <input
        className="h-1.5 w-20 cursor-pointer accent-[var(--color-primary)]"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-label="Width parallel mix"
      />
      <span className="ms-mono w-8 text-right text-[10px] tabular-nums text-foreground/80">
        {Math.round(value)}%
      </span>
    </div>
  );
}

export function WidthEditor() {
  const w = useApp((s) => s.settings.width);
  const setWidth = useApp((s) => s.setWidth);
  const beginUserEdit = useApp((s) => s.beginUserEdit);
  const endUserEdit = useApp((s) => s.endUserEdit);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<PointerState | null>(null);
  const [selectedBand, setSelectedBand] = useState<BandKey>("midWidth");
  const [stats, setStats] = useState({ correlation: 0, sideDb: BOT_DB });

  const settingsRef = useRef(w);
  useEffect(() => {
    settingsRef.current = w;
  }, [w]);

  const cache = useRef<AnalyzerCache>({
    smoothPre: new Float32Array(BUCKETS),
    smoothPost: new Float32Array(BUCKETS),
    smartSpectrum: {},
    corrL: new Float32Array(1024),
    corrR: new Float32Array(1024),
    peakPre: 0,
    peakPost: 0,
    rmsPre: 0,
    rmsPost: 0,
    correlation: 0,
    lastTs: 0,
  });

  const renderCanvas = useCallback(
    (canvas: HTMLCanvasElement, ts: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth || 900;
      const height = canvas.clientHeight || 290;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const settings = settingsRef.current;
      const player = getPlayer();
      const pre = player.widthInAnalyser ?? player.colorOutAnalyser;
      const post = player.widthOutAnalyser ?? player.limiterInAnalyser;
      const sampleRate = player.sampleRate || 48000;
      const cc = cache.current;
      const liveRead = useApp.getState().isPlaying && settings.enabled && !document.hidden;
      const dt = cc.lastTs ? clamp((ts - cc.lastTs) / 1000, 1 / 120, 0.12) : 1 / 30;
      cc.lastTs = ts;
      if (liveRead) {
        ensureArrays(cc, pre, post);
        const preMeter = readRmsPeak(pre, cc.preTime);
        const postMeter = readRmsPeak(post, cc.postTime);
        const corr = computeCorrelation(
          player.outAnalyserL,
          player.outAnalyserR,
          cc.corrL,
          cc.corrR,
        );
        const alphaFast = 1 - Math.exp(-dt / 0.12);
        const alphaSlow = 1 - Math.exp(-dt / 0.55);
        cc.peakPre += (preMeter.peak - cc.peakPre) * alphaFast;
        cc.peakPost += (postMeter.peak - cc.peakPost) * alphaFast;
        cc.rmsPre += (preMeter.rms - cc.rmsPre) * alphaSlow;
        cc.rmsPost += (postMeter.rms - cc.rmsPost) * alphaSlow;
        cc.correlation += (corr - cc.correlation) * (1 - Math.exp(-dt / 0.4));
      }

      // Resolve accent (Width plugin flows --color-primary).
      const wrapEl = canvas.parentElement;
      const cs = wrapEl ? getComputedStyle(wrapEl) : null;
      const accentCss = cs?.getPropertyValue("--color-primary").trim() || "oklch(0.78 0.11 275)";
      const ACC = resolveColorRGB(accentCss);
      const accRGBA = (a: number) => `rgba(${ACC[0]},${ACC[1]},${ACC[2]},${a})`;

      const padL = 46;
      const padR = 46;
      const top = 28;
      const bottom = height - 32;
      const graphX = padL;
      const graphW = width - padL - padR;

      // Grid — dB/% lines + freq ticks (EQ-style).
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => {
        const x = graphX + logX(f, graphW, 0);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.font = "10px 'Sometype Mono', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, bottom + 16);
      });
      [0, 50, 100, 150, 200].forEach((val) => {
        const y = widthToY(val, top, bottom);
        ctx.strokeStyle = val === 100 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)";
        ctx.beginPath();
        ctx.moveTo(graphX, y);
        ctx.lineTo(graphX + graphW, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.font = "10px 'Sometype Mono', ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${val}%`, graphX - 6, y + 3);
      });

      // Spectrum POST — same smart constant-Q renderer as EQ, tinted for Width.
      // The analyser is read only while this FX page is open and enabled.
      drawSmartSpectrum(ctx, post, cc.smartSpectrum, {
        left: graphX,
        right: graphX + graphW,
        top,
        bottom,
        accent: ACC,
        enabled: settings.enabled,
        readEnabled: liveRead,
        timestamp: ts,
        updateFps: drag.current?.target ? 34 : 26,
        motionMs: drag.current?.target ? 64 : 96,
        fillAlpha: 0.28,
        lineAlpha: 0.14,
        referenceAnalyser: pre,
        referenceAlpha: 0.38,
        postLabel: "POST WIDTH",
        referenceLabel: "BEFORE",
      });

      // Mono crossover — single dashed vertical line.
      const monoX = graphX + logX(settings.monoBassFreq, graphW, 0);
      ctx.strokeStyle = accRGBA(0.45);
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(monoX, top);
      ctx.lineTo(monoX, bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Width target curve — filled to the 100% center line, Color-style.
      const midY = widthToY(100, top, bottom);
      const curvePoints = BANDS.map((b) => ({
        band: b,
        x: graphX + logX(Math.sqrt(b.minFreq * b.maxFreq), graphW, 0),
        y: widthToY(bandValue(settings, b.key), top, bottom),
      }));

      ctx.beginPath();
      ctx.moveTo(curvePoints[0].x, midY);
      curvePoints.forEach((p, i) => {
        if (i === 0) ctx.lineTo(p.x, p.y);
        else {
          const prev = curvePoints[i - 1];
          ctx.bezierCurveTo(
            prev.x + (p.x - prev.x) * 0.45,
            prev.y,
            prev.x + (p.x - prev.x) * 0.55,
            p.y,
            p.x,
            p.y,
          );
        }
      });
      ctx.lineTo(curvePoints[curvePoints.length - 1].x, midY);
      ctx.closePath();
      const widthFill = ctx.createLinearGradient(0, top, 0, bottom);
      widthFill.addColorStop(0, accRGBA(w.enabled ? 0.16 : 0.04));
      widthFill.addColorStop(0.5, accRGBA(w.enabled ? 0.06 : 0.02));
      widthFill.addColorStop(1, accRGBA(w.enabled ? 0.13 : 0.04));
      ctx.fillStyle = widthFill;
      ctx.fill();

      ctx.beginPath();
      curvePoints.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else {
          const prev = curvePoints[i - 1];
          ctx.bezierCurveTo(
            prev.x + (p.x - prev.x) * 0.45,
            prev.y,
            prev.x + (p.x - prev.x) * 0.55,
            p.y,
            p.x,
            p.y,
          );
        }
      });
      ctx.lineWidth = 2;
      ctx.strokeStyle = w.enabled ? accRGBA(0.95) : "rgba(255,255,255,0.25)";
      ctx.shadowBlur = w.enabled ? 10 : 0;
      ctx.shadowColor = accRGBA(0.6);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Band nodes — flat dots, vertical tether to 100% line.
      let activeReadout: { x: number; y: number; band: (typeof BANDS)[number] } | null = null;
      BANDS.forEach((b, idx) => {
        const f = Math.sqrt(b.minFreq * b.maxFreq);
        const x = graphX + logX(f, graphW, 0);
        const y = widthToY(bandValue(settings, b.key), top, bottom);
        const active = b.key === selectedBand;
        const r = active ? 8.5 : 7;

        if (Math.abs(y - midY) > 2) {
          ctx.strokeStyle = accRGBA(w.enabled ? 0.4 : 0.15);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(x, midY);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (active) {
          ctx.beginPath();
          ctx.arc(x, y, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = accRGBA(0.16);
          ctx.fill();
        }

        ctx.globalAlpha = w.enabled ? 1 : 0.45;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = accRGBA(w.enabled ? 0.95 : 0.5);
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
        ctx.fillText(String(idx + 1), x, y + 0.5);
        ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = 1;

        if (active) activeReadout = { x, y, band: b };
      });

      // EQ-style readout pill above active node.
      if (activeReadout) {
        const { x, y, band } = activeReadout as {
          x: number;
          y: number;
          band: (typeof BANDS)[number];
        };
        const f = Math.sqrt(band.minFreq * band.maxFreq);
        const fTxt = f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`;
        const txt = `${band.short}  ·  ${fTxt}Hz  ·  ${Math.round(bandValue(settings, band.key))}%`;
        ctx.font = "11px 'Sometype Mono', ui-monospace, monospace";
        const tw = ctx.measureText(txt).width + 16;
        const bx = Math.max(4, Math.min(width - tw - 4, x - tw / 2));
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

      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px 'Sometype Mono', ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `PRE ${formatDb(ampToDb(cc.peakPre))} dB   POST ${formatDb(ampToDb(cc.peakPost))} dB   CORR ${cc.correlation >= 0 ? "+" : ""}${cc.correlation.toFixed(2)}`,
        graphX,
        top - 10,
      );
      ctx.textAlign = "right";
      ctx.fillText(
        "drag nodes: vertical = width · crossover line = mono bass · wheel = space",
        graphX + graphW,
        top - 10,
      );

      setStats((prev) => {
        const next = {
          correlation: cc.correlation,
          sideDb: ampToDb(Math.max(0, cc.rmsPost * (1 - Math.max(-1, cc.correlation)) * 0.75)),
        };
        if (
          Math.abs(next.correlation - prev.correlation) < 0.01 &&
          Math.abs(next.sideDb - prev.sideDb) < 0.15
        ) {
          return prev;
        }
        return next;
      });
    },
    [selectedBand, w.enabled],
  );

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (last && ts - last < FRAME_MS) return;
      last = ts;
      const canvas = canvasRef.current;
      if (canvas) renderCanvas(canvas, ts);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [renderCanvas]);

  const targetFromPoint = useCallback(
    (x: number, y: number, width: number, height: number): DragTarget => {
      const graphX = 46;
      const graphW = width - 92;
      const top = 28;
      const bottom = height - 32;
      const settings = settingsRef.current;
      const monoX = graphX + logX(settings.monoBassFreq, graphW, 0);
      if (Math.abs(x - monoX) < 14 && y >= top && y <= bottom) return "monoBassFreq";
      let nearest: { key: BandKey; dist: number } | null = null;
      for (const b of BANDS) {
        const bx = graphX + logX(Math.sqrt(b.minFreq * b.maxFreq), graphW, 0);
        const by = widthToY(bandValue(settings, b.key), top, bottom);
        const d = Math.hypot(x - bx, y - by);
        if (!nearest || d < nearest.dist) nearest = { key: b.key, dist: d };
      }
      if (nearest && nearest.dist < 44) return nearest.key;
      const freq = freqFromX(x - graphX, graphW, 0);
      if (freq < settings.monoBassFreq) return "lowWidth";
      if (freq < 600) return "lowMidWidth";
      if (freq < 3500) return "midWidth";
      return "highWidth";
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pt = getCanvasPoint(canvas, e);
      const target = targetFromPoint(pt.x, pt.y, pt.w, pt.h);
      if (target && target !== "monoBassFreq") setSelectedBand(target);
      beginUserEdit("Adjust stereo width");
      drag.current = { target, x: pt.x, y: pt.y, start: settingsRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [beginUserEdit, targetFromPoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drag.current || !(e.buttons & 1)) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pt = getCanvasPoint(canvas, e);
      const graphX = 46;
      const graphW = pt.w - 92;
      const top = 28;
      const bottom = pt.h - 32;
      const { target, start } = drag.current;
      if (target === "monoBassFreq") {
        const freq = freqFromX(pt.x - graphX, graphW, 0);
        setWidth({ monoBassFreq: Math.round(clamp(freq, 60, 250)) });
        return;
      }
      if (target) {
        setSelectedBand(target);
        setWidth(setBandPatch(target, yToWidth(pt.y, top, bottom)));
      } else if (Math.abs(pt.y - drag.current.y) > 2) {
        setWidth({ width: clamp(start.width + (drag.current.y - pt.y) * 0.9, 0, 200) });
      }
    },
    [setWidth],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (drag.current) endUserEdit("Adjust stereo width");
      drag.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    },
    [endUserEdit],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY);
      if (e.shiftKey) setWidth({ sideTone: clamp(w.sideTone + delta * 0.3, -12, 18) });
      else setWidth({ width: clamp(w.width + delta * 2, 0, 200) });
    },
    [setWidth, w.sideTone, w.width],
  );

  const widthPresets: { id: string; label: string; patch: Partial<WidthSettings> }[] = [
    {
      id: "neutral",
      label: "Neutral",
      patch: {
        width: 100,
        lowWidth: 100,
        lowMidWidth: 100,
        midWidth: 100,
        highWidth: 100,
        sideTone: 0,
        mix: 0,
      },
    },
    {
      id: "wide",
      label: "Wide",
      patch: { width: 140, lowMidWidth: 110, midWidth: 120, highWidth: 140, mix: 72 },
    },
    {
      id: "mono-safe",
      label: "Mono Safe",
      patch: { lowWidth: 60, sourceProtect: 100, monoBass: true, mix: 48 },
    },
    {
      id: "intimate",
      label: "Intimate",
      patch: { width: 70, midWidth: 80, highWidth: 75, mix: 42 },
    },
  ];

  const corr = stats.correlation;
  const corrPct = Math.round(corr * 100);
  const corrLabel =
    corr > 0.6 ? "Coherent" : corr > 0.1 ? "Stable" : corr > -0.1 ? "Wide" : "Phase risk";
  const corrColor =
    corr < 0.05 ? "var(--meter-clip)" : corr < 0.35 ? "var(--meter-warn)" : "var(--meter)";
  const corrBarPos = (corr + 1) / 2;

  return (
    <PluginShell
      accent="width"
      inspectorWidth={208}
      header={
        <PluginHeader
          title="Width"
          accent="width"
          presets={
            <PresetPills
              options={widthPresets.map((p) => ({ id: p.id, label: p.label }))}
              value={null}
              accent="width"
              onChange={(id) => {
                const p = widthPresets.find((x) => x.id === id);
                if (p) setWidth(p.patch);
              }}
            />
          }
          rightSlot={<WidthMixControl value={w.mix} onChange={(mix) => setWidth({ mix })} />}
          enabled={w.enabled}
          onToggleEnabled={() => setWidth({ enabled: !w.enabled })}
        />
      }
      inspector={
        <div className="flex h-full flex-col">
          <InspectorSection title="Space" accent="width">
            <InspectorReadout value={`${Math.round(w.width)}`} unit="%" sub="Master width" />
            <InspectorRow label="Parallel mix" value={`${Math.round(w.mix)}%`} />
            <InspectorRow label="Crossover" value={`${Math.round(w.monoBassFreq)} Hz`} />
            <InspectorRow
              label="Side tone"
              value={`${w.sideTone >= 0 ? "+" : ""}${w.sideTone.toFixed(1)} dB`}
            />
          </InspectorSection>
          <InspectorSection title="Correlation" accent="width">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="ms-mono text-base tabular-nums" style={{ color: corrColor }}>
                  {corr >= 0 ? "+" : ""}
                  {corr.toFixed(2)}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {corrLabel}
                </span>
              </div>
              <div className="relative h-1.5 rounded-full bg-black/45 ring-1 ring-border">
                <div
                  className="absolute top-0 h-full w-px bg-foreground/30"
                  style={{ left: "50%" }}
                />
                <div
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ left: `${corrBarPos * 100}%`, background: corrColor }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>-1</span>
                <span>0</span>
                <span>+1</span>
              </div>
            </div>
            <InspectorRow
              label="Side level"
              value={stats.sideDb <= BOT_DB + 0.5 ? "-∞ dB" : `${stats.sideDb.toFixed(1)} dB`}
            />
            <InspectorRow label="Phase score" value={`${corrPct}%`} />
          </InspectorSection>
        </div>
      }
      footer={
        <>
          <div className="grid grid-cols-4 border-b border-border">
            {BANDS.map((band) => (
              <BandButton
                key={band.key}
                band={band}
                value={bandValue(w, band.key)}
                selected={selectedBand === band.key}
                onSelect={() => setSelectedBand(band.key)}
              />
            ))}
          </div>
          <PluginKnobRow>
            <Knob
              value={w.mix}
              min={0}
              max={100}
              defaultValue={62}
              size={56}
              label="Mix"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ mix: v })}
            />
            <Knob
              value={w.width}
              min={0}
              max={200}
              defaultValue={100}
              size={56}
              label="Space"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ width: v })}
            />
            <Knob
              value={w.lowWidth}
              min={0}
              max={200}
              defaultValue={100}
              size={56}
              label="Sub"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ lowWidth: v })}
            />
            <Knob
              value={w.lowMidWidth}
              min={0}
              max={200}
              defaultValue={100}
              size={56}
              label="Low-Mid"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ lowMidWidth: v })}
            />
            <Knob
              value={w.midWidth}
              min={0}
              max={200}
              defaultValue={100}
              size={56}
              label="Mid"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ midWidth: v })}
            />
            <Knob
              value={w.highWidth}
              min={0}
              max={200}
              defaultValue={100}
              size={56}
              label="High"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ highWidth: v })}
            />
            <Knob
              value={w.sideTone}
              min={-12}
              max={18}
              defaultValue={0}
              size={56}
              label="Side Tone"
              bipolar
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
              onChange={(v) => setWidth({ sideTone: v })}
            />
            <Knob
              value={w.sourceProtect}
              min={0}
              max={100}
              defaultValue={93}
              size={56}
              label="Protect"
              format={(v) => `${v.toFixed(0)}%`}
              onChange={(v) => setWidth({ sourceProtect: v })}
            />
            <Knob
              value={w.monoBassFreq}
              min={60}
              max={250}
              defaultValue={150}
              size={56}
              label="Crossover"
              logScale
              format={(v) => `${v.toFixed(0)} Hz`}
              onChange={(v) => setWidth({ monoBassFreq: v })}
            />
          </PluginKnobRow>
        </>
      }
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    </PluginShell>
  );
}
