// Dev-only memory diagnostics. Strip in production via `import.meta.env.DEV`.
//
// Tracks:
//   • Estimated bytes held by the currently loaded AudioBuffer.
//   • Count of AnalyserNodes the player exposes (rough engine pressure).
//   • Outstanding rAF render loops in plugin editors.
//
// Output is throttled to once per 5 seconds and printed via console.info,
// never via UI, so it doesn't ship in production builds.

import { useEffect } from "react";
import { getPlayer } from "@/audio/player";

let activeLoops = 0;
let lastLog = 0;
const LOG_EVERY_MS = 5000;

export function trackRenderLoop(label: string) {
  if (!import.meta.env.DEV) return () => {};
  activeLoops += 1;
  const myLabel = label;
  return () => {
    activeLoops -= 1;
    if (import.meta.env.DEV && activeLoops < 0) {
      console.warn(`[memProbe] rAF loop count went negative after "${myLabel}" cleanup`);
      activeLoops = 0;
    }
  };
}

function audioBufferBytes(buf: AudioBuffer | null): number {
  if (!buf) return 0;
  return buf.length * buf.numberOfChannels * 4; // Float32 per sample
}

function analyserCount(): number {
  const p = getPlayer();
  // Whitelist of analyser getters on Player. Cheap reflection.
  const keys = [
    "inputAnalyser",
    "outputAnalyser",
    "inAnalyserL",
    "inAnalyserR",
    "outAnalyserL",
    "outAnalyserR",
    "compInAnalyser",
    "compOutAnalyser",
    "limiterInAnalyser",
    "colorInAnalyser",
    "colorOutAnalyser",
    "widthInAnalyser",
    "widthOutAnalyser",
    "matchInAnalyserL",
    "matchInAnalyserR",
    "matchOutAnalyserL",
    "matchOutAnalyserR",
  ] as const;
  let n = 0;
  for (const k of keys) {
    if ((p as unknown as Record<string, unknown>)[k]) n += 1;
  }
  return n;
}

/** Mount once near the app root. Logs a snapshot every 5s in dev. */
export function useMemoryProbe() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      if (now - lastLog < LOG_EVERY_MS) return;
      lastLog = now;
      const bytes = audioBufferBytes(getPlayer().audioBuffer);
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      console.info(
        `[memProbe] audioBuffer=${mb} MB · analysers=${analyserCount()} · rAF loops=${activeLoops}`,
      );
    }, LOG_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);
}
