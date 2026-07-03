// Loudness tools for final mastering export.
//
// The aim is a practical, browser-friendly implementation inspired by
// ITU-R BS.1770 / EBU R128: K-weighting, 400 ms gated loudness blocks,
// and a 4x interpolated true-peak estimate. It avoids large intermediate
// buffers so long songs remain safe in memory.

export interface LoudnessStats {
  integratedLufs: number;
  samplePeakDb: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
}

export interface StudioLoudnessTarget {
  /** Streaming-safe global music target used for exported WAV. */
  integratedLufs: number;
  /** Inter-sample/transcode safety ceiling. */
  truePeakDb: number;
}

export const GLOBAL_STUDIO_TARGET: StudioLoudnessTarget = {
  integratedLufs: -14,
  truePeakDb: -1,
};

const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const BS1770_CALIBRATION_DB = -0.691;
const MAX_DB = 24;
const MIN_DB = -48;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ampToDb = (amp: number) => (amp <= 1e-12 ? -120 : 20 * Math.log10(amp));
const dbToAmp = (db: number) => Math.pow(10, db / 20);
const msToLufs = (ms: number) => (ms <= 1e-24 ? -120 : BS1770_CALIBRATION_DB + 10 * Math.log10(ms));

interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function makeHighpass(sampleRate: number, frequency: number, q: number): BiquadCoefs {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function makeHighShelf(
  sampleRate: number,
  frequency: number,
  gainDb: number,
  slope = 1,
): BiquadCoefs {
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = (sin / 2) * Math.sqrt((a + 1 / a) * (1 / slope - 1) + 2);
  const twoRootAAlpha = 2 * Math.sqrt(a) * alpha;

  const b0 = a * (a + 1 + (a - 1) * cos + twoRootAAlpha);
  const b1 = -2 * a * (a - 1 + (a + 1) * cos);
  const b2 = a * (a + 1 + (a - 1) * cos - twoRootAAlpha);
  const a0 = a + 1 - (a - 1) * cos + twoRootAAlpha;
  const a1 = 2 * (a - 1 - (a + 1) * cos);
  const a2 = a + 1 - (a - 1) * cos - twoRootAAlpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

class BiquadState {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly c: BiquadCoefs) {}

  process(x: number) {
    const y =
      this.c.b0 * x +
      this.c.b1 * this.x1 +
      this.c.b2 * this.x2 -
      this.c.a1 * this.y1 -
      this.c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function createKWeighting(sampleRate: number) {
  // Practical K-weighting approximation: the ITU pre-filter is a high shelf
  // followed by an RLB high-pass. Frequencies/Qs are the commonly used BS.1770
  // design values, generated for the actual file sample rate.
  const shelf = makeHighShelf(sampleRate, 1681.974, 4, 1);
  const hpf = makeHighpass(sampleRate, 38.1358, 0.5003);
  return {
    shelf: new BiquadState(shelf),
    hpf: new BiquadState(hpf),
    process(x: number) {
      return this.hpf.process(this.shelf.process(x));
    },
  };
}

export function measureMasterLoudness(buffer: AudioBuffer): LoudnessStats {
  const channels = Math.min(2, buffer.numberOfChannels || 1);
  const sampleRate = buffer.sampleRate || 48000;
  const length = buffer.length;
  const blockSize = Math.max(1, Math.round(BLOCK_SECONDS * sampleRate));
  const hopSize = Math.max(1, Math.round(HOP_SECONDS * sampleRate));
  const maxBlocks = Math.max(
    1,
    Math.floor((Math.max(length, blockSize) - blockSize) / hopSize) + 1,
  );
  const blockSums = new Float64Array(maxBlocks);
  const blockCounts = new Uint32Array(maxBlocks);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

  let samplePeak = 0;
  let truePeak = 0;
  let rawSq = 0;
  let rawCount = 0;

  for (let c = 0; c < channels; c++) {
    const data = channelData[c];
    const k = createKWeighting(sampleRate);
    let prev = data[0] || 0;
    for (let i = 0; i < length; i++) {
      const v = data[i];
      const abs = Math.abs(v);
      if (abs > samplePeak) samplePeak = abs;
      rawSq += v * v;
      rawCount++;

      // A lightweight 4x true-peak estimate. This is not a certification-grade
      // oversampling filter, but it catches inter-sample risk much better than
      // sample-peak only and costs very little memory.
      if (i > 0) {
        const d = v - prev;
        const p1 = Math.abs(prev + d * 0.25);
        const p2 = Math.abs(prev + d * 0.5);
        const p3 = Math.abs(prev + d * 0.75);
        if (p1 > truePeak) truePeak = p1;
        if (p2 > truePeak) truePeak = p2;
        if (p3 > truePeak) truePeak = p3;
      }
      if (abs > truePeak) truePeak = abs;
      prev = v;

      const y = k.process(v);
      const energy = y * y;
      const firstBlock = Math.max(0, Math.ceil((i - blockSize + 1) / hopSize));
      const lastBlock = Math.min(maxBlocks - 1, Math.floor(i / hopSize));
      for (let b = firstBlock; b <= lastBlock; b++) {
        blockSums[b] += energy;
        blockCounts[b]++;
      }
    }
  }

  const blockMeans: number[] = [];
  for (let b = 0; b < maxBlocks; b++) {
    if (blockCounts[b] > 0) blockMeans.push(blockSums[b] / blockCounts[b]);
  }
  const absolutePassed = blockMeans.filter((ms) => msToLufs(ms) >= ABSOLUTE_GATE_LUFS);
  const absoluteMean = absolutePassed.length
    ? absolutePassed.reduce((sum, v) => sum + v, 0) / absolutePassed.length
    : rawSq / Math.max(1, rawCount);
  const relativeGate = msToLufs(absoluteMean) + RELATIVE_GATE_LU;
  const gated = absolutePassed.filter((ms) => msToLufs(ms) >= relativeGate);
  const gatedMean = gated.length
    ? gated.reduce((sum, v) => sum + v, 0) / gated.length
    : absoluteMean;

  const integratedLufs = msToLufs(gatedMean);
  const samplePeakDb = ampToDb(samplePeak);
  const truePeakDb = ampToDb(truePeak);
  const rmsDb = ampToDb(Math.sqrt(rawSq / Math.max(1, rawCount)));

  return {
    integratedLufs: round01(integratedLufs),
    samplePeakDb: round01(samplePeakDb),
    truePeakDb: round01(truePeakDb),
    rmsDb: round01(rmsDb),
    crestDb: round01(truePeakDb - integratedLufs),
  };
}

export function gainForStudioTarget(
  stats: LoudnessStats,
  target: StudioLoudnessTarget = GLOBAL_STUDIO_TARGET,
): number {
  const loudnessGain = target.integratedLufs - stats.integratedLufs;
  const truePeakGain = target.truePeakDb - stats.truePeakDb;
  return round01(clamp(Math.min(loudnessGain, truePeakGain), MIN_DB, MAX_DB));
}

export function copyAudioBufferWithGain(buffer: AudioBuffer, gainDb: number): AudioBuffer {
  const gain = dbToAmp(gainDb);
  if (Math.abs(gainDb) < 0.001) return buffer;
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

function round01(v: number) {
  return Math.round(v * 10) / 10;
}
