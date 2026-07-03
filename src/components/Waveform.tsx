// Waveform timeline (Audacity-style): canvas peaks renderer with zoom,
// pan, click-to-seek, playhead, time ruler. Uses min/max peak summaries
// computed once per AudioBuffer load.

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";

interface Peak {
  min: number;
  max: number;
}

function computePeaks(buffer: AudioBuffer, bins: number): Peak[][] {
  const channels: Peak[][] = [];
  const total = buffer.length;
  const samplesPerBin = Math.max(1, Math.floor(total / bins));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const peaks: Peak[] = new Array(bins);
    for (let i = 0; i < bins; i++) {
      const start = i * samplesPerBin;
      const end = Math.min(total, start + samplesPerBin);
      let mn = 1.0;
      let mx = -1.0;
      for (let j = start; j < end; j++) {
        const v = data[j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      peaks[i] = { min: mn, max: mx };
    }
    channels.push(peaks);
  }
  return channels;
}

function formatTime(t: number) {
  if (!Number.isFinite(t)) return "0:00.00";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function Waveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<Peak[][] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [scroll, setScroll] = useState(0); // 0..1
  const duration = useApp((s) => s.duration);
  const fileName = useApp((s) => s.fileName);
  const isPlaying = useApp((s) => s.isPlaying);
  const currentTime = useApp((s) => s.currentTime);
  const selStart = useApp((s) => s.selectionStart);
  const selEnd = useApp((s) => s.selectionEnd);
  const loop = useApp((s) => s.loop);
  const setSelection = useApp((s) => s.setSelection);
  const setDuration = useApp((s) => s.setDuration);
  const setCurrentTime = useApp((s) => s.setCurrentTime);
  const audioRevision = useApp((s) => s.audioRevision);
  const registerAudioEdit = useApp((s) => s.registerAudioEdit);

  // Recompute peaks when a new buffer is loaded.
  useEffect(() => {
    if (!fileName) {
      setPeaks(null);
      return;
    }
    const player = getPlayer();
    const buf = player.audioBuffer;
    if (!buf) {
      setPeaks(null);
      return;
    }
    const width = wrapRef.current?.clientWidth ?? 1200;
    const bins = Math.min(8000, Math.max(1000, Math.floor(width * 2 * Math.max(1, zoom))));
    setPeaks(computePeaks(buf, bins));
  }, [fileName, duration, zoom, audioRevision]);

  // Re-render on container resize.
  const [sizeNonce, setSizeNonce] = useState(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setSizeNonce((n) => n + 1));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Push selection region into the player whenever it changes.
  useEffect(() => {
    getPlayer().setRegion(selStart, selEnd);
  }, [selStart, selEnd]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue("--color-panel") || "#1a1d22";
    ctx.fillRect(0, 0, w, h);

    if (!peaks || !duration) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "12px Plus Jakarta Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        fileName ? "Decoding…" : "Drop an audio file here, or use File → Open",
        w / 2,
        h / 2,
      );
      return;
    }

    const rulerH = 18;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, w, rulerH);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "10px Sometype Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const visStart = scroll * duration * (1 - 1 / zoom);
    const visEnd = visStart + duration / zoom;
    const span = visEnd - visStart;
    const targetTicks = 8;
    const rawStep = span / targetTicks;
    const niceSteps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    const step = niceSteps.find((s) => s >= rawStep) ?? rawStep;
    for (let t = Math.ceil(visStart / step) * step; t <= visEnd; t += step) {
      const x = ((t - visStart) / span) * w;
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x, rulerH - 5, 1, 5);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(formatTime(t), x + 3, 3);
    }

    // Selection highlight
    if (selStart != null && selEnd != null && selEnd > selStart) {
      const x0 = ((selStart - visStart) / span) * w;
      const x1 = ((selEnd - visStart) / span) * w;
      ctx.fillStyle = "color-mix(in oklab, var(--color-primary) 18%, transparent)";
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.strokeStyle = "color-mix(in oklab, var(--color-primary) 70%, transparent)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, h - 1);
    }

    const numCh = peaks.length;
    const wavTop = rulerH + 4;
    const wavH = h - rulerH - 4;
    const chH = wavH / numCh;
    const primary = "oklch(0.80 0.11 215)";
    const bins = peaks[0].length;
    const binStart = Math.floor(scroll * bins * (1 - 1 / zoom));
    const binSpan = Math.floor(bins / zoom);
    for (let c = 0; c < numCh; c++) {
      const data = peaks[c];
      const baseY = wavTop + chH * c + chH / 2;
      const amp = chH / 2 - 2;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const idx = binStart + Math.floor((x / w) * binSpan);
        const p = data[idx];
        if (!p) continue;
        const yMax = baseY - p.max * amp;
        const yMin = baseY - p.min * amp;
        ctx.moveTo(x + 0.5, yMin);
        ctx.lineTo(x + 0.5, yMax);
      }
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, baseY, w, 1);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "10px Sometype Mono, monospace";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(`${numCh === 2 ? (c === 0 ? "L" : "R") : "M"}`, 6, wavTop + chH * c + 2);
    }

    const phT = currentTime;
    if (phT >= visStart && phT <= visEnd) {
      const x = ((phT - visStart) / span) * w;
      ctx.fillStyle = "oklch(0.92 0.12 60)";
      ctx.fillRect(x, 0, 1.5, h);
    }
  }, [peaks, duration, currentTime, scroll, zoom, fileName, sizeNonce, selStart, selEnd]);

  // Drag-select / click-seek
  const dragRef = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);
  const xToTime = useCallback(
    (x: number, width: number) => {
      const visStart = scroll * duration * (1 - 1 / zoom);
      const visEnd = visStart + duration / zoom;
      return visStart + (x / width) * (visEnd - visStart);
    },
    [scroll, zoom, duration],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = xToTime(x, rect.width);
    dragRef.current = { x0: x, t0: t, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    d.moved = true;
    const t = xToTime(x, rect.width);
    const a = Math.min(d.t0, t);
    const b = Math.max(d.t0, t);
    setSelection(Math.max(0, a), Math.min(duration, b));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (!d) return;
    if (!d.moved) {
      // pure click → seek + clear selection
      setSelection(null, null);
      getPlayer().seek(d.t0);
      useApp.getState().setCurrentTime(d.t0);
    }
  };

  // Wheel: zoom (ctrl) or scroll
  const onWheel = (e: React.WheelEvent) => {
    if (!duration) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      const nz = Math.min(128, Math.max(1, zoom * factor));
      setZoom(nz);
    } else {
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const ns = Math.min(1, Math.max(0, scroll + (delta / 4000) * (1 / zoom + 0.2)));
      setScroll(ns);
    }
  };

  // Delete key: ripple-delete selected audio and close the gap, like Audacity/DAW
  // default Delete. Use Silence/Delete-and-leave-gap later if a separate tool is added.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable))
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && selStart != null && selEnd != null) {
        e.preventDefault();
        const p = getPlayer();
        const edit = p.deleteRegionRipple(selStart, selEnd, "Ripple delete waveform selection");
        if (edit) {
          registerAudioEdit(edit);
          const snap = Math.min(p.duration, Math.max(0, edit.startSample / edit.sampleRate));
          setDuration(p.duration);
          setCurrentTime(snap);
        }
        // Re-render peaks immediately; audioRevision also keeps future undo/redo in sync.
        const buf = p.audioBuffer;
        if (buf) {
          const width = wrapRef.current?.clientWidth ?? 1200;
          const bins = Math.min(8000, Math.max(1000, Math.floor(width * 2 * Math.max(1, zoom))));
          setPeaks(computePeaks(buf, bins));
        }
        setSelection(null, null);
      } else if (e.key === "Escape") {
        setSelection(null, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selStart, selEnd, setSelection, setDuration, setCurrentTime, zoom, registerAudioEdit]);

  // Drive currentTime while playing. Keep the audio clock real-time, but
  // throttle React state so the waveform cursor stays smooth without forcing
  // a full React update at display refresh rate.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let lastCommit = 0;
    const tick = (ts: number) => {
      if (!document.hidden && (!lastCommit || ts - lastCommit >= 1000 / 30)) {
        const t = getPlayer().currentTime;
        useApp.getState().setCurrentTime(t);
        lastCommit = ts;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={wrapRef}
        className="relative flex-1 border-b border-border bg-panel select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{ minHeight: 140 }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {duration > 0 && (
          <div className="pointer-events-none absolute right-3 top-1 ms-mono text-[10px] text-foreground/55">
            zoom {zoom.toFixed(1)}× ·{" "}
            {selStart != null && selEnd != null
              ? `sel ${formatTime(selStart)}–${formatTime(selEnd)} · Del=clear · ${loop ? "loop on" : "loop off"}`
              : "drag = select · click = seek · ctrl+wheel = zoom"}
          </div>
        )}
      </div>
    </div>
  );
}
