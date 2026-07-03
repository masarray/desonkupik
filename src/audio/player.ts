// Player ties the AudioBuffer + MasterChain together. Single AudioContext
// owned by this module; React components talk to it via PlayerProvider.

import { MasterChain } from "@/audio/engine";
import type { MasterSettings } from "@/audio/presets";
import {
  analyzeInputHeadroom,
  applySmartHeadroom,
  type InputHeadroomResult,
} from "@/audio/inputHeadroom";

type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkAudioContext = AudioContext & {
  setSinkId?: (sinkId: string | { type: "none" }) => Promise<void>;
  sinkId?: string | { type: "none" };
};

export interface AudioRegionEdit {
  kind: "ripple-delete";
  label: string;
  startSample: number;
  endSample: number;
  removedSamples: number;
  sampleRate: number;
  channelCount: number;
  beforeLength: number;
  before: Float32Array[];
}

export interface AudioEditResult {
  duration: number;
  currentTime: number;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export class Player {
  private ctx: AudioContext | null = null;
  private chain: MasterChain | null = null;
  private monitorGain: GainNode | null = null;
  private mediaDestination: MediaStreamAudioDestinationNode | null = null;
  private sinkAudio: SinkAudioElement | null = null;
  private outputDeviceId = "default";
  private monitorVolume = 1;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0; // ctx.currentTime when last playback started
  private offset = 0; // offset into buffer (s)
  private playing = false;
  private loop = false;
  private endHandler: (() => void) | null = null;
  /** Optional loop region in seconds. When set and loop is true, playback
   *  restarts from regionStart at regionEnd. */
  private regionStart: number | null = null;
  private regionEnd: number | null = null;
  private regionTimer: number | null = null;

  onTimeUpdate: ((t: number) => void) | null = null;
  onEnded: (() => void) | null = null;

  get isReady() {
    return Boolean(this.buffer && this.chain);
  }
  get isPlaying() {
    return this.playing;
  }
  get duration() {
    return this.buffer?.duration ?? 0;
  }
  get sampleRate() {
    return this.buffer?.sampleRate ?? 48000;
  }
  get channels() {
    return this.buffer?.numberOfChannels ?? 2;
  }
  get audioBuffer() {
    return this.buffer;
  }
  get currentTime(): number {
    if (!this.ctx || !this.buffer) return this.offset;
    if (!this.playing) return this.offset;
    const t = this.offset + (this.ctx.currentTime - this.startedAt);
    return Math.max(0, Math.min(this.buffer.duration, t));
  }
  get masterChain() {
    return this.chain;
  }
  get selectedOutputDeviceId() {
    return this.outputDeviceId;
  }
  get currentMonitorVolume() {
    return this.monitorVolume;
  }
  get inputAnalyser() {
    return this.chain?.inputAnalyser ?? null;
  }
  get outputAnalyser() {
    return this.chain?.outputAnalyser ?? null;
  }
  get inAnalyserL() {
    return this.chain?.inAnalyserL ?? null;
  }
  get inAnalyserR() {
    return this.chain?.inAnalyserR ?? null;
  }
  get outAnalyserL() {
    return this.chain?.outAnalyserL ?? null;
  }
  get outAnalyserR() {
    return this.chain?.outAnalyserR ?? null;
  }
  get compInAnalyser() {
    return this.chain?.compInAnalyser ?? null;
  }
  get compOutAnalyser() {
    return this.chain?.compOutAnalyser ?? null;
  }
  get limiterInAnalyser() {
    return this.chain?.limiterInAnalyser ?? null;
  }
  get colorInAnalyser() {
    return this.chain?.colorInAnalyser ?? null;
  }
  get colorOutAnalyser() {
    return this.chain?.colorOutAnalyser ?? null;
  }
  get widthInAnalyser() {
    return this.chain?.widthInAnalyser ?? null;
  }
  get widthOutAnalyser() {
    return this.chain?.widthOutAnalyser ?? null;
  }
  get matchInAnalyserL() {
    return this.chain?.matchInAnalyserL ?? null;
  }
  get matchInAnalyserR() {
    return this.chain?.matchInAnalyserR ?? null;
  }
  get matchOutAnalyserL() {
    return this.chain?.matchOutAnalyserL ?? null;
  }
  get matchOutAnalyserR() {
    return this.chain?.matchOutAnalyserR ?? null;
  }

  async loadFile(
    file: File,
    initialSettings: MasterSettings,
    onStage?: (message: string) => void,
  ): Promise<InputHeadroomResult> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        (
          globalThis as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
          }
        ).AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
      this.ctx = new Ctor({ latencyHint: "interactive" });
    }
    // Decode in a scoped block so the source ArrayBuffer can be GC'd
    // immediately after `decodeAudioData` finishes. A 5-min 48k stereo WAV
    // is ~110 MB — keeping both copies effectively doubled memory per load.
    const decoded = await (async (ctx: AudioContext) => {
      onStage?.("Reading audio file…");
      const ab = await file.arrayBuffer();
      // Some browsers detach the ArrayBuffer during decode; we don't reuse it.
      onStage?.("Decoding audio…");
      return ctx.decodeAudioData(ab);
    })(this.ctx);
    this.stop();
    this.buffer = decoded;
    this.offset = 0;
    onStage?.("Analyzing loudness and peak headroom…");
    const headroom = analyzeInputHeadroom(decoded);
    const stagedSettings = applySmartHeadroom(initialSettings, headroom);
    onStage?.("Building clean mastering chain…");
    if (!this.chain) {
      this.chain = new MasterChain(this.ctx);
      this.chain.build(stagedSettings);
      this.attachMonitorOutput();
    } else {
      this.chain.setParams(stagedSettings, 0);
      this.attachMonitorOutput();
    }
    return headroom;
  }

  private attachMonitorOutput() {
    if (!this.ctx || !this.chain) return;
    if (!this.monitorGain) {
      this.monitorGain = this.ctx.createGain();
      this.monitorGain.gain.value = this.monitorVolume;
    }

    // Do NOT call chain.output.disconnect() here. The engine output also feeds
    // the stereo output meters; disconnecting it made the OUTPUT meter go dead
    // whenever monitor routing was rebuilt. Only reconnect this monitor tap.
    try {
      this.chain.output.disconnect(this.monitorGain);
    } catch {
      /* monitor tap was not connected yet */
    }
    this.chain.output.connect(this.monitorGain);
    void this.connectMonitorDestination();
  }

  private async connectMonitorDestination() {
    if (!this.ctx || !this.monitorGain) return;
    const ctxWithSink = this.ctx as SinkAudioContext;

    try {
      this.monitorGain.disconnect();
    } catch {
      /* not connected yet */
    }

    // Best path for this app: route the real Web Audio context directly.
    // Chrome supports AudioContext.setSinkId(), so no MediaStreamAudioDestination
    // detour is needed and analyzers/meters keep reading the same mastering bus.
    if (typeof ctxWithSink.setSinkId === "function") {
      const requestedSinkId = this.outputDeviceId === "default" ? "" : this.outputDeviceId;
      try {
        await ctxWithSink.setSinkId(requestedSinkId);
      } catch (error) {
        // Never leave the monitor path silent if the chosen device lost permission
        // or was unplugged. Fall back to browser default, then let the UI know.
        if (requestedSinkId) {
          this.outputDeviceId = "default";
          try {
            await ctxWithSink.setSinkId("");
          } catch {
            /* keep default destination even if the browser rejects explicit reset */
          }
          this.monitorGain.connect(this.ctx.destination);
          throw error;
        }
      }
      this.monitorGain.connect(this.ctx.destination);
      if (this.sinkAudio) {
        this.sinkAudio.pause();
        this.sinkAudio.srcObject = null;
      }
      return;
    }

    // Fallback for browsers that only support HTMLMediaElement.setSinkId().
    if (this.outputDeviceId && this.outputDeviceId !== "default") {
      const canRouteElement =
        typeof HTMLAudioElement !== "undefined" &&
        typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
      if (!canRouteElement) {
        this.outputDeviceId = "default";
        this.monitorGain.connect(this.ctx.destination);
        return;
      }
      if (!this.mediaDestination) this.mediaDestination = this.ctx.createMediaStreamDestination();
      this.monitorGain.connect(this.mediaDestination);
      if (!this.sinkAudio) {
        this.sinkAudio = new Audio() as SinkAudioElement;
        this.sinkAudio.autoplay = true;
      }
      if (this.sinkAudio.srcObject !== this.mediaDestination.stream) {
        this.sinkAudio.srcObject = this.mediaDestination.stream;
      }
      await this.sinkAudio.setSinkId?.(this.outputDeviceId);
      try {
        await this.sinkAudio.play();
      } catch {
        // The next user play gesture will start the routed media element.
      }
      return;
    }

    if (this.sinkAudio) {
      this.sinkAudio.pause();
      this.sinkAudio.srcObject = null;
    }
    this.monitorGain.connect(this.ctx.destination);
  }

  setMonitorVolume(value: number) {
    this.monitorVolume = clamp(value, 0, 1.25);
    if (this.ctx && this.monitorGain) {
      this.monitorGain.gain.setTargetAtTime(this.monitorVolume, this.ctx.currentTime, 0.015);
    }
  }

  async setOutputDevice(deviceId: string) {
    this.outputDeviceId = deviceId || "default";
    await this.connectMonitorDestination();
  }

  setParams(s: MasterSettings) {
    this.chain?.setParams(s, 0.02);
  }

  setLoop(b: boolean) {
    this.loop = b;
    // Native loop only when no region is set — region loop is driven by timer.
    if (this.source && this.regionStart == null) this.source.loop = b;
    if (this.playing) this.scheduleRegionWatch();
  }

  setRegion(start: number | null, end: number | null) {
    if (start != null && end != null && end > start) {
      this.regionStart = start;
      this.regionEnd = end;
    } else {
      this.regionStart = null;
      this.regionEnd = null;
    }
    if (this.source) this.source.loop = this.loop && this.regionStart == null;
    if (this.playing) this.scheduleRegionWatch();
  }

  /** Capture a compact deleted-region snapshot before ripple editing. */
  captureRegion(
    start: number,
    end: number,
    label = "Delete audio selection",
  ): AudioRegionEdit | null {
    const buf = this.buffer;
    if (!buf) return null;
    const sr = buf.sampleRate;
    const a = Math.max(0, Math.floor(Math.min(start, end) * sr));
    const b = Math.min(buf.length, Math.ceil(Math.max(start, end) * sr));
    if (b <= a) return null;
    const before: Float32Array[] = [];
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      before.push(buf.getChannelData(ch).slice(a, b));
    }
    return {
      kind: "ripple-delete",
      label,
      startSample: a,
      endSample: b,
      removedSamples: b - a,
      sampleRate: sr,
      channelCount: buf.numberOfChannels,
      beforeLength: buf.length,
      before,
    };
  }

  /**
   * Delete a selection DAW/Audacity-style: remove the selected audio and
   * shift everything to the right left to close the gap. This is different
   * from Silence/Delete-and-leave-gap. The cursor snaps to the left edit
   * boundary after the operation.
   */
  deleteRegionRipple(
    start: number,
    end: number,
    label = "Delete waveform selection",
  ): AudioRegionEdit | null {
    const edit = this.captureRegion(start, end, label);
    if (!edit) return null;
    this.applyAudioRegionEdit(edit, "redo");
    return edit;
  }

  /** Backward-compatible alias: delete now means ripple delete, not silence. */
  clearRegion(start: number, end: number, label = "Delete waveform selection") {
    return this.deleteRegionRipple(start, end, label);
  }

  applyAudioRegionEdit(edit: AudioRegionEdit, direction: "undo" | "redo"): AudioEditResult | null {
    const buf = this.buffer;
    const ctx = this.ctx;
    if (!buf || !ctx) return null;
    if (edit.sampleRate !== buf.sampleRate || edit.channelCount !== buf.numberOfChannels) {
      return null;
    }

    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();

    const start = Math.max(0, Math.min(buf.length, edit.startSample));
    const removed = Math.max(0, edit.removedSamples || edit.endSample - edit.startSample);
    if (removed <= 0) return null;

    let next: AudioBuffer;
    if (direction === "redo") {
      const len = Math.min(removed, Math.max(0, buf.length - start));
      const newLength = Math.max(1, buf.length - len);
      next = ctx.createBuffer(buf.numberOfChannels, newLength, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = next.getChannelData(ch);
        const leftEnd = Math.min(start, newLength);
        if (leftEnd > 0) dst.set(src.subarray(0, leftEnd), 0);
        if (leftEnd < newLength) {
          dst.set(src.subarray(start + len, start + len + (newLength - leftEnd)), leftEnd);
        }
      }
    } else {
      const insert = edit.before;
      const newLength = Math.max(1, buf.length + removed);
      next = ctx.createBuffer(buf.numberOfChannels, newLength, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = next.getChannelData(ch);
        const leftEnd = Math.min(start, src.length, dst.length);
        if (leftEnd > 0) dst.set(src.subarray(0, leftEnd), 0);
        const restored = insert[ch];
        if (restored) dst.set(restored.subarray(0, removed), leftEnd);
        const rightStart = leftEnd + removed;
        if (rightStart < dst.length) {
          dst.set(src.subarray(leftEnd, leftEnd + (dst.length - rightStart)), rightStart);
        }
      }
    }

    this.buffer = next;
    const snapTime = Math.min(next.duration, Math.max(0, start / next.sampleRate));
    this.offset = snapTime;
    if (wasPlaying) void this.play();
    return { duration: next.duration, currentTime: snapTime };
  }

  private clearRegionWatch() {
    if (this.regionTimer != null) {
      clearTimeout(this.regionTimer);
      this.regionTimer = null;
    }
  }

  private scheduleRegionWatch() {
    this.clearRegionWatch();
    if (!this.playing || this.regionStart == null || this.regionEnd == null) return;
    const remain = (this.regionEnd - this.currentTime) * 1000;
    if (remain <= 0) {
      this.handleRegionEnd();
      return;
    }
    this.regionTimer = window.setTimeout(() => this.handleRegionEnd(), Math.max(8, remain));
  }

  private handleRegionEnd() {
    if (!this.playing || this.regionStart == null) return;
    if (this.loop) {
      this.seek(this.regionStart);
    } else {
      this.pause();
      this.onEnded?.();
    }
  }

  async play(): Promise<void> {
    if (!this.ctx || !this.buffer || !this.chain) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.sinkAudio && this.outputDeviceId !== "default") {
      try {
        await this.sinkAudio.play();
      } catch {
        /* user can switch back to default if the browser blocks routed output */
      }
    }
    if (this.playing) return;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = this.loop && this.regionStart == null;
    this.source.connect(this.chain.input);
    this.startedAt = this.ctx.currentTime;
    this.endHandler = () => {
      if (!this.playing) return;
      this.playing = false;
      this.offset = 0;
      this.clearRegionWatch();
      try {
        this.source?.disconnect();
      } catch {}
      this.source = null;
      this.onEnded?.();
    };
    this.source.onended = this.endHandler;
    this.source.start(0, this.offset);
    this.playing = true;
    this.scheduleRegionWatch();
  }

  pause() {
    if (!this.ctx || !this.source) return;
    if (!this.playing) return;
    const t = this.currentTime;
    try {
      this.source.onended = null;
      this.source.stop();
    } catch {}
    this.source.disconnect();
    this.source = null;
    this.offset = t;
    this.playing = false;
    this.clearRegionWatch();
  }

  stop() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {}
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
    this.offset = 0;
    this.clearRegionWatch();
  }

  seek(t: number) {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(this.buffer.duration, t));
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.offset = clamped;
    if (wasPlaying) void this.play();
  }
}

// Singleton player for the app.
let _player: Player | null = null;
export function getPlayer(): Player {
  if (!_player) _player = new Player();
  return _player;
}
