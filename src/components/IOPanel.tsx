// Ozone-style I/O metering rail on the right edge:
//   • Stereo input + output meters (peak bars + peak-hold caps)
//   • Peak / RMS numeric readouts per channel
//   • Vertical input + output gain faders
//   • Master Bypass (dry passthrough)
//   • Modern Gain Match toggle: slow perceived-level compensation so the
//     processed output is compared fairly against the input.
//
// Metering reads per-channel analysers exposed by the audio engine. Gain Match
// uses dedicated pre-compensation taps so the controller does not chase itself.

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Lock, Unlock, Power } from "lucide-react";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import { cn } from "@/lib/utils";

const TOP_DB = 4;
const BOT_DB = -60;
const METER_FPS = 30;
const GAIN_MATCH_FPS = 8;
const GAIN_MATCH_LOUDER_DB = 1.5;
const SCALE_TICKS = [4, 0, -1, -3, -6, -10, -15, -20, -30, -40, -50];

// Professional meter hierarchy: noise floor/low presence → healthy program
// level → headroom caution → clipping risk. No decorative rainbow.
const C_LOW = "rgb(56, 189, 248)";
const C_SAFE = "rgb(52, 211, 153)";
const C_WARN = "rgb(251, 191, 36)";
const C_HOT = "rgb(251, 146, 60)";
const C_CLIP = "rgb(248, 113, 113)";
const colorForDb = (db: number) => {
  if (db >= -1) return C_CLIP;
  if (db >= -3) return C_HOT;
  if (db >= -6) return C_WARN;
  if (db >= -24) return C_SAFE;
  return C_LOW;
};

const dbToFrac = (db: number) => Math.min(1, Math.max(0, (TOP_DB - db) / (TOP_DB - BOT_DB)));
const ampToDb = (v: number) => (v <= 1e-6 ? BOT_DB : Math.max(BOT_DB, 20 * Math.log10(v)));
const dbToAmp = (db: number) => (db <= BOT_DB + 0.1 ? 0 : Math.pow(10, db / 20));
const fmtDb = (db: number) => (db <= BOT_DB + 0.2 ? "-∞" : `${db > 0 ? "+" : ""}${db.toFixed(1)}`);
const fmtOffset = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round01 = (v: number) => Math.round(v * 10) / 10;

const smoothDb = (prev: number, next: number, dt: number, attackMs: number, releaseMs: number) => {
  const target = Number.isFinite(next) ? clamp(next, BOT_DB, TOP_DB) : BOT_DB;
  const current = Number.isFinite(prev) ? prev : target;
  const tau = Math.max(0.001, (target > current ? attackMs : releaseMs) / 1000);
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / tau);
  return current + (target - current) * alpha;
};

