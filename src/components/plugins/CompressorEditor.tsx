// FabFilter Pro-C–style compressor.
//
// Main display: a scrolling real-time view of input level, output level, and
// gain reduction (the amber "curtain" from the top), with a draggable
// threshold line plus Ratio and Knee handles. A large transfer curve is drawn
// directly on the main graph so ratio/slope movement is obvious like Pro-C.
// A large GR meter sits on the right.

import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import { MasterChain } from "@/audio/engine";
import type { CompressorSettings } from "@/audio/presets";
import { cn } from "@/lib/utils";
import {
  PluginShell,
  PluginHeader,
  PluginKnobRow,
  PresetPills,
  InspectorSection,
  InspectorReadout,
  InspectorRow,
} from "@/components/plugins/_shell/PluginShell";

const TOP_DB = 6;
const BOT_DB = -60;
const GR_FULL = 24; // dB of reduction that fills the GR curtain / meter
const HISTORY = 480; // scrolling columns
const METER_FPS = 30;

// Resolved at render-time from the FX accent token. Curve + knobs share this.
let ACCENT = "rgba(120, 200, 220, 0.95)";
const C_GR = "rgba(232, 152, 80, 0.85)"; // warning-only, kept neutral amber

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const dbToFrac = (db: number) => Math.min(1, Math.max(0, (TOP_DB - db) / (TOP_DB - BOT_DB)));
const inputDbToX = (db: number, w: number) =>
  ((clamp(db, BOT_DB, TOP_DB) - BOT_DB) / (TOP_DB - BOT_DB)) * w;
const ampToDb = (v: number) => (v <= 1e-6 ? BOT_DB : Math.max(BOT_DB, 20 * Math.log10(v)));

const smoothDb = (prev: number, next: number, dt: number, attackMs: number, releaseMs: number) => {
  const target = Number.isFinite(next) ? clamp(next, BOT_DB, TOP_DB) : BOT_DB;
  const current = Number.isFinite(prev) ? prev : target;
  const tau = Math.max(0.001, (target > current ? attackMs : releaseMs) / 1000);
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / tau);
  return current + (target - current) * alpha;
};

const smoothPositive = (
  prev: number,
  next: number,
  dt: number,
  attackMs: number,
  releaseMs: number,
) => {
  const target = Math.max(0, Number.isFinite(next) ? next : 0);
  const tau = Math.max(0.001, (target > prev ? attackMs : releaseMs) / 1000);
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / tau);
  return prev + (target - prev) * alpha;
};

const readPeakDb = (analyser: AnalyserNode | null, buf: Float32Array) => {
  if (!analyser) return BOT_DB;
  analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return ampToDb(peak);
};

// Soft-knee compressor transfer curve (returns output dB before makeup).
function transfer(inDb: number, threshold: number, ratio: number, knee: number) {
  const over = inDb - threshold + knee / 2;
  if (over <= 0) return inDb;
  if (over >= knee || knee <= 0) return threshold + (inDb - threshold) / ratio;
  return inDb + ((1 / ratio - 1) * over * over) / (2 * knee);
}

const STYLES: { name: string; patch: Partial<CompressorSettings> }[] = [
  { name: "Clean", patch: { ratio: 2, knee: 12, attack: 0.03, release: 0.2 } },
  { name: "Punch", patch: { ratio: 4, knee: 2, attack: 0.015, release: 0.12 } },
  { name: "Vocal", patch: { ratio: 3, knee: 8, attack: 0.005, release: 0.15 } },
  { name: "Bus", patch: { ratio: 2, knee: 18, attack: 0.03, release: 0.3 } },
  { name: "Mastering", patch: { ratio: 1.5, knee: 24, attack: 0.05, release: 0.4 } },
  { name: "Pumping", patch: { ratio: 6, knee: 0, attack: 0.001, release: 0.5 } },
];

function autoMakeup(threshold: number, ratio: number) {
  // Rough loudness compensation for the reduction applied to a 0 dBFS ceiling.
  const est = (0 - threshold) * (1 - 1 / ratio) * 0.55;
  return Math.round(Math.min(18, Math.max(-18, est)) * 10) / 10;
}

