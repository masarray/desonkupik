import type { MasterSettings } from "./presets";

export type HeadroomAction = "attenuate" | "lift" | "hold";

export interface InputHeadroomResult {
  loudnessLufs: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  recommendedFileGainDb: number;
  /** Backward-compatible alias for old saved UI labels; do not drive the manual Input fader with this. */
  recommendedInputGainDb: number;
  projectedLoudnessLufs: number;
  projectedPeakDb: number;
  targetLoudnessLufs: number;
  targetPeakDb: number;
  scannedSamples: number;
  /** 0..1 estimate from sample-to-sample energy; higher means likely bright/edgy source. */
  brightnessScore: number;
  /** 0..1 estimate from crest factor; higher means denser/flatter source. */
  densityScore: number;
  /** 0..1 estimate from crest factor; higher means more transient punch available. */
  transientScore: number;
  /** 0..1 estimate of L/R spread; 0 = mono/center, 1 = very wide/decorrelated. */
  stereoSpreadScore: number;
  /** 0..1 long-listening risk used to relax color/limiter moves. */
  fatigueRisk: number;
  /** 0..1 estimate of sustained sub/low bass energy. */
  lowEndScore: number;
  /** 0..1 estimate of 160–650 Hz low-mid/vocal-pocket masking energy. */
  vocalPocketScore: number;
  /** 0..1 estimate of 6 kHz+ sheen/sizzle energy. */
  highSheenScore: number;
  action: HeadroomAction;
}

const TARGET_LOUDNESS_LUFS = -18;
const TARGET_PEAK_DBFS = -6;
const MAX_LIFT_DB = 12;
const MAX_ATTENUATE_DB = -18;
const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.4;
const MAX_SAMPLES_PER_BLOCK = 4096;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ampToDb = (amp: number) => (amp <= 1e-12 ? -120 : 20 * Math.log10(amp));
const dbFromMeanSquare = (ms: number) => (ms <= 1e-24 ? -120 : 10 * Math.log10(ms));
const round01 = (v: number) => Math.round(v * 10) / 10;

function loudnessFromMeanSquare(ms: number) {
  // ITU-R BS.1770 expresses loudness from gated mean-square energy with a
  // -0.691 dB calibration constant. This fast browser implementation keeps the
  // same block/gate philosophy but avoids extra copies and expensive oversampling.
  return -0.691 + dbFromMeanSquare(ms);
}

function actionForGain(gainDb: number): HeadroomAction {
  if (gainDb <= -0.25) return "attenuate";
  if (gainDb >= 0.25) return "lift";
  return "hold";
}

