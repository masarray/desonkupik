// Offline render: re-run the same MasterChain through OfflineAudioContext
// and encode the result as WAV or MP3.
//
// The final buffer is scanned before encoding. If a rendered chain exceeds the
// selected ceiling, DeSonKuPik applies a transparent peak-safe trim instead of
// silently clipping samples during PCM/MP3 conversion.

import { MasterChain } from "./engine";
import { encodeMp3Smart } from "./mp3Encoder";
import {
  GLOBAL_STUDIO_TARGET,
  copyAudioBufferWithGain,
  gainForStudioTarget,
  measureMasterLoudness,
  type StudioLoudnessTarget,
} from "./masterLoudness";
import type { MasterSettings } from "./presets";

export interface RenderResult {
  blob: Blob;
  format: "wav" | "mp3";
  peakDb: number;
  normalizedDb: number;
  clippedSamples: number;
  loudnessBeforeLufs: number;
  loudnessAfterLufs: number;
  truePeakBeforeDb: number;
  truePeakAfterDb: number;
  studioGainDb: number;
  bitrateKbps?: number;
  mp3SampleRate?: number;
  mp3Verified?: boolean;
  mp3VerificationAttempts?: number;
  mp3VerificationGainDb?: number;
  mp3VerificationWarning?: string;
}

interface MasteredBufferResult extends Omit<RenderResult, "blob" | "format" | "bitrateKbps"> {
  buffer: AudioBuffer;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);
const ampToDb = (amp: number) => (amp <= 1e-12 ? -120 : 20 * Math.log10(amp));
const round01 = (v: number) => Math.round(v * 10) / 10;

export async function renderToWav(
  buffer: AudioBuffer,
  settings: MasterSettings,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  const mastered = await renderMasteredBuffer(buffer, settings, {
    target: {
      ...GLOBAL_STUDIO_TARGET,
      truePeakDb: Math.min(GLOBAL_STUDIO_TARGET.truePeakDb, settings.output.limiterCeiling),
    },
    onProgress: (p) => onProgress?.(p * 0.985),
  });
  onProgress?.(1);
  return {
    ...stripBuffer(mastered),
    format: "wav",
    blob: encodeWavPCM24(mastered.buffer),
  };
}

export async function renderToMp3(
  buffer: AudioBuffer,
  settings: MasterSettings,
  onProgress?: (p: number) => void,
  bitrateKbps = 320,
): Promise<RenderResult> {
  // MP3 encoding and later platform transcoding can create extra inter-sample
  // overs. Use a slightly safer ceiling than WAV while keeping the same global
  // music loudness target.
  const mp3Target: StudioLoudnessTarget = {
    ...GLOBAL_STUDIO_TARGET,
    truePeakDb: Math.min(settings.output.limiterCeiling, -1.5),
  };
  const mastered = await renderMasteredBuffer(buffer, settings, {
    target: mp3Target,
    onProgress: (p) => onProgress?.(p * 0.72),
  });
  const encoded = await encodeMp3Smart(mastered.buffer, {
    kbps: bitrateKbps,
    decodedTruePeakCeilingDb: -1.0,
    verifyDecodedMp3: true,
    onProgress: (p) => onProgress?.(0.72 + p * 0.28),
  });
  onProgress?.(1);
  const stats = encoded.verification.decodedStats;
  const verificationGainDb = encoded.verification.verificationGainDb;
  const stripped = stripBuffer(mastered);
  return {
    ...stripped,
    loudnessAfterLufs: stats?.integratedLufs ?? stripped.loudnessAfterLufs,
    truePeakAfterDb: stats?.truePeakDb ?? stripped.truePeakAfterDb,
    peakDb: stats?.samplePeakDb ?? stripped.peakDb,
    studioGainDb: round01(stripped.studioGainDb + verificationGainDb),
    format: "mp3",
    blob: encoded.blob,
    bitrateKbps: encoded.kbps,
    mp3SampleRate: encoded.sampleRate,
    mp3Verified: encoded.verification.attempted && encoded.verification.passed,
    mp3VerificationAttempts: encoded.verification.attempts,
    mp3VerificationGainDb: verificationGainDb,
    mp3VerificationWarning: encoded.verification.warning,
  };
}