export function CompressorEditor() {
  const c = useApp((s) => s.settings.compressor);
  const setC = useApp((s) => s.setCompressor);
  const beginUserEdit = useApp((s) => s.beginUserEdit);
  const endUserEdit = useApp((s) => s.endUserEdit);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLCanvasElement>(null);

  const [style, setStyle] = useState<string | null>(null);
  const [autoGain, setAutoGain] = useState(false);
  const [grRead, setGrRead] = useState(0);

  // Live params for the render loop.
  const cRef = useRef(c);
  cRef.current = c;

  // Scrolling history ring buffer.
  const hist = useRef({
    inDb: new Float32Array(HISTORY).fill(BOT_DB),
    outDb: new Float32Array(HISTORY).fill(BOT_DB),
    gr: new Float32Array(HISTORY),
    head: 0,
  });
  const grHold = useRef(0);
  const meterSmooth = useRef({ inDb: BOT_DB, outDb: BOT_DB, gr: 0 });
  // Smoothed operating-point coordinates (lerped each frame for buttery motion).
  const opPoint = useRef({ x: -1, y: -1, init: false });

  const dragRef = useRef<{
    mode: "threshold" | "ratio" | "knee";
    startX: number;
    startY: number;
    t0: number;
    r0: number;
    k0: number;
  } | null>(null);

  // Auto-gain: recompute makeup whenever threshold/ratio change while enabled.
  useEffect(() => {
    if (!autoGain) return;
    const m = autoMakeup(c.threshold, c.ratio);
    if (Math.abs(m - c.makeupGain) > 0.05) setC({ makeupGain: m });
  }, [autoGain, c.threshold, c.ratio, c.makeupGain, setC]);

  const applyStyle = (s: { name: string; patch: Partial<CompressorSettings> }) => {
    setStyle(s.name);
    setC(s.patch);
  };

  // Single render loop: sample levels, scroll history, draw display + meter.
  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    let lastUi = 0;
    const bufIn = new Float32Array(1024);
    const bufOut = new Float32Array(1024);

    const drawMain = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !wrap || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Resolve FX accent (cyan-teal) → drives knob fill + curve + dot.
      const acc = getComputedStyle(canvas).getPropertyValue("--color-fx-comp").trim();
      if (acc) ACCENT = acc;
      const cs = cRef.current;
      const y = (db: number) => dbToFrac(db) * h;

      // Grid + dB labels
      ctx.font = "10px 'Sometype Mono', monospace";
      ctx.textBaseline = "middle";
      for (let d = 0; d >= -54; d -= 6) {
        const yy = y(d);
        ctx.strokeStyle = d === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.045)";
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.textAlign = "right";
        ctx.fillText(`${d}`, w - 5, yy - 7);
      }

      // Knee band
      const kneeTop = y(cs.threshold + cs.knee / 2);
      const kneeBot = y(cs.threshold - cs.knee / 2);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(0, kneeTop, w, Math.max(0, kneeBot - kneeTop));

      const H = hist.current;
      const col = (i: number) => (i / (HISTORY - 1)) * w;
      const order = (k: number) => (H.head + k) % HISTORY;

      // Input level area (dim)
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let k = 0; k < HISTORY; k++) {
        ctx.lineTo(col(k), y(H.inDb[order(k)]));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fill();

      // Output level line (primary)
      ctx.beginPath();
      for (let k = 0; k < HISTORY; k++) {
        const xx = col(k);
        const yy = y(H.outDb[order(k)]);
        k === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Gain-reduction "curtain" hanging from the top
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let k = 0; k < HISTORY; k++) {
        ctx.lineTo(col(k), (H.gr[order(k)] / GR_FULL) * h);
      }
      ctx.lineTo(w, 0);
      ctx.closePath();
      const grGrad = ctx.createLinearGradient(0, 0, 0, h);
      grGrad.addColorStop(0, "rgba(250,176,70,0.32)");
      grGrad.addColorStop(1, "rgba(250,176,70,0.02)");
      ctx.fillStyle = grGrad;
      ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < HISTORY; k++) {
        const xx = col(k);
        const yy = (H.gr[order(k)] / GR_FULL) * h;
        k === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = "rgba(250,176,70,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Big Pro-C-style transfer curve on the main display.
      drawTransferCurve(ctx, w, h, cs, H.inDb[order(HISTORY - 1)]);

      // Threshold line + handles. The whole display can drag the threshold;
      // the large dashed rail makes that affordance obvious.
      const ty = y(cs.threshold);
      const tx = inputDbToX(cs.threshold, w);
      const railGrad = ctx.createLinearGradient(0, ty - 12, 0, ty + 12);
      railGrad.addColorStop(0, "rgba(255,255,255,0.00)");
      railGrad.addColorStop(0.5, "rgba(255,255,255,0.08)");
      railGrad.addColorStop(1, "rgba(255,255,255,0.00)");
      ctx.fillStyle = railGrad;
      ctx.fillRect(0, ty - 16, w, 32);
      ctx.strokeStyle = "rgba(255,255,255,0.74)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(w, ty);
      ctx.stroke();
      ctx.strokeStyle = "rgba(120,200,220,0.55)";
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, h);
      ctx.stroke();
      ctx.setLineDash([]);

      const drawHandle = (cx: number, cy: number, label: string, sub: string, accent = false) => {
        const bw = accent ? 72 : 58;
        ctx.save();
        ctx.shadowColor = accent ? "rgba(120,200,220,0.45)" : "rgba(0,0,0,0.4)";
        ctx.shadowBlur = accent ? 16 : 6;
        ctx.fillStyle = "rgba(14,18,24,0.94)";
        ctx.strokeStyle = accent ? "rgba(120,200,220,0.65)" : "rgba(255,255,255,0.20)";
        roundRect(ctx, cx - bw / 2, cy - 12, bw, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "9px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy - 4);
        ctx.fillStyle = accent ? "rgba(170,220,235,0.92)" : "rgba(255,255,255,0.56)";
        ctx.font = "8px 'Sometype Mono', monospace";
        ctx.fillText(sub, cx, cy + 5);
        ctx.restore();
      };
      drawHandle(66, ty, "KNEE", `${cs.knee.toFixed(0)}`);
      drawHandle(w - 78, ty, "RATIO", `${cs.ratio.toFixed(2)}:1`, true);

      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "11px 'Sometype Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`THR ${cs.threshold.toFixed(1)} dB  ·  drag`, 10, Math.max(16, ty - 10));
    };

    const drawTransferCurve = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      cs: CompressorSettings,
      curInDb: number,
    ) => {
      const xFor = (db: number) => inputDbToX(db, w);
      const yFor = (db: number) => dbToFrac(clamp(db, BOT_DB, TOP_DB)) * h;
      const topHeadroom = TOP_DB;
      const makeOut = (inDb: number) =>
        transfer(inDb, cs.threshold, cs.ratio, cs.knee) + cs.makeupGain;

      // Unity reference, full-size, not a small inset. This is what makes
      // the ratio/slope visually obvious like a modern compressor display.
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(xFor(BOT_DB), yFor(BOT_DB));
      ctx.lineTo(xFor(topHeadroom), yFor(topHeadroom));
      ctx.stroke();
      ctx.setLineDash([]);

      // Compression fill above the transfer curve.
      const fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, "rgba(120,200,220,0.22)");
      fill.addColorStop(0.55, "rgba(120,200,220,0.06)");
      fill.addColorStop(1, "rgba(120,200,220,0.00)");
      ctx.beginPath();
      ctx.moveTo(xFor(BOT_DB), yFor(BOT_DB));
      for (let i = 0; i <= w; i++) {
        const inDb = BOT_DB + (i / w) * (TOP_DB - BOT_DB);
        ctx.lineTo(i, yFor(makeOut(inDb)));
      }
      ctx.lineTo(w, yFor(TOP_DB));
      ctx.lineTo(xFor(BOT_DB), yFor(BOT_DB));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // Draw curve with glow and a secondary hot segment above threshold.
      ctx.shadowColor = "rgba(120,200,220,0.45)";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const inDb = BOT_DB + (i / w) * (TOP_DB - BOT_DB);
        const yy = yFor(makeOut(inDb));
        i === 0 ? ctx.moveTo(i, yy) : ctx.lineTo(i, yy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Emphasize the compressed / ratio portion so ratio movement is readable.
      const hotStart = Math.max(0, Math.floor(xFor(cs.threshold - cs.knee / 2)));
      ctx.strokeStyle = "rgba(150,215,230,0.95)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let started = false;
      for (let i = hotStart; i <= w; i++) {
        const inDb = BOT_DB + (i / w) * (TOP_DB - BOT_DB);
        const yy = yFor(makeOut(inDb));
        if (!started) {
          ctx.moveTo(i, yy);
          started = true;
        } else {
          ctx.lineTo(i, yy);
        }
      }
      ctx.stroke();

      // Operating point follows the music level, smoothed for premium feel.
      if (curInDb > BOT_DB + 1) {
        const out = makeOut(curInDb);
        const tx = xFor(curInDb);
        const ty = yFor(out);
        const op = opPoint.current;
        if (!op.init) {
          op.x = tx;
          op.y = ty;
          op.init = true;
        } else {
          const k = 0.22; // critically-damped feel
          op.x += (tx - op.x) * k;
          op.y += (ty - op.y) * k;
        }
        ctx.fillStyle = "rgba(10,13,18,0.92)";
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(op.x, op.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = "rgba(170,220,235,0.86)";
      ctx.font = "10px 'Sometype Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`TRANSFER  ${cs.ratio.toFixed(2)}:1`, 10, 10);
      ctx.restore();
    };

    const drawMeter = (gr: number) => {
      const canvas = meterRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      for (const t of [0, 3, 6, 9, 12, 18, 24]) {
        const yy = (t / GR_FULL) * h;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(0, yy, w, 1);
      }
      const hh = Math.min(h, (gr / GR_FULL) * h);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgb(250,140,60)");
      grad.addColorStop(1, "rgb(250,200,90)");
      ctx.fillStyle = grad;
      ctx.fillRect(1, 0, w - 2, hh);
      // hold cap
      const hy = Math.min(h - 1, (grHold.current / GR_FULL) * h);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      if (grHold.current > 0.1) ctx.fillRect(1, Math.max(0, hy - 1), w - 2, 2);
    };

    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const playing = useApp.getState().isPlaying;
      const fps = playing ? METER_FPS : 8;
      if (lastPaint && ts - lastPaint < 1000 / fps) return;
      const dt = lastPaint ? clamp((ts - lastPaint) / 1000, 1 / 120, 0.12) : 1 / fps;
      lastPaint = ts;

      const p = getPlayer();
      const chain = p.masterChain;
      let rawInDb = BOT_DB;
      let rawOutDb = BOT_DB;
      let rawGr = 0;
      if (playing && chain) {
        rawInDb = readPeakDb(p.compInAnalyser, bufIn);
        rawOutDb = readPeakDb(p.compOutAnalyser, bufOut);
        rawGr = MasterChain.reduction(chain.compressorNode);
      }
      const sm = meterSmooth.current;
      sm.inDb = smoothDb(sm.inDb, rawInDb, dt, 18, 420);
      sm.outDb = smoothDb(sm.outDb, rawOutDb, dt, 18, 420);
      sm.gr = smoothPositive(sm.gr, rawGr, dt, 25, 520);

      const H = hist.current;
      if (playing) {
        H.inDb[H.head] = sm.inDb;
        H.outDb[H.head] = sm.outDb;
        H.gr[H.head] = sm.gr;
        H.head = (H.head + 1) % HISTORY;
      }
      grHold.current = rawGr >= grHold.current ? rawGr : Math.max(0, grHold.current - dt * 7);

      drawMain();
      drawMeter(sm.gr);
      if (!lastUi || ts - lastUi > 240) {
        setGrRead(grHold.current);
        lastUi = ts;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- Pointer interaction on the main display ---------------------------
  const local = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const yToDb = (y: number, h: number) => TOP_DB - (y / h) * (TOP_DB - BOT_DB);

  const onPointerDown = (e: React.PointerEvent) => {
    beginUserEdit("Adjust compressor display");
    const { x, y, w, h } = local(e);
    const ty = dbToFrac(c.threshold) * h;
    let mode: "threshold" | "ratio" | "knee" = "threshold";
    if (Math.abs(y - ty) < 22 && Math.abs(x - (w - 78)) < 44) mode = "ratio";
    else if (Math.abs(y - ty) < 22 && Math.abs(x - 66) < 38) mode = "knee";

    // Threshold now behaves like a real compressor display: click/drag anywhere
    // on the graph sets the threshold immediately, then keeps dragging it.
    if (mode === "threshold") {
      setC({ threshold: Math.round(clamp(yToDb(y, h), -60, 0) * 10) / 10 });
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: x, startY: y, t0: c.threshold, r0: c.ratio, k0: c.knee };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y, h } = local(e);
    if (d.mode === "threshold") {
      setC({ threshold: Math.round(clamp(yToDb(y, h), -60, 0) * 10) / 10 });
    } else if (d.mode === "ratio") {
      const r = d.r0 * Math.exp((d.startY - y) / 110);
      setC({ ratio: Math.round(Math.min(20, Math.max(1, r)) * 100) / 100 });
    } else if (d.mode === "knee") {
      setC({ knee: Math.round(Math.min(40, Math.max(0, d.k0 + (x - d.startX) * 0.22)) * 10) / 10 });
    }
  };
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      endUserEdit("Adjust compressor display");
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.92 : 1.087;
    setC({ ratio: Math.round(Math.min(20, Math.max(1, c.ratio * f)) * 100) / 100 });
  };

  const cursorFor = () => {
    const d = dragRef.current;
    if (d?.mode === "knee") return "cursor-ew-resize";
    if (d?.mode === "ratio" || d?.mode === "threshold") return "cursor-ns-resize";
    return "cursor-crosshair";
  };

  const styleOptions = STYLES.map((s) => ({ id: s.name, label: s.name }));

  return (
    <PluginShell
      accent="comp"
      inspectorWidth={184}
      header={
        <PluginHeader
          title="Compressor"
          accent="comp"
          presets={
            <PresetPills
              options={styleOptions}
              value={style}
              accent="comp"
              onChange={(id) => {
                const s = STYLES.find((x) => x.name === id);
                if (s) applyStyle(s);
              }}
            />
          }
          rightSlot={
            <button
              type="button"
              onClick={() => setAutoGain((v) => !v)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition",
                autoGain
                  ? "border-fx-comp/50 bg-fx-comp/10 text-fx-comp"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
              style={
                autoGain
                  ? {
                      borderColor: "color-mix(in oklab, var(--color-fx-comp) 55%, transparent)",
                      background: "color-mix(in oklab, var(--color-fx-comp) 14%, transparent)",
                      color: "var(--color-fx-comp)",
                    }
                  : undefined
              }
              title="Auto makeup gain"
            >
              Auto Gain
            </button>
          }
          enabled={c.enabled}
          onToggleEnabled={() => setC({ enabled: !c.enabled })}
        />
      }
      inspector={
        <>
          <InspectorSection title="Gain Reduction" accent="comp">
            <div className="relative h-32 overflow-hidden rounded-md border border-border bg-background/40">
              <canvas ref={meterRef} className="absolute inset-0 h-full w-full" />
            </div>
            <InspectorReadout
              value={`−${grRead.toFixed(1)}`}
              unit="dB GR"
              sub="instantaneous reduction"
            />
          </InspectorSection>
          <InspectorSection title="Transfer">
            <InspectorRow label="Threshold" value={`${c.threshold.toFixed(1)} dB`} />
            <InspectorRow label="Ratio" value={`${c.ratio.toFixed(2)} : 1`} />
            <InspectorRow label="Knee" value={`${c.knee.toFixed(0)} dB`} />
            <InspectorRow
              label="Makeup"
              value={`${c.makeupGain >= 0 ? "+" : ""}${c.makeupGain.toFixed(1)} dB`}
            />
            <InspectorRow label="Mix" value={`${c.parallelMix.toFixed(0)} %`} />
          </InspectorSection>
          <InspectorSection title="Hint">
            <p className="text-[10px] leading-snug text-muted-foreground">
              Drag the display to set threshold · scroll = ratio · drag KNEE / RATIO handles.
            </p>
          </InspectorSection>
        </>
      }
      footer={
        <PluginKnobRow>
          <Knob
            value={c.threshold}
            min={-60}
            max={0}
            defaultValue={-24}
            size={56}
            label="Threshold"
            bipolar
            format={(v) => v.toFixed(1)}
            onChange={(v) => setC({ threshold: v })}
          />
          <Knob
            value={c.ratio}
            min={1}
            max={20}
            defaultValue={1.8}
            size={56}
            label="Ratio"
            format={(v) => `${v.toFixed(2)}:1`}
            onChange={(v) => setC({ ratio: v })}
          />
          <Knob
            value={c.knee}
            min={0}
            max={40}
            defaultValue={20}
            size={56}
            label="Knee"
            format={(v) => v.toFixed(0)}
            onChange={(v) => setC({ knee: v })}
          />
          <Knob
            value={c.attack * 1000}
            min={1}
            max={200}
            defaultValue={26}
            size={56}
            label="Attack ms"
            logScale
            format={(v) => v.toFixed(1)}
            onChange={(v) => setC({ attack: v / 1000 })}
          />
          <Knob
            value={c.release * 1000}
            min={20}
            max={1500}
            defaultValue={180}
            size={56}
            label="Release ms"
            logScale
            format={(v) => v.toFixed(0)}
            onChange={(v) => setC({ release: v / 1000 })}
          />
          <Knob
            value={c.makeupGain}
            min={-18}
            max={18}
            defaultValue={0}
            size={56}
            label="Makeup dB"
            bipolar
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
            onChange={(v) => setC({ makeupGain: v })}
            className={autoGain ? "pointer-events-none opacity-40" : ""}
          />
          <Knob
            value={c.parallelMix}
            min={0}
            max={100}
            defaultValue={100}
            size={56}
            label="Mix %"
            format={(v) => v.toFixed(0)}
            onChange={(v) => setC({ parallelMix: v })}
          />
        </PluginKnobRow>
      }
    >
      <div
        ref={wrapRef}
        className={cn("relative h-full w-full touch-none select-none", cursorFor())}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute right-3 top-2 ms-mono text-[10px] text-foreground/45">
          drag = threshold · scroll = ratio · handles = knee / ratio
        </div>
      </div>
    </PluginShell>
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