export function analyzeInputHeadroom(buffer: AudioBuffer): InputHeadroomResult {
  const channels = Math.min(2, buffer.numberOfChannels || 1);
  const sampleRate = buffer.sampleRate || 48000;
  const length = buffer.length;
  const block = Math.max(512, Math.floor(sampleRate * BLOCK_SECONDS));
  const hop = Math.max(512, Math.floor(sampleRate * HOP_SECONDS));
  const blockStride = Math.max(1, Math.ceil(block / MAX_SAMPLES_PER_BLOCK));
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

  let exactPeak = 0;
  let totalSq = 0;
  let totalCount = 0;
  let diffSq = 0;
  let diffCount = 0;
  let lrCross = 0;
  let lSq = 0;
  let rSq = 0;
  let lowSq = 0;
  let lowMidSq = 0;
  let highSq = 0;

  // Exact sample-peak + global RMS scan. This is a single streaming pass over
  // decoded channel data, no new large arrays. We also extract a tiny musical
  // profile so the web app can adapt the ArSonKuPik DNA to each file instead
  // of applying the same color intensity to every source.
  const lowCoef = Math.exp((-2 * Math.PI * 140) / sampleRate);
  const lowMidCoef = Math.exp((-2 * Math.PI * 720) / sampleRate);

  for (let c = 0; c < channels; c++) {
    const data = channelData[c];
    let prev = data[0] || 0;
    let low = 0;
    let lowMid = 0;
    for (let i = 0; i < length; i++) {
      const v = data[i];
      low = lowCoef * low + (1 - lowCoef) * v;
      lowMid = lowMidCoef * lowMid + (1 - lowMidCoef) * v;
      const vocalPocket = lowMid - low;
      const sheen = v - lowMid;
      lowSq += low * low;
      lowMidSq += vocalPocket * vocalPocket;
      highSq += sheen * sheen;
      const a = Math.abs(v);
      if (a > exactPeak) exactPeak = a;
      totalSq += v * v;
      totalCount++;
      if (i > 0) {
        const d = v - prev;
        diffSq += d * d;
        diffCount++;
      }
      prev = v;
    }
  }

  if (channels >= 2) {
    const left = channelData[0];
    const right = channelData[1];
    const stride = Math.max(1, Math.ceil(length / 220_000));
    for (let i = 0; i < length; i += stride) {
      const l = left[i];
      const r = right[i];
      lrCross += l * r;
      lSq += l * l;
      rSq += r * r;
    }
  }

  const blockEnergies: number[] = [];
  for (let start = 0; start < length; start += hop) {
    const end = Math.min(length, start + block);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += blockStride) {
      let frame = 0;
      for (let c = 0; c < channels; c++) {
        const v = channelData[c][i];
        frame += v * v;
      }
      // Mean per channel, so mono and stereo tracks land in the same practical
      // staging zone for a web mastering chain.
      sum += frame / channels;
      count++;
    }
    if (count > 0) blockEnergies.push(sum / count);
  }

  const absolutePassed = blockEnergies.filter(
    (ms) => loudnessFromMeanSquare(ms) >= ABSOLUTE_GATE_LUFS,
  );
  const firstMean = absolutePassed.length
    ? absolutePassed.reduce((a, b) => a + b, 0) / absolutePassed.length
    : totalSq / Math.max(1, totalCount);
  const relativeGate = loudnessFromMeanSquare(firstMean) + RELATIVE_GATE_LU;
  const gated = absolutePassed.filter((ms) => loudnessFromMeanSquare(ms) >= relativeGate);
  const gatedMean = gated.length ? gated.reduce((a, b) => a + b, 0) / gated.length : firstMean;

  const loudnessLufs = loudnessFromMeanSquare(gatedMean);
  const peakDb = ampToDb(exactPeak);
  const rmsDb = ampToDb(Math.sqrt(totalSq / Math.max(1, totalCount)));
  const crestDb = peakDb - loudnessLufs;

  const rmsLinear = Math.sqrt(totalSq / Math.max(1, totalCount));
  const diffRms = Math.sqrt(diffSq / Math.max(1, diffCount));
  const brightnessScore = clamp((diffRms / Math.max(1e-9, rmsLinear) - 0.18) / 0.82, 0, 1);
  const energyRef = Math.max(1e-12, totalSq);
  const lowEndScore = clamp(lowSq / energyRef / 0.42, 0, 1);
  const vocalPocketScore = clamp((lowMidSq / energyRef - 0.08) / 0.28, 0, 1);
  const highSheenScore = clamp((highSq / energyRef - 0.16) / 0.46, 0, 1);
  const transientScore = clamp((crestDb - 7) / 11, 0, 1);
  const densityScore = clamp((13 - crestDb) / 9, 0, 1);
  const corr = channels >= 2 ? lrCross / Math.max(1e-12, Math.sqrt(lSq * rSq)) : 1;
  const stereoSpreadScore = clamp((1 - corr) / 1.25, 0, 1);
  const fatigueRisk = clamp(
    densityScore * 0.4 +
      brightnessScore * 0.26 +
      highSheenScore * 0.12 +
      vocalPocketScore * 0.08 +
      clamp((loudnessLufs + 16) / 10, 0, 1) * 0.16 +
      clamp((peakDb + 3) / 3, 0, 1) * 0.08,
    0,
    1,
  );

  const loudnessGain = TARGET_LOUDNESS_LUFS - loudnessLufs;
  const peakGain = TARGET_PEAK_DBFS - peakDb;
  const gainDb = round01(clamp(Math.min(loudnessGain, peakGain), MAX_ATTENUATE_DB, MAX_LIFT_DB));

  return {
    loudnessLufs: round01(loudnessLufs),
    peakDb: round01(peakDb),
    rmsDb: round01(rmsDb),
    crestDb: round01(crestDb),
    recommendedFileGainDb: gainDb,
    recommendedInputGainDb: gainDb,
    projectedLoudnessLufs: round01(loudnessLufs + gainDb),
    projectedPeakDb: round01(peakDb + gainDb),
    targetLoudnessLufs: TARGET_LOUDNESS_LUFS,
    targetPeakDb: TARGET_PEAK_DBFS,
    scannedSamples: totalCount,
    brightnessScore: round01(brightnessScore),
    densityScore: round01(densityScore),
    transientScore: round01(transientScore),
    stereoSpreadScore: round01(stereoSpreadScore),
    fatigueRisk: round01(fatigueRisk),
    lowEndScore: round01(lowEndScore),
    vocalPocketScore: round01(vocalPocketScore),
    highSheenScore: round01(highSheenScore),
    action: actionForGain(gainDb),
  };
}

