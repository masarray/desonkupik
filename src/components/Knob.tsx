// Rotary knob: vertical drag = change, scroll wheel = fine, double-click = reset.
// Looks like a DAW knob: ring indicator + value label inside.

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useApp } from "@/state/app";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  step?: number;
  label?: string;
  format?: (v: number) => string;
  size?: number;
  onChange: (v: number) => void;
  bipolar?: boolean;
  logScale?: boolean;
  className?: string;
  accent?: string; // CSS color for fill/indicator. Defaults to --color-primary.
  historyLabel?: string;
}

function toNorm(v: number, min: number, max: number, log: boolean) {
  if (log) {
    const lo = Math.log(Math.max(min, 1e-6));
    const hi = Math.log(max);
    return (Math.log(Math.max(v, 1e-6)) - lo) / (hi - lo);
  }
  return (v - min) / (max - min);
}
function fromNorm(n: number, min: number, max: number, log: boolean) {
  n = Math.min(1, Math.max(0, n));
  if (log) {
    const lo = Math.log(Math.max(min, 1e-6));
    const hi = Math.log(max);
    return Math.exp(lo + n * (hi - lo));
  }
  return min + n * (max - min);
}

export function Knob({
  value,
  min,
  max,
  defaultValue,
  step = 0,
  label,
  format,
  size = 64,
  onChange,
  bipolar = false,
  logScale = false,
  className,
  accent,
  historyLabel,
}: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startVal = useRef(value);
  const beginUserEdit = useApp((s) => s.beginUserEdit);
  const endUserEdit = useApp((s) => s.endUserEdit);

  const fmt = format ?? ((v: number) => v.toFixed(2));
  const norm = Math.min(1, Math.max(0, toNorm(value, min, max, logScale)));
  // Arc: 240° sweep centered at bottom
  const startAngle = -210;
  const endAngle = 30;
  const angle = startAngle + (endAngle - startAngle) * norm;

  const radius = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  const arc = (a0: number, a1: number) => {
    const r0 = (a0 * Math.PI) / 180;
    const r1 = (a1 * Math.PI) / 180;
    const x0 = cx + radius * Math.cos(r0);
    const y0 = cy + radius * Math.sin(r0);
    const x1 = cx + radius * Math.cos(r1);
    const y1 = cy + radius * Math.sin(r1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startY.current = e.clientY;
      startVal.current = value;
      beginUserEdit(historyLabel ?? label ?? "Adjust parameter");
    },
    [beginUserEdit, historyLabel, label, value],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!(e.buttons & 1)) return;
      const dy = startY.current - e.clientY;
      const fine = e.shiftKey ? 0.25 : 1;
      const range = max - min;
      const dNorm = (dy / 200) * fine;
      const newNorm = toNorm(startVal.current, min, max, logScale) + dNorm;
      let v = fromNorm(newNorm, min, max, logScale);
      if (step > 0) v = Math.round(v / step) * step;
      v = Math.min(max, Math.max(min, v));
      onChange(v);
      void range;
    },
    [max, min, onChange, step, logScale],
  );
  const onPointerUp = useCallback(() => {
    endUserEdit(historyLabel ?? label ?? "Adjust parameter");
  }, [endUserEdit, historyLabel, label]);

  const onDoubleClick = useCallback(() => {
    if (defaultValue === undefined) return;
    beginUserEdit(historyLabel ?? label ?? "Reset parameter");
    onChange(defaultValue);
    endUserEdit(historyLabel ?? label ?? "Reset parameter");
  }, [beginUserEdit, defaultValue, endUserEdit, historyLabel, label, onChange]);
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const fine = e.shiftKey ? 0.002 : 0.01;
      const dNorm = -Math.sign(e.deltaY) * fine;
      const newNorm = toNorm(value, min, max, logScale) + dNorm;
      let v = fromNorm(newNorm, min, max, logScale);
      if (step > 0) v = Math.round(v / step) * step;
      beginUserEdit(historyLabel ?? label ?? "Adjust parameter");
      onChange(Math.min(max, Math.max(min, v)));
      endUserEdit(historyLabel ?? label ?? "Adjust parameter");
    },
    [beginUserEdit, endUserEdit, historyLabel, label, value, min, max, step, logScale, onChange],
  );

  // For bipolar knobs, fill arc from center (0 / midpoint) outward.
  const centerNorm = bipolar ? toNorm(0, min, max, false) : 0;
  const fillFrom = bipolar ? Math.min(norm, centerNorm) : 0;
  const fillTo = bipolar ? Math.max(norm, centerNorm) : norm;
  const fillStart = startAngle + (endAngle - startAngle) * fillFrom;
  const fillEnd = startAngle + (endAngle - startAngle) * fillTo;

  return (
    <div className={cn("flex flex-col items-center gap-1.5 select-none", className)}>
      <div
        ref={ref}
        className="relative cursor-ns-resize touch-none"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        role="slider"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
      >
        <svg width={size} height={size} className="overflow-visible">
          {/* Track */}
          <path
            d={arc(startAngle, endAngle)}
            stroke="var(--color-border)"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
          {/* Fill */}
          {fillEnd > fillStart && (
            <path
              d={arc(fillStart, fillEnd)}
              stroke={accent ?? "var(--color-primary)"}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              style={{
                filter: `drop-shadow(0 0 4px color-mix(in oklab, ${accent ?? "var(--color-primary)"} 55%, transparent))`,
              }}
            />
          )}
          {/* Indicator */}
          <g transform={`rotate(${angle + 90} ${cx} ${cy})`}>
            <line
              x1={cx}
              y1={cy - radius + 8}
              x2={cx}
              y2={cy - radius + 18}
              stroke={accent ?? "var(--color-primary)"}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
          {/* Center cap */}
          <circle
            cx={cx}
            cy={cy}
            r={radius - 10}
            fill="var(--color-panel-soft)"
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] ms-mono text-foreground/85">
          {fmt(value)}
        </div>
      </div>
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      )}
    </div>
  );
}
