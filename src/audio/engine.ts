// Mastering audio graph. Builds the same processing chain as the
// DeSonKuPik mastering engine using BiquadFilters + DynamicsCompressor +
// WaveShaper + a source-protected multiband M/S width stage + softclip-and-limiter.
//
// The graph is built once for a given AudioContext (online or offline).
// Settings are applied via setParams() and can change in real time;
// where possible we use setTargetAtTime() for click-free updates.

import {
  BUTTERWORTH_Q,
  type ColorSettings,
  type CompressorSettings,
  type EqBand,
  type MasterSettings,
  type OutputSettings,
  type WidthSettings,
  dbToGain,
  isCutType,
  toWebAudioType,
} from "./presets";
import {
  makeAirExciterCurve,
  makeAnalogWarmCurve,
  makeBassExciterCurve,
  makeMidAnchorCurve,
  makePresenceExciterCurve,
  makeSoftClipCurve,
} from "./curves";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v: number) {
  return clamp(v, 0, 1);
}

interface EqGroup {
  nodes: BiquadFilterNode[];
}

// Gain Match A/B philosophy: processed playback should remain a little louder
// than the bypass reference. If peak safety prevents boosting the processed
// path, the dry bypass reference is trimmed instead so A/B never makes the
// original seem louder than the DeSonKuPik master.
const GAIN_MATCH_BYPASS_REFERENCE_TRIM_DB = -1.4;

export class MasterChain {
  readonly ctx: BaseAudioContext;
  readonly input: GainNode;
  readonly output: GainNode;

  private fileGain: GainNode;
  private inputGain: GainNode;
  private safetyHpf: BiquadFilterNode;
  private eqGroups: EqGroup[] = [];
  private eqIn: GainNode;
  private eqOut: GainNode;

  // Compressor (parallel)
  private compIn: GainNode;
  private compDry: GainNode;
  private compWet: GainNode;
  private compOut: GainNode;
  private compressor: DynamicsCompressorNode;
  private makeup: GainNode;

  // Color (4-band parallel saturator)
  private colorIn: GainNode;
  private colorDry: GainNode;
  private colorOut: GainNode;
  private bassPre: BiquadFilterNode;
  private bassDrive: GainNode;
  private bassShaper: WaveShaperNode;
  private bassPostHpf: BiquadFilterNode;
  private bassPostLpf: BiquadFilterNode;
  private bassPunch: BiquadFilterNode;
  private bassWet: GainNode;
  private warmPre: BiquadFilterNode;
  private warmDrive: GainNode;
  private warmShaper: WaveShaperNode;
  private warmTone: BiquadFilterNode;
  private warmWet: GainNode;
  private presencePre: BiquadFilterNode;
  private presenceDrive: GainNode;
  private presenceShaper: WaveShaperNode;
  private presenceTone: BiquadFilterNode;
  private presenceWet: GainNode;
  private airPre: BiquadFilterNode;
  private airDrive: GainNode;
  private airShaper: WaveShaperNode;
  private airTone: BiquadFilterNode;
  private airWet: GainNode;

  // Center Mid Projection: small parallel mid-only body/focus support.
  private midProjectSplitter: ChannelSplitterNode;
  private midProjectL: GainNode;
  private midProjectR: GainNode;
  private midProjectBus: GainNode;
  private midProjectHighpass: BiquadFilterNode;
  private midProjectLowpass: BiquadFilterNode;
  private midProjectFocus: BiquadFilterNode;
  private midProjectNasalGuard: BiquadFilterNode;
  private midProjectShoutGuard: BiquadFilterNode;
  private midProjectDrive: GainNode;
  private midProjectShaper: WaveShaperNode;
  private midProjectWet: GainNode;
  private midProjectToL: GainNode;
  private midProjectToR: GainNode;
  private midProjectMerge: ChannelMergerNode;
  private midProjectBodyHighpass: BiquadFilterNode;
  private midProjectBodyLowpass: BiquadFilterNode;
  private midProjectBody: BiquadFilterNode;
  private midProjectBodyMudGuard: BiquadFilterNode;
  private midProjectBodyDrive: GainNode;
  private midProjectBodyShaper: WaveShaperNode;
  private midProjectBodyWet: GainNode;
  private midProjectBodyToL: GainNode;
  private midProjectBodyToR: GainNode;
  private midProjectBodyMerge: ChannelMergerNode;

  // Smart God Particles+: two tiny parallel micro-harmonic layers.
  // Side layer adds airy movement from real L-R information; Mid layer adds
  // coherent center sparkle so vocals remain forward instead of floating back.
  private godSplitter: ChannelSplitterNode;
  private godSideL: GainNode;
  private godSideR: GainNode;
  private godSideBus: GainNode;
  private godSideFocus: BiquadFilterNode;
  private godSideDrive: GainNode;
  private godSideShaper: WaveShaperNode;
  private godSideTone: BiquadFilterNode;
  private godSideWet: GainNode;
  private godSideToL: GainNode;
  private godSideToR: GainNode;
  private godSideMerge: ChannelMergerNode;
  private godMidL: GainNode;
  private godMidR: GainNode;
  private godMidBus: GainNode;
  private godMidHighpass: BiquadFilterNode;
  private godMidFocus: BiquadFilterNode;
  private godMidDrive: GainNode;
  private godMidShaper: WaveShaperNode;
  private godMidTone: BiquadFilterNode;
  private godMidWet: GainNode;
  private godMidToL: GainNode;
  private godMidToR: GainNode;
  private godMidMerge: ChannelMergerNode;

  private aiRepairDeHarsh: BiquadFilterNode;
  private aiRepairEdge: BiquadFilterNode;
  private aiRepairGlass: BiquadFilterNode;
  private aiRepairGrain: BiquadFilterNode;
  private aiRepairSplash: BiquadFilterNode;
  private aiRepairChirp: BiquadFilterNode;
  private aiRepairFizz: BiquadFilterNode;
  private aiRepairAirShelf: BiquadFilterNode;
  private colorVocalPresenceFocus: BiquadFilterNode;
  private colorVocalPresenceGuard: BiquadFilterNode;
  private colorPost: GainNode;
  private aiHighRepairIntent = 0;
  private smartBassIntent = 0;
  private vocalTickleIntent = 0;
  private vocalPresenceIntent = 0;
  private midProjectionIntent = 0;
  private godParticlesIntent = 0;
  private smartTrebleGuardIntent = 0;
  private vocalPresenceAnchorFreq = 2050;

  // Width (M/S)
  private widthIn: GainNode;
  private widthDryMix: GainNode;
  private widthWetMix: GainNode;
  private widthSplit: ChannelSplitterNode;
  private widthMerge: ChannelMergerNode;
  private widthMidL: GainNode;
  private widthMidR: GainNode;
  private widthSideL: GainNode;
  private widthSideR: GainNode;
  private widthMidGain: GainNode;
  private widthSideGain: GainNode;
  private widthSideLowShelf: BiquadFilterNode;
  private widthSideLowMidTone: BiquadFilterNode;
  private widthSideTone: BiquadFilterNode;
  private widthSideHi: BiquadFilterNode;
  private widthOutL: GainNode;
  private widthOutR: GainNode;
  private widthMonoLpf: BiquadFilterNode;
  private widthMonoMix: GainNode;
  private widthVocalBodyBand: BiquadFilterNode;
  private widthVocalBodyGain: GainNode;
  private widthVocalPresenceBand: BiquadFilterNode;
  private widthVocalPresenceGain: GainNode;
  private widthUpperBodyBand: BiquadFilterNode;
  private widthUpperBodyGain: GainNode;
  private widthVocalTickleBand: BiquadFilterNode;
  private widthVocalTickleGain: GainNode;
  private vocalCenterIntent = 0;
  private vocalBodyAnchorFreq = 490;

  // Limiter
  private limiterDrive: GainNode;
  private softClip: WaveShaperNode;
  private limiter: DynamicsCompressorNode;
  private gainMatchGain: GainNode;
  private outputGain: GainNode;

  // Meters
  readonly inputAnalyser: AnalyserNode;
  readonly outputAnalyser: AnalyserNode;
  readonly inAnalyserL: AnalyserNode;
  readonly inAnalyserR: AnalyserNode;
  readonly outAnalyserL: AnalyserNode;
  readonly outAnalyserR: AnalyserNode;
  private inSplitter: ChannelSplitterNode;
  private outSplitter: ChannelSplitterNode;
  private bypassGain: GainNode;
  readonly compInAnalyser: AnalyserNode;
  readonly compOutAnalyser: AnalyserNode;
  readonly limiterInAnalyser: AnalyserNode;
  readonly colorInAnalyser: AnalyserNode;
  readonly colorOutAnalyser: AnalyserNode;
  readonly widthInAnalyser: AnalyserNode;
  readonly widthOutAnalyser: AnalyserNode;
  readonly matchInAnalyserL: AnalyserNode;
  readonly matchInAnalyserR: AnalyserNode;
  readonly matchOutAnalyserL: AnalyserNode;
  readonly matchOutAnalyserR: AnalyserNode;
  private matchInSplitter: ChannelSplitterNode;
  private matchOutSplitter: ChannelSplitterNode;

  private currentSettings: MasterSettings | null = null;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.inputAnalyser = ctx.createAnalyser();
    // High-resolution analyser for the EQ spectrum. A larger FFT gives real
    // 20–60 Hz bin coverage instead of forcing fake flat low-end caps.
    this.inputAnalyser.fftSize = 16384;
    this.inputAnalyser.smoothingTimeConstant = 0.76;
    this.inputAnalyser.minDecibels = -112;
    this.inputAnalyser.maxDecibels = -8;
    this.outputAnalyser = ctx.createAnalyser();
    this.outputAnalyser.fftSize = 16384;
    this.outputAnalyser.smoothingTimeConstant = 0.76;
    this.outputAnalyser.minDecibels = -112;
    this.outputAnalyser.maxDecibels = -8;