export function applySmartHeadroom(
  settings: MasterSettings,
  analysis: InputHeadroomResult,
): MasterSettings {
  const bright = analysis.brightnessScore ?? 0;
  const dense = analysis.densityScore ?? 0;
  const punch = analysis.transientScore ?? 0;
  const spread = analysis.stereoSpreadScore ?? 0;
  const fatigue = analysis.fatigueRisk ?? 0;
  const lowEnd = analysis.lowEndScore ?? 0;
  const vocalPocket = analysis.vocalPocketScore ?? 0;
  const highSheen = analysis.highSheenScore ?? bright;

  const color = settings.color;
  const width = settings.width;
  const output = settings.output;

  // Open Stereo Sheen source adaptation v3. The web app can inspect the whole
  // file, so the default no longer just turns things down when a source is bright.
  // It separates useful sheen from harshness, protects the vocal pocket, and keeps
  // bass sustain/glerr alive while preserving export-safe limiter behavior.
  const needsVocalLift = clamp((1 - spread) * 0.55 + vocalPocket * 0.32 + dense * 0.18, 0, 1);
  const sheenIsUseful = clamp(
    punch * 0.42 + (1 - fatigue) * 0.32 + spread * 0.18 - bright * 0.18,
    0,
    1,
  );
  const sweetSparkleWindow = clamp(
    punch * 0.32 + spread * 0.24 + (1 - fatigue) * 0.28 + highSheen * 0.16 - bright * 0.12,
    0,
    1,
  );
  const harshSheen = clamp(
    highSheen * 0.44 + bright * 0.32 + fatigue * 0.22 - sweetSparkleWindow * 0.18,
    0,
    1,
  );
  // Human-detail model: a source can be bright yet still musically detailed.
  // Preserve that micro-detail instead of letting adaptation over-smooth it.
  const humanDetailWindow = clamp(
    punch * 0.36 + (1 - dense) * 0.24 + sweetSparkleWindow * 0.24 + (1 - fatigue) * 0.18,
    0,
    1,
  );
  // Treble phase risk: wide/decorrelated sources with strong 6 kHz+ energy can
  // sound impressive but smear cymbal/vocal skin. In that case we preserve
  // center-coherent 6–10 kHz detail and move width/air decisions higher up.
  const treblePhaseRisk = clamp(
    spread * 0.34 +
      highSheen * 0.26 +
      bright * 0.13 +
      fatigue * 0.1 -
      punch * 0.18 -
      humanDetailWindow * 0.12,
    0,
    1,
  );
  const harmonicMaskRisk = clamp(
    dense * 0.34 +
      vocalPocket * 0.26 +
      fatigue * 0.24 +
      bright * 0.14 +
      treblePhaseRisk * 0.1 -
      punch * 0.18 -
      humanDetailWindow * 0.16,
    0,
    1,
  );

  const adaptedColor = {
    ...color,
    smartBass: clamp(
      color.smartBass +
        punch * 3.2 +
        lowEnd * 1.2 -
        dense * 2.0 -
        fatigue * 0.8 +
        humanDetailWindow * 0.5,
      0,
      100,
    ),
    godParticles: clamp(
      color.godParticles +
        sheenIsUseful * 3.4 +
        sweetSparkleWindow * 3.2 +
        humanDetailWindow * 1.15 +
        punch * 1.2 -
        harshSheen * 1.15 -
        harmonicMaskRisk * 0.95,
      0,
      100,
    ),
    aiHighRepair: clamp(
      color.aiHighRepair +
        harshSheen * 3.2 +
        fatigue * 0.9 +
        treblePhaseRisk * 0.45 -
        humanDetailWindow * 0.75 -
        sweetSparkleWindow * 0.35,
      0,
      100,
    ),
    velvetTreble: clamp(
      (color.velvetTreble ?? 78) +
        harshSheen * 1.8 +
        fatigue * 0.9 +
        treblePhaseRisk * 0.35 -
        humanDetailWindow * 0.55 -
        sweetSparkleWindow * 0.3,
      0,
      100,
    ),
    air: clamp(
      color.air +
        sheenIsUseful * 1.6 +
        sweetSparkleWindow * 2.0 -
        harshSheen * 0.62 -
        fatigue * 0.32,
      -24,
      48,
    ),
    vocalTickle: clamp(
      color.vocalTickle +
        needsVocalLift * 2.5 +
        punch * 0.9 +
        sweetSparkleWindow * 0.62 +
        humanDetailWindow * 1.0 -
        harshSheen * 0.24 -
        harmonicMaskRisk * 0.18,
      0,
      100,
    ),
    vocalPresence: clamp(
      color.vocalPresence +
        needsVocalLift * 2.25 +
        punch * 0.85 +
        sweetSparkleWindow * 0.46 +
        humanDetailWindow * 0.92 -
        harshSheen * 0.3 -
        harmonicMaskRisk * 0.22,
      0,
      100,
    ),
    midProjection: clamp(
      (color.midProjection ?? 50) +
        needsVocalLift * 2.05 +
        punch * 0.82 +
        humanDetailWindow * 0.7 -
        harmonicMaskRisk * 0.42,
      0,
      100,
    ),
    harmonics: clamp(
      (color.harmonics ?? 0) + humanDetailWindow * 0.5 - harmonicMaskRisk * 1.35,
      0,
      100,
    ),
    drive: clamp((color.drive ?? 0) + humanDetailWindow * 0.04 - harmonicMaskRisk * 0.1, 0, 12),
    mix: clamp(
      color.mix -
        fatigue * 0.2 -
        harmonicMaskRisk * 0.5 +
        punch * 0.48 +
        sheenIsUseful * 0.28 +
        humanDetailWindow * 0.22,
      0,
      100,
    ),
  };

  const adaptedWidth = {
    ...width,
    highWidth: clamp(
      width.highWidth +
        sheenIsUseful * 2.7 +
        sweetSparkleWindow * 3.6 -
        fatigue * 2.0 -
        spread * 0.7 -
        harmonicMaskRisk * 1.1 -
        treblePhaseRisk * 3.1,
      0,
      200,
    ),
    midWidth: clamp(width.midWidth + needsVocalLift * 1.8 - fatigue * 1.2, 0, 200),
    sourceProtect: clamp(
      width.sourceProtect +
        fatigue * 1.3 +
        spread * 0.7 +
        harmonicMaskRisk * 0.8 +
        treblePhaseRisk * 2.0 -
        sheenIsUseful * 0.65 -
        sweetSparkleWindow * 0.5,
      0,
      100,
    ),
    sideTone: clamp(
      width.sideTone +
        sheenIsUseful * 0.16 +
        sweetSparkleWindow * 0.24 -
        harshSheen * 0.08 -
        fatigue * 0.1 -
        harmonicMaskRisk * 0.07 -
        treblePhaseRisk * 0.24 +
        humanDetailWindow * 0.05,
      -12,
      18,
    ),
  };

  const adaptedOutput = {
    ...output,
    fileGain: analysis.recommendedFileGainDb,
    limiterDrive: clamp(
      output.limiterDrive -
        fatigue * 0.08 -
        dense * 0.035 -
        harmonicMaskRisk * 0.045 +
        punch * 0.04,
      0,
      12,
    ),
    limiterReleaseMs: clamp(output.limiterReleaseMs + fatigue * 12 + lowEnd * 4, 5, 1000),
  };

  return {
    ...settings,
    color: adaptedColor,
    width: adaptedWidth,
    output: adaptedOutput,
  };
}

export function formatHeadroomToast(analysis: InputHeadroomResult) {
  const verb =
    analysis.action === "attenuate" ? "lowered" : analysis.action === "lift" ? "raised" : "kept";
  const gain =
    analysis.recommendedFileGainDb > 0
      ? `+${analysis.recommendedFileGainDb}`
      : `${analysis.recommendedFileGainDb}`;
  return `Smart headroom ${verb} file pre-gain ${gain} dB · ${analysis.projectedLoudnessLufs} LUFS / ${analysis.projectedPeakDb} dBFS peak · open-sheen profile ${analysis.fatigueRisk.toFixed(1)} fatigue`;
}
