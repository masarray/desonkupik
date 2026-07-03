// Unified plugin chrome. Every FX editor renders inside <PluginShell> so the
// header/display/inspector/footer geometry stays identical — only the canvas
// changes between EQ, Compressor, Color, Width, Limiter.
//
// Slots:
//   header      → <PluginHeader>
//   display     → main interactive canvas area (flex-1)
//   inspector   → right rail (optional; fixed width)
//   footer      → knob row (typically <PluginKnobRow>)
//
// Accent colour comes from per-FX CSS tokens (--fx-eq / --fx-comp / …).
// No ad-hoc Tailwind colour literals in editor code.

import { type ReactNode } from "react";
import { Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/state/app";

export type FxAccent = "eq" | "comp" | "color" | "width" | "limiter";

const ACCENT_TOKEN: Record<FxAccent, string> = {
  eq: "var(--color-fx-eq)",
  comp: "var(--color-fx-comp)",
  color: "var(--color-fx-color)",
  width: "var(--color-fx-width)",
  limiter: "var(--color-fx-limiter)",
};

export function fxAccent(a: FxAccent) {
  return ACCENT_TOKEN[a];
}

interface PluginShellProps {
  header: ReactNode;
  children: ReactNode; // main display
  inspector?: ReactNode;
  footer?: ReactNode;
  inspectorWidth?: number;
  /** When true, render the inspector inline (no bordered card / soft bg) so
   *  the main canvas keeps maximum room. Used by Color & Width. */
  inspectorBare?: boolean;
  accent?: FxAccent;
}

export function PluginShell({
  header,
  children,
  inspector,
  footer,
  inspectorWidth = 224,
  inspectorBare = false,
  accent,
}: PluginShellProps) {
  const bypass = useApp((s) => s.settings.output.bypass);
  const accentStyle = accent
    ? ({ "--color-primary": fxAccent(accent) } as React.CSSProperties)
    : undefined;
  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", bypass && "ms-bypass-muted-shell")}
      style={accentStyle}
    >
      {header}
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-panel">
          {children}
        </div>
        {inspector ? (
          <aside
            className={cn(
              "flex shrink-0 flex-col overflow-hidden",
              inspectorBare ? "bg-transparent" : "rounded-md border border-border bg-panel-soft",
            )}
            style={{ width: inspectorWidth }}
          >
            {inspector}
          </aside>
        ) : null}
      </div>
      {footer ? <div className="border-t border-border bg-panel-soft">{footer}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface PluginHeaderProps {
  title: string;
  accent: FxAccent;
  presets?: ReactNode; // pill-row content (typically <PresetPills>)
  rightSlot?: ReactNode; // extras between presets and power
  enabled: boolean;
  onToggleEnabled: () => void;
  enabledLabel?: string;
  bypassedLabel?: string;
}

export function PluginHeader({
  title,
  accent,
  presets,
  rightSlot,
  enabled,
  onToggleEnabled,
  enabledLabel = "Active",
  bypassedLabel = "Bypassed",
}: PluginHeaderProps) {
  const color = fxAccent(accent);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3 py-2 sm:flex sm:flex-wrap sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{
            background: enabled
              ? color
              : "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
            boxShadow: enabled ? `0 0 8px ${color}` : "none",
          }}
        />
        <h3 className="truncate text-[13px] font-semibold tracking-tight">{title}</h3>
        {presets ? (
          <div className="ml-1 hidden min-w-0 items-center gap-1 lg:flex">{presets}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {rightSlot}
        <button
          type="button"
          onClick={onToggleEnabled}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
          )}
          style={{
            borderColor: enabled
              ? `color-mix(in oklab, ${color} 55%, transparent)`
              : "var(--border)",
            background: enabled
              ? `color-mix(in oklab, ${color} 14%, transparent)`
              : "var(--panel-soft)",
            color: enabled ? color : "var(--muted-foreground)",
          }}
          aria-pressed={enabled}
        >
          <Power className="h-3 w-3" />
          {enabled ? enabledLabel : bypassedLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset pill row (reused across all FX)
// ---------------------------------------------------------------------------

interface PresetPillsProps<T extends string> {
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
  accent: FxAccent;
}

export function PresetPills<T extends string>({
  options,
  value,
  onChange,
  accent,
}: PresetPillsProps<T>) {
  const color = fxAccent(accent);
  return (
    <>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className="rounded-md border px-2 py-0.5 text-[11px] transition"
            style={{
              borderColor: active
                ? `color-mix(in oklab, ${color} 55%, transparent)`
                : "transparent",
              background: active ? `color-mix(in oklab, ${color} 14%, transparent)` : "transparent",
              color: active ? color : "var(--muted-foreground)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inspector primitives
// ---------------------------------------------------------------------------

export function InspectorSection({
  title,
  children,
  accent,
}: {
  title: string;
  children: ReactNode;
  accent?: FxAccent;
}) {
  return (
    <div className="border-b border-border px-3 py-2.5 last:border-b-0">
      <div
        className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: accent ? fxAccent(accent) : "var(--muted-foreground)" }}
      >
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function InspectorRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("ms-mono text-[11px] text-foreground/90 tabular-nums", valueClass)}>
        {value}
      </span>
    </div>
  );
}

export function InspectorReadout({
  value,
  unit,
  sub,
}: {
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2.5 py-2">
      <div className="ms-mono text-base text-foreground tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer knob row
// ---------------------------------------------------------------------------

export function PluginKnobRow({ children, columns }: { children: ReactNode; columns?: number }) {
  const style = columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined;
  return (
    <div
      className={cn(
        "grid gap-3 px-4 py-3",
        !columns && "grid-cols-[repeat(auto-fit,minmax(82px,1fr))]",
      )}
      style={style}
    >
      {children}
    </div>
  );
}
