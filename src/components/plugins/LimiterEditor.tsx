// FabFilter Pro-L2-inspired limiter editor.
//
// Goal: large mastering-limiter workflow, not small utility controls:
//   • full-width scrolling level display
//   • draggable ceiling rail (red) and drive/gain badge (gold)
//   • real-time gain-reduction marks at the ceiling
//   • loudness trend line + segmented output/GR meter rail
//   • compact bottom tray for style/peak guard/attack/release/linking
//
// The proven audio chain is preserved. UI changes map to the existing output
// stage; extra limiter params are normalized in presets.ts and applied by the
// existing DynamicsCompressor/softclip output stage.

import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import { MasterChain } from "@/audio/engine";
import type { OutputSettings } from "@/audio/presets";
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

const TOP_DB = 2;
const BOT_DB = -36;
const HISTORY = 480;
const METER_FPS = 30;
const GR_FULL = 12;
const C_CYAN = "rgb(0, 216, 242)";
const C_CEIL = "rgb(235, 52, 75)";
const C_GOLD = "rgb(242, 190, 67)";
const C_BLUE = "rgb(150, 174, 225)";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ampToDb = (v: number) => (v <= 1e-6 ? BOT_DB : Math.max(BOT_DB, 20 * Math.log10(v)));
const dbToFrac = (db: number) => Math.min(1, Math.max(0, (TOP_DB - db) / (TOP_DB - BOT_DB)));
const fmtDb = (db: number, digits = 1) => `${db >= 0 ? "+" : ""}${db.toFixed(digits)}`;

const colorForDb = (db: number) => {
  if (db > -1) return "rgb(248,113,113)";
  if (db > -3) return "rgb(251,146,60)";
  if (db > -6) return "rgb(251,191,36)";
  if (db > -24) return "rgb(52,211,153)";
  return "rgb(56,189,248)";
};

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

const readPeakRms = (analyser: AnalyserNode | null, buf: Float32Array) => {
  if (!analyser) return { peakDb: BOT_DB, rmsDb: BOT_DB };
  analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peakDb: ampToDb(peak), rmsDb: ampToDb(Math.sqrt(sum / buf.length)) };
};

type DragMode = "ceiling" | "drive";

type LimiterStyle = OutputSettings["limiterStyle"];

const STYLES: { id: LimiterStyle; label: string; patch: Partial<OutputSettings> }[] = [
  {
    id: "transparent",
    label: "Transparent",
    patch: {
      limiterStyle: "transparent",
      limiterAttackMs: 2.5,
      limiterReleaseMs: 55,
      punchProtect: true,
    },
  },
  {
    id: "modern",
    label: "Modern",
    patch: { limiterStyle: "modern", limiterAttackMs: 4, limiterReleaseMs: 80, punchProtect: true },
  },
  {
    id: "punchy",
    label: "Punchy",
    patch: {
      limiterStyle: "punchy",
      limiterAttackMs: 1.2,
      limiterReleaseMs: 95,
      punchProtect: false,
    },
  },
  {
    id: "safe",
    label: "Safe",
    patch: {
      limiterStyle: "safe",
      limiterAttackMs: 6,
      limiterReleaseMs: 140,
      punchProtect: true,
      truePeak: true,
    },
  },
];