    // Per-channel level meters (input + output, L/R).
    this.inAnalyserL = ctx.createAnalyser();
    this.inAnalyserR = ctx.createAnalyser();
    this.outAnalyserL = ctx.createAnalyser();
    this.outAnalyserR = ctx.createAnalyser();
    for (const a of [this.inAnalyserL, this.inAnalyserR, this.outAnalyserL, this.outAnalyserR]) {
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0.82;
    }
    this.inSplitter = ctx.createChannelSplitter(2);
    this.outSplitter = ctx.createChannelSplitter(2);
    // Dry bypass branch (raw input → output, mixed in only when bypassed).
    this.bypassGain = ctx.createGain();
    this.bypassGain.gain.value = 0;
    // Compressor pre/post level taps for the Pro-C-style display.
    this.compInAnalyser = ctx.createAnalyser();
    this.compOutAnalyser = ctx.createAnalyser();
    this.limiterInAnalyser = ctx.createAnalyser();
    this.colorInAnalyser = ctx.createAnalyser();
    this.colorOutAnalyser = ctx.createAnalyser();
    this.widthInAnalyser = ctx.createAnalyser();
    this.widthOutAnalyser = ctx.createAnalyser();
    this.matchInAnalyserL = ctx.createAnalyser();
    this.matchInAnalyserR = ctx.createAnalyser();
    this.matchOutAnalyserL = ctx.createAnalyser();
    this.matchOutAnalyserR = ctx.createAnalyser();
    this.matchInSplitter = ctx.createChannelSplitter(2);
    this.matchOutSplitter = ctx.createChannelSplitter(2);
    for (const a of [
      this.compInAnalyser,
      this.compOutAnalyser,
      this.limiterInAnalyser,
      this.colorInAnalyser,
      this.colorOutAnalyser,
      this.widthInAnalyser,
      this.widthOutAnalyser,
    ]) {
      // Same high-resolution FFT as the EQ analyser so the post/before spectrum
      // looks calibrated and behaves identically on EQ, Color, and Width pages.
      a.fftSize = 16384;
      a.smoothingTimeConstant = 0.76;
      a.minDecibels = -112;
      a.maxDecibels = -8;
    }
    for (const a of [
      this.matchInAnalyserL,
      this.matchInAnalyserR,
      this.matchOutAnalyserL,
      this.matchOutAnalyserR,
    ]) {
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.88;
    }

    this.fileGain = ctx.createGain();
    this.inputGain = ctx.createGain();
    this.safetyHpf = ctx.createBiquadFilter();
    this.safetyHpf.type = "highpass";
    this.safetyHpf.frequency.value = 18;
    this.safetyHpf.Q.value = 0.707;

    this.eqIn = ctx.createGain();
    this.eqOut = ctx.createGain();

    this.compIn = ctx.createGain();
    this.compDry = ctx.createGain();
    this.compWet = ctx.createGain();
    this.compOut = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();

    this.colorIn = ctx.createGain();
    this.colorDry = ctx.createGain();
    this.colorOut = ctx.createGain();
    this.bassPre = ctx.createBiquadFilter();
    this.bassPre.type = "lowpass";
    this.bassDrive = ctx.createGain();
    this.bassShaper = ctx.createWaveShaper();
    this.bassShaper.oversample = "2x";
    this.bassPostHpf = ctx.createBiquadFilter();
    this.bassPostHpf.type = "highpass";
    this.bassPostLpf = ctx.createBiquadFilter();
    this.bassPostLpf.type = "lowpass";
    this.bassPunch = ctx.createBiquadFilter();
    this.bassPunch.type = "peaking";
    this.bassWet = ctx.createGain();
    this.warmPre = ctx.createBiquadFilter();
    this.warmPre.type = "bandpass";
    this.warmDrive = ctx.createGain();
    this.warmShaper = ctx.createWaveShaper();
    this.warmShaper.oversample = "2x";
    this.warmTone = ctx.createBiquadFilter();
    this.warmTone.type = "peaking";
    this.warmWet = ctx.createGain();
    this.presencePre = ctx.createBiquadFilter();
    this.presencePre.type = "bandpass";
    this.presenceDrive = ctx.createGain();
    this.presenceShaper = ctx.createWaveShaper();
    this.presenceShaper.oversample = "2x";
    this.presenceTone = ctx.createBiquadFilter();
    this.presenceTone.type = "peaking";
    this.presenceWet = ctx.createGain();
    this.airPre = ctx.createBiquadFilter();
    this.airPre.type = "highpass";
    this.airDrive = ctx.createGain();
    this.airShaper = ctx.createWaveShaper();
    this.airShaper.oversample = "2x";
    this.airTone = ctx.createBiquadFilter();
    this.airTone.type = "highshelf";
    this.airWet = ctx.createGain();

    this.midProjectSplitter = ctx.createChannelSplitter(2);
    this.midProjectL = ctx.createGain();
    this.midProjectR = ctx.createGain();
    this.midProjectBus = ctx.createGain();
    this.midProjectHighpass = ctx.createBiquadFilter();
    this.midProjectHighpass.type = "highpass";
    this.midProjectLowpass = ctx.createBiquadFilter();
    this.midProjectLowpass.type = "lowpass";
    this.midProjectFocus = ctx.createBiquadFilter();
    this.midProjectFocus.type = "peaking";
    this.midProjectNasalGuard = ctx.createBiquadFilter();
    this.midProjectNasalGuard.type = "peaking";
    this.midProjectShoutGuard = ctx.createBiquadFilter();
    this.midProjectShoutGuard.type = "peaking";
    this.midProjectDrive = ctx.createGain();
    this.midProjectShaper = ctx.createWaveShaper();
    this.midProjectShaper.oversample = "2x";
    this.midProjectWet = ctx.createGain();
    this.midProjectToL = ctx.createGain();
    this.midProjectToR = ctx.createGain();
    this.midProjectMerge = ctx.createChannelMerger(2);
    this.midProjectBodyHighpass = ctx.createBiquadFilter();
    this.midProjectBodyHighpass.type = "highpass";
    this.midProjectBodyLowpass = ctx.createBiquadFilter();
    this.midProjectBodyLowpass.type = "lowpass";
    this.midProjectBody = ctx.createBiquadFilter();
    this.midProjectBody.type = "peaking";
    this.midProjectBodyMudGuard = ctx.createBiquadFilter();
    this.midProjectBodyMudGuard.type = "peaking";
    this.midProjectBodyDrive = ctx.createGain();
    this.midProjectBodyShaper = ctx.createWaveShaper();
    this.midProjectBodyShaper.oversample = "2x";
    this.midProjectBodyWet = ctx.createGain();
    this.midProjectBodyToL = ctx.createGain();
    this.midProjectBodyToR = ctx.createGain();
    this.midProjectBodyMerge = ctx.createChannelMerger(2);

    this.godSplitter = ctx.createChannelSplitter(2);
    this.godSideL = ctx.createGain();
    this.godSideR = ctx.createGain();
    this.godSideBus = ctx.createGain();
    this.godSideFocus = ctx.createBiquadFilter();
    this.godSideFocus.type = "bandpass";
    this.godSideDrive = ctx.createGain();
    this.godSideShaper = ctx.createWaveShaper();
    this.godSideTone = ctx.createBiquadFilter();
    this.godSideTone.type = "highshelf";
    this.godSideWet = ctx.createGain();
    this.godSideToL = ctx.createGain();
    this.godSideToR = ctx.createGain();
    this.godSideMerge = ctx.createChannelMerger(2);
    this.godMidL = ctx.createGain();
    this.godMidR = ctx.createGain();
    this.godMidBus = ctx.createGain();
    this.godMidHighpass = ctx.createBiquadFilter();
    this.godMidHighpass.type = "highpass";
    this.godMidFocus = ctx.createBiquadFilter();
    this.godMidFocus.type = "bandpass";
    this.godMidDrive = ctx.createGain();
    this.godMidShaper = ctx.createWaveShaper();
    this.godMidTone = ctx.createBiquadFilter();
    this.godMidTone.type = "highshelf";
    this.godMidWet = ctx.createGain();
    this.godMidToL = ctx.createGain();
    this.godMidToR = ctx.createGain();
    this.godMidMerge = ctx.createChannelMerger(2);

    this.aiRepairDeHarsh = ctx.createBiquadFilter();
    this.aiRepairDeHarsh.type = "peaking";
    this.aiRepairEdge = ctx.createBiquadFilter();
    this.aiRepairEdge.type = "peaking";
    this.aiRepairGlass = ctx.createBiquadFilter();
    this.aiRepairGlass.type = "peaking";
    this.aiRepairGrain = ctx.createBiquadFilter();
    this.aiRepairGrain.type = "peaking";
    this.aiRepairSplash = ctx.createBiquadFilter();
    this.aiRepairSplash.type = "peaking";
    this.aiRepairChirp = ctx.createBiquadFilter();
    this.aiRepairChirp.type = "peaking";
    this.aiRepairFizz = ctx.createBiquadFilter();
    this.aiRepairFizz.type = "peaking";
    this.aiRepairAirShelf = ctx.createBiquadFilter();
    this.aiRepairAirShelf.type = "highshelf";
    this.colorVocalPresenceFocus = ctx.createBiquadFilter();
    this.colorVocalPresenceFocus.type = "peaking";
    this.colorVocalPresenceGuard = ctx.createBiquadFilter();
    this.colorVocalPresenceGuard.type = "peaking";
    this.colorPost = ctx.createGain();

    this.widthIn = ctx.createGain();
    this.widthDryMix = ctx.createGain();
    this.widthWetMix = ctx.createGain();
    this.widthSplit = ctx.createChannelSplitter(2);
    this.widthMerge = ctx.createChannelMerger(2);
    this.widthMidL = ctx.createGain();
    this.widthMidR = ctx.createGain();
    this.widthSideL = ctx.createGain();
    this.widthSideR = ctx.createGain();
    this.widthMidGain = ctx.createGain();
    this.widthSideGain = ctx.createGain();
    this.widthSideLowShelf = ctx.createBiquadFilter();
    this.widthSideLowShelf.type = "lowshelf";
    this.widthSideLowMidTone = ctx.createBiquadFilter();
    this.widthSideLowMidTone.type = "peaking";
    this.widthSideTone = ctx.createBiquadFilter();
    this.widthSideTone.type = "peaking";
    this.widthSideHi = ctx.createBiquadFilter();
    this.widthSideHi.type = "highshelf";
    this.widthOutL = ctx.createGain();
    this.widthOutR = ctx.createGain();
    this.widthMonoLpf = ctx.createBiquadFilter();
    this.widthMonoLpf.type = "lowpass";
    this.widthMonoMix = ctx.createGain();
    this.widthVocalBodyBand = ctx.createBiquadFilter();
    this.widthVocalBodyBand.type = "bandpass";
    this.widthVocalBodyGain = ctx.createGain();
    this.widthVocalPresenceBand = ctx.createBiquadFilter();
    this.widthVocalPresenceBand.type = "bandpass";
    this.widthVocalPresenceGain = ctx.createGain();
    this.widthUpperBodyBand = ctx.createBiquadFilter();
    this.widthUpperBodyBand.type = "bandpass";
    this.widthUpperBodyGain = ctx.createGain();
    this.widthVocalTickleBand = ctx.createBiquadFilter();
    this.widthVocalTickleBand.type = "bandpass";
    this.widthVocalTickleGain = ctx.createGain();

