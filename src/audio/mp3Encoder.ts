// Browser MP3 export for DeSonKuPik.
//
// The export path intentionally avoids MediaRecorder/WebCodecs for MP3 because
// browser MP3 *encoding* support is not reliable across platforms. Instead we
// lazy-load a small LAME-compatible JS encoder and feed it short PCM frames.
// After encoding, DeSonKuPik can decode-audit the MP3 that was just produced;
// if codec overs push the decoded file above the safety ceiling, it applies a
// tiny pre-encode trim and encodes one more time. This keeps MP3 export smart
// without permanently loading an encoder bundle on app start.

import { measureMasterLoudness, type LoudnessStats } from "./masterLoudness";

type LameEncoder = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array | Int8Array;
  flush(): Uint8Array | Int8Array;
};

type LameJsModule = {
  Mp3Encoder?: new (channels: number, sampleRate: number, kbps: number) => LameEncoder;
  default?: {
    Mp3Encoder?: new (channels: number, sampleRate: number, kbps: number) => LameEncoder;
  };
};

export interface Mp3EncodeOptions {
  kbps?: number;
  onProgress?: (progress: number) => void;
}

export interface Mp3VerifiedEncodeOptions extends Mp3EncodeOptions {
  /** Decoded MP3 true-peak safety target after lossy encode. */
  decodedTruePeakCeilingDb?: number;
  /** Skip decode-audit for low-memory situations or very long quick exports. */
  verifyDecodedMp3?: boolean;
}

export interface Mp3EncodeVerification {
  attempted: boolean;
  passed: boolean;
  attempts: number;
  decodedStats?: LoudnessStats;
  verificationGainDb: number;
  warning?: string;
}

export interface Mp3EncodeResult {
  blob: Blob;
  kbps: number;
  sampleRate: number;
  channels: number;
  verification: Mp3EncodeVerification;
}

const MP3_FRAME_SAMPLES = 1152;
const DEFAULT_MP3_KBPS = 320;
const DEFAULT_DECODED_TRUE_PEAK_CEILING_DB = -1.0;
const MP3_REENCODE_MARGIN_DB = 0.15;
const SUPPORTED_MP3_SAMPLE_RATES = new Set([
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
]);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const dbToGain = (db: number) => Math.pow(10, db / 20);
const round01 = (v: number) => Math.round(v * 10) / 10;

let cachedEncoderCtor:
  | (new (channels: number, sampleRate: number, kbps: number) => LameEncoder)
  | null = null;

export function chooseMp3SampleRate(sampleRate: number): number {
  const rounded = Math.round(sampleRate);
  if (SUPPORTED_MP3_SAMPLE_RATES.has(rounded)) return rounded;
  if (rounded > 48000) return 48000;
  if (rounded >= 44100) return 44100;
  if (rounded >= 32000) return 32000;
  if (rounded >= 24000) return 24000;
  if (rounded >= 22050) return 22050;
  return 44100;
}

export async function encodeMp3FromAudioBuffer(
  buffer: AudioBuffer,
  options: Mp3EncodeOptions = {},
): Promise<Blob> {
  return (await encodeMp3Smart(buffer, { ...options, verifyDecodedMp3: false })).blob;
}

export async function encodeMp3Smart(
  buffer: AudioBuffer,
  options: Mp3VerifiedEncodeOptions = {},
): Promise<Mp3EncodeResult> {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels || 1));
  const sampleRate = chooseMp3SampleRate(buffer.sampleRate);
  const source =
    sampleRate === Math.round(buffer.sampleRate)
      ? buffer
      : await resampleAudioBuffer(buffer, sampleRate);
  const kbps = clamp(Math.round(options.kbps ?? DEFAULT_MP3_KBPS), 96, 320);

  options.onProgress?.(0.02);
  const first = await encodePreparedBuffer(source, {
    channels,
    sampleRate,
    kbps,
    onProgress: (p) => {
      // Reserve the last part of progress for optional decode-audit.
      options.onProgress?.(0.02 + p * 0.78);
    },
  });

  const verifyDecodedMp3 = options.verifyDecodedMp3 ?? true;
  if (!verifyDecodedMp3) {
    options.onProgress?.(1);
    return {
      blob: first,
      kbps,
      sampleRate,
      channels,
      verification: {
        attempted: false,
        passed: true,
        attempts: 1,
        verificationGainDb: 0,
      },
    };
  }

  const ceiling = options.decodedTruePeakCeilingDb ?? DEFAULT_DECODED_TRUE_PEAK_CEILING_DB;
  try {
    options.onProgress?.(0.84);
    const decodedFirst = await decodeAudioBlob(first);
    const firstStats = measureMasterLoudness(decodedFirst);
    options.onProgress?.(0.9);

    if (firstStats.truePeakDb <= ceiling) {
      options.onProgress?.(1);
      return {
        blob: first,
        kbps,
        sampleRate,
        channels,
        verification: {
          attempted: true,
          passed: true,
          attempts: 1,
          decodedStats: firstStats,
          verificationGainDb: 0,
        },
      };
    }

    // Lossy encoders can generate extra reconstructed peaks. Trim only the
    // overshoot plus a small margin, then encode once more. This is cheaper and
    // safer than blindly using a very low ceiling for every MP3 export.
    const trimDb = round01(Math.min(0, ceiling - firstStats.truePeakDb - MP3_REENCODE_MARGIN_DB));
    const correctedSource = copyBufferWithGain(source, trimDb);
    const second = await encodePreparedBuffer(correctedSource, {
      channels,
      sampleRate,
      kbps,
      onProgress: (p) => options.onProgress?.(0.9 + p * 0.07),
    });
    const decodedSecond = await decodeAudioBlob(second);
    const secondStats = measureMasterLoudness(decodedSecond);
    options.onProgress?.(1);

    return {
      blob: second,
      kbps,
      sampleRate,
      channels,
      verification: {
        attempted: true,
        passed: secondStats.truePeakDb <= ceiling,
        attempts: 2,
        decodedStats: secondStats,
        verificationGainDb: trimDb,
        warning:
          secondStats.truePeakDb > ceiling
            ? `Decoded MP3 still peaked at ${secondStats.truePeakDb.toFixed(1)} dBTP`
            : undefined,
      },
    };
  } catch (err) {
    // Verification is a quality/safety audit, not a hard dependency. Some older
    // browsers may encode MP3 but fail to decode it immediately from a Blob.
    options.onProgress?.(1);
    return {
      blob: first,
      kbps,
      sampleRate,
      channels,
      verification: {
        attempted: true,
        passed: false,
        attempts: 1,
        verificationGainDb: 0,
        warning: `MP3 decode verification skipped: ${(err as Error).message}`,
      },
    };
  }
}

