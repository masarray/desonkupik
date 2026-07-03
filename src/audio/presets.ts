// DeSonKuPik factory presets — preserves all factory
// presets, default values, and normalisation behaviour from the proven
// engine. Numeric ranges and field shapes are intentionally identical so
// that the same tuning maps 1:1 onto the new web app's audio graph.

export type EqType = "lowcut" | "lowshelf" | "bell" | "notch" | "highshelf" | "highcut";

export interface EqBand {
  id: string;
  label: string;
  type: EqType;
  frequency: number;
  gain: number;
  q: number;
  slope: 12 | 24 | 36 | 48;
  enabled: boolean;
}

export interface CompressorSettings {
  threshold: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
  makeupGain: number;
  parallelMix: number;
  enabled: boolean;
}

export interface ColorSettings {
  enabled: boolean;
  drive: number;
  /** Lower body color center. Default 170 Hz supports vocal lower body, piano wood, and acoustic guitar. */
  bodyFreq: number;
  body: number;
  /** Smart bass context amount: keeps bass thick but prevents masking/fatigue. */
  smartBass: number;
  /** Vocal/chest body color center. Default 490 Hz keeps vocal/piano body present. */
  warmthFreq: number;
  harmonics: number;
  /** Presence harmonic center. Default around 2.15 kHz keeps vocal forward without harshness. */
  harmonicsFreq: number;
  warmth: number;
  /** Air exciter shelf/drive center. */
  airFreq: number;
  air: number;
  /** Smart God Particles+: micro harmonics that add perceived sparkle, mid detail, and bass power without raw treble boost. */
  godParticles: number;
  /** Velvet treble governor: rounds 6–12 kHz digital grain before rebuilding clean upper air. */
  velvetTreble: number;
  /** Smart treble governor: prevents God Particles/air/presence from becoming overexcited or fatiguing. */
  smartTrebleGuard: number;
  /** Hidden engine family for special bass/throw presets. */
  engineFamily: "standard" | "sonkuhoreg" | "sonkubattle" | "sonkubalap";
  /** Segment-aware high repair: sweetens 5–18 kHz artifacts without dulling air. */
  aiHighRepair: number;
  /** Center vocal tickle around 1.05–1.25 kHz so vocals feel tactile/forward. */
  vocalTickle: number;
  /** Smart 2 kHz center presence: makes lead/female vocals stand out without honky 2.5 kHz artifacts. */
  vocalPresence: number;
  /** Center Mid Projection: small parallel body/focus layer that brings the master forward without shout. */
  midProjection: number;
  mix: number;
  stereoMid: number;
  mode: "clean" | "warm" | "modern" | "mastering";
}

export interface WidthSettings {
  enabled: boolean;
  /** Parallel blend of the processed M/S width stage. 0 = dry center-safe, 100 = full width engine. */
  mix: number;
  width: number;
  lowWidth: number;
  lowMidWidth: number;
  midWidth: number;
  highWidth: number;
  sourceProtect: number;
  monoBass: boolean;
  monoBassFreq: number;
  sideTone: number;
}

export interface OutputSettings {
  /** File-specific pre-gain applied directly after decode/source, before the manual Input fader and before bypass. */
  fileGain: number;
  inputGain: number;
  outputGain: number;
  /** Output Gain Lock: when true, preset changes preserve the current Output fader for stable gain-match/A/B. */
  outputGainLock: boolean;
  gainMatchEnabled: boolean;
  gainMatchGain: number;
  limiterEnabled: boolean;
  limiterCeiling: number;
  limiterDrive: number;
  punchProtect: boolean;
  bypass: boolean;
  limiterStyle: "transparent" | "modern" | "punchy" | "safe";
  lookaheadMs: number;
  limiterAttackMs: number;
  limiterReleaseMs: number;
  transientLink: number;
  releaseLink: number;
  oversampling: 1 | 2 | 4 | 8;
  truePeak: boolean;
}

export interface MasterSettings {
  eqEnabled: boolean;
  eq: EqBand[];
  compressor: CompressorSettings;
  color: ColorSettings;
  width: WidthSettings;
  output: OutputSettings;
}

export const EQ_TYPE_LABELS: Record<EqType, string> = {
  lowcut: "Low Cut",
  lowshelf: "Low Shelf",
  bell: "Bell",
  notch: "Notch",
  highshelf: "High Shelf",
  highcut: "High Cut",
};

const WEB_AUDIO_TYPE: Record<EqType, BiquadFilterType> = {
  lowcut: "highpass",
  lowshelf: "lowshelf",
  bell: "peaking",
  notch: "notch",
  highshelf: "highshelf",
  highcut: "lowpass",
};

export function toWebAudioType(type: EqType): BiquadFilterType {
  return WEB_AUDIO_TYPE[type] ?? "peaking";
}

export function isCutType(type: EqType): boolean {
  return type === "lowcut" || type === "highcut";
}

export function dbToGain(db: number): number {
  return Math.pow(10, (Number.isFinite(db) ? db : 0) / 20);
}

export const BUTTERWORTH_Q: Record<number, number[]> = {
  12: [0.70710678],
  24: [0.5411961, 1.30656296],
  36: [0.51763809, 0.70710678, 1.93185165],
  48: [0.50979558, 0.60134489, 0.89997622, 2.56291545],
};

export const VOCAL_BODY_GUARD_BAND: EqBand = {
  id: "vocal-body-guard",
  label: "Vocal Body Guard",
  type: "bell",
  frequency: 490,
  gain: 1.5,
  q: 0.8,
  slope: 12,
  enabled: true,
};

export const VOCAL_ACOUSTIC_BODY_BAND: EqBand = {
  id: "vocal-acoustic-body",
  label: "Vocal / Guitar Body",
  type: "bell",
  frequency: 170,
  gain: 1,
  q: 2.5,
  slope: 12,
  enabled: true,
};

