// Plugin chain selector + A/B compare. Pills along the top of the
// editor panel; click to switch the visible plugin. Each pill shows
// an LED-style on/off dot and the slot label.

import { Sliders, Activity, Sparkles, Waves, Gauge, Undo2, Redo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp, type PluginId } from "@/state/app";
import { cn } from "@/lib/utils";

const SLOTS: { id: PluginId; label: string; icon: LucideIcon }[] = [
  { id: "eq", label: "EQ", icon: Sliders },
  { id: "compressor", label: "Compressor", icon: Activity },
  { id: "color", label: "Color", icon: Sparkles },
  { id: "width", label: "Width", icon: Waves },
  { id: "limiter", label: "Limiter", icon: Gauge },
];

export function ChainSelector() {
  const active = useApp((s) => s.activePlugin);
  const setActive = useApp((s) => s.setActivePlugin);
  const settings = useApp((s) => s.settings);
  const slot = useApp((s) => s.abSlot);
  const toggleAB = useApp((s) => s.toggleAB);
  const copyAB = useApp((s) => s.copyABToOther);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.historyPast.length > 0);
  const canRedo = useApp((s) => s.historyFuture.length > 0);

  const isEnabled = (id: PluginId) => {
    switch (id) {
      case "eq":
        return settings.eqEnabled;
      case "compressor":
        return settings.compressor.enabled;
      case "color":
        return settings.color.enabled;
      case "width":
        return settings.width.enabled;
      case "limiter":
        return settings.output.limiterEnabled;
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Chain</span>
      <div className="flex items-center gap-1 border-r border-border pr-2">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
          className="grid h-7 w-7 place-items-center rounded-md border border-border text-foreground/70 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
          className="grid h-7 w-7 place-items-center rounded-md border border-border text-foreground/70 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        {SLOTS.map((s) => {
          const Icon = s.icon;
          const on = isEnabled(s.id);
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                "group inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition",
                isActive
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border bg-panel-soft text-foreground/75 hover:border-border hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full transition",
                  on
                    ? "bg-primary shadow-[0_0_6px_var(--color-primary)]"
                    : "bg-muted-foreground/40",
                )}
              />
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Compare
        </span>
        <button
          type="button"
          onClick={toggleAB}
          className={cn(
            "h-7 w-7 rounded-md border text-xs font-bold transition",
            slot === "A"
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-foreground/70 hover:bg-accent",
          )}
        >
          A
        </button>
        <button
          type="button"
          onClick={toggleAB}
          className={cn(
            "h-7 w-7 rounded-md border text-xs font-bold transition",
            slot === "B"
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-foreground/70 hover:bg-accent",
          )}
        >
          B
        </button>
        <button
          type="button"
          onClick={copyAB}
          title={`Copy ${slot} → ${slot === "A" ? "B" : "A"}`}
          className="ml-1 rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-foreground/65 hover:bg-accent"
        >
          Copy →
        </button>
      </div>
    </div>
  );
}