async function loadMp3Encoder() {
  if (cachedEncoderCtor) return cachedEncoderCtor;
  const module = (await import("@breezystack/lamejs")) as unknown as LameJsModule;
  const Mp3Encoder = module.Mp3Encoder ?? module.default?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error("MP3 encoder could not be loaded");
  cachedEncoderCtor = Mp3Encoder;
  return Mp3Encoder;
}

async function encodePreparedBuffer(
  source: AudioBuffer,
  options: {
    channels: number;
    sampleRate: number;
    kbps: number;
    onProgress?: (progress: number) => void;
  },
): Promise<Blob> {
  const Mp3Encoder = await loadMp3Encoder();
  const encoder = new Mp3Encoder(options.channels, options.sampleRate, options.kbps);
  const length = source.length;
  const leftData = source.getChannelData(0);
  const rightData = options.channels > 1 ? source.getChannelData(1) : null;
  const parts: ArrayBuffer[] = [];
  const left = new Int16Array(MP3_FRAME_SAMPLES);
  const right = options.channels > 1 ? new Int16Array(MP3_FRAME_SAMPLES) : undefined;
  let lastYield = performance.now();

  for (let offset = 0; offset < length; offset += MP3_FRAME_SAMPLES) {
    const frameLen = Math.min(MP3_FRAME_SAMPLES, length - offset);
    fillPcm16(left, leftData, offset, frameLen);
    if (right && rightData) fillPcm16(right, rightData, offset, frameLen);

    const chunk =
      options.channels > 1 && right
        ? encoder.encodeBuffer(left, right)
        : encoder.encodeBuffer(left);
    if (chunk.length > 0) parts.push(copyChunk(chunk));
    options.onProgress?.(Math.min(0.995, (offset + frameLen) / Math.max(1, length)));

    // Keep the browser responsive during long exports without moving the
    // encoding work to an always-loaded worker bundle.
    const now = performance.now();
    if (now - lastYield > 24) {
      await yieldToBrowser();
      lastYield = performance.now();
    }
  }

  const end = encoder.flush();
  if (end.length > 0) parts.push(copyChunk(end));
  options.onProgress?.(1);
  return new Blob(parts, { type: "audio/mpeg" });
}

function fillPcm16(dst: Int16Array, src: Float32Array, offset: number, frameLen: number) {
  for (let i = 0; i < frameLen; i++) {
    const s = clamp(src[offset + i] || 0, -1, 1);
    dst[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  for (let i = frameLen; i < dst.length; i++) dst[i] = 0;
}

function copyChunk(chunk: Uint8Array | Int8Array): ArrayBuffer {
  const src =
    chunk instanceof Uint8Array
      ? chunk
      : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const out = new Uint8Array(src.length);
  out.set(src);
  return out.buffer as ArrayBuffer;
}

async function resampleAudioBuffer(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (Math.round(buffer.sampleRate) === sampleRate) return buffer;
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels || 1));
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

function copyBufferWithGain(buffer: AudioBuffer, gainDb: number): AudioBuffer {
  if (Math.abs(gainDb) < 0.001) return buffer;
  const gain = dbToGain(gainDb);
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
  }
  return out;
}

async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Ctor) throw new Error("AudioContext decode is not available");
  const ctx = new Ctor();
  try {
    const ab = await blob.arrayBuffer();
    return await ctx.decodeAudioData(ab.slice(0));
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