export const DEFAULT_EQ_BANDS: EqBand[] = [
  {
    id: "cut-low",
    label: "Sub Clean",
    type: "lowcut",
    frequency: 26,
    gain: 0,
    q: 0.707,
    slope: 24,
    enabled: true,
  },
  {
    id: "low-body",
    label: "Global Glerr Body",
    type: "lowshelf",
    frequency: 82,
    gain: 1.18,
    q: 0.68,
    slope: 12,
    enabled: true,
  },
  {
    id: "mud-clean",
    label: "Mud Clean",
    type: "bell",
    frequency: 345,
    gain: -0.66,
    q: 0.88,
    slope: 12,
    enabled: true,
  },
  {
    id: "presence",
    label: "Living Mid",
    type: "bell",
    frequency: 2050,
    gain: 0.88,
    q: 0.72,
    slope: 12,
    enabled: true,
  },
  {
    id: "detail",
    label: "Open Sheen Detail",
    type: "bell",
    frequency: 6500,
    gain: 0.94,
    q: 0.84,
    slope: 12,
    enabled: true,
  },
  {
    id: "sparkle",
    label: "Open Rounded Sheen",
    type: "highshelf",
    frequency: 12650,
    gain: 2.7,
    q: 0.42,
    slope: 12,
    enabled: true,
  },
  // Appended here to preserve historical DEFAULT_EQ_BANDS indexes used by
  // preset definitions; normalizeEqBands() reorders vocal support bands into
  // the audible chain by frequency.
  VOCAL_ACOUSTIC_BODY_BAND,
  VOCAL_BODY_GUARD_BAND,
];

export const DEFAULT_COMPRESSOR: CompressorSettings = {
  threshold: -24.2,
  ratio: 1.62,
  knee: 26,
  attack: 0.036,
  release: 0.225,
  makeupGain: 0.64,
  parallelMix: 91,
  enabled: true,
};

export const DEFAULT_COLOR: ColorSettings = {
  enabled: true,
  drive: 3.05,
  bodyFreq: 166,
  body: 14.2,
  smartBass: 58,
  warmthFreq: 500,
  harmonics: 31,
  harmonicsFreq: 2080,
  warmth: 12.7,
  airFreq: 12650,
  air: 31.5,
  godParticles: 66.5,
  velvetTreble: 78,
  smartTrebleGuard: 62,
  engineFamily: "standard",
  aiHighRepair: 56,
  vocalTickle: 48,
  vocalPresence: 47,
  midProjection: 56,
  mix: 26.2,
  stereoMid: 44,
  mode: "mastering",
};

export const DEFAULT_WIDTH: WidthSettings = {
  enabled: true,
  mix: 64,
  width: 134,
  lowWidth: 100,
  lowMidWidth: 102,
  midWidth: 114,
  highWidth: 174,
  sourceProtect: 74,
  monoBass: true,
  monoBassFreq: 150,
  sideTone: 2.75,
};

export const DEFAULT_OUTPUT: OutputSettings = {
  fileGain: 0,
  inputGain: 0,
  outputGain: 0,
  outputGainLock: true,
  gainMatchEnabled: false,
  gainMatchGain: 0,
  limiterEnabled: true,
  limiterCeiling: -1,
  limiterDrive: 0.36,
  punchProtect: true,
  bypass: false,
  limiterStyle: "transparent",
  lookaheadMs: 5,
  limiterAttackMs: 4.4,
  limiterReleaseMs: 104,
  transientLink: 66,
  releaseLink: 90,
  oversampling: 4,
  truePeak: true,
};

export interface FactoryPreset {
  id: string;
  name: string;
  description: string;
  settings: MasterSettings;
}