const smoothScalar = (
  prev: number,
  next: number,
  dt: number,
  attackSec: number,
  releaseSec: number,
) => {
  const target = Number.isFinite(next) ? next : prev;
  const tau = Math.max(0.04, target < prev ? attackSec : releaseSec);
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

const pairRmsDb = (lDb: number, rDb: number, mono: boolean) => {
  const l = dbToAmp(lDb);
  const r = mono ? l : dbToAmp(rDb);
  return ampToDb(Math.sqrt((l * l + r * r) / (mono ? 1 : 2)));
};

type Lvl = {
  pkLDb: number;
  pkRDb: number;
  rmsLDb: number;
  rmsRDb: number;
  holdL: number;
  holdR: number;
};
const zeroLvl = (): Lvl => ({
  pkLDb: BOT_DB,
  pkRDb: BOT_DB,
  rmsLDb: BOT_DB,
  rmsRDb: BOT_DB,
  holdL: BOT_DB,
  holdR: BOT_DB,
});

export function IOPanel() {
  const isPlaying = useApp((s) => s.isPlaying);
  const bypass = useApp((s) => s.settings.output.bypass);
  const fileGain = useApp((s) => s.settings.output.fileGain);
  const inputGain = useApp((s) => s.settings.output.inputGain);
  const outputGain = useApp((s) => s.settings.output.outputGain);
  const outputGainLock = useApp((s) => s.settings.output.outputGainLock);
  const gainMatchEnabled = useApp((s) => s.settings.output.gainMatchEnabled);
  const gainMatchGain = useApp((s) => s.settings.output.gainMatchGain);
  const bypassLocked = useApp((s) => s.bypassLocked);
  const gainMatchLocked = useApp((s) => s.gainMatchLocked);
  const inputHeadroom = useApp((s) => s.inputHeadroom);
  const setOutput = useApp((s) => s.setOutput);
  const setBypassLocked = useApp((s) => s.setBypassLocked);
  const setGainMatchLocked = useApp((s) => s.setGainMatchLocked);

  const inCanvas = useRef<HTMLCanvasElement>(null);
  const outCanvas = useRef<HTMLCanvasElement>(null);

  const inLvl = useRef<Lvl>(zeroLvl());
  const outLvl = useRef<Lvl>(zeroLvl());
  const [inRead, setInRead] = useState<Lvl>(zeroLvl());
  const [outRead, setOutRead] = useState<Lvl>(zeroLvl());

  // Keep fast loop closures fresh without restarting the animation effect.
  const stateRef = useRef({ bypass, outputGain, gainMatchEnabled, gainMatchGain });
  useEffect(() => {
    stateRef.current = { bypass, outputGain, gainMatchEnabled, gainMatchGain };
  }, [bypass, outputGain, gainMatchEnabled, gainMatchGain]);

  const gmRef = useRef({ offsetDb: 0, lastCommitTs: 0, lastActiveTs: 0 });

  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    let lastUi = 0;
    const bufL = new Float32Array(1024);
    const bufR = new Float32Array(1024);
    const gmInL = new Float32Array(2048);
    const gmInR = new Float32Array(2048);
    const gmOutL = new Float32Array(2048);
    const gmOutR = new Float32Array(2048);

    const measure = (
      aL: AnalyserNode | null,
      aR: AnalyserNode | null,
      mono: boolean,
      store: MutableRefObject<Lvl>,
      dt: number,
    ) => {
      const left = readPeakRms(aL, bufL);
      const right = mono ? left : readPeakRms(aR, bufR);
      const cur = store.current;
      const pkLDb = smoothDb(cur.pkLDb, left.peakDb, dt, 20, 420);
      const pkRDb = smoothDb(cur.pkRDb, right.peakDb, dt, 20, 420);
      const rmsLDb = smoothDb(cur.rmsLDb, left.rmsDb, dt, 220, 900);
      const rmsRDb = smoothDb(cur.rmsRDb, right.rmsDb, dt, 220, 900);
      const holdL = left.peakDb >= cur.holdL ? left.peakDb : Math.max(BOT_DB, cur.holdL - dt * 9);
      const holdR = right.peakDb >= cur.holdR ? right.peakDb : Math.max(BOT_DB, cur.holdR - dt * 9);
      store.current = { pkLDb, pkRDb, rmsLDb, rmsRDb, holdL, holdR };
    };

    const drawMeter = (canvas: HTMLCanvasElement | null, lvl: Lvl) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const gap = 4;
      const bw = (w - gap) / 2;
      const bars: [number, number][] = [
        [lvl.pkLDb, lvl.holdL],
        [lvl.pkRDb, lvl.holdR],
      ];
      bars.forEach(([db, hold], i) => {
        const x = i * (bw + gap);
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(x, 0, bw, h);
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.strokeRect(x + 0.5, 0.5, bw - 1, h - 1);
        for (const t of SCALE_TICKS) {
          const y = dbToFrac(t) * h;
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fillRect(x, y, bw, 1);
        }
        const top = dbToFrac(db) * h;
        // Dim reference zones explain the meter philosophy without shouting.
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
          ctx.fillRect(x + 1, yHi, bw - 2, Math.max(1, yLo - yHi));
        }
        // LED-style segments: each segment has one semantic color based on its
        // dB position. This avoids the old decorative rainbow gradient.
        if (db > BOT_DB) {
          const segH = 4;
          const segGap = 2;
          for (let yy = h - segH; yy >= top; yy -= segH + segGap) {
            const midDb = TOP_DB - ((yy + segH * 0.5) / h) * (TOP_DB - BOT_DB);
            ctx.fillStyle = colorForDb(midDb);
            ctx.globalAlpha = midDb <= db ? 0.92 : 0.25;
            ctx.fillRect(x + 2, yy, bw - 4, segH);
          }
          ctx.globalAlpha = 1;
        }
        if (hold > BOT_DB && Number.isFinite(hold)) {
          const hy = dbToFrac(hold) * h;
          ctx.fillStyle = hold > -1 ? C_CLIP : colorForDb(hold);
          ctx.fillRect(x + 1, Math.max(0, hy - 1), bw - 2, 2);
        }
      });
    };

    const updateGainMatch = (ts: number, dt: number, mono: boolean) => {
      const st = stateRef.current;
      if (!st.gainMatchEnabled || st.bypass) return;
      if (ts - gmRef.current.lastCommitTs < 1000 / GAIN_MATCH_FPS) return;

      const p = getPlayer();
      const inL = readPeakRms(p.matchInAnalyserL, gmInL);
      const inR = mono ? inL : readPeakRms(p.matchInAnalyserR, gmInR);
      const outL = readPeakRms(p.matchOutAnalyserL, gmOutL);
      const outR = mono ? outL : readPeakRms(p.matchOutAnalyserR, gmOutR);
      const inRmsDb = pairRmsDb(inL.rmsDb, inR.rmsDb, mono);
      const outRmsPreDb = pairRmsDb(outL.rmsDb, outR.rmsDb, mono);
      const outPeakPreDb = Math.max(outL.peakDb, outR.peakDb);

      // Gated, slow controller: ignore silence, do not chase tiny frame-to-frame changes,
      // and include the manual output fader so final audible output matches the input.
      if (inRmsDb < -42 || outRmsPreDb < -58) return;
      gmRef.current.lastActiveTs = ts;

      // Do not punish a better master: match close to the source but keep the
      // enhanced version just a little louder so users can hear the improvement.
      let target = inRmsDb + GAIN_MATCH_LOUDER_DB - (outRmsPreDb + st.outputGain);
      // Never add more than the desired A/B bias; trim only the excess.
      // Bias is intentionally a touch stronger so processed playback still
      // feels slightly better/louder than bypass during A/B.
      target = Math.min(target, GAIN_MATCH_LOUDER_DB);
      // Peak safety should cap excessive positive makeup, not force the
      // processed path below the bypass reference. When peak headroom is tight,
      // the engine trims the bypass reference instead so A/B still confirms the
      // enhanced master as slightly louder.
      const peakSafeMax = -0.35 - (outPeakPreDb + st.outputGain);
      if (target > 0) target = Math.min(target, Math.max(0, peakSafeMax));
      target = clamp(target, -10, 6);

      // When the error is already tiny, freeze; this prevents zipper-like UI motion.
      if (Math.abs(target - gmRef.current.offsetDb) < 0.08) target = gmRef.current.offsetDb;
      gmRef.current.offsetDb = smoothScalar(gmRef.current.offsetDb, target, dt, 0.38, 1.15);
      const next = round01(gmRef.current.offsetDb);
      gmRef.current.lastCommitTs = ts;

      if (Math.abs(next - st.gainMatchGain) >= 0.1) {
        setOutput({ gainMatchGain: next });
      }
    };

    const tick = (ts: number) => {
      if (!useApp.getState().isPlaying) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (lastPaint && ts - lastPaint < 1000 / METER_FPS) return;
      const dt = lastPaint ? clamp((ts - lastPaint) / 1000, 1 / 120, 0.12) : 1 / METER_FPS;
      lastPaint = ts;

      const p = getPlayer();
      const mono = p.channels === 1;
      measure(p.inAnalyserL, p.inAnalyserR, mono, inLvl, dt);
      measure(p.outAnalyserL, p.outAnalyserR, mono, outLvl, dt);
      updateGainMatch(ts, dt, mono);
      drawMeter(inCanvas.current, inLvl.current);
      drawMeter(outCanvas.current, outLvl.current);
      if (!lastUi || ts - lastUi > 240) {
        setInRead({ ...inLvl.current });
        setOutRead({ ...outLvl.current });
        lastUi = ts;
      }
    };
    if (!isPlaying) return;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, setOutput]);

  const toggleGainMatch = () => {
    if (gainMatchEnabled) {
      gmRef.current.offsetDb = 0;
      setOutput({ gainMatchEnabled: false, gainMatchGain: 0 });
      return;
    }
    gmRef.current.offsetDb = gainMatchGain || 0;
    setOutput({ gainMatchEnabled: true, gainMatchGain: gainMatchGain || 0 });
  };

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-panel-soft">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
          I / O
        </span>
        <button
          type="button"
          onClick={() => setOutput({ bypass: !bypass })}
          title="Master bypass"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition",
            bypass
              ? "border-amber-400/75 bg-amber-500/15 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,0.18)] ring-1 ring-amber-300/15"
              : "border-primary/45 bg-primary/10 text-primary hover:border-primary/65 hover:bg-primary/15",
          )}
        >
          <Power className="h-3 w-3" />
          {bypass ? "Bypassed" : "Active"}
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
          <MeterColumn
            label="Input"
            read={inRead}
            canvasRef={inCanvas}
            gain={inputGain}
            onGain={(v) => setOutput({ inputGain: v })}
            assist={inputHeadroom ? "manual input" : undefined}
          />

          <div className="relative w-7 pt-[34px]" aria-hidden>
            <div className="relative h-[220px]">
              {SCALE_TICKS.map((t) => (
                <span
                  key={t}
                  className="absolute right-0 -translate-y-1/2 text-[9px] tabular-nums text-muted-foreground"
                  style={{ top: `${dbToFrac(t) * 100}%` }}
                >
                  {t}
                </span>
              ))}
              <span
                className="absolute right-0 -translate-y-1/2 text-[9px] text-muted-foreground"
                style={{ top: "100%" }}
              >
                ∞
              </span>
            </div>
          </div>

          <MeterColumn
            label="Output"
            read={outRead}
            canvasRef={outCanvas}
            gain={outputGain}
            onGain={(v) => setOutput({ outputGain: v })}
            assist={
              gainMatchEnabled
                ? `GM ${fmtOffset(gainMatchGain)}`
                : outputGainLock
                  ? "Output locked"
                  : undefined
            }
            locked={outputGainLock}
            lockLabel="Lock Output gain when loading presets"
            onToggleLock={() => setOutput({ outputGainLock: !outputGainLock })}
          />
        </div>
        {inputHeadroom && (
          <div className="mt-3 rounded-lg border border-primary/18 bg-panel/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/85">
                File Pre-Gain
              </span>
              <span className="ms-mono text-[10px] text-foreground/85">{fmtOffset(fileGain)}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 ms-mono text-[9px] text-muted-foreground">
              <span>raw {inputHeadroom.loudnessLufs.toFixed(1)} LUFS</span>
              <span>peak {inputHeadroom.peakDb.toFixed(1)} dBFS</span>
              <span>staged {inputHeadroom.projectedLoudnessLufs.toFixed(1)} LUFS</span>
              <span>staged peak {inputHeadroom.projectedPeakDb.toFixed(1)} dBFS</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOutput({ bypass: !bypass })}
            className={cn(
              "grid min-h-[50px] w-full place-items-center rounded-md border px-3 py-2 pr-8 text-xs font-medium transition",
              bypass
                ? "border-amber-400/80 bg-amber-500/16 text-amber-200 shadow-[0_0_22px_rgba(245,158,11,0.18)] ring-1 ring-amber-300/15 hover:bg-amber-500/20"
                : "border-border bg-panel text-foreground/80 hover:border-primary/45 hover:bg-accent",
            )}
          >
            {bypass ? "Bypassed" : "Bypass"}
          </button>
          <LockToggle
            locked={bypassLocked}
            label="Lock Bypass state when loading presets"
            onToggle={() => setBypassLocked(!bypassLocked)}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={toggleGainMatch}
            className={cn(
              "grid min-h-[50px] w-full place-items-center rounded-md border px-3 py-2 pr-8 text-xs font-medium transition",
              gainMatchEnabled
                ? "border-primary/70 bg-primary/15 text-primary shadow-[0_0_18px_rgba(0,229,255,0.16)]"
                : "border-border bg-panel text-foreground/80 hover:bg-accent",
            )}
            title="Toggle smart gain match: keeps A/B fair while preserving a slightly louder mastered result"
            aria-pressed={gainMatchEnabled}
          >
            <span className="block">Gain Match</span>
            <span className="block ms-mono text-[10px] opacity-80">
              {gainMatchEnabled ? fmtOffset(gainMatchGain) : "Off"}
            </span>
          </button>
          <LockToggle
            locked={gainMatchLocked}
            label="Lock Gain Match state when loading presets"
            onToggle={() => setGainMatchLocked(!gainMatchLocked)}
          />
        </div>
      </div>
    </aside>
  );
}