async function renderMasteredBuffer(
  buffer: AudioBuffer,
  settings: MasterSettings,
  options: { target: StudioLoudnessTarget; onProgress?: (p: number) => void },
): Promise<MasteredBufferResult> {
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
  const chain = new MasterChain(ctx);
  chain.build(settings);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start();

  const renderPromise = ctx.startRendering();
  let tick: ReturnType<typeof setInterval> | null = null;
  if (options.onProgress) {
    tick = setInterval(() => {
      options.onProgress?.(Math.min(0.97, ctx.currentTime / (length / sampleRate)));
    }, 100);
  }

  try {
    const rendered = await renderPromise;
    options.onProgress?.(0.975);

    // Export path: keep live playback exciting, but make the downloaded file
    // land in a globally safe production zone. This does not move the Output
    // fader in the UI; it is an offline finalization step for the download only.
    const before = measureMasterLoudness(rendered);
    const studioGainDb = gainForStudioTarget(before, options.target);
    const mastered = copyAudioBufferWithGain(rendered, studioGainDb);

    // One final safety pass after the studio loudness move. If unusual source
    // material still risks the ceiling, trim only the excess peak.
    const targetPeak = dbToGain(options.target.truePeakDb);
    const peakAfterStudio = scanPeak(mastered);
    const trimGain = peakAfterStudio.peak > targetPeak ? targetPeak / peakAfterStudio.peak : 1;
    const safe = trimGain < 0.999 ? copyAudioBufferWithGain(mastered, ampToDb(trimGain)) : mastered;
    const after = measureMasterLoudness(safe);
    const clippedSamples = countClippedSamples(safe);
    options.onProgress?.(1);

    return {
      buffer: safe,
      peakDb: after.samplePeakDb,
      normalizedDb: ampToDb(trimGain),
      clippedSamples,
      loudnessBeforeLufs: before.integratedLufs,
      loudnessAfterLufs: after.integratedLufs,
      truePeakBeforeDb: before.truePeakDb,
      truePeakAfterDb: after.truePeakDb,
      studioGainDb: round01(studioGainDb + ampToDb(trimGain)),
    };
  } finally {
    if (tick) clearInterval(tick);
  }
}

function stripBuffer(
  result: MasteredBufferResult,
): Omit<RenderResult, "blob" | "format" | "bitrateKbps"> {
  return {
    peakDb: result.peakDb,
    normalizedDb: result.normalizedDb,
    clippedSamples: result.clippedSamples,
    loudnessBeforeLufs: result.loudnessBeforeLufs,
    loudnessAfterLufs: result.loudnessAfterLufs,
    truePeakBeforeDb: result.truePeakBeforeDb,
    truePeakAfterDb: result.truePeakAfterDb,
    studioGainDb: result.studioGainDb,
  };
}

function scanPeak(buf: AudioBuffer): { peak: number } {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  return { peak };
}

function countClippedSamples(buf: AudioBuffer): number {
  let clipped = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) >= 0.999999) clipped++;
    }
  }
  return clipped;
}

function encodeWavPCM24(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels;
  const sampleRate = buf.sampleRate;
  const samples = buf.length;
  const bytesPerSample = 3;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const headerSize = 44;
  const total = headerSize + dataSize;

  const ab = new ArrayBuffer(total);
  const view = new DataView(ab);
  let p = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  writeStr("RIFF");
  view.setUint32(p, total - 8, true);
  p += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(p, 16, true);
  p += 4;
  view.setUint16(p, 1, true);
  p += 2; // PCM
  view.setUint16(p, numCh, true);
  p += 2;
  view.setUint32(p, sampleRate, true);
  p += 4;
  view.setUint32(p, byteRate, true);
  p += 4;
  view.setUint16(p, blockAlign, true);
  p += 2;
  view.setUint16(p, bytesPerSample * 8, true);
  p += 2;
  writeStr("data");
  view.setUint32(p, dataSize, true);
  p += 4;

  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));

  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      const val = Math.round(s * 8388607); // 2^23 - 1
      // 24-bit little-endian signed
      view.setUint8(p++, val & 0xff);
      view.setUint8(p++, (val >> 8) & 0xff);
      view.setUint8(p++, (val >> 16) & 0xff);
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}