function clamp(n: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function normalizeEqBand(band: Partial<EqBand>, index = 0): EqBand {
  const fallback = DEFAULT_EQ_BANDS[index % DEFAULT_EQ_BANDS.length] ?? DEFAULT_EQ_BANDS[0];
  const type = (band.type ?? fallback.type) as EqType;
  return {
    id: band.id ?? `band-${Date.now()}-${index}`,
    label: band.label ?? EQ_TYPE_LABELS[type] ?? fallback.label,
    type: EQ_TYPE_LABELS[type] ? type : fallback.type,
    frequency: clamp(band.frequency ?? fallback.frequency, 20, 20000),
    gain: clamp(band.gain ?? fallback.gain, -24, 24),
    q: clamp(band.q ?? fallback.q, 0.1, 24),
    slope: ([12, 24, 36, 48] as const).includes(Number(band.slope) as 12 | 24 | 36 | 48)
      ? (Number(band.slope) as 12 | 24 | 36 | 48)
      : fallback.slope,
    enabled: band.enabled !== false,
  };
}

function isVocalBodyGuardLike(band: EqBand): boolean {
  return (
    band.id === VOCAL_BODY_GUARD_BAND.id ||
    (band.type === "bell" && band.frequency >= 450 && band.frequency <= 540 && band.gain >= 0.7)
  );
}

function isVocalAcousticBodyLike(band: EqBand): boolean {
  return (
    band.id === VOCAL_ACOUSTIC_BODY_BAND.id ||
    (band.type === "bell" && band.frequency >= 150 && band.frequency <= 190 && band.gain >= 0.5)
  );
}

function insertSupportBand(
  bands: EqBand[],
  target: EqBand,
  matcher: (band: EqBand) => boolean,
): EqBand[] {
  const existingIndex = bands.findIndex(matcher);
  const support = existingIndex >= 0 ? { ...bands[existingIndex] } : { ...target };
  const withoutSupport =
    existingIndex >= 0 ? bands.filter((_, index) => index !== existingIndex) : bands;
  const insertAt = withoutSupport.findIndex((band) => band.frequency > support.frequency);
  if (insertAt < 0) return [...withoutSupport, support];
  return [...withoutSupport.slice(0, insertAt), support, ...withoutSupport.slice(insertAt)];
}

export function normalizeEqBands(bands?: Partial<EqBand>[]): EqBand[] {
  const src = bands && bands.length ? bands : DEFAULT_EQ_BANDS;
  const normalized = src.map((b, i) => normalizeEqBand(b, i));
  return insertSupportBand(
    insertSupportBand(normalized, VOCAL_ACOUSTIC_BODY_BAND, isVocalAcousticBodyLike),
    VOCAL_BODY_GUARD_BAND,
    isVocalBodyGuardLike,
  );
}

export function normalizeCompressor(c: Partial<CompressorSettings> = {}): CompressorSettings {
  return {
    threshold: clamp(c.threshold ?? DEFAULT_COMPRESSOR.threshold, -60, 0),
    ratio: clamp(c.ratio ?? DEFAULT_COMPRESSOR.ratio, 1, 20),
    knee: clamp(c.knee ?? DEFAULT_COMPRESSOR.knee, 0, 40),
    attack: clamp(c.attack ?? DEFAULT_COMPRESSOR.attack, 0.001, 0.2),
    release: clamp(c.release ?? DEFAULT_COMPRESSOR.release, 0.02, 1.5),
    makeupGain: clamp(c.makeupGain ?? DEFAULT_COMPRESSOR.makeupGain, -18, 18),
    parallelMix: clamp(c.parallelMix ?? DEFAULT_COMPRESSOR.parallelMix, 0, 100),
    enabled: c.enabled !== false,
  };
}

export function normalizeColor(c: Partial<ColorSettings> = {}): ColorSettings {
  return {
    enabled: c.enabled !== false,
    drive: clamp(c.drive ?? DEFAULT_COLOR.drive, 0, 24),
    bodyFreq: clamp(c.bodyFreq ?? DEFAULT_COLOR.bodyFreq, 95, 260),
    body: clamp(c.body ?? DEFAULT_COLOR.body, -24, 24),
    smartBass: clamp(c.smartBass ?? DEFAULT_COLOR.smartBass, 0, 100),
    warmthFreq: clamp(c.warmthFreq ?? DEFAULT_COLOR.warmthFreq, 300, 760),
    harmonics: clamp(c.harmonics ?? DEFAULT_COLOR.harmonics, 0, 100),
    harmonicsFreq: clamp(c.harmonicsFreq ?? DEFAULT_COLOR.harmonicsFreq, 1200, 3600),
    warmth: clamp(c.warmth ?? DEFAULT_COLOR.warmth, -24, 24),
    airFreq: clamp(c.airFreq ?? DEFAULT_COLOR.airFreq, 6500, 16000),
    air: clamp(c.air ?? DEFAULT_COLOR.air, -24, 48),
    godParticles: clamp(c.godParticles ?? DEFAULT_COLOR.godParticles, 0, 100),
    velvetTreble: clamp(c.velvetTreble ?? DEFAULT_COLOR.velvetTreble, 0, 100),
    smartTrebleGuard: clamp(c.smartTrebleGuard ?? DEFAULT_COLOR.smartTrebleGuard, 0, 100),
    engineFamily: (
      ["standard", "sonkuhoreg", "sonkubattle", "sonkubalap"] as readonly string[]
    ).includes(c.engineFamily ?? "")
      ? (c.engineFamily as ColorSettings["engineFamily"])
      : DEFAULT_COLOR.engineFamily,
    aiHighRepair: clamp(c.aiHighRepair ?? DEFAULT_COLOR.aiHighRepair, 0, 100),
    vocalTickle: clamp(c.vocalTickle ?? DEFAULT_COLOR.vocalTickle, 0, 100),
    vocalPresence: clamp(c.vocalPresence ?? DEFAULT_COLOR.vocalPresence, 0, 100),
    midProjection: clamp(c.midProjection ?? DEFAULT_COLOR.midProjection, 0, 100),
    mix: clamp(c.mix ?? DEFAULT_COLOR.mix, 0, 100),
    stereoMid: clamp(c.stereoMid ?? DEFAULT_COLOR.stereoMid, 0, 100),
    mode: (["clean", "warm", "modern", "mastering"] as readonly string[]).includes(c.mode ?? "")
      ? (c.mode as ColorSettings["mode"])
      : DEFAULT_COLOR.mode,
  };
}

export function normalizeWidth(w: Partial<WidthSettings> = {}): WidthSettings {
  return {
    enabled: w.enabled !== false,
    mix: clamp(w.mix ?? DEFAULT_WIDTH.mix, 0, 100),
    width: clamp(w.width ?? DEFAULT_WIDTH.width, 0, 200),
    lowWidth: clamp(w.lowWidth ?? DEFAULT_WIDTH.lowWidth, 0, 200),
    lowMidWidth: clamp(w.lowMidWidth ?? DEFAULT_WIDTH.lowMidWidth, 0, 200),
    midWidth: clamp(w.midWidth ?? DEFAULT_WIDTH.midWidth, 0, 200),
    highWidth: clamp(w.highWidth ?? DEFAULT_WIDTH.highWidth, 0, 200),
    sourceProtect: clamp(w.sourceProtect ?? DEFAULT_WIDTH.sourceProtect, 0, 100),
    monoBass: w.monoBass !== false,
    monoBassFreq: clamp(w.monoBassFreq ?? DEFAULT_WIDTH.monoBassFreq, 60, 250),
    sideTone: clamp(w.sideTone ?? DEFAULT_WIDTH.sideTone, -12, 18),
  };
}

export function normalizeOutput(o: Partial<OutputSettings> = {}): OutputSettings {
  const style = (["transparent", "modern", "punchy", "safe"] as const).includes(
    o.limiterStyle as OutputSettings["limiterStyle"],
  )
    ? (o.limiterStyle as OutputSettings["limiterStyle"])
    : DEFAULT_OUTPUT.limiterStyle;
  const osRaw = Number(o.oversampling ?? DEFAULT_OUTPUT.oversampling);
  const oversampling = (
    osRaw >= 8 ? 8 : osRaw >= 4 ? 4 : osRaw >= 2 ? 2 : 1
  ) as OutputSettings["oversampling"];
  return {
    fileGain: clamp(o.fileGain ?? DEFAULT_OUTPUT.fileGain, -24, 18),
    inputGain: clamp(o.inputGain ?? DEFAULT_OUTPUT.inputGain, -24, 18),
    outputGain: clamp(o.outputGain ?? DEFAULT_OUTPUT.outputGain, -24, 18),
    outputGainLock: o.outputGainLock !== false,
    gainMatchEnabled: o.gainMatchEnabled === true,
    gainMatchGain: clamp(o.gainMatchGain ?? DEFAULT_OUTPUT.gainMatchGain, -24, 18),
    limiterEnabled: o.limiterEnabled !== false,
    limiterCeiling: clamp(o.limiterCeiling ?? DEFAULT_OUTPUT.limiterCeiling, -12, 0),
    limiterDrive: clamp(o.limiterDrive ?? DEFAULT_OUTPUT.limiterDrive, 0, 12),
    punchProtect: o.punchProtect !== false,
    bypass: o.bypass === true,
    limiterStyle: style,
    lookaheadMs: clamp(o.lookaheadMs ?? DEFAULT_OUTPUT.lookaheadMs, 0, 20),
    limiterAttackMs: clamp(o.limiterAttackMs ?? DEFAULT_OUTPUT.limiterAttackMs, 0.1, 50),
    limiterReleaseMs: clamp(o.limiterReleaseMs ?? DEFAULT_OUTPUT.limiterReleaseMs, 5, 1000),
    transientLink: clamp(o.transientLink ?? DEFAULT_OUTPUT.transientLink, 0, 100),
    releaseLink: clamp(o.releaseLink ?? DEFAULT_OUTPUT.releaseLink, 0, 100),
    oversampling,
    truePeak: o.truePeak !== false,
  };
}

export function normalizeSettings(s: Partial<MasterSettings> = {}): MasterSettings {
  return {
    eqEnabled: s.eqEnabled !== false,
    eq: normalizeEqBands(s.eq),
    compressor: normalizeCompressor(s.compressor),
    color: normalizeColor(s.color),
    width: normalizeWidth(s.width),
    output: normalizeOutput(s.output),
  };
}

interface PresetSpec {
  id: string;
  name: string;
  description: string;
  eq?: EqBand[];
  compressor?: Partial<CompressorSettings>;
  color?: Partial<ColorSettings>;
  width?: Partial<WidthSettings>;
  output?: Partial<OutputSettings>;
}

function p(spec: PresetSpec): FactoryPreset {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    settings: normalizeSettings({
      eqEnabled: true,
      eq: spec.eq ?? DEFAULT_EQ_BANDS,
      compressor: { ...DEFAULT_COMPRESSOR, ...spec.compressor },
      color: { ...DEFAULT_COLOR, ...spec.color },
      width: { ...DEFAULT_WIDTH, ...spec.width },
      output: { ...DEFAULT_OUTPUT, ...spec.output },
    }),
  };
}