function LockToggle({
  locked,
  label,
  onToggle,
}: {
  locked: boolean;
  label: string;
  onToggle: () => void;
}) {
  const Icon = locked ? Lock : Unlock;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={locked}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full border text-[10px] shadow-sm transition",
        locked
          ? "border-primary/70 bg-primary/18 text-primary shadow-[0_0_12px_rgba(0,229,255,0.18)]"
          : "border-border bg-panel text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

function MeterColumn({
  label,
  read,
  canvasRef,
  gain,
  onGain,
  assist,
  locked,
  lockLabel,
  onToggleLock,
}: {
  label: string;
  read: Lvl;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  gain: number;
  onGain: (v: number) => void;
  assist?: string;
  locked?: boolean;
  lockLabel?: string;
  onToggleLock?: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/55">
        {label}
      </div>
      <div className="mb-1.5 w-full text-center">
        <div className="flex justify-center gap-2 ms-mono text-[11px] tabular-nums text-foreground/90">
          <span>{fmtDb(read.holdL)}</span>
          <span>{fmtDb(read.holdR)}</span>
        </div>
        <div className="flex justify-center gap-2 ms-mono text-[9px] tabular-nums text-muted-foreground">
          <span>{fmtDb(read.rmsLDb)}</span>
          <span>{fmtDb(read.rmsRDb)}</span>
        </div>
        <div className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground/70">
          peak · rms
        </div>
      </div>

      <div className="relative flex items-stretch gap-2">
        <canvas ref={canvasRef} className="h-[220px] w-[34px]" />
        <VFader value={gain} min={-24} max={18} onChange={onGain} />
        {onToggleLock && (
          <LockToggle
            locked={locked === true}
            label={lockLabel ?? "Lock gain"}
            onToggle={onToggleLock}
          />
        )}
      </div>

      <div className="mt-1.5 ms-mono text-[11px] tabular-nums text-foreground/85">
        {gain > 0 ? "+" : ""}
        {gain.toFixed(1)} <span className="text-[9px] text-muted-foreground">dB</span>
      </div>
      {assist && <div className="mt-0.5 ms-mono text-[9px] text-primary/90">{assist}</div>}
    </div>
  );
}

function VFader({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const norm = (value - min) / (max - min);

  const setFromClientY = (clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const n = 1 - (clientY - rect.top) / rect.height;
    onChange(round01(min + Math.min(1, Math.max(0, n)) * (max - min)));
  };

  return (
    <div
      ref={ref}
      className="relative w-5 cursor-ns-resize touch-none select-none"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setFromClientY(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) setFromClientY(e.clientY);
      }}
      onDoubleClick={() => onChange(0)}
      onWheel={(e) => {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.5;
        onChange(round01(Math.min(max, Math.max(min, value - Math.sign(e.deltaY) * step))));
      }}
      role="slider"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
    >
      <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full bg-black/40 ring-1 ring-border" />
      <div
        className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-foreground/20"
        style={{ top: `${(1 - (0 - min) / (max - min)) * 100}%` }}
      />
      <div
        className="absolute left-1/2 h-3 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-border bg-foreground/90 shadow"
        style={{ top: `${(1 - norm) * 100}%` }}
      />
    </div>
  );
}