export function LimiterEditor() {
  const o = useApp((s) => s.settings.output);
  const setOutput = useApp((s) => s.setOutput);
  const beginUserEdit = useApp((s) => s.beginUserEdit);
  const endUserEdit = useApp((s) => s.endUserEdit);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLCanvasElement>(null);
  const oRef = useRef(o);
  oRef.current = o;

  const dragRef = useRef<{
    mode: DragMode;
    startY: number;
    startDrive: number;
    startCeiling: number;
  } | null>(null);

  const [read, setRead] = useState({ gr: 0, outPk: BOT_DB, outRms: BOT_DB, lufs: BOT_DB });
  const readRef = useRef({ gr: 0, outPk: BOT_DB, outRms: BOT_DB, lufs: BOT_DB });
  const meterSmooth = useRef({
    prePk: BOT_DB,
    outPk: BOT_DB,
    outRms: BOT_DB,
    lufs: BOT_DB,
    gr: 0,
    peakHold: BOT_DB,
  });

  const hist = useRef({
    inDb: new Float32Array(HISTORY).fill(BOT_DB),
    outDb: new Float32Array(HISTORY).fill(BOT_DB),
    rmsDb: new Float32Array(HISTORY).fill(BOT_DB),
    gr: new Float32Array(HISTORY),
    head: 0,
  });
  const hold = useRef({ gr: 0, peak: BOT_DB });

  const setStyle = (style: (typeof STYLES)[number]) => setOutput(style.patch);
  const cycleOversampling = () => {
    const next = o.oversampling === 1 ? 2 : o.oversampling === 2 ? 4 : o.oversampling === 4 ? 8 : 1;
    setOutput({ oversampling: next });
  };

  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    let lastUi = 0;
    const preBuf = new Float32Array(1024);
    const outBuf = new Float32Array(1024);

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

      const s = oRef.current;
      const y = (db: number) => dbToFrac(db) * h;
      const H = hist.current;
      const order = (k: number) => (H.head + k) % HISTORY;
      const xFor = (k: number) => (k / (HISTORY - 1)) * w;

      // Background: transparent blue-gray Pro-L-style display.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "rgba(70,70,86,0.38)");
      bg.addColorStop(0.55, "rgba(59,66,82,0.28)");
      bg.addColorStop(1, "rgba(24,29,36,0.72)");
      ctx.fillStyle = bg;
      roundRect(ctx, 0, 0, w, h, 6);
      ctx.fill();

      // Grid and right dB scale.
      ctx.font = "10px 'Sometype Mono', monospace";
      ctx.textBaseline = "middle";
      const ticks = [0, -5, -8, -11, -14, -17, -20, -23, -26, -29, -32, -35];
      for (const d of ticks) {
        const yy = y(d);
        ctx.strokeStyle = d === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.075)";
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.62)";
        ctx.textAlign = "right";
        ctx.fillText(`${d} dB`, w - 8, yy - 8);
      }

      // Vertical time-ish grid.
      for (let i = 0; i <= 9; i++) {
        const xx = (i / 9) * w;
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        ctx.beginPath();
        ctx.moveTo(xx, 0);
        ctx.lineTo(xx, h);
        ctx.stroke();
      }

      // Incoming signal after limiter drive: filled peak history.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let k = 0; k < HISTORY; k++) {
        const db = clamp(H.inDb[order(k)], BOT_DB, TOP_DB);
        ctx.lineTo(xFor(k), y(db));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const wave = ctx.createLinearGradient(0, 0, 0, h);
      wave.addColorStop(0, "rgba(182,199,244,0.72)");
      wave.addColorStop(0.42, "rgba(139,160,214,0.52)");
      wave.addColorStop(1, "rgba(85,99,133,0.18)");
      ctx.fillStyle = wave;
      ctx.fill();

      // Secondary output body, slightly brighter lower layer.
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let k = 0; k < HISTORY; k++) {
        const db = clamp(H.outDb[order(k)], BOT_DB, TOP_DB);
        ctx.lineTo(xFor(k), y(db));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(220,228,255,0.16)";
      ctx.fill();
      ctx.restore();

      // Gain reduction: red ceiling bites hanging from the ceiling rail.
      const ceilY = y(s.limiterCeiling);
      for (let k = 0; k < HISTORY; k++) {
        const gr = H.gr[order(k)];
        if (gr < 0.15) continue;
        const x = xFor(k);
        const nextX = xFor(k + 1);
        const hh = Math.min(h - ceilY, (gr / GR_FULL) * h * 0.72 + 4);
        const a = Math.min(0.82, 0.18 + gr / 13);
        ctx.fillStyle = `rgba(235,52,75,${a})`;
        ctx.fillRect(x, ceilY, Math.max(1, nextX - x + 0.5), hh);
      }
      ctx.shadowColor = "rgba(235,52,75,0.45)";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = C_CEIL;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, ceilY);
      ctx.lineTo(w, ceilY);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Loudness trend line (short-term RMS approx), gold.
      ctx.beginPath();
      for (let k = 0; k < HISTORY; k++) {
        const xx = xFor(k);
        const yy = y(clamp(H.rmsDb[order(k)], BOT_DB, TOP_DB));
        k === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = "rgba(242,190,67,0.96)";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Ceiling draggable label.
      badge(
        ctx,
        w - 80,
        Math.max(22, ceilY + 18),
        `${fmtDb(s.limiterCeiling, 1)} dB`,
        "CEILING",
        C_GOLD,
      );

      // Drive badge. Drag anywhere away from the ceiling for drive; wheel also controls drive.
      const driveY = clamp(h * 0.55 - s.limiterDrive * 3.2, 42, h - 64);
      badge(ctx, 58, driveY, `${fmtDb(s.limiterDrive, 1)}`, "DRIVE", "rgb(121,145,190)");

      // Current stats / instructions.
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.font = "10px 'Sometype Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("drag red ceiling rail · drag display = drive · wheel = drive fine", 12, h - 12);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(0,216,242,0.78)";
      ctx.fillText(
        `${s.limiterStyle.toUpperCase()} · ${s.oversampling}x · ${s.truePeak ? "TP SAFE" : "TP OFF"}`,
        w - 12,
        18,
      );
    };

    const drawMeter = () => {
      const canvas = meterRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 34;
      const h = canvas.clientHeight || 220;
      const targetW = Math.floor(w * dpr);
      const targetH = Math.floor(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = readRef.current;

      // Stable LED output meter. Keep this geometry identical to the Master
      // Volume meter philosophy: fixed narrow rail, semantic colour zones,
      // smoothed peak level, and a quiet peak-hold cap. Avoid large text inside
      // the rail because changing glyphs make the small inspector meter look like
      // it is shaking/flickering.
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      roundRect(ctx, 0, 0, w, h, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.stroke();

      const x = 0;
      const padX = 2;
      const segH = 4;
      const segGap = 2;
      const activeTop = dbToFrac(r.outPk) * h;

      const zones: [number, number, string][] = [
        [BOT_DB, -24, "rgba(56,189,248,0.055)"],
        [-24, -6, "rgba(52,211,153,0.075)"],
        [-6, -3, "rgba(251,191,36,0.12)"],
        [-3, -1, "rgba(251,146,60,0.14)"],
        [-1, TOP_DB, "rgba(248,113,113,0.16)"],
      ];
      for (const [lo, hi, color] of zones) {
        const yHi = dbToFrac(hi) * h;
        const yLo = dbToFrac(lo) * h;
        ctx.fillStyle = color;
        ctx.fillRect(x + 1, yHi, w - 2, Math.max(1, yLo - yHi));
      }

      // Dim rails first so the meter stays visually anchored even at silence.
      for (let yy = h - segH; yy >= 0; yy -= segH + segGap) {
        const midDb = TOP_DB - ((yy + segH * 0.5) / h) * (TOP_DB - BOT_DB);
        ctx.fillStyle = colorForDb(midDb);
        ctx.globalAlpha = 0.16;
        roundRect(ctx, x + padX, yy, w - padX * 2, segH, 1.5);
        ctx.fill();
      }

      if (r.outPk > BOT_DB + 0.2) {
        for (let yy = h - segH; yy >= activeTop; yy -= segH + segGap) {
          const midDb = TOP_DB - ((yy + segH * 0.5) / h) * (TOP_DB - BOT_DB);
          ctx.fillStyle = colorForDb(midDb);
          ctx.globalAlpha = 0.92;
          roundRect(ctx, x + padX, yy, w - padX * 2, segH, 1.5);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      if (hold.current.peak > BOT_DB && Number.isFinite(hold.current.peak)) {
        const hy = dbToFrac(hold.current.peak) * h;
        ctx.fillStyle = hold.current.peak > -1 ? C_CEIL : colorForDb(hold.current.peak);
        ctx.fillRect(x + 1, Math.max(0, hy - 1), w - 2, 2);
      }
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
      const settings = oRef.current;
      let rawPrePk = BOT_DB;
      let rawOutPk = BOT_DB;
      let rawOutRms = BOT_DB;
      let rawGr = 0;

      if (playing && chain) {
        const pre = readPeakRms(p.limiterInAnalyser, preBuf);
        const out = readPeakRms(p.outputAnalyser, outBuf);
        rawPrePk = pre.peakDb + settings.limiterDrive;
        rawOutPk = out.peakDb;
        rawOutRms = out.rmsDb;
        rawGr = MasterChain.reduction(chain.limiterNode);
      }

      const sm = meterSmooth.current;
      sm.prePk = smoothDb(sm.prePk, rawPrePk, dt, 18, 360);
      sm.outPk = smoothDb(sm.outPk, rawOutPk, dt, 14, 520);
      sm.outRms = smoothDb(sm.outRms, rawOutRms, dt, 260, 1200);
      sm.lufs = smoothDb(sm.lufs, rawOutRms - 1.5, dt, 900, 1900);
      sm.gr = smoothPositive(sm.gr, rawGr, dt, 28, 520);
      sm.peakHold = rawOutPk >= sm.peakHold ? rawOutPk : Math.max(BOT_DB, sm.peakHold - dt * 7);

      hold.current.gr = sm.gr;
      hold.current.peak = sm.peakHold;

      const H = hist.current;
      if (playing) {
        H.inDb[H.head] = clamp(sm.prePk, BOT_DB, TOP_DB);
        H.outDb[H.head] = clamp(sm.outPk, BOT_DB, TOP_DB);
        H.rmsDb[H.head] = clamp(sm.lufs, BOT_DB, TOP_DB);
        H.gr[H.head] = sm.gr;
        H.head = (H.head + 1) % HISTORY;
      }

      const nextRead = { gr: sm.gr, outPk: sm.outPk, outRms: sm.outRms, lufs: sm.lufs };
      readRef.current = nextRead;
      drawMain();
      drawMeter();
      if (!lastUi || ts - lastUi > 220) {
        setRead(nextRead);
        lastUi = ts;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The canvas loop reads live values through refs to avoid restarting on every knob move.
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const yToDb = (y: number, h: number) => TOP_DB - (y / h) * (TOP_DB - BOT_DB);

  const onPointerDown = (e: React.PointerEvent) => {
    beginUserEdit("Adjust limiter display");
    const p = local(e);
    const ceilingY = dbToFrac(o.limiterCeiling) * p.h;
    const mode: DragMode = Math.abs(p.y - ceilingY) < 28 ? "ceiling" : "drive";
    if (mode === "ceiling") {
      setOutput({ limiterCeiling: Math.round(clamp(yToDb(p.y, p.h), -12, 0) * 10) / 10 });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startY: p.y,
      startDrive: o.limiterDrive,
      startCeiling: o.limiterCeiling,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = local(e);
    if (d.mode === "ceiling") {
      setOutput({ limiterCeiling: Math.round(clamp(yToDb(p.y, p.h), -12, 0) * 10) / 10 });
    } else {
      const next = d.startDrive + (d.startY - p.y) * 0.045;
      setOutput({ limiterDrive: Math.round(clamp(next, 0, 12) * 10) / 10 });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      endUserEdit("Adjust limiter display");
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.35;
    const next = o.limiterDrive + (e.deltaY > 0 ? -step : step);
    setOutput({ limiterDrive: Math.round(clamp(next, 0, 12) * 10) / 10 });
  };

  const styleOptions = STYLES.map((s) => ({ id: s.id as string, label: s.label }));

  return (
    <PluginShell
      accent="limiter"
      header={
        <PluginHeader
          title="Limiter"
          accent="limiter"
          presets={
            <PresetPills
              options={styleOptions}
              value={o.limiterStyle as string}
              accent="limiter"
              onChange={(id) => {
                const s = STYLES.find((x) => x.id === id);
                if (s) setStyle(s);
              }}
            />
          }
          rightSlot={
            <>
              <button
                type="button"
                onClick={() =>
                  setOutput({
                    truePeak: !o.truePeak,
                    punchProtect: !o.truePeak ? true : o.punchProtect,
                  })
                }
                className="rounded-md border px-2 py-1 text-[11px] transition"
                style={
                  o.truePeak
                    ? {
                        borderColor:
                          "color-mix(in oklab, var(--color-fx-limiter) 50%, transparent)",
                        background: "color-mix(in oklab, var(--color-fx-limiter) 12%, transparent)",
                        color: "var(--color-fx-limiter)",
                      }
                    : { borderColor: "var(--border)", color: "var(--muted-foreground)" }
                }
              >
                TP {o.truePeak ? "Safe" : "Off"}
              </button>
              <button
                type="button"
                onClick={cycleOversampling}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
              >
                {o.oversampling}x
              </button>
            </>
          }
          enabled={o.limiterEnabled}
          onToggleEnabled={() => setOutput({ limiterEnabled: !o.limiterEnabled })}
        />
      }
      inspector={
        <>
          <InspectorSection title="Output Meter" accent="limiter">
            <div className="flex justify-center py-1">
              <canvas ref={meterRef} className="block h-[220px] w-[34px]" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <InspectorReadout value={fmtDb(read.outPk, 1)} unit="dB pk" />
              <InspectorReadout value={`−${read.gr.toFixed(1)}`} unit="dB GR" />
            </div>
          </InspectorSection>
          <InspectorSection title="Ceiling">
            <InspectorRow label="Ceiling" value={`${fmtDb(o.limiterCeiling, 1)} dB`} />
            <InspectorRow label="Gain" value={`${fmtDb(o.limiterDrive, 1)} dB`} />
            <InspectorRow label="Peak Guard" value={`${o.lookaheadMs.toFixed(1)} ms`} />
            <InspectorRow label="True-Peak" value={o.truePeak ? "Safe" : "Off"} />
          </InspectorSection>
          <InspectorSection title="Hint">
            <p className="text-[10px] leading-snug text-muted-foreground">
              Drag display vertically = gain · scroll = ceiling. Pick a Style pill for tonal
              character.
            </p>
          </InspectorSection>
        </>
      }
      footer={
        <PluginKnobRow>
          <Knob
            value={o.limiterDrive}
            min={0}
            max={12}
            defaultValue={0.55}
            size={56}
            label="Gain dB"
            format={(v) => fmtDb(v, 1)}
            onChange={(v) => setOutput({ limiterDrive: v })}
          />
          <Knob
            value={o.limiterCeiling}
            min={-12}
            max={0}
            defaultValue={-1}
            size={56}
            label="Ceiling"
            bipolar
            format={(v) => fmtDb(v, 1)}
            onChange={(v) => setOutput({ limiterCeiling: v })}
          />
          <Knob
            value={o.lookaheadMs}
            min={0}
            max={20}
            defaultValue={5}
            size={56}
            label="Peak Guard"
            logScale
            format={(v) => `${v.toFixed(1)} ms`}
            onChange={(v) => setOutput({ lookaheadMs: v })}
          />
          <Knob
            value={o.limiterAttackMs}
            min={0.1}
            max={50}
            defaultValue={4}
            size={56}
            label="Attack"
            logScale
            format={(v) => `${v.toFixed(1)} ms`}
            onChange={(v) => setOutput({ limiterAttackMs: v })}
          />
          <Knob
            value={o.limiterReleaseMs}
            min={5}
            max={1000}
            defaultValue={80}
            size={56}
            label="Release"
            logScale
            format={(v) => `${v.toFixed(0)} ms`}
            onChange={(v) => setOutput({ limiterReleaseMs: v })}
          />
          <Knob
            value={o.transientLink}
            min={0}
            max={100}
            defaultValue={75}
            size={56}
            label="Transients"
            format={(v) => `${v.toFixed(0)}%`}
            onChange={(v) => setOutput({ transientLink: v })}
          />
          <Knob
            value={o.releaseLink}
            min={0}
            max={100}
            defaultValue={95}
            size={56}
            label="Release Link"
            format={(v) => `${v.toFixed(0)}%`}
            onChange={(v) => setOutput({ releaseLink: v })}
          />
        </PluginKnobRow>
      }
    >
      <div
        ref={wrapRef}
        className="relative h-full w-full touch-none select-none cursor-ns-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </PluginShell>
  );
}

function badge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: string,
  label: string,
  color: string,
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color === C_GOLD ? "rgba(176,130,26,0.96)" : "rgba(60,72,105,0.94)";
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  roundRect(ctx, x - 36, y - 18, 72, 36, 7);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.88)";
  ctx.font = "12px 'Sometype Mono', monospace";
  ctx.fillText(value, x, y - 4);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "8px 'Plus Jakarta Sans', sans-serif";
  ctx.fillText(label, x, y + 9);
  ctx.restore();
}

function roundRect(
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