export const FACTORY_PRESETS: FactoryPreset[] = [
  p({
    id: "mastering",
    name: "DeSonKuPik Global",
    description:
      "Top global-grade default with Vocal Crown tuning: natural center vocal weight, living mid, glerr deep bass, open sheen, velvet treble, and smarter source-aware mastering.",
    eq: [
      {
        id: "global-sub-clean",
        label: "Sub Clean",
        type: "lowcut",
        frequency: 26,
        gain: 0,
        q: 0.707,
        slope: 24,
        enabled: true,
      },
      {
        id: "global-glerr-body",
        label: "Global Glerr Body",
        type: "lowshelf",
        frequency: 82,
        gain: 1.28,
        q: 0.66,
        slope: 12,
        enabled: true,
      },
      {
        ...VOCAL_ACOUSTIC_BODY_BAND,
        frequency: 178,
        gain: 1.22,
        q: 2.25,
      },
      {
        id: "global-pocket-clean",
        label: "Vocal Pocket Clean",
        type: "bell",
        frequency: 352,
        gain: -0.58,
        q: 0.78,
        slope: 12,
        enabled: true,
      },
      {
        ...VOCAL_BODY_GUARD_BAND,
        frequency: 505,
        gain: 1.62,
        q: 0.74,
      },
      {
        id: "global-vocal-crown-tickle",
        label: "Vocal Crown Tickle",
        type: "bell",
        frequency: 1160,
        gain: 0.26,
        q: 0.92,
        slope: 12,
        enabled: true,
      },
      {
        id: "global-living-mid",
        label: "Living Mid",
        type: "bell",
        frequency: 2020,
        gain: 1.16,
        q: 0.66,
        slope: 12,
        enabled: true,
      },
      {
        id: "global-open-sheen",
        label: "Coherent Sheen Detail",
        type: "bell",
        frequency: 6750,
        gain: 0.92,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      {
        id: "global-treble-clarity",
        label: "Treble Clarity Skin",
        type: "bell",
        frequency: 8750,
        gain: 0.46,
        q: 0.82,
        slope: 12,
        enabled: true,
      },
      {
        id: "global-rounded-sheen",
        label: "Open Rounded Sheen",
        type: "highshelf",
        frequency: 12650,
        gain: 2.75,
        q: 0.42,
        slope: 12,
        enabled: true,
      },
    ],
    compressor: {
      threshold: -24.2,
      ratio: 1.62,
      knee: 26,
      attack: 0.036,
      release: 0.225,
      makeupGain: 0.64,
      parallelMix: 91,
    },
    color: {
      drive: 2.94,
      bodyFreq: 170,
      body: 14.7,
      smartBass: 57,
      warmthFreq: 505,
      warmth: 13.0,
      harmonicsFreq: 2020,
      harmonics: 29,
      airFreq: 12650,
      air: 36.0,
      godParticles: 72,
      velvetTreble: 68,
      smartTrebleGuard: 52,
      aiHighRepair: 46,
      vocalTickle: 58,
      vocalPresence: 58,
      midProjection: 63,
      mix: 26.6,
      stereoMid: 58,
      mode: "mastering",
    },
    width: {
      mix: 62,
      width: 134,
      lowWidth: 100,
      lowMidWidth: 100,
      midWidth: 112,
      highWidth: 172,
      sourceProtect: 80,
      monoBass: true,
      monoBassFreq: 150,
      sideTone: 2.18,
    },
    output: {
      outputGain: 0,
      limiterDrive: 0.36,
      limiterCeiling: -1,
      limiterStyle: "transparent",
      lookaheadMs: 5,
      limiterAttackMs: 4.4,
      limiterReleaseMs: 104,
      transientLink: 66,
      releaseLink: 90,
      oversampling: 4,
      truePeak: true,
    },
  }),
  p({
    id: "mas-ari-signature",
    name: "Mas Ari Signature",
    description:
      "Vivid personal signature master: clearly more keluar than Global, with tactile living mid, deeper glerr bass, brighter air sparkle lift, wider stereo particles, and true-peak-safe output.",
    eq: [
      {
        id: "masari-sub-clean",
        label: "Sub Clean",
        type: "lowcut",
        frequency: 24,
        gain: 0,
        q: 0.707,
        slope: 24,
        enabled: true,
      },
      {
        id: "masari-glerr-body",
        label: "Deep Glerr Body",
        type: "lowshelf",
        frequency: 76,
        gain: 1.52,
        q: 0.62,
        slope: 12,
        enabled: true,
      },
      {
        ...VOCAL_ACOUSTIC_BODY_BAND,
        frequency: 168,
        gain: 1.18,
        q: 2.35,
      },
      {
        id: "masari-pocket-clean",
        label: "Vocal Pocket Clean",
        type: "bell",
        frequency: 326,
        gain: -1.06,
        q: 0.84,
        slope: 12,
        enabled: true,
      },
      {
        ...VOCAL_BODY_GUARD_BAND,
        frequency: 492,
        gain: 1.62,
        q: 0.76,
      },
      {
        id: "masari-mid-tickle",
        label: "Tactile Mid Tickle",
        type: "bell",
        frequency: 1180,
        gain: 0.38,
        q: 0.86,
        slope: 12,
        enabled: true,
      },
      {
        id: "masari-living-mid",
        label: "Living Mid Forward",
        type: "bell",
        frequency: 2180,
        gain: 1.22,
        q: 0.62,
        slope: 12,
        enabled: true,
      },
      {
        id: "masari-presence-sweetener",
        label: "Presence Sweetener",
        type: "bell",
        frequency: 3550,
        gain: 0.44,
        q: 0.78,
        slope: 12,
        enabled: true,
      },
      {
        id: "masari-soft-polish",
        label: "Soft Harsh Polish",
        type: "bell",
        frequency: 4300,
        gain: -0.1,
        q: 1.08,
        slope: 12,
        enabled: true,
      },
      {
        id: "masari-air-tickle",
        label: "Air Sparkle Tickle",
        type: "bell",
        frequency: 6250,
        gain: 1.46,
        q: 0.54,
        slope: 12,
        enabled: true,
      },
      {
        id: "masari-silky-9k-smooth",
        label: "Silky 9k Smooth",
        type: "bell",
        frequency: 9000,
        gain: -0.28,
        q: 0.92,
        slope: 12,
        enabled: true,
      },
      {
        id: "masari-open-sparkle",
        label: "Open Sparkle Lift",
        type: "highshelf",
        frequency: 12650,
        gain: 2.7,
        q: 0.38,
        slope: 12,
        enabled: true,
      },
    ],
    compressor: {
      threshold: -24.4,
      ratio: 1.58,
      knee: 24,
      attack: 0.038,
      release: 0.205,
      makeupGain: 0.78,
      parallelMix: 93,
    },
    color: {
      drive: 3.34,
      bodyFreq: 166,
      body: 14.4,
      smartBass: 60,
      warmthFreq: 500,
      warmth: 13.6,
      harmonicsFreq: 2180,
      harmonics: 36,
      airFreq: 12650,
      air: 46.8,
      godParticles: 89,
      velvetTreble: 66,
      smartTrebleGuard: 55,
      aiHighRepair: 45,
      vocalTickle: 64,
      vocalPresence: 55,
      midProjection: 68,
      mix: 31.5,
      stereoMid: 68,
      mode: "mastering",
    },
    width: {
      mix: 73,
      width: 153,
      lowWidth: 100,
      lowMidWidth: 101,
      midWidth: 128,
      highWidth: 200,
      sourceProtect: 58,
      monoBass: true,
      monoBassFreq: 150,
      sideTone: 4.25,
    },
    output: {
      outputGain: 0,
      outputGainLock: true,
      limiterDrive: 0.48,
      limiterCeiling: -1,
      limiterStyle: "transparent",
      lookaheadMs: 5,
      limiterAttackMs: 4,
      limiterReleaseMs: 98,
      transientLink: 62,
      releaseLink: 88,
      oversampling: 4,
      truePeak: true,
      punchProtect: true,
    },
  }),
  p({
    id: "default",
    name: "DeSonKuPik 3.79",
    description:
      "Factory signature following the same Global default DNA: open sheen, living mid, glerr bass, and long-listening velvet control.",
  }),
  p({
    id: "max-enhancer",
    name: "Max Enhancer",
    description:
      "v0.3.79-inspired maximum enhancement: stronger open sheen, living vocal particle, bigger but safer stereo, and long-listening limiter control.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 88, gain: 1.55, q: 0.66 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 380, gain: -0.52, q: 0.62 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2450, gain: 1.04, q: 0.58 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 6350, gain: 1.06, q: 0.54 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12650, gain: 2.88, q: 0.42 },
    ],
    compressor: {
      threshold: -24.2,
      ratio: 1.8,
      knee: 24,
      attack: 0.032,
      release: 0.19,
      makeupGain: 0.82,
      parallelMix: 90,
    },
    color: {
      drive: 3.18,
      bodyFreq: 164,
      body: 15.0,
      smartBass: 62,
      warmthFreq: 505,
      warmth: 13.0,
      harmonicsFreq: 2100,
      harmonics: 32,
      airFreq: 12750,
      air: 36.8,
      godParticles: 76,
      velvetTreble: 73,
      smartTrebleGuard: 59,
      aiHighRepair: 52,
      vocalTickle: 56,
      vocalPresence: 55,
      midProjection: 62,
      mix: 28.4,
      stereoMid: 58,
      mode: "mastering",
    },
    width: {
      mix: 66,
      width: 144,
      lowWidth: 100,
      lowMidWidth: 102,
      midWidth: 122,
      highWidth: 192,
      sourceProtect: 66,
      monoBass: true,
      monoBassFreq: 158,
      sideTone: 3.65,
    },
    output: { outputGain: 0, limiterDrive: 0.46, limiterCeiling: -1, punchProtect: true },
  }),
  p({
    id: "sonkuhoreg",
    name: "SonKuHoreg",
    description:
      "Empuk slow-bass Horeg: softer deep sub, stronger glerr torque, more living mid, open top-end sheen, and smart long-listening control.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 24, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 56, gain: 3.55, q: 0.48 },
      {
        id: "horeg-sub-torque",
        label: "Sub Torque",
        type: "bell",
        frequency: 70,
        gain: 1.38,
        q: 0.52,
        slope: 12,
        enabled: true,
      },
      {
        id: "horeg-wall-push",
        label: "Wall Push",
        type: "bell",
        frequency: 116,
        gain: 1.16,
        q: 0.58,
        slope: 12,
        enabled: true,
      },
      { ...VOCAL_ACOUSTIC_BODY_BAND, frequency: 182, gain: 1.08, q: 1.95 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 338, gain: -0.9, q: 0.78 },
      { ...VOCAL_BODY_GUARD_BAND, gain: 1.62, q: 0.76 },
      {
        id: "horeg-far-mid-glow",
        label: "Far Mid Glow",
        type: "bell",
        frequency: 1320,
        gain: 0.58,
        q: 0.68,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2180, gain: 1.52, q: 0.58 },
      {
        id: "horeg-3d-mid-sparkle",
        label: "3D Mid Sparkle",
        type: "bell",
        frequency: 3720,
        gain: 1.16,
        q: 0.76,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[4], frequency: 6300, gain: 1.16, q: 0.66 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12650, gain: 2.65, q: 0.48 },
    ],
    compressor: {
      threshold: -24.6,
      ratio: 1.66,
      knee: 25,
      attack: 0.04,
      release: 0.27,
      makeupGain: 0.76,
      parallelMix: 91,
    },
    color: {
      drive: 3.54,
      bodyFreq: 142,
      body: 18.6,
      smartBass: 94,
      warmthFreq: 500,
      warmth: 15.4,
      harmonicsFreq: 2140,
      harmonics: 39,
      airFreq: 12650,
      air: 31.0,
      godParticles: 82,
      velvetTreble: 80,
      smartTrebleGuard: 73,
      engineFamily: "sonkuhoreg",
      aiHighRepair: 60,
      vocalTickle: 62,
      vocalPresence: 67,
      midProjection: 80,
      mix: 31.5,
      stereoMid: 78,
      mode: "mastering",
    },
    width: {
      mix: 66,
      width: 138,
      lowWidth: 100,
      lowMidWidth: 102,
      midWidth: 122,
      highWidth: 178,
      sourceProtect: 72,
      monoBass: true,
      monoBassFreq: 165,
      sideTone: 2.9,
    },
    output: { outputGain: 0, limiterDrive: 0.61, limiterCeiling: -1.12, punchProtect: true },
  }),
  p({
    id: "sonkubattle",
    name: "SonKuBattle",
    description:
      "Maximum SPL battle preset: stronger dBC bass pressure, dBA throw presence, open top-end sparkle, and limiter-safe battle loudness.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 60, gain: 3.25, q: 0.48 },
      {
        id: "battle-dbc-torque",
        label: "dBC Torque",
        type: "bell",
        frequency: 74,
        gain: 1.68,
        q: 0.5,
        slope: 12,
        enabled: true,
      },
      {
        id: "battle-dbc-punch",
        label: "dBC Punch",
        type: "bell",
        frequency: 110,
        gain: 1.46,
        q: 0.54,
        slope: 12,
        enabled: true,
      },
      {
        id: "battle-small-speaker-bass",
        label: "Bass Harmonic Push",
        type: "bell",
        frequency: 158,
        gain: 1.05,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      { ...VOCAL_ACOUSTIC_BODY_BAND, frequency: 198, gain: 0.86, q: 1.85 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 315, gain: -1.2, q: 0.8 },
      { ...VOCAL_BODY_GUARD_BAND, gain: 1.52, q: 0.74 },
      {
        id: "battle-dba-throw",
        label: "dBA Throw",
        type: "bell",
        frequency: 1860,
        gain: 1.48,
        q: 0.62,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2550, gain: 1.48, q: 0.56 },
      {
        id: "battle-3d-spark",
        label: "3D Battle Spark",
        type: "bell",
        frequency: 3480,
        gain: 1.32,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      {
        id: "battle-harsh-guard",
        label: "Battle Harsh Guard",
        type: "bell",
        frequency: 4700,
        gain: -0.16,
        q: 1.0,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[4], frequency: 6400, gain: 1.14, q: 0.64 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12600, gain: 2.55, q: 0.48 },
    ],
    compressor: {
      threshold: -25.2,
      ratio: 1.98,
      knee: 24,
      attack: 0.028,
      release: 0.155,
      makeupGain: 0.66,
      parallelMix: 89,
    },
    color: {
      drive: 3.78,
      bodyFreq: 148,
      body: 19.2,
      smartBass: 96,
      warmthFreq: 505,
      warmth: 13.4,
      harmonicsFreq: 2320,
      harmonics: 44,
      airFreq: 12550,
      air: 30.0,
      godParticles: 83,
      velvetTreble: 78,
      smartTrebleGuard: 74,
      engineFamily: "sonkubattle",
      aiHighRepair: 60,
      vocalTickle: 64,
      vocalPresence: 75,
      midProjection: 84,
      mix: 31.8,
      stereoMid: 84,
      mode: "mastering",
    },
    width: {
      mix: 68,
      width: 140,
      lowWidth: 100,
      lowMidWidth: 101,
      midWidth: 128,
      highWidth: 184,
      sourceProtect: 68,
      monoBass: true,
      monoBassFreq: 170,
      sideTone: 3.25,
    },
    output: { outputGain: 0, limiterDrive: 0.72, limiterCeiling: -1.08, punchProtect: true },
  }),
  p({
    id: "sonkubalap",
    name: "SonKuBalap",
    description:
      "Maximum efficient battle preset: fast long-throw bass torque, high dBA presence, dBC punch, open top-end sparkle, and amp-friendly loudness.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 31, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 66, gain: 2.82, q: 0.46 },
      {
        id: "balap-efficient-torque",
        label: "Efficient Torque",
        type: "bell",
        frequency: 82,
        gain: 1.58,
        q: 0.5,
        slope: 12,
        enabled: true,
      },
      {
        id: "balap-amp-punch",
        label: "Amp Punch",
        type: "bell",
        frequency: 118,
        gain: 1.42,
        q: 0.52,
        slope: 12,
        enabled: true,
      },
      {
        id: "balap-bass-harmonic",
        label: "Bass Harmonic",
        type: "bell",
        frequency: 158,
        gain: 1.12,
        q: 0.68,
        slope: 12,
        enabled: true,
      },
      { ...VOCAL_ACOUSTIC_BODY_BAND, frequency: 205, gain: 0.8, q: 1.8 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 305, gain: -1.25, q: 0.82 },
      {
        id: "balap-box-control",
        label: "Box Control",
        type: "bell",
        frequency: 430,
        gain: -0.38,
        q: 0.88,
        slope: 12,
        enabled: true,
      },
      { ...VOCAL_BODY_GUARD_BAND, gain: 1.48, q: 0.74 },
      {
        id: "balap-mid-throw",
        label: "Balap Mid Throw",
        type: "bell",
        frequency: 1680,
        gain: 1.32,
        q: 0.62,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2480, gain: 1.44, q: 0.56 },
      {
        id: "balap-3d-spark",
        label: "3D Balap Spark",
        type: "bell",
        frequency: 3550,
        gain: 1.28,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      {
        id: "balap-tweeter-safe",
        label: "Tweeter Safe",
        type: "bell",
        frequency: 5200,
        gain: -0.18,
        q: 0.96,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[4], frequency: 6400, gain: 1.12, q: 0.64 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12600, gain: 2.48, q: 0.48 },
    ],
    compressor: {
      threshold: -25.1,
      ratio: 1.94,
      knee: 25,
      attack: 0.024,
      release: 0.145,
      makeupGain: 0.6,
      parallelMix: 89,
    },
    color: {
      drive: 3.72,
      bodyFreq: 152,
      body: 18.2,
      smartBass: 93,
      warmthFreq: 505,
      warmth: 12.8,
      harmonicsFreq: 2350,
      harmonics: 46,
      airFreq: 12600,
      air: 31.5,
      godParticles: 84,
      velvetTreble: 77,
      smartTrebleGuard: 73,
      engineFamily: "sonkubalap",
      aiHighRepair: 59,
      vocalTickle: 66,
      vocalPresence: 77,
      midProjection: 86,
      mix: 31.4,
      stereoMid: 86,
      mode: "mastering",
    },
    width: {
      mix: 68,
      width: 144,
      lowWidth: 100,
      lowMidWidth: 100,
      midWidth: 132,
      highWidth: 190,
      sourceProtect: 66,
      monoBass: true,
      monoBassFreq: 180,
      sideTone: 3.45,
    },
    output: { outputGain: 0, limiterDrive: 0.68, limiterCeiling: -1.08, punchProtect: true },
  }),
  p({
    id: "audiophile-pop",
    name: "Audiophile",
    description:
      "v0.3.79 popular audiophile balance: open vocal center, refined side sheen, glerr bass, and non-fatiguing sparkle.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 30, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 84, gain: 0.95, q: 0.7 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 350, gain: -0.72, q: 0.88 },
      {
        id: "vocal-focus-audiophile",
        label: "Vocal Focus",
        type: "bell",
        frequency: 1900,
        gain: 0.65,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[4], frequency: 6250, gain: 0.86, q: 0.62 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12650, gain: 2.55, q: 0.48 },
      { ...VOCAL_BODY_GUARD_BAND, gain: 1.5, q: 0.8 },
    ],
    compressor: {
      threshold: -24,
      ratio: 1.65,
      knee: 22,
      attack: 0.032,
      release: 0.22,
      makeupGain: 0.55,
      parallelMix: 90,
    },
    color: {
      drive: 2.68,
      bodyFreq: 170,
      body: 13.1,
      smartBass: 55,
      warmthFreq: 500,
      warmth: 11.4,
      harmonicsFreq: 2050,
      harmonics: 28,
      airFreq: 12680,
      air: 32.4,
      godParticles: 68,
      velvetTreble: 74,
      smartTrebleGuard: 58,
      aiHighRepair: 50,
      vocalTickle: 45,
      vocalPresence: 46,
      midProjection: 54,
      mix: 24.8,
      stereoMid: 40,
      mode: "mastering",
    },
    width: {
      mix: 67,
      width: 142,
      lowWidth: 100,
      lowMidWidth: 102,
      midWidth: 118,
      highWidth: 190,
      sourceProtect: 68,
      monoBass: true,
      monoBassFreq: 148,
      sideTone: 3.42,
    },
    output: { outputGain: 0, limiterDrive: 0.26, limiterCeiling: -1 },
  }),
  p({
    id: "pro-music",
    name: "Punchy Music",
    description: "Punchy bass, thick groove, transient glue, sparkling detail.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 28, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 82, gain: 2.0 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 360, gain: -0.62, q: 0.86 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 2150, gain: 0.78, q: 0.78 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 5900, gain: 0.86, q: 0.86 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12650, gain: 2.15 },
    ],
    compressor: {
      threshold: -23.8,
      ratio: 1.95,
      knee: 18,
      attack: 0.026,
      release: 0.18,
      makeupGain: 0.68,
      parallelMix: 91,
    },
    color: {
      drive: 3.36,
      bodyFreq: 165,
      body: 17.2,
      smartBass: 70,
      warmthFreq: 505,
      warmth: 14.0,
      harmonicsFreq: 2180,
      harmonics: 34,
      airFreq: 11100,
      air: 28.8,
      godParticles: 66,
      velvetTreble: 78,
      smartTrebleGuard: 61,
      aiHighRepair: 54,
      vocalTickle: 52,
      vocalPresence: 57,
      midProjection: 63,
      mix: 27.8,
      stereoMid: 54,
      mode: "mastering",
    },
    width: {
      mix: 58,
      width: 132,
      lowWidth: 100,
      lowMidWidth: 102,
      midWidth: 116,
      highWidth: 176,
      sourceProtect: 76,
      monoBass: true,
      monoBassFreq: 155,
      sideTone: 2.55,
    },
    output: { outputGain: 0, limiterDrive: 0.5, limiterCeiling: -1 },
  }),
  p({
    id: "open-air-field",
    name: "Open Air",
    description: "Big bass contour, forward vocal, strong air sparkle, limiter-safe.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 32, slope: 24 },
      {
        id: "field-low",
        label: "Field Low Contour",
        type: "lowshelf",
        frequency: 92,
        gain: 2.45,
        q: 0.68,
        slope: 12,
        enabled: true,
      },
      {
        id: "field-lowmid",
        label: "Low-Mid Clean",
        type: "bell",
        frequency: 330,
        gain: -1.28,
        q: 0.92,
        slope: 12,
        enabled: true,
      },
      {
        id: "field-vocal",
        label: "Vocal Guard",
        type: "bell",
        frequency: 2050,
        gain: 0.92,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      {
        id: "field-bite",
        label: "Field Bite",
        type: "bell",
        frequency: 5200,
        gain: 0.56,
        q: 0.9,
        slope: 12,
        enabled: true,
      },
      {
        id: "field-air",
        label: "Open Air",
        type: "highshelf",
        frequency: 12650,
        gain: 2.65,
        q: 0.58,
        slope: 12,
        enabled: true,
      },
    ],
    compressor: {
      threshold: -25.2,
      ratio: 2.05,
      knee: 20,
      attack: 0.028,
      release: 0.22,
      makeupGain: 0.45,
      parallelMix: 88,
    },
    color: {
      drive: 3.18,
      bodyFreq: 180,
      body: 15.6,
      smartBass: 62,
      warmthFreq: 510,
      warmth: 12.8,
      harmonicsFreq: 2100,
      harmonics: 30,
      airFreq: 10600,
      air: 34.5,
      godParticles: 71,
      velvetTreble: 74,
      smartTrebleGuard: 58,
      aiHighRepair: 51,
      vocalTickle: 48,
      vocalPresence: 50,
      midProjection: 58,
      mix: 27.2,
      stereoMid: 46,
      mode: "mastering",
    },
    width: {
      mix: 56,
      width: 144,
      lowWidth: 100,
      lowMidWidth: 101,
      midWidth: 118,
      highWidth: 196,
      sourceProtect: 66,
      monoBass: true,
      monoBassFreq: 190,
      sideTone: 3.85,
    },
    output: { outputGain: 0, limiterDrive: 0.42, limiterCeiling: -1 },
  }),
  p({
    id: "movie-dolby",
    name: "Movie Sub",
    description: "Thick sub, clean low-mid, dialogue clarity, smooth cinematic width.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 24, slope: 24 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 58, gain: 2.35, q: 0.7 },
      {
        id: "sub-body",
        label: "Sub Body",
        type: "bell",
        frequency: 118,
        gain: 0.82,
        q: 0.84,
        slope: 12,
        enabled: true,
      },
      {
        id: "de-box",
        label: "De-box",
        type: "bell",
        frequency: 370,
        gain: -1.55,
        q: 0.95,
        slope: 12,
        enabled: true,
      },
      {
        id: "dialogue",
        label: "Dialogue",
        type: "bell",
        frequency: 2650,
        gain: 1.12,
        q: 0.78,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[5], frequency: 12400, gain: 1.28 },
    ],
    compressor: {
      threshold: -24,
      ratio: 1.7,
      knee: 18,
      attack: 0.034,
      release: 0.28,
      makeupGain: 0.35,
      parallelMix: 90,
    },
    color: {
      drive: 2.55,
      bodyFreq: 180,
      body: 13.2,
      smartBass: 56,
      warmthFreq: 520,
      warmth: 11.8,
      harmonicsFreq: 1850,
      harmonics: 20,
      airFreq: 9800,
      air: 19.8,
      godParticles: 45,
      velvetTreble: 84,
      smartTrebleGuard: 62,
      aiHighRepair: 58,
      vocalTickle: 32,
      vocalPresence: 36,
      midProjection: 40,
      mix: 22,
      stereoMid: 20,
      mode: "warm",
    },
    width: {
      mix: 60,
      width: 122,
      lowWidth: 100,
      lowMidWidth: 101,
      midWidth: 108,
      highWidth: 142,
      sourceProtect: 86,
      monoBass: true,
      monoBassFreq: 165,
      sideTone: 1.25,
    },
    output: { outputGain: 0, limiterDrive: 0.2, limiterCeiling: -1.1 },
  }),
  p({
    id: "podcast",
    name: "Podcast",
    description: "Voice-safe polish: controlled lows, smooth compression, soft air.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 86, slope: 24 },
      {
        id: "vocal-chest",
        label: "Vocal Chest",
        type: "bell",
        frequency: 190,
        gain: 0.52,
        q: 0.72,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[2], frequency: 330, gain: -2.1, q: 1.0 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 1850, gain: 0.88, q: 0.76 },
      {
        id: "sib",
        label: "Sibilance Smooth",
        type: "bell",
        frequency: 6900,
        gain: -1.8,
        q: 1.8,
        slope: 12,
        enabled: true,
      },
      { ...DEFAULT_EQ_BANDS[5], frequency: 11800, gain: 0.58 },
    ],
    compressor: {
      threshold: -26.5,
      ratio: 2.0,
      knee: 24,
      attack: 0.018,
      release: 0.26,
      makeupGain: 0.45,
      parallelMix: 80,
    },
    color: {
      drive: 0.82,
      bodyFreq: 165,
      body: 5.4,
      smartBass: 32,
      warmthFreq: 520,
      warmth: 7.6,
      harmonicsFreq: 1750,
      harmonics: 5,
      airFreq: 9300,
      air: 6.8,
      godParticles: 24,
      velvetTreble: 84,
      smartTrebleGuard: 62,
      aiHighRepair: 58,
      vocalTickle: 34,
      vocalPresence: 38,
      midProjection: 42,
      mix: 8.5,
      stereoMid: 0,
      mode: "clean",
    },
    width: {
      enabled: false,
      mix: 0,
      width: 100,
      lowWidth: 100,
      lowMidWidth: 100,
      midWidth: 100,
      highWidth: 108,
      monoBass: true,
      monoBassFreq: 145,
      sideTone: 0,
    },
    output: { outputGain: 0, limiterDrive: 0.05, limiterCeiling: -1.3 },
  }),
  p({
    id: "night-listening",
    name: "Night Listening",
    description: "Soft, warm sleep-friendly comfort: rounded presence, relaxed highs.",
    eq: [
      { ...DEFAULT_EQ_BANDS[0], frequency: 42, slope: 12 },
      { ...DEFAULT_EQ_BANDS[1], frequency: 98, gain: -1.15 },
      { ...DEFAULT_EQ_BANDS[2], frequency: 360, gain: -0.55, q: 0.82 },
      { ...DEFAULT_EQ_BANDS[3], frequency: 1500, gain: 0.22, q: 0.75 },
      { ...DEFAULT_EQ_BANDS[4], frequency: 4800, gain: -1.25, q: 0.8 },
      { ...DEFAULT_EQ_BANDS[5], frequency: 8200, gain: -2.55 },
    ],
    compressor: {
      threshold: -33,
      ratio: 2.65,
      knee: 24,
      attack: 0.026,
      release: 0.42,
      makeupGain: 1.0,
      parallelMix: 72,
    },
    color: {
      drive: 0.62,
      bodyFreq: 155,
      body: 3.4,
      smartBass: 40,
      warmthFreq: 470,
      warmth: 9.2,
      harmonicsFreq: 1500,
      harmonics: 3,
      airFreq: 7800,
      air: -4.2,
      godParticles: 12,
      velvetTreble: 88,
      smartTrebleGuard: 68,
      aiHighRepair: 66,
      vocalTickle: 9,
      vocalPresence: 12,
      midProjection: 16,
      mix: 8.5,
      stereoMid: 0,
      mode: "warm",
    },
    width: {
      enabled: false,
      mix: 0,
      width: 96,
      lowWidth: 100,
      lowMidWidth: 96,
      midWidth: 92,
      highWidth: 98,
      sourceProtect: 100,
      monoBass: true,
      monoBassFreq: 120,
      sideTone: -1.4,
    },
    output: { outputGain: 0, limiterDrive: 0.04, limiterCeiling: -1.5 },
  }),
];

export const DEFAULT_SETTINGS: MasterSettings = FACTORY_PRESETS[0].settings;