    this.limiterDrive = ctx.createGain();
    this.softClip = ctx.createWaveShaper();
    this.softClip.curve = makeSoftClipCurve(0.94);
    this.softClip.oversample = "2x";
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.ratio.value = 20;
    this.gainMatchGain = ctx.createGain();
    this.outputGain = ctx.createGain();
  }

  /** Build the audio graph. Call once after construction. */
  build(initial: MasterSettings) {
    this.currentSettings = initial;

    // Build EQ chain nodes based on initial settings (per-band slope decides node count).
    this.rebuildEq(initial.eq);

    // source input -> fileGain (Smart Headroom pre-gain) -> metering/bypass + manual inputGain -> FX chain.
    // FileGain is common to both bypassed and processed playback, so Smart Headroom
    // never makes bypass sound much louder than the active chain.
    this.input.connect(this.fileGain);
    this.fileGain.connect(this.inputAnalyser);
    this.inputAnalyser.connect(this.inputGain);
    this.inputGain.connect(this.matchInSplitter);
    this.matchInSplitter.connect(this.matchInAnalyserL, 0);
    this.matchInSplitter.connect(this.matchInAnalyserR, 1);
    this.inputGain.connect(this.safetyHpf);

    // Stereo input metering + dry bypass tap both read the staged file level,
    // before the manual Input fader and before FX.
    this.fileGain.connect(this.inSplitter);
    this.inSplitter.connect(this.inAnalyserL, 0);
    this.inSplitter.connect(this.inAnalyserR, 1);
    this.fileGain.connect(this.bypassGain);

    // EQ chain
    this.safetyHpf.connect(this.eqIn);
    this.connectEqChain();

    // Compressor (parallel)
    this.eqOut.connect(this.compIn);
    this.compIn.connect(this.compDry).connect(this.compOut);
    this.compIn
      .connect(this.compressor)
      .connect(this.makeup)
      .connect(this.compWet)
      .connect(this.compOut);
    // Level taps for the compressor display (pre and post the comp stage).
    this.compIn.connect(this.compInAnalyser);
    this.compOut.connect(this.compOutAnalyser);

    // Color (4-band parallel saturator)
    this.compOut.connect(this.colorIn);
    this.compOut.connect(this.colorInAnalyser);
    this.colorIn.connect(this.colorDry).connect(this.colorOut);

    this.colorIn
      .connect(this.bassPre)
      .connect(this.bassDrive)
      .connect(this.bassShaper)
      .connect(this.bassPostHpf)
      .connect(this.bassPostLpf)
      .connect(this.bassPunch)
      .connect(this.bassWet)
      .connect(this.colorOut);

    this.colorIn
      .connect(this.warmPre)
      .connect(this.warmDrive)
      .connect(this.warmShaper)
      .connect(this.warmTone)
      .connect(this.warmWet)
      .connect(this.colorOut);

    this.colorIn
      .connect(this.presencePre)
      .connect(this.presenceDrive)
      .connect(this.presenceShaper)
      .connect(this.presenceTone)
      .connect(this.presenceWet)
      .connect(this.colorOut);

    this.colorIn
      .connect(this.airPre)
      .connect(this.airDrive)
      .connect(this.airShaper)
      .connect(this.airTone)
      .connect(this.airWet)
      .connect(this.colorOut);

    // Mid Projection is center-only and parallel. It adds a tiny body/focus
    // memory from the real mid signal, so vocals/guitars/piano come forward
    // without widening artifacts or a raw 2 kHz EQ push.
    this.colorIn.connect(this.midProjectSplitter);
    this.midProjectL.gain.value = 0.5;
    this.midProjectR.gain.value = 0.5;
    this.midProjectSplitter.connect(this.midProjectL, 0);
    this.midProjectSplitter.connect(this.midProjectR, 1);
    this.midProjectL.connect(this.midProjectBus);
    this.midProjectR.connect(this.midProjectBus);

    this.midProjectBus
      .connect(this.midProjectHighpass)
      .connect(this.midProjectLowpass)
      .connect(this.midProjectFocus)
      .connect(this.midProjectNasalGuard)
      .connect(this.midProjectShoutGuard)
      .connect(this.midProjectDrive)
      .connect(this.midProjectShaper)
      .connect(this.midProjectWet);
    this.midProjectToL.gain.value = 1;
    this.midProjectToR.gain.value = 1;
    this.midProjectWet.connect(this.midProjectToL).connect(this.midProjectMerge, 0, 0);
    this.midProjectWet.connect(this.midProjectToR).connect(this.midProjectMerge, 0, 1);
    this.midProjectMerge.connect(this.colorOut);

    this.midProjectBus
      .connect(this.midProjectBodyHighpass)
      .connect(this.midProjectBodyLowpass)
      .connect(this.midProjectBody)
      .connect(this.midProjectBodyMudGuard)
      .connect(this.midProjectBodyDrive)
      .connect(this.midProjectBodyShaper)
      .connect(this.midProjectBodyWet);
    this.midProjectBodyToL.gain.value = 1;
    this.midProjectBodyToR.gain.value = 1;
    this.midProjectBodyWet.connect(this.midProjectBodyToL).connect(this.midProjectBodyMerge, 0, 0);
    this.midProjectBodyWet.connect(this.midProjectBodyToR).connect(this.midProjectBodyMerge, 0, 1);
    this.midProjectBodyMerge.connect(this.colorOut);

    // Smart God Particles+: ultra-small parallel micro-harmonics. It gives
    // audible "wow" sparkle without raw treble gain: real side air is returned
    // as +Side/-Side, while the mid layer returns equally to L/R so vocals stay
    // locked at center. Both layers are disabled by gain=0 when the control is off.
    this.colorIn.connect(this.godSplitter);
    this.godSideL.gain.value = 0.5;
    this.godSideR.gain.value = -0.5;
    this.godSplitter.connect(this.godSideL, 0);
    this.godSplitter.connect(this.godSideR, 1);
    this.godSideL.connect(this.godSideBus);
    this.godSideR.connect(this.godSideBus);
    this.godSideBus
      .connect(this.godSideFocus)
      .connect(this.godSideDrive)
      .connect(this.godSideShaper)
      .connect(this.godSideTone)
      .connect(this.godSideWet);
    this.godSideToL.gain.value = 1;
    this.godSideToR.gain.value = -1;
    this.godSideWet.connect(this.godSideToL).connect(this.godSideMerge, 0, 0);
    this.godSideWet.connect(this.godSideToR).connect(this.godSideMerge, 0, 1);
    this.godSideMerge.connect(this.colorOut);

    this.godMidL.gain.value = 0.5;
    this.godMidR.gain.value = 0.5;
    this.godSplitter.connect(this.godMidL, 0);
    this.godSplitter.connect(this.godMidR, 1);
    this.godMidL.connect(this.godMidBus);
    this.godMidR.connect(this.godMidBus);
    this.godMidBus
      .connect(this.godMidHighpass)
      .connect(this.godMidFocus)
      .connect(this.godMidDrive)
      .connect(this.godMidShaper)
      .connect(this.godMidTone)
      .connect(this.godMidWet);
    this.godMidToL.gain.value = 1;
    this.godMidToR.gain.value = 1;
    this.godMidWet.connect(this.godMidToL).connect(this.godMidMerge, 0, 0);
    this.godMidWet.connect(this.godMidToR).connect(this.godMidMerge, 0, 1);
    this.godMidMerge.connect(this.colorOut);

    // Segment-aware high repair sits after the parallel Color bus. It is mostly
    // transparent at low settings, but catches 5–18 kHz glass/chirp/fizz before
    // Width and Limiter so the master stays open without krisik.
    this.colorOut
      .connect(this.colorVocalPresenceFocus)
      .connect(this.colorVocalPresenceGuard)
      .connect(this.aiRepairDeHarsh)
      .connect(this.aiRepairEdge)
      .connect(this.aiRepairGlass)
      .connect(this.aiRepairGrain)
      .connect(this.aiRepairSplash)
      .connect(this.aiRepairChirp)
      .connect(this.aiRepairFizz)
      .connect(this.aiRepairAirShelf)
      .connect(this.colorPost);

    // Color output tap for Saturn-style live analyzer. It is a passive analyser only.
    this.colorPost.connect(this.colorOutAnalyser);

    // Width (M/S) – source-protected stereo widening.
    // Low stereo content is narrowed gently with a low-shelf on the side bus,
    // not hard-monoed, so intentional stereo kick/bass/drum interplay survives.
    this.colorPost.connect(this.widthInAnalyser);
    this.colorPost.connect(this.widthIn);
    this.colorPost.connect(this.widthDryMix);
    this.widthIn.connect(this.widthSplit);

    // L = (M + S) ; R = (M - S)
    // M = (L+R)*0.5  ;  S = (L-R)*0.5
    this.widthMidL.gain.value = 0.5;
    this.widthMidR.gain.value = 0.5;
    this.widthSideL.gain.value = 0.5;
    this.widthSideR.gain.value = -0.5;

    const midBus = this.ctx.createGain();
    const sideBus = this.ctx.createGain();
    this.widthSplit.connect(this.widthMidL, 0);
    this.widthSplit.connect(this.widthMidR, 1);
    this.widthMidL.connect(midBus);
    this.widthMidR.connect(midBus);
    this.widthSplit.connect(this.widthSideL, 0);
    this.widthSplit.connect(this.widthSideR, 1);
    this.widthSideL.connect(sideBus);
    this.widthSideR.connect(sideBus);

    midBus.connect(this.widthMidGain);
    // Mid-only vocal anchor: a tiny parallel center lift in the chest and
    // intelligibility zones keeps vocals round, forward, and locked to the
    // phantom center even when the side/high bands are widened.
    midBus
      .connect(this.widthVocalBodyBand)
      .connect(this.widthVocalBodyGain)
      .connect(this.widthMidGain);
    midBus
      .connect(this.widthVocalPresenceBand)
      .connect(this.widthVocalPresenceGain)
      .connect(this.widthMidGain);
    midBus
      .connect(this.widthUpperBodyBand)
      .connect(this.widthUpperBodyGain)
      .connect(this.widthMidGain);
    midBus
      .connect(this.widthVocalTickleBand)
      .connect(this.widthVocalTickleGain)
      .connect(this.widthMidGain);
    sideBus
      .connect(this.widthSideLowShelf)
      .connect(this.widthSideLowMidTone)
      .connect(this.widthSideTone)
      .connect(this.widthSideHi)
      .connect(this.widthSideGain);

    // back to L/R:  L = M + S ; R = M - S
    const lFromM = this.ctx.createGain();
    lFromM.gain.value = 1;
    const lFromS = this.ctx.createGain();
    lFromS.gain.value = 1;
    const rFromM = this.ctx.createGain();
    rFromM.gain.value = 1;
    const rFromS = this.ctx.createGain();
    rFromS.gain.value = -1;
    this.widthMidGain.connect(lFromM).connect(this.widthMerge, 0, 0);
    this.widthSideGain.connect(lFromS).connect(this.widthMerge, 0, 0);
    this.widthMidGain.connect(rFromM).connect(this.widthMerge, 0, 1);
    this.widthSideGain.connect(rFromS).connect(this.widthMerge, 0, 1);

    // Source-protected low-side narrowing is handled in applyWidth() by a
    // gentle low-shelf on the side bus, never by a forced mono collapse.

    // Limiter
    // Parallel Width Mix: dry center-safe signal + processed M/S width signal.
    // This lets users keep vocal focus while still adding stereo air.
    this.widthMerge.connect(this.widthWetMix);
    this.widthWetMix.connect(this.widthOutAnalyser);
    this.widthDryMix.connect(this.widthOutAnalyser);
    this.widthWetMix.connect(this.limiterInAnalyser);
    this.widthDryMix.connect(this.limiterInAnalyser);
    this.widthWetMix.connect(this.limiterDrive);
    this.widthDryMix.connect(this.limiterDrive);
    this.limiterDrive.connect(this.softClip).connect(this.limiter);
    // Gain-match output metering reads the processed signal before the
    // automatic compensation and manual output fader. This avoids feedback
    // in the smart match controller.
    this.limiter.connect(this.matchOutSplitter);
    this.matchOutSplitter.connect(this.matchOutAnalyserL, 0);
    this.matchOutSplitter.connect(this.matchOutAnalyserR, 1);
    this.limiter.connect(this.gainMatchGain).connect(this.outputGain);
    // Processed path and dry bypass path both feed the output analyser, so the
    // output meter always reflects what is actually audible.
    this.outputGain.connect(this.outputAnalyser);
    this.bypassGain.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.output);
    // Stereo output metering.
    this.output.connect(this.outSplitter);
    this.outSplitter.connect(this.outAnalyserL, 0);
    this.outSplitter.connect(this.outAnalyserR, 1);

    this.setParams(initial, 0);
  }

  /** Rebuild EQ chain when slope counts change. */
  private rebuildEq(bands: EqBand[]) {
    // Disconnect existing
    for (const g of this.eqGroups)
      for (const n of g.nodes)
        try {
          n.disconnect();
        } catch {}
    this.eqGroups = bands.map((band) => {
      const count = isCutType(band.type) ? (BUTTERWORTH_Q[band.slope]?.length ?? 1) : 1;
      const nodes: BiquadFilterNode[] = [];
      for (let i = 0; i < count; i++) {
        const f = this.ctx.createBiquadFilter();
        nodes.push(f);
      }
      return { nodes };
    });
  }

  private connectEqChain() {
    try {
      this.eqIn.disconnect();
    } catch {}
    let cursor: AudioNode = this.eqIn;
    for (const g of this.eqGroups) {
      for (const n of g.nodes) {
        try {
          n.disconnect();
        } catch {}
        cursor.connect(n);
        cursor = n;
      }
    }
    cursor.connect(this.eqOut);
  }

  /** Apply settings. ramp = seconds (use 0 during build, 0.02 for live tweaks). */
  setParams(s: MasterSettings, ramp = 0.02) {
    const now = this.ctx.currentTime;
    const prev = this.currentSettings;
    this.currentSettings = s;

    // Detect EQ band-count / slope changes – rebuild if needed.
    const needRebuild =
      !prev ||
      prev.eq.length !== s.eq.length ||
      prev.eq.some(
        (b, i) => b.slope !== s.eq[i]?.slope || b.type !== s.eq[i]?.type || b.id !== s.eq[i]?.id,
      );
    if (needRebuild) {
      this.rebuildEq(s.eq);
      this.connectEqChain();
    }

    // Source/input/output gains
    this.setParam(this.fileGain.gain, dbToGain(s.output.fileGain), now, ramp);
    this.setParam(this.inputGain.gain, dbToGain(s.output.inputGain), now, ramp);
    this.setParam(
      this.gainMatchGain.gain,
      s.output.bypass || !s.output.gainMatchEnabled ? 1 : dbToGain(s.output.gainMatchGain),
      now,
      ramp,
    );
    this.setParam(
      this.outputGain.gain,
      s.output.bypass ? 0 : dbToGain(s.output.outputGain),
      now,
      ramp,
    );
    const bypassReferenceGain =
      s.output.bypass && s.output.gainMatchEnabled
        ? dbToGain(GAIN_MATCH_BYPASS_REFERENCE_TRIM_DB)
        : s.output.bypass
          ? 1
          : 0;
    this.setParam(this.bypassGain.gain, bypassReferenceGain, now, ramp);

    // EQ
    const eqOn = s.eqEnabled !== false;
    s.eq.forEach((band, idx) => {
      const group = this.eqGroups[idx];
      if (!group) return;
      const qValues = isCutType(band.type)
        ? (BUTTERWORTH_Q[band.slope] ?? BUTTERWORTH_Q[12])
        : [band.q];
      const effectiveType: BiquadFilterType =
        !eqOn || !band.enabled ? "allpass" : toWebAudioType(band.type);
      group.nodes.forEach((node, i) => {
        node.type = effectiveType;
        this.setParam(node.frequency, band.frequency, now, ramp);
        this.setParam(node.gain, isCutType(band.type) ? 0 : band.gain, now, ramp);
        this.setParam(node.Q, qValues[i] ?? band.q, now, ramp);
      });
    });

    // Compressor (parallel equal-power)
    this.applyCompressor(s.compressor, now, ramp);

    // Color
    this.applyColor(s.color, now, ramp);

    // Width
    this.applyWidth(s.width, now, ramp);

    // Limiter
    this.applyLimiter(s.output, now, ramp);
  }

  private applyCompressor(c: CompressorSettings, now: number, ramp: number) {
    const enabled = c.enabled !== false;
    const mix = clamp01((c.parallelMix ?? 100) / 100) * (enabled ? 1 : 0);
    const dry = Math.cos((mix * Math.PI) / 2);
    const wet = Math.sin((mix * Math.PI) / 2);
    this.setParam(this.compDry.gain, dry, now, ramp);
    this.setParam(this.compWet.gain, wet, now, ramp);
    this.setParam(this.compressor.threshold, c.threshold, now, ramp);
    this.setParam(this.compressor.ratio, c.ratio, now, ramp);
    this.setParam(this.compressor.knee, c.knee, now, ramp);
    this.setParam(this.compressor.attack, c.attack, now, ramp);
    this.setParam(this.compressor.release, c.release, now, ramp);
    this.setParam(this.makeup.gain, dbToGain(c.makeupGain), now, ramp);
  }

  private applyColor(color: ColorSettings, now: number, ramp: number) {
    const enabled = color.enabled !== false;
    const mix = enabled ? clamp01((color.mix || 0) / 100) : 0;
    const bodyAmt = clamp((color.body || 0) / 24, -1, 1);
    const warmthAmt = clamp((color.warmth || 0) / 24, -1, 1);
    const airAmt = clamp((color.air || 0) / 48, -0.5, 1);
    const harm = clamp01((color.harmonics || 0) / 100);
    const smartBass = enabled ? clamp01((color.smartBass ?? 0) / 100) : 0;
    const godParticles = enabled ? clamp01((color.godParticles ?? 0) / 100) : 0;
    const velvetTreble = enabled ? clamp01((color.velvetTreble ?? 0) / 100) : 0;
    const smartTrebleGuard = enabled ? clamp01((color.smartTrebleGuard ?? 68) / 100) : 0;
    const family = color.engineFamily ?? "standard";
    const isSonKuHoreg = family === "sonkuhoreg";
    const isSonKuBattle = family === "sonkubattle";
    const isSonKuBalap = family === "sonkubalap";
    const isSonKuFamily = isSonKuHoreg || isSonKuBattle || isSonKuBalap;
    const horegIntent = isSonKuFamily ? smartBass : 0;
    const battleIntent = isSonKuBattle ? smartBass : isSonKuBalap ? smartBass * 0.72 : 0;
    const balapIntent = isSonKuBalap ? smartBass : 0;
    const highRepair = enabled ? clamp01((color.aiHighRepair ?? 0) / 100) : 0;
    const vocalTickle = enabled ? clamp01((color.vocalTickle ?? 0) / 100) : 0;
    const vocalPresence = enabled ? clamp01((color.vocalPresence ?? 0) / 100) : 0;
    const midProjection = enabled ? clamp01((color.midProjection ?? 0) / 100) : 0;
    const bodyCenter = clamp(color.bodyFreq ?? 170, 95, 260);
    const warmCenter = clamp(color.warmthFreq ?? 490, 300, 760);
    const harmonicCenter = clamp(color.harmonicsFreq ?? 2150, 1200, 3600);
    const airCenter = clamp(color.airFreq ?? 11800, 6500, 16000);
    const modeDrive =
      color.mode === "mastering"
        ? 0.96
        : color.mode === "modern"
          ? 0.92
          : color.mode === "warm"
            ? 0.84
            : 0.58;
    const driveDb = clamp(color.drive * 0.92 + color.harmonics * 0.034, 0, 12) * modeDrive;
    const vocalBodyProtect = clamp01(
      (Math.max(0, color.warmth) * 0.66 + Math.max(0, color.body) * 0.48) / 24,
    );
    const rawTreblePressure = clamp01(
      harm * 0.42 + Math.max(0, color.air) / 72 + godParticles * 0.13 + vocalPresence * 0.06,
    );
    // Smart Treble Guard: the SonKu/Festival presets carry big presence/air,
    // but this governor prevents God Particles and air excitation from becoming
    // overexcited, harsh, or tiring. It raises micro-repair and lowers wet air
    // rather than bluntly low-passing the master.
    const overExcitedTreble = clamp01(
      smartTrebleGuard *
        (rawTreblePressure * 0.6 + highRepair * 0.12 + (isSonKuFamily ? 0.08 : 0)) +
        velvetTreble * (rawTreblePressure * 0.08 + highRepair * 0.035),
    );
    const treblePressure = clamp01(rawTreblePressure + overExcitedTreble * 0.16);
    const vocalSafety = clamp(
      vocalBodyProtect * 0.15 +
        treblePressure * 0.075 +
        vocalTickle * 0.055 +
        vocalPresence * 0.065,
      0,
      0.26,
    );
    // Human-ear Detail Preserve. The extension ECO/TURBO audit showed that the
    // most enjoyable "detail" is often the original 1–6 kHz texture, not extra
    // saturation. When a preset stacks high Color/GodParticles/StereoMid, keep
    // the dry path slightly dominant and trim masking-prone harmonic wet layers.
    const harmonicStack = clamp01(
      Math.max(0, (color.mix ?? 0) - 24) * 0.026 +
        Math.max(0, (color.godParticles ?? 0) - 70) * 0.0125 +
        Math.max(0, (color.air ?? 0) - 34) * 0.012 +
        Math.max(0, (color.stereoMid ?? 0) - 54) * 0.011 +
        Math.max(0, (color.midProjection ?? 0) - 58) * 0.008 +
        Math.max(0, (color.harmonics ?? 0) - 32) * 0.006,
    );
    const midDetailWindow = clamp01(
      vocalTickle * 0.36 + vocalPresence * 0.34 + midProjection * 0.14 + harm * 0.08,
    );
    const harmonicMaskGuard = clamp01(
      harmonicStack * (0.58 + treblePressure * 0.22 + vocalBodyProtect * 0.14) -
        midDetailWindow * 0.12,
    );
    const dryDetailLift = enabled
      ? clamp(1 + mix * (0.048 + harmonicStack * 0.09 + midDetailWindow * 0.024), 0.99, 1.058)
      : 1;
    const wetDetailTrim = clamp(1 - harmonicMaskGuard * 0.12, 0.86, 1);
    const driveDetailTrim = clamp(1 - harmonicMaskGuard * 0.08, 0.9, 1);
    const bassSustainGuard = clamp01(
      Math.max(0, bodyAmt) * 0.35 + Math.max(0, warmthAmt) * 0.24 + treblePressure * 0.1,
    );
    // God Particles is a perceptual enhancement control, not a static treble boost.
    // It follows useful musical energy: bass transient/body, vocal 2K/tickle,
    // and stable air, then backs off when high-repair/treble-pressure implies artifacts.
    const godGuard = clamp01(
      highRepair * 0.34 + treblePressure * 0.18 + vocalSafety * 0.08 + overExcitedTreble * 0.34,
    );
    const godBass = clamp01(
      godParticles *
        smartBass *
        (0.54 + Math.max(0, bodyAmt) * 0.26 + harm * 0.08) *
        (1 - bassSustainGuard * 0.28),
    );
    const godMid = clamp01(
      godParticles *
        (0.44 + vocalPresence * 0.34 + vocalTickle * 0.26 + harm * 0.18 + godBass * 0.08) *
        (1 - godGuard * 0.32),
    );
    const godAir = clamp01(
      godParticles *
        (0.58 + Math.max(0, airAmt) * 0.34 + harm * 0.18 + vocalTickle * 0.08) *
        (1 - godGuard * 0.5),
    );
    this.vocalCenterIntent = enabled ? clamp01((color.stereoMid ?? 0) / 100) : 0;
    this.vocalBodyAnchorFreq = warmCenter;
    this.smartBassIntent = smartBass;
    this.aiHighRepairIntent = highRepair;
    this.godParticlesIntent = godParticles;
    this.smartTrebleGuardIntent = overExcitedTreble;
    this.vocalTickleIntent = vocalTickle;
    this.vocalPresenceIntent = vocalPresence;
    this.midProjectionIntent = midProjection;
    this.vocalPresenceAnchorFreq = clamp(1990 + vocalPresence * 150 + harm * 65, 1860, 2260);

    this.setParam(this.colorDry.gain, dryDetailLift, now, ramp);

    // Smart Bass v2 / SonKu family context. The extension v0.3.59 idea is
    // ported as a safe mastering version: bass gets perceived power from useful
    // 66–160 Hz torque and bass harmonics, while sub-pressure, sustain, mud and
    // limiter stress reduce wet/drive before it becomes slow, muddy, or tiring.
    const subPressure = clamp01(
      Math.max(0, bodyAmt) * 0.24 + smartBass * (isSonKuFamily ? 0.22 : 0.1) - balapIntent * 0.08,
    );
    const bassWarmthGuard = clamp01(
      Math.max(0, warmthAmt) * 0.28 + vocalBodyProtect * 0.18 + Math.max(0, bodyAmt) * 0.12,
    );
    const mudGuard = clamp01(
      Math.max(0, warmthAmt) * 0.18 + Math.max(0, bodyAmt) * 0.13 + (isSonKuFamily ? 0.06 : 0),
    );
    const limiterStressProxy = clamp01(
      Math.max(0, bodyAmt) * 0.16 +
        godParticles * 0.12 +
        Math.max(0, airAmt) * 0.1 +
        horegIntent * 0.08,
    );
    const bassTransientHint = clamp01(
      0.34 +
        Math.max(0, bodyAmt) * 0.22 +
        harm * 0.1 -
        bassSustainGuard * 0.16 +
        balapIntent * 0.08,
    );
    const perceivedBass = clamp01(
      godBass *
        (0.58 +
          bassTransientHint * 0.48 +
          horegIntent * 0.2 +
          battleIntent * 0.12 +
          balapIntent * 0.2) *
        (1 -
          bassSustainGuard * (isSonKuFamily ? 0.18 : 0.42) -
          subPressure * (isSonKuBalap ? 0.22 : 0.26)),
    );
    const sustainTrimScale = isSonKuBalap ? 0.58 : isSonKuBattle ? 0.44 : isSonKuHoreg ? 0.38 : 1;
    const fatigueTrim =
      smartBass *
      ((bassSustainGuard * 0.12 +
        subPressure * (isSonKuBalap ? 0.095 : isSonKuFamily ? 0.07 : 0.1)) *
        sustainTrimScale +
        limiterStressProxy * (isSonKuBalap ? 0.2 : isSonKuBattle ? 0.18 : 0.16));
    const warmthTrim =
      smartBass *
      (bassWarmthGuard * (isSonKuBalap ? 0.09 : isSonKuFamily ? 0.07 : 0.1) +
        mudGuard * (isSonKuBalap ? 0.075 : 0.06));
    const wetFactor = clamp(
      1 -
        fatigueTrim -
        warmthTrim +
        bassTransientHint * smartBass * (0.03 + battleIntent * 0.025 + balapIntent * 0.03) +
        horegIntent * (bassSustainGuard * 0.12 + (1 - subPressure) * 0.08) +
        battleIntent * 0.035 +
        balapIntent * (0.028 + bassTransientHint * 0.035) +
        perceivedBass * (isSonKuBalap ? 0.1 : isSonKuFamily ? 0.08 : 0.035),
      0.7,
      isSonKuBalap ? 1.2 : isSonKuBattle ? 1.26 : isSonKuHoreg ? 1.3 : 1.08,
    );
    const punchFactor = clamp(
      1 +
        smartBass *
          (bassTransientHint * (isSonKuFamily ? 0.16 : 0.11) - limiterStressProxy * 0.04) -
        bassWarmthGuard * smartBass * 0.035 +
        horegIntent * 0.035 +
        battleIntent * (bassTransientHint * 0.075 + 0.018) +
        balapIntent * (0.03 + bassTransientHint * 0.095) +
        perceivedBass * (isSonKuBalap ? 0.18 : isSonKuFamily ? 0.13 : 0.07),
      0.82,
      isSonKuBalap ? 1.3 : isSonKuBattle ? 1.27 : isSonKuHoreg ? 1.23 : 1.14,
    );
    const driveFactor = clamp(
      1 -
        smartBass *
          (bassSustainGuard * (isSonKuFamily ? 0.045 : 0.09) +
            limiterStressProxy * (isSonKuBalap ? 0.14 : isSonKuBattle ? 0.12 : 0.1) +
            subPressure * (isSonKuBalap ? 0.075 : 0.05)) +
        battleIntent * 0.018 +
        balapIntent * 0.01,
      0.82,
      isSonKuBalap ? 1.07 : isSonKuBattle ? 1.1 : isSonKuHoreg ? 1.08 : 1.04,
    );
    this.setParam(
      this.bassPre.frequency,
      clamp(
        bodyCenter * (1.22 + Math.max(0, bodyAmt) * 0.1) -
          bassSustainGuard * smartBass * (isSonKuBalap ? 8 : isSonKuFamily ? 18 : 8) +
          bassTransientHint * smartBass * 6 +
          perceivedBass * (isSonKuBalap ? 34 : isSonKuBattle ? 24 : isSonKuHoreg ? 18 : 10) +
          balapIntent * 10,
        isSonKuBalap ? 100 : isSonKuFamily ? 88 : 116,
        350,
      ),
      now,
      ramp * 1.6,
    );
    this.setParam(this.bassPre.Q, isSonKuFamily ? (isSonKuBalap ? 0.56 : 0.52) : 0.62, now, ramp);
    this.setParam(
      this.bassPostHpf.frequency,
      clamp(
        bodyCenter * 0.34 +
          Math.max(0, bodyAmt) * 8 +
          subPressure * smartBass * (isSonKuBalap ? 18 : isSonKuFamily ? 7 : 10) +
          balapIntent * 12,
        isSonKuBalap ? 41 : isSonKuFamily ? 30 : 42,
        isSonKuBalap ? 104 : isSonKuFamily ? 86 : 104,
      ),
      now,
      ramp * 1.6,
    );
    this.setParam(
      this.bassPostLpf.frequency,
      clamp(
        bodyCenter * 3.85 +
          harm * 120 +
          horegIntent * 135 +
          balapIntent * 90 -
          bassSustainGuard * smartBass * 36,
        430,
        isSonKuBalap ? 1220 : isSonKuFamily ? 1080 : 900,
      ),
      now,
      ramp * 1.6,
    );
    this.setParam(
      this.bassPunch.frequency,
      clamp(
        bodyCenter * 0.66 +
          Math.max(0, bodyAmt) * 36 -
          horegIntent * 14 +
          balapIntent * 28 +
          perceivedBass * (isSonKuBalap ? 28 : isSonKuFamily ? 18 : 20),
        isSonKuBalap ? 76 : isSonKuFamily ? 66 : 92,
        225,
      ),
      now,
      ramp * 1.6,
    );
    this.setParam(this.bassPunch.Q, isSonKuFamily ? 0.62 : 0.72, now, ramp);
    this.setParam(
      this.bassPunch.gain,
      clamp(
        (0.35 +
          Math.max(0, color.body) * 0.145 +
          harm * 0.42 +
          smartBass * bassTransientHint * 0.38) *
          punchFactor +
          perceivedBass * (isSonKuBalap ? 1.55 : isSonKuBattle ? 1.28 : isSonKuHoreg ? 1.15 : 0.72),
        0.18,
        isSonKuBalap ? 6.25 : isSonKuFamily ? 6.5 : 5.6,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.bassDrive.gain,
      dbToGain((driveDb * 0.36 + Math.max(0, color.body) * 0.026) * driveFactor * driveDetailTrim),
      now,
      ramp,
    );
    this.setParam(
      this.bassWet.gain,
      clamp(
        mix *
          (0.18 + Math.max(0, bodyAmt) * 0.34 + harm * 0.08 + godBass * 0.055) *
          wetFactor *
          (1 - vocalSafety * 0.54) *
          wetDetailTrim,
        0,
        vocalSafety > 0.24
          ? 0.11
          : isSonKuBalap
            ? 0.435
            : isSonKuBattle
              ? 0.455
              : isSonKuHoreg
                ? 0.465
                : 0.325,
      ),
      now,
      ramp,
    );
    this.bassShaper.curve = makeBassExciterCurve(
      (driveDb * 0.44 + Math.max(0, color.body) * 0.03) * driveFactor * driveDetailTrim,
      color.mode,
    );

    // Vocal/piano body density around 490 Hz. This is broad and parallel, so it
    // makes vocals feel closer without creating boxy 300–600 Hz resonance.
    this.setParam(this.warmPre.frequency, warmCenter - Math.max(0, warmthAmt) * 18, now, ramp);
    this.setParam(this.warmPre.Q, 0.72 + vocalBodyProtect * 0.12, now, ramp);
    this.setParam(
      this.warmDrive.gain,
      dbToGain(
        (driveDb * 0.31 + Math.max(0, color.warmth) * 0.021 + vocalBodyProtect * 0.32) *
          driveDetailTrim,
      ),
      now,
      ramp,
    );
    this.setParam(this.warmTone.frequency, warmCenter + Math.max(0, warmthAmt) * 26, now, ramp);
    this.setParam(this.warmTone.Q, 0.84, now, ramp);
    this.setParam(
      this.warmTone.gain,
      color.warmth * 0.082 +
        Math.max(0, color.body) * 0.026 +
        harm * 0.18 +
        vocalBodyProtect * 0.58,
      now,
      ramp,
    );
    this.setParam(
      this.warmWet.gain,
      mix *
        (0.24 + Math.max(0, warmthAmt) * 0.38 + vocalBodyProtect * 0.15 + harm * 0.06) *
        clamp(1 - harmonicMaskGuard * 0.16, 0.82, 1),
      now,
      ramp,
    );
    this.warmShaper.curve = makeAnalogWarmCurve(
      (driveDb * 0.32 + Math.max(0, color.warmth) * 0.024) * driveDetailTrim,
      color.mode,
    );

    // Presence and vocal tickle. Harmonics stays the main presence path, while
    // vocalTickle adds a tiny centered tactile lift around 1.1–1.2 kHz via the
    // Width mid anchor below. The Color presence path remains broader to avoid
    // telephone/nasal artifacts.
    const presenceBase =
      color.mode === "warm"
        ? harmonicCenter * 0.92
        : color.mode === "mastering"
          ? harmonicCenter * 0.98
          : color.mode === "clean"
            ? harmonicCenter * 1.06
            : harmonicCenter;
    this.setParam(
      this.presencePre.frequency,
      vocalPresence > 0.08
        ? clamp(1980 + vocalPresence * 120 + harm * 60 - vocalTickle * 18, 1780, 2320)
        : presenceBase + harm * 190 - vocalTickle * 80,
      now,
      ramp,
    );
    this.setParam(this.presencePre.Q, 0.56 + harm * 0.1 + vocalPresence * 0.05, now, ramp);
    this.setParam(
      this.presenceDrive.gain,
      dbToGain(
        (driveDb * 0.2 + harm * 0.36 + vocalTickle * 0.18 + vocalPresence * 0.24) * driveDetailTrim,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.presenceTone.frequency,
      harmonicCenter * 1.28 + Math.max(0, color.air) * 9 + vocalPresence * 70,
      now,
      ramp,
    );
    this.setParam(this.presenceTone.Q, 0.68, now, ramp);
    this.setParam(
      this.presenceTone.gain,
      0.34 + Math.max(0, color.air) * 0.0095 + harm * 0.24,
      now,
      ramp,
    );
    this.setParam(
      this.presenceWet.gain,
      mix *
        (0.09 +
          harm * 0.12 +
          Math.max(0, warmthAmt) * 0.035 +
          vocalTickle * 0.024 +
          vocalPresence * 0.032) *
        (1 - vocalSafety * 0.32) *
        clamp(1 + midDetailWindow * 0.04 - harmonicMaskGuard * 0.08, 0.88, 1.06),
      now,
      ramp,
    );
    this.presenceShaper.curve = makePresenceExciterCurve(
      (driveDb * 0.17 + harm * 0.28 + vocalTickle * 0.16 + vocalPresence * 0.22) * driveDetailTrim,
      color.mode,
    );

    // Smart 2 kHz Vocal Presence / Female Vocal Focus. This is not a raw 2 kHz
    // boost: a broad center-memory lift sits around 1.9–2.2 kHz, while a tiny
    // guard around 2.45–2.75 kHz prevents honk/megaphone fatigue.
    const vocalPresenceGuard = clamp01(
      vocalPresence * 0.52 + treblePressure * 0.18 + highRepair * 0.16,
    );
    this.setParam(this.colorVocalPresenceFocus.frequency, this.vocalPresenceAnchorFreq, now, ramp);
    this.setParam(
      this.colorVocalPresenceFocus.Q,
      0.46 + harm * 0.05 + vocalPresence * 0.05,
      now,
      ramp,
    );
    this.setParam(
      this.colorVocalPresenceFocus.gain,
      enabled
        ? clamp(
            vocalPresence * (1.82 + harm * 0.4 + vocalTickle * 0.22) - vocalPresenceGuard * 0.28,
            0,
            1.58,
          )
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.colorVocalPresenceGuard.frequency,
      clamp(2520 + vocalPresence * 120 + harm * 35, 2380, 2780),
      now,
      ramp,
    );
    this.setParam(this.colorVocalPresenceGuard.Q, 0.82 + vocalPresenceGuard * 0.28, now, ramp);
    this.setParam(
      this.colorVocalPresenceGuard.gain,
      enabled
        ? -clamp(
            vocalPresence * (0.42 + treblePressure * 0.18 + harm * 0.1) + highRepair * 0.06,
            0,
            0.82,
          )
        : 0,
      now,
      ramp,
    );

    // DeSonKuPik Mid Projection. This ports the ArSonKuPik mid-projection idea
    // into the web mastering graph, but tuned smaller for repeated listening:
    // body and focus are split into two parallel mid-only branches so the 380–470 Hz
    // body is not killed by the focus high-pass.
    const projectionIntent = clamp01(
      midProjection * 0.58 +
        this.vocalCenterIntent * 0.24 +
        vocalPresence * 0.19 +
        harm * 0.055 +
        (isSonKuFamily ? 0.035 : 0),
    );
    const projectionGuard = clamp01(
      treblePressure * 0.14 + vocalSafety * 0.12 + highRepair * 0.075,
    );
    const projectionFactor = clamp(1 - projectionGuard * 0.26, 0.72, 1.12);
    const bodyProjectionFactor = clamp(1 - mudGuard * 0.34 - bassWarmthGuard * 0.16, 0.62, 1.02);
    const midProjectBodyHz = clamp(
      380 + Math.max(0, bodyAmt) * 32 + projectionIntent * 22,
      330,
      470,
    );

    this.setParam(
      this.midProjectHighpass.frequency,
      clamp(760 + projectionIntent * 140 + Math.max(0, warmthAmt) * 20, 720, 1040),
      now,
      ramp * 1.4,
    );
    this.setParam(
      this.midProjectLowpass.frequency,
      clamp(3350 + projectionIntent * 520 - velvetTreble * 140, 3100, 4300),
      now,
      ramp * 1.4,
    );
    this.setParam(
      this.midProjectFocus.frequency,
      clamp(1780 + vocalPresence * 260 + projectionIntent * 210 + harm * 80, 1580, 2380),
      now,
      ramp * 1.4,
    );
    this.setParam(this.midProjectFocus.Q, 0.46 + projectionIntent * 0.06, now, ramp);
    this.setParam(
      this.midProjectFocus.gain,
      enabled
        ? clamp(
            projectionIntent * (1.64 + harm * 0.3 + vocalTickle * 0.16) - projectionGuard * 0.22,
            0,
            1.42,
          )
        : 0,
      now,
      ramp,
    );
    this.setParam(this.midProjectNasalGuard.frequency, 980, now, ramp * 1.4);
    this.setParam(this.midProjectNasalGuard.Q, 0.78, now, ramp);
    this.setParam(
      this.midProjectNasalGuard.gain,
      enabled ? -clamp(projectionIntent * (0.22 + Math.max(0, warmthAmt) * 0.1), 0, 0.56) : 0,
      now,
      ramp,
    );
    this.setParam(
      this.midProjectShoutGuard.frequency,
      clamp(3420 + projectionIntent * 240, 3200, 4200),
      now,
      ramp * 1.4,
    );
    this.setParam(this.midProjectShoutGuard.Q, 0.72, now, ramp);
    this.setParam(
      this.midProjectShoutGuard.gain,
      enabled
        ? -clamp(projectionIntent * (0.26 + treblePressure * 0.18) + highRepair * 0.06, 0, 0.68)
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.midProjectDrive.gain,
      dbToGain(
        (0.32 + driveDb * 0.12 + projectionIntent * 0.72) * projectionFactor * driveDetailTrim,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.midProjectWet.gain,
      enabled
        ? mix *
            clamp(
              projectionIntent *
                0.076 *
                (1 - projectionGuard * 0.36) *
                (1 - harmonicMaskGuard * 0.055),
              0,
              0.071,
            )
        : 0,
      now,
      ramp,
    );
    this.midProjectShaper.curve = makeMidAnchorCurve(
      (0.7 + driveDb * 0.1 + projectionIntent * 1.1) * driveDetailTrim,
      color.mode,
    );

    this.setParam(
      this.midProjectBodyHighpass.frequency,
      clamp(midProjectBodyHz - 130 + mudGuard * 12, 245, 335),
      now,
      ramp * 1.4,
    );
    this.setParam(
      this.midProjectBodyLowpass.frequency,
      clamp(midProjectBodyHz + 305 - mudGuard * 70, 610, 760),
      now,
      ramp * 1.4,
    );
    this.setParam(this.midProjectBody.frequency, midProjectBodyHz, now, ramp * 1.4);
    this.setParam(this.midProjectBody.Q, 0.6 + mudGuard * 0.1, now, ramp);
    this.setParam(
      this.midProjectBody.gain,
      enabled
        ? clamp(
            projectionIntent * (0.52 + Math.max(0, bodyAmt) * 0.45 + smartBass * 0.08) -
              mudGuard * 0.18,
            0,
            1.06,
          )
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.midProjectBodyMudGuard.frequency,
      clamp(500 + mudGuard * 80, 500, 690),
      now,
      ramp * 1.4,
    );
    this.setParam(this.midProjectBodyMudGuard.Q, 0.7 + mudGuard * 0.2, now, ramp);
    this.setParam(
      this.midProjectBodyMudGuard.gain,
      enabled
        ? -clamp(0.16 + mudGuard * 0.42 + projectionGuard * 0.12, 0, 0.66) * bodyProjectionFactor
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.midProjectBodyDrive.gain,
      dbToGain(
        (0.24 + driveDb * 0.09 + projectionIntent * 0.38) * bodyProjectionFactor * driveDetailTrim,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.midProjectBodyWet.gain,
      enabled
        ? mix *
            clamp(
              projectionIntent * 0.05 * bodyProjectionFactor * (1 - harmonicMaskGuard * 0.045),
              0,
              0.044,
            )
        : 0,
      now,
      ramp,
    );
    this.midProjectBodyShaper.curve = makeMidAnchorCurve(
      (0.58 + driveDb * 0.07 + projectionIntent * 0.72) * driveDetailTrim,
      color.mode,
    );

    // Air Sparkle Lift / global-grade air: v0.3.85-inspired mastering-safe top-end.
    // The synthetic air layer is pushed above the 6–12 kHz artifact zone, then
    // a small sweet-tickle recovery keeps vocal breath and snare skin alive when
    // velvet/high-repair guards are working.
    const airBase =
      color.mode === "warm"
        ? airCenter * 0.95
        : color.mode === "mastering"
          ? airCenter
          : color.mode === "clean"
            ? airCenter * 1.04
            : airCenter;
    const signatureExcite = clamp01(
      Math.max(0, color.air - 34) * 0.018 +
        Math.max(0, (color.godParticles ?? 0) - 70) * 0.012 +
        Math.max(0, (color.stereoMid ?? 0) - 52) * 0.01 +
        Math.max(0, (color.vocalTickle ?? 0) - 54) * 0.008,
    );
    // Treble Coherence Guard: the 6–10 kHz range should read as crisp musical
    // skin/detail, not as a wide phasey side layer. Keep this band mostly
    // center-coherent, recover musical edge when repair is active, and move the
    // stereo sheen above the sensitive 6–10 kHz zone.
    const trebleCoherence = clamp01(
      vocalTickle * 0.18 +
        vocalPresence * 0.16 +
        midProjection * 0.08 +
        godMid * 0.09 +
        signatureExcite * 0.08 -
        overExcitedTreble * 0.08 -
        highRepair * 0.05,
    );
    const sweetAirRecover = clamp(
      vocalTickle * 0.09 +
        vocalPresence * 0.055 +
        godAir * 0.09 +
        trebleCoherence * 0.15 -
        overExcitedTreble * 0.052 +
        signatureExcite * 0.11,
      0,
      0.24,
    );
    this.setParam(
      this.airPre.frequency,
      clamp(
        airBase - Math.max(0, airAmt) * 58 + velvetTreble * 720 + overExcitedTreble * 280,
        10400,
        17000,
      ),
      now,
      ramp,
    );
    this.setParam(this.airPre.Q, 0.34 + harm * 0.025 - velvetTreble * 0.04, now, ramp);
    this.setParam(
      this.airDrive.gain,
      dbToGain(
        (driveDb * 0.12 +
          harm * 0.42 +
          Math.max(0, airAmt) * 0.24 +
          sweetAirRecover * 0.44 +
          signatureExcite * 0.28) *
          (1 - velvetTreble * 0.14) *
          driveDetailTrim,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.airTone.frequency,
      clamp(airCenter + harm * 780 + velvetTreble * 980 + overExcitedTreble * 360, 12200, 18200),
      now,
      ramp,
    );
    this.setParam(
      this.airTone.gain,
      clamp(
        0.48 +
          Math.max(0, color.air) * 0.026 +
          harm * 0.25 +
          sweetAirRecover * 1.1 +
          signatureExcite * 0.34,
        0,
        2.35,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.airWet.gain,
      mix *
        Math.max(0, 0.104 + Math.max(0, airAmt) * 0.31 + harm * 0.105 + godAir * 0.07) *
        (1 -
          vocalSafety * 0.18 -
          overExcitedTreble * 0.16 -
          velvetTreble * 0.014 -
          harmonicMaskGuard * 0.075 +
          sweetAirRecover * 0.34 +
          signatureExcite * 0.1),
      now,
      ramp,
    );
    this.airShaper.curve = makeAirExciterCurve(
      (driveDb * 0.14 +
        harm * 0.5 +
        Math.max(0, airAmt) * 0.28 +
        sweetAirRecover * 0.36 +
        signatureExcite * 0.2) *
        (1 - velvetTreble * 0.1) *
        driveDetailTrim,
      color.mode,
    );

    // Smart God Particles+: controlled micro shimmer. Side layer adds movement
    // above the vocal core; Mid layer adds a tiny coherent center sparkle around
    // 2–4 kHz so lead vocals and piano attacks feel expensive without moving back.
    this.setParam(
      this.godSideFocus.frequency,
      clamp(airCenter * 1.04 + godAir * 1180 + overExcitedTreble * 480, 11800, 16600),
      now,
      ramp,
    );
    this.setParam(this.godSideFocus.Q, 0.46 + highRepair * 0.08 - velvetTreble * 0.035, now, ramp);
    this.setParam(
      this.godSideDrive.gain,
      dbToGain(
        (0.5 + driveDb * 0.15 + godAir * 1.26 + sweetAirRecover * 0.7 + signatureExcite * 0.48) *
          (1 - velvetTreble * 0.09) *
          driveDetailTrim,
      ),
      now,
      ramp,
    );
    this.setParam(
      this.godSideTone.frequency,
      clamp(airCenter * 1.22 + godAir * 2500 + velvetTreble * 620, 13600, 18200),
      now,
      ramp,
    );
    this.setParam(this.godSideTone.Q, 0.48, now, ramp);
    this.setParam(
      this.godSideTone.gain,
      enabled
        ? clamp(
            0.19 +
              godAir * 0.48 +
              sweetAirRecover * 1.1 +
              signatureExcite * 0.38 -
              godGuard * 0.13 -
              overExcitedTreble * 0.1,
            -0.1,
            1.18,
          )
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.godSideWet.gain,
      enabled
        ? mix *
            clamp(
              godAir *
                0.112 *
                (1 -
                  godGuard * 0.32 -
                  overExcitedTreble * 0.16 -
                  velvetTreble * 0.012 -
                  harmonicMaskGuard * 0.08 +
                  sweetAirRecover * 0.22 +
                  signatureExcite * 0.12),
              0,
              0.108,
            )
        : 0,
      now,
      ramp,
    );
    this.godSideShaper.curve = makeAirExciterCurve(
      (0.3 + godAir * 0.96 + highRepair * 0.24 + sweetAirRecover * 0.34 + signatureExcite * 0.24) *
        (1 - velvetTreble * 0.085) *
        driveDetailTrim,
      color.mode,
    );

    this.setParam(
      this.godMidHighpass.frequency,
      clamp(this.vocalPresenceAnchorFreq - 260 + godBass * 90, 1580, 2450),
      now,
      ramp,
    );
    this.setParam(this.godMidHighpass.Q, 0.707, now, ramp);
    this.setParam(
      this.godMidFocus.frequency,
      clamp(3000 + vocalPresence * 420 + vocalTickle * 240, 2200, 4700),
      now,
      ramp,
    );
    this.setParam(this.godMidFocus.Q, 0.42 + godMid * 0.18 + highRepair * 0.06, now, ramp);
    this.setParam(
      this.godMidDrive.gain,
      dbToGain((0.46 + driveDb * 0.14 + godMid * 1.34) * driveDetailTrim),
      now,
      ramp,
    );
    this.setParam(
      this.godMidTone.frequency,
      clamp(8600 + godAir * 3400 + godMid * 900, 7600, 15000),
      now,
      ramp,
    );
    this.setParam(this.godMidTone.Q, 0.56, now, ramp);
    this.setParam(
      this.godMidTone.gain,
      enabled
        ? clamp(
            0.18 + godAir * 0.28 + godMid * 0.48 + godBass * 0.07 - godGuard * 0.14,
            -0.04,
            0.96,
          )
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.godMidWet.gain,
      enabled
        ? mix *
            clamp(
              godMid *
                0.09 *
                (1 -
                  godGuard * 0.25 -
                  overExcitedTreble * 0.14 -
                  harmonicMaskGuard * 0.075 +
                  signatureExcite * 0.14),
              0,
              0.078,
            )
        : 0,
      now,
      ramp,
    );
    this.godMidShaper.curve = makePresenceExciterCurve(
      (0.28 + godMid * 0.82 + vocalPresence * 0.28 + signatureExcite * 0.18) * driveDetailTrim,
      color.mode,
    );

    // Segment-aware AI high repair. These gains are intentionally small and
    // distributed. The master stays bright, but 6.3–7 kHz glass/edge, 8–10 kHz
    // splash, 10–14 kHz chirp, and 14–18 kHz fizz are each restrained separately.
    const repair = clamp01(
      highRepair * (0.64 + treblePressure * 0.22) +
        overExcitedTreble * 0.34 +
        velvetTreble * (0.035 + treblePressure * 0.035),
    );
    // Repair must remove artifact, not blanket the musical edge. Preserve more
    // 5–8 kHz skin when the preset deliberately asks for vocal tickle/presence.
    const detailRepairPreserve = clamp01(
      harmonicStack * 0.22 +
        midDetailWindow * 0.34 +
        signatureExcite * 0.12 +
        trebleCoherence * 0.34,
    );
    this.setParam(this.aiRepairDeHarsh.frequency, 5600, now, ramp);
    this.setParam(this.aiRepairDeHarsh.Q, 0.95 + repair * 0.1, now, ramp);
    this.setParam(
      this.aiRepairDeHarsh.gain,
      -repair * 0.42 * (1 - detailRepairPreserve * 0.26),
      now,
      ramp,
    );
    this.setParam(this.aiRepairEdge.frequency, 6250, now, ramp);
    this.setParam(this.aiRepairEdge.Q, 1.36 + repair * 0.26, now, ramp);
    this.setParam(
      this.aiRepairEdge.gain,
      -repair * 0.48 * (1 - detailRepairPreserve * 0.3),
      now,
      ramp,
    );
    this.setParam(this.aiRepairGlass.frequency, 7050, now, ramp);
    this.setParam(this.aiRepairGlass.Q, 1.52 + repair * 0.3, now, ramp);
    this.setParam(
      this.aiRepairGlass.gain,
      -repair * 0.56 * (1 - detailRepairPreserve * 0.28),
      now,
      ramp,
    );
    this.setParam(this.aiRepairGrain.frequency, 7850, now, ramp);
    this.setParam(this.aiRepairGrain.Q, 1.18 + repair * 0.22, now, ramp);
    this.setParam(
      this.aiRepairGrain.gain,
      -repair * 0.44 * (1 - detailRepairPreserve * 0.32),
      now,
      ramp,
    );
    // 9 kHz silky smoothing: gently rounds splashy saturation/grain without
    // killing the 12 kHz+ air shelf. Signature-style presets get a tiny extra
    // polish here so sparkle stays expensive instead of brittle.
    const silkyNineK = clamp01(
      sweetAirRecover * 0.34 + signatureExcite * 0.18 + godAir * 0.06 - trebleCoherence * 0.08,
    );
    this.setParam(this.aiRepairSplash.frequency, 9000, now, ramp);
    this.setParam(this.aiRepairSplash.Q, 0.9 + repair * 0.18 + silkyNineK * 0.1, now, ramp);
    this.setParam(
      this.aiRepairSplash.gain,
      -repair * (0.58 + silkyNineK * 0.12) - silkyNineK * 0.045 + trebleCoherence * 0.055,
      now,
      ramp,
    );
    this.setParam(this.aiRepairChirp.frequency, 11600, now, ramp);
    this.setParam(this.aiRepairChirp.Q, 1.08 + repair * 0.26, now, ramp);
    this.setParam(this.aiRepairChirp.gain, -repair * 0.96, now, ramp);
    this.setParam(this.aiRepairFizz.frequency, 14800, now, ramp);
    this.setParam(this.aiRepairFizz.Q, 0.84 + repair * 0.16, now, ramp);
    this.setParam(this.aiRepairFizz.gain, -repair * 0.46, now, ramp);
    this.setParam(
      this.aiRepairAirShelf.frequency,
      clamp(13200 + sweetAirRecover * 2200, 12800, 16800),
      now,
      ramp,
    );
    this.setParam(this.aiRepairAirShelf.Q, 0.54, now, ramp);
    this.setParam(
      this.aiRepairAirShelf.gain,
      clamp(
        -repair * 0.045 + sweetAirRecover * 0.38 + godAir * 0.028 - overExcitedTreble * 0.018,
        -0.08,
        0.07,
      ),
      now,
      ramp,
    );
  }

  private applyWidth(w: WidthSettings, now: number, ramp: number) {
    const enabled = w.enabled !== false;
    const mix = enabled ? clamp01((w.mix ?? 100) / 100) : 0;
    this.setParam(this.widthDryMix.gain, 1 - mix, now, ramp);
    this.setParam(this.widthWetMix.gain, mix, now, ramp);

    const protect = clamp01((w.sourceProtect ?? 100) / 100);
    const protectFactor = 1 - protect * 0.62;
    const signatureWidthLift = clamp01(
      Math.max(0, (w.highWidth ?? 100) - 176) * 0.018 +
        Math.max(0, (w.width ?? 100) - 138) * 0.012 +
        Math.max(0, 70 - (w.sourceProtect ?? 100)) * 0.012 +
        Math.max(0, (w.sideTone ?? 0) - 3) * 0.08,
    );
    const treblePhaseGuard = clamp01(
      Math.max(0, (w.highWidth ?? 100) - 166) * 0.011 +
        Math.max(0, (w.sideTone ?? 0) - 2.1) * 0.08 +
        this.godParticlesIntent * 0.12 +
        this.smartTrebleGuardIntent * 0.28 -
        protect * 0.18,
    );
    const widthCurve = (value: number, maxDb: number) => {
      const delta = clamp((value - 100) / 100, -1, 1);
      return delta * maxDb * protectFactor;
    };

    // Vocal Anchor watches the user's Color → Stereo Mid intent and the amount
    // of side widening. Instead of collapsing the mix, it gently reinforces only
    // the MID bus around vocal body + presence while shaving a little side energy
    // in the same zones. Result: center vocal stays round/forward, not floating.
    const widthPush = clamp01((Math.max(w.width, w.highWidth ?? 100) - 100) / 48);
    const centerIntent = this.vocalCenterIntent;
    const vocalAnchor = enabled
      ? clamp01(
          centerIntent * 0.72 +
            protect * 0.12 +
            widthPush * 0.2 +
            this.godParticlesIntent * 0.07 +
            this.midProjectionIntent * 0.16,
        )
      : 0;
    const vocalSideTrimDb = vocalAnchor * 0.68;
    const vocalPresenceTrimDb =
      vocalAnchor * 0.54 +
      this.vocalTickleIntent * 0.18 +
      this.vocalPresenceIntent * 0.36 +
      this.midProjectionIntent * 0.18;

    // Source Protect keeps intentional stereo bass/kick/drum movement alive.
    // Even when monoBass is enabled, the low side is only gently narrowed; it is
    // not collapsed to mono unless the user explicitly pulls Low Width down.
    const smartMonoBassCutDb = w.monoBass ? 0.35 + (1 - protect) * 1.65 : 0;
    const globalWidth = enabled
      ? clamp(1 + ((w.width - 100) / 100) * (1 - protect * 0.36), 0, 2.05)
      : 1;

    this.setParam(this.widthMidGain.gain, 1, now, ramp);
    this.setParam(this.widthVocalBodyBand.frequency, this.vocalBodyAnchorFreq, now, ramp);
    this.setParam(this.widthVocalBodyBand.Q, 0.74, now, ramp);
    this.setParam(this.widthVocalPresenceBand.frequency, this.vocalPresenceAnchorFreq, now, ramp);
    this.setParam(this.widthVocalPresenceBand.Q, 0.88 + this.vocalPresenceIntent * 0.1, now, ramp);
    this.setParam(this.widthUpperBodyBand.frequency, 600, now, ramp);
    this.setParam(this.widthUpperBodyBand.Q, 0.82, now, ramp);
    this.setParam(this.widthVocalTickleBand.frequency, 1150, now, ramp);
    this.setParam(this.widthVocalTickleBand.Q, 0.98, now, ramp);
    this.setParam(
      this.widthVocalBodyGain.gain,
      enabled ? 0.026 + vocalAnchor * 0.068 + this.smartBassIntent * 0.01 : 0,
      now,
      ramp,
    );
    this.setParam(
      this.widthVocalPresenceGain.gain,
      enabled
        ? 0.014 +
            vocalAnchor * 0.036 +
            this.vocalTickleIntent * 0.01 +
            this.vocalPresenceIntent * 0.034
        : 0,
      now,
      ramp,
    );
    this.setParam(
      this.widthUpperBodyGain.gain,
      enabled ? 0.006 + vocalAnchor * 0.03 + this.smartBassIntent * 0.01 : 0,
      now,
      ramp,
    );
    this.setParam(
      this.widthVocalTickleGain.gain,
      enabled ? this.vocalTickleIntent * (0.03 + vocalAnchor * 0.04) : 0,
      now,
      ramp,
    );
    this.setParam(
      this.widthSideGain.gain,
      globalWidth * dbToGain(enabled ? (w.sideTone || 0) + signatureWidthLift * 0.32 : 0),
      now,
      ramp,
    );

    this.setParam(
      this.widthSideLowShelf.frequency,
      clamp(w.monoBassFreq || 150, 60, 250),
      now,
      ramp,
    );
    this.setParam(this.widthSideLowShelf.Q, 0.68, now, ramp);
    this.setParam(
      this.widthSideLowShelf.gain,
      enabled ? widthCurve(w.lowWidth ?? 100, 5.5) - smartMonoBassCutDb : 0,
      now,
      ramp,
    );

    this.setParam(this.widthSideLowMidTone.frequency, 490, now, ramp);
    this.setParam(this.widthSideLowMidTone.Q, 0.82, now, ramp);
    this.setParam(
      this.widthSideLowMidTone.gain,
      enabled ? widthCurve(w.lowMidWidth ?? 100, 3.6) - vocalSideTrimDb : 0,
      now,
      ramp,
    );

    this.setParam(
      this.widthSideTone.frequency,
      clamp(1850 + this.vocalPresenceIntent * 210, 1750, 2180),
      now,
      ramp,
    );
    this.setParam(this.widthSideTone.Q, 0.78, now, ramp);
    this.setParam(
      this.widthSideTone.gain,
      enabled ? widthCurve(w.midWidth ?? 100, 2.95) - vocalPresenceTrimDb : 0,
      now,
      ramp,
    );

    this.setParam(
      this.widthSideHi.frequency,
      clamp(8800 + signatureWidthLift * 1650 + this.godParticlesIntent * 620, 7600, 11800),
      now,
      ramp,
    );
    this.setParam(this.widthSideHi.Q, 0.48, now, ramp);
    this.setParam(
      this.widthSideHi.gain,
      enabled
        ? widthCurve(w.highWidth ?? 100, 5.7) +
            this.godParticlesIntent * 0.18 +
            this.vocalTickleIntent * 0.06 +
            signatureWidthLift * 0.28 -
            this.smartTrebleGuardIntent * 0.34 -
            treblePhaseGuard * 0.92
        : 0,
      now,
      ramp,
    );
  }

  private applyLimiter(o: OutputSettings, now: number, ramp: number) {
    const lim = o.limiterEnabled !== false;
    const styleKnee =
      o.limiterStyle === "safe"
        ? 5
        : o.limiterStyle === "transparent"
          ? 1.2
          : o.limiterStyle === "punchy"
            ? 0.4
            : 3;
    const transientLink = clamp01((o.transientLink ?? 75) / 100);
    const releaseLink = clamp01((o.releaseLink ?? 95) / 100);
    const baseAttackMs = Number.isFinite(o.limiterAttackMs)
      ? o.limiterAttackMs
      : o.punchProtect
        ? 4
        : 1.5;
    const baseReleaseMs = Number.isFinite(o.limiterReleaseMs)
      ? o.limiterReleaseMs
      : o.punchProtect
        ? 80
        : 55;
    const attackMs = o.punchProtect
      ? baseAttackMs * (1 + transientLink * 0.65)
      : baseAttackMs * (1 - transientLink * 0.35);
    const releaseMs = baseReleaseMs * (0.78 + releaseLink * 0.44);
    const guardDb = clamp(o.lookaheadMs || 0, 0, 20) * 0.0175;
    const safeCeiling =
      (o.truePeak ? Math.min(o.limiterCeiling, -1) : Math.min(o.limiterCeiling, -0.3)) - guardDb;

    this.softClip.oversample = o.oversampling >= 4 ? "4x" : o.oversampling >= 2 ? "2x" : "none";
    this.setParam(this.limiterDrive.gain, lim ? dbToGain(o.limiterDrive) : 1, now, ramp);
    this.setParam(this.limiter.threshold, lim ? safeCeiling : 0, now, ramp);
    this.setParam(this.limiter.knee, o.punchProtect || o.truePeak ? styleKnee : 0, now, ramp);
    this.setParam(this.limiter.attack, Math.max(0.0001, attackMs / 1000), now, ramp);
    this.setParam(this.limiter.release, Math.max(0.005, releaseMs / 1000), now, ramp);
  }

  private setParam(p: AudioParam, value: number, now: number, ramp: number) {
    if (!Number.isFinite(value)) return;
    if (ramp <= 0) {
      try {
        p.cancelScheduledValues(now);
      } catch {}
      p.value = value;
    } else {
      p.setTargetAtTime(value, now, ramp);
    }
  }

  /** Read current peak (0..1) from an analyser. */
  static peak(analyser: AnalyserNode, buf: Float32Array<ArrayBufferLike>): number {
    analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
    let m = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > m) m = a;
    }
    return m;
  }

  /** Read current RMS (0..1) from an analyser. */
  static rms(analyser: AnalyserNode, buf: Float32Array<ArrayBufferLike>): number {
    analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  /** Compute an instantaneous gain-reduction estimate from a DynamicsCompressorNode. */
  static reduction(node: DynamicsCompressorNode): number {
    // .reduction is in dB (negative when reducing)
    return Math.max(0, -node.reduction);
  }

  get compressorNode() {
    return this.compressor;
  }
  get limiterNode() {
    return this.limiter;
  }
}
