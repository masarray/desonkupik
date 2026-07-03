import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { MenuBar } from "@/components/MenuBar";
import { Waveform } from "@/components/Waveform";
import { Transport } from "@/components/Transport";
import { ChainSelector } from "@/components/ChainSelector";
import { IOPanel } from "@/components/IOPanel";
import { EQEditor } from "@/components/plugins/EQEditor";
import { CompressorEditor } from "@/components/plugins/CompressorEditor";
import { ColorEditor } from "@/components/plugins/ColorEditor";
import { WidthEditor } from "@/components/plugins/WidthEditor";
import { LimiterEditor } from "@/components/plugins/LimiterEditor";
import { useApp } from "@/state/app";
import { getPlayer } from "@/audio/player";
import { formatHeadroomToast } from "@/audio/inputHeadroom";
import { toast } from "sonner";

export function App() {
  const active = useApp((s) => s.activePlugin);
  const settings = useApp((s) => s.settings);
  const fileName = useApp((s) => s.fileName);
  const isLoading = useApp((s) => s.isLoading);
  const bypass = useApp((s) => s.settings.output.bypass);
  const loadingMessage = useApp((s) => s.loadingMessage);
  const [dragOver, setDragOver] = useState(false);

  // Auto-stop when the source naturally ends.
  useEffect(() => {
    const p = getPlayer();
    p.onEnded = () => {
      useApp.getState().setIsPlaying(false);
      useApp.getState().setCurrentTime(0);
    };
    return () => {
      p.onEnded = null;
    };
  }, []);

  // Push settings → engine whenever they change (cheap, click-free).
  useEffect(() => {
    getPlayer().setParams(settings);
  }, [settings]);

  // Global drag-drop for audio files.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget == null) setDragOver(false);
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const store = useApp.getState();
        store.setIsLoading(true);
        store.setLoadingMessage("Preparing audio file…");
        store.setFileName(file.name);
        const p = getPlayer();
        const headroom = await p.loadFile(file, store.settings, (message) => {
          useApp.getState().setLoadingMessage(message);
        });
        store.setInputHeadroom(headroom);
        store.setOutput({ fileGain: headroom.recommendedFileGainDb });
        store.setDuration(p.duration);
        store.setCurrentTime(0);
        store.setIsPlaying(false);
        toast.success(`Loaded ${file.name}`, { id: "audio-load", duration: 1600 });
        toast.message(formatHeadroomToast(headroom), { id: "headroom-info", duration: 2300 });
      } catch (err) {
        toast.error(`Failed to decode: ${(err as Error).message}`);
        useApp.getState().setFileName(null);
        useApp.getState().setInputHeadroom(null);
      } finally {
        useApp.getState().setIsLoading(false);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground"
      data-bypassed={bypass ? "true" : "false"}
    >
      <MenuBar />
      <div className="h-[180px] shrink-0">
        <Waveform />
      </div>
      <div>
        <Transport />
      </div>
      <div>
        <ChainSelector />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {active === "eq" && <EQEditor />}
          {active === "compressor" && <CompressorEditor />}
          {active === "color" && <ColorEditor />}
          {active === "width" && <WidthEditor />}
          {active === "limiter" && <LimiterEditor />}
        </div>
        <IOPanel />
      </div>

      {isLoading && <LoadingOverlay message={loadingMessage} />}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="rounded-xl border border-primary/40 bg-panel-soft px-8 py-6 ms-glow">
            <div className="text-sm uppercase tracking-widest text-primary">Drop audio</div>
            <div className="mt-1 text-xs text-muted-foreground">WAV · MP3 · FLAC · OGG · M4A</div>
          </div>
        </div>
      )}

      {!fileName && (
        <div className="pointer-events-none absolute inset-x-0 top-[48px] z-10 grid h-[180px] place-items-center">
          <div className="pointer-events-auto rounded-lg border border-dashed border-border bg-panel-soft/80 px-6 py-4 text-center">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              No audio loaded
            </div>
            <div className="mt-1 text-sm">
              Drop a file anywhere, or use{" "}
              <span className="ms-mono text-primary">File → Open audio</span>
            </div>
          </div>
        </div>
      )}

      <Toaster theme="dark" position="top-center" offset="38vh" visibleToasts={3} expand={false} />
    </div>
  );
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/72 backdrop-blur-md">
      <div className="w-[min(420px,calc(100vw-40px))] rounded-xl border border-border/80 bg-panel/95 p-5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.03]">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">
              Preparing audio
            </div>
            <div className="mt-1 text-base font-medium tracking-[-0.01em] text-foreground">
              DeSonKuPik mastering engine
            </div>
          </div>
          <div className="ms-mono rounded-md border border-border bg-background/55 px-2 py-1 text-[10px] text-muted-foreground">
            LOCAL
          </div>
        </div>

        <div className="mt-5 h-1 overflow-hidden rounded-full bg-muted/70">
          <div className="ms-loading-line h-full w-2/5 rounded-full bg-primary" />
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0 truncate ms-mono text-xs text-muted-foreground">{message}</div>
          <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
            <span className="ms-loading-chip" />
            <span className="ms-loading-chip [animation-delay:120ms]" />
            <span className="ms-loading-chip [animation-delay:240ms]" />
          </div>
        </div>
      </div>
    </div>
  );
}
