// Transport: play/pause/stop/skip/loop + time display + monitor-only output controls.

import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { Play, Pause, Square, SkipBack, SkipForward, Repeat, Volume2 } from "lucide-react";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AudioOutputDevice = { deviceId: string; label: string };
type MediaDevicesWithOutput = MediaDevices & {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
};

const PICK_OUTPUT_VALUE = "__pick_output__";
const OUTPUT_DEVICE_KEY = "desonkupik.outputDeviceId";

function fmtTime(t: number) {
  if (!Number.isFinite(t)) return "0:00.00";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function Transport() {
  const isPlaying = useApp((s) => s.isPlaying);
  const duration = useApp((s) => s.duration);
  const currentTime = useApp((s) => s.currentTime);
  const loop = useApp((s) => s.loop);
  const [monitorVolume, setMonitorVolumeState] = useState(() => getPlayer().currentMonitorVolume);
  const [outputDeviceId, setOutputDeviceId] = useState(() => {
    try {
      return localStorage.getItem(OUTPUT_DEVICE_KEY) || getPlayer().selectedOutputDeviceId;
    } catch {
      return getPlayer().selectedOutputDeviceId;
    }
  });
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const sinkSupported = useMemo(() => {
    const contextSupportsSink =
      typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
    const elementSupportsSink =
      typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
    return contextSupportsSink || elementSupportsSink;
  }, []);

  const outputPickerSupported = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof (navigator.mediaDevices as MediaDevicesWithOutput | undefined)?.selectAudioOutput ===
        "function",
    [],
  );

  const refreshOutputDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const seen = new Set<string>();
      const outputs = devices
        .filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default")
        .filter((d) => {
          if (seen.has(d.deviceId)) return false;
          seen.add(d.deviceId);
          return true;
        })
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Output ${index + 1}`,
        }));
      setOutputDevices(outputs);
    } catch {
      setOutputDevices([]);
    }
  };

  const rememberOutputDevice = (deviceId: string) => {
    try {
      if (deviceId === "default") localStorage.removeItem(OUTPUT_DEVICE_KEY);
      else localStorage.setItem(OUTPUT_DEVICE_KEY, deviceId);
    } catch {
      // Ignore storage restrictions.
    }
  };

  const pickOutputDevice = async () => {
    const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutput | undefined;
    if (!mediaDevices) return null;
    if (typeof mediaDevices.selectAudioOutput === "function") {
      return mediaDevices.selectAudioOutput(
        outputDeviceId !== "default" ? { deviceId: outputDeviceId } : undefined,
      );
    }
    await refreshOutputDevices();
    return null;
  };

  useEffect(() => {
    void refreshOutputDevices();
    const remembered = outputDeviceId;
    if (remembered && remembered !== "default")
      void getPlayer()
        .setOutputDevice(remembered)
        .catch(() => {});
    const onChange = () => void refreshOutputDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlayPause = async () => {
    const p = getPlayer();
    if (!p.isReady) return;
    if (isPlaying) {
      p.pause();
      useApp.getState().setIsPlaying(false);
    } else {
      await p.play();
      useApp.getState().setIsPlaying(true);
      void refreshOutputDevices();
    }
  };
  const onStop = () => {
    const p = getPlayer();
    p.stop();
    useApp.getState().setIsPlaying(false);
    useApp.getState().setCurrentTime(0);
  };
  const onSkipStart = () => {
    getPlayer().seek(0);
    useApp.getState().setCurrentTime(0);
  };
  const onSkipEnd = () => {
    const p = getPlayer();
    p.seek(p.duration);
    useApp.getState().setCurrentTime(p.duration);
  };
  const onLoop = () => {
    const next = !loop;
    useApp.getState().setLoop(next);
    getPlayer().setLoop(next);
  };

  const onMonitorVolume = (value: number) => {
    const next = Math.max(0, Math.min(125, value));
    setMonitorVolumeState(next / 100);
    getPlayer().setMonitorVolume(next / 100);
  };

  const resetMonitorVolume = () => {
    setMonitorVolumeState(1);
    getPlayer().setMonitorVolume(1);
  };

  const onOutputDevice = async (deviceId: string) => {
    if (deviceId === PICK_OUTPUT_VALUE) {
      try {
        const picked = await pickOutputDevice();
        await refreshOutputDevices();
        if (picked?.deviceId) {
          const next = picked.deviceId;
          setOutputDeviceId(next);
          rememberOutputDevice(next);
          await getPlayer().setOutputDevice(next);
          if (picked.label) {
            setOutputDevices((prev) => {
              if (prev.some((d) => d.deviceId === next)) return prev;
              return [...prev, { deviceId: next, label: picked.label }];
            });
          }
          toast.success("Monitor routed to selected output", { id: "output-device" });
          return;
        }
        return;
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "Error";
        if (name !== "AbortError" && name !== "NotAllowedError") {
          toast.error("Could not select audio output", { id: "output-device" });
        }
      }
      return;
    }

    const next = deviceId || "default";
    setOutputDeviceId(next);
    rememberOutputDevice(next);
    try {
      await getPlayer().setOutputDevice(next);
      await refreshOutputDevices();
    } catch {
      toast.error("This browser blocked that output device. Choose it again from the picker.", {
        id: "output-device",
      });
      setOutputDeviceId("default");
      rememberOutputDevice("default");
      await getPlayer().setOutputDevice("default");
    }
  };

  const onOutputSelectorPointerDown = (event: PointerEvent<HTMLSelectElement>) => {
    // Output-only unlock: the first click on the dropdown opens the browser's
    // speaker picker directly when supported. No microphone permission needed.
    if (!sinkSupported || !outputPickerSupported) return;
    event.preventDefault();
    void onOutputDevice(PICK_OUTPUT_VALUE);
  };

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void onPlayPause();
      } else if (e.code === "ArrowLeft") {
        getPlayer().seek(Math.max(0, currentTime - (e.shiftKey ? 10 : 2)));
      } else if (e.code === "ArrowRight") {
        getPlayer().seek(Math.min(duration, currentTime + (e.shiftKey ? 10 : 2)));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, duration, isPlaying]);

  return (
    <div className="flex items-center gap-4 border-b border-border bg-panel-soft px-4 py-2.5">
      <div className="flex items-center gap-1">
        <TransportBtn onClick={onSkipStart} title="Skip to start">
          <SkipBack className="h-4 w-4" />
        </TransportBtn>
        <TransportBtn onClick={onPlayPause} title="Play / Pause (Space)" accent>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </TransportBtn>
        <TransportBtn onClick={onStop} title="Stop">
          <Square className="h-4 w-4" />
        </TransportBtn>
        <TransportBtn onClick={onSkipEnd} title="Skip to end">
          <SkipForward className="h-4 w-4" />
        </TransportBtn>
        <TransportBtn onClick={onLoop} title="Loop" pressed={loop}>
          <Repeat className="h-4 w-4" />
        </TransportBtn>
      </div>

      <div className="ms-mono text-sm text-foreground/85 tabular-nums">
        {fmtTime(currentTime)}
        <span className="mx-2 text-foreground/35">/</span>
        <span className="text-foreground/55">{fmtTime(duration)}</span>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/35 px-2 py-1">
        <Volume2 className="h-3.5 w-3.5 shrink-0 text-primary/85" />
        <span className="hidden text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:inline">
          Monitor
        </span>
        <input
          aria-label="Monitor volume"
          title="Monitor volume only — does not change the mastering chain or export loudness. Double-click to reset to 100%."
          type="range"
          min={0}
          max={125}
          step={1}
          value={Math.round(monitorVolume * 100)}
          onDoubleClick={resetMonitorVolume}
          onChange={(e) => onMonitorVolume(Number(e.currentTarget.value))}
          className="h-1.5 w-28 accent-primary"
        />
        <span className="ms-mono w-9 text-right text-[10px] text-foreground/65">
          {Math.round(monitorVolume * 100)}%
        </span>
        <select
          aria-label="Audio output device"
          title={
            sinkSupported
              ? outputPickerSupported
                ? "Click to choose monitor output — browser speaker picker, output-only"
                : "Choose monitor output device — this browser can only show already-authorized outputs"
              : "Output device selection is not supported by this browser"
          }
          value={outputDeviceId}
          disabled={!sinkSupported}
          onPointerDown={onOutputSelectorPointerDown}
          onFocus={() => void refreshOutputDevices()}
          onChange={(e) => void onOutputDevice(e.currentTarget.value)}
          className="h-7 max-w-[230px] rounded-md border border-border bg-panel px-2 text-xs text-foreground/80 outline-none transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <option value="default">Default output</option>
          {outputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
          {outputDeviceId !== "default" &&
            !outputDevices.some((d) => d.deviceId === outputDeviceId) && (
              <option value={outputDeviceId}>Selected output</option>
            )}
        </select>
      </div>
    </div>
  );
}

function TransportBtn({
  children,
  onClick,
  title,
  accent,
  pressed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  accent?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition",
        accent
          ? "bg-primary text-primary-foreground hover:brightness-110"
          : "text-foreground/80 hover:bg-accent hover:text-foreground",
        pressed && "border-primary/60 bg-primary/10 text-primary",
      )}
    >
      {children}
    </button>
  );
}
