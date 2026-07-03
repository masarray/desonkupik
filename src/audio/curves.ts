// Waveshaper curves for the Color saturator and Limiter softclip.
// Evolved from the DeSonKuPik mastering engine, simplified into a small set of
// purpose-built curves for the 4-band parallel saturator topology.

const SAMPLES = 1024;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// WaveShaperNode.curve expects Float32Array<ArrayBuffer>; create via a fresh
// ArrayBuffer so TS does not widen to ArrayBufferLike.
function newCurve(): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(SAMPLES * 4));
}

export function makeSoftClipCurve(amount = 0.94): Float32Array<ArrayBuffer> {
  const curve = newCurve();
  const knee = clamp(amount, 0.72, 0.98);
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i / (SAMPLES - 1)) * 2 - 1;
    const ax = Math.abs(x);
    if (ax <= knee) {
      curve[i] = x;
    } else {
      const sign = x < 0 ? -1 : 1;
      const over = (ax - knee) / (1 - knee);
      const shaped = knee + ((1 - knee) * Math.tanh(over * 1.55)) / Math.tanh(1.55);
      curve[i] = sign * Math.min(0.995, shaped);
    }
  }
  return curve;
}

// Bass exciter: dry-biased low harmonics. The extension ECO/TURBO audit showed
// that fundamental/transient detail must stay dominant; this curve now supplies
// bass audibility and "glerr" harmonics without replacing the original low-end.
export function makeBassExciterCurve(
  driveDb: number,
  mode: "clean" | "warm" | "modern" | "mastering",
): Float32Array<ArrayBuffer> {
  const drive = Math.pow(10, clamp(driveDb, 0, 9) / 20);
  const warmth =
    mode === "warm" ? 0.115 : mode === "mastering" ? 0.05 : mode === "modern" ? 0.058 : 0.07;
  const hardness =
    mode === "mastering" ? 0.46 : mode === "modern" ? 0.5 : mode === "warm" ? 0.43 : 0.45;
  const norm = Math.tanh(drive * hardness + warmth) || 1;
  const curve = newCurve();
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i / (SAMPLES - 1)) * 2 - 1;
    const even = warmth * (x * x - 0.3333333);
    const shaped = Math.tanh((x * drive + even) * hardness) / norm;
    curve[i] = clamp(shaped * 0.46 + x * 0.54, -0.98, 0.98);
  }
  return curve;
}

// Warm/analog body: smoother, more linear, less low-mid masking than the older
// Saturn-style curve. It rounds density while letting consonants and attacks pass.
export function makeAnalogWarmCurve(
  driveDb: number,
  mode: "clean" | "warm" | "modern" | "mastering",
): Float32Array<ArrayBuffer> {
  const drive = Math.pow(10, clamp(driveDb, 0, 10) / 20);
  const even =
    mode === "warm" ? 0.105 : mode === "mastering" ? 0.06 : mode === "modern" ? 0.068 : 0.078;
  const third = mode === "mastering" ? 0.027 : mode === "modern" ? 0.035 : 0.022;
  const hardness =
    mode === "warm" ? 0.44 : mode === "mastering" ? 0.46 : mode === "modern" ? 0.5 : 0.4;
  const norm = Math.tanh(drive * hardness + even) || 1;
  const curve = newCurve();
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i / (SAMPLES - 1)) * 2 - 1;
    const analog = x * drive + even * (x * x - 0.3333333) + third * x * x * x;
    const shaped = Math.tanh(analog * hardness) / norm;
    curve[i] = clamp(shaped * 0.64 + x * 0.36, -0.97, 0.97);
  }
  return curve;
}

// Presence: dry-biased clarity harmonics. Too much odd-harmonic presence can
// sound brighter but paradoxically blur human-perceived detail; keep the dry
// 1–6 kHz texture as the anchor, then add just enough tactile sparkle.
export function makePresenceExciterCurve(
  driveDb: number,
  mode: "clean" | "warm" | "modern" | "mastering",
): Float32Array<ArrayBuffer> {
  const drive = Math.pow(10, clamp(driveDb, 0, 9) / 20);
  const hardness =
    mode === "mastering" ? 0.36 : mode === "modern" ? 0.4 : mode === "warm" ? 0.34 : 0.36;
  const even = mode === "warm" ? 0.046 : mode === "mastering" ? 0.034 : 0.03;
  const norm = Math.tanh(drive * hardness) || 1;
  const curve = newCurve();
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i / (SAMPLES - 1)) * 2 - 1;
    const shaped = Math.tanh((x * drive + even * (x * x - 0.3333333)) * hardness) / norm;
    curve[i] = clamp(shaped * 0.44 + x * 0.56, -0.965, 0.965);
  }
  return curve;
}

// Air: mostly linear silk with a tiny nonlinear shimmer. This keeps sparkle
// expensive and open without turning 6–12 kHz into synthetic fizz.
export function makeAirExciterCurve(
  driveDb: number,
  mode: "clean" | "warm" | "modern" | "mastering",
): Float32Array<ArrayBuffer> {
  const drive = Math.pow(10, clamp(driveDb, 0, 8) / 20);
  const hardness =
    mode === "mastering" ? 0.22 : mode === "modern" ? 0.24 : mode === "warm" ? 0.21 : 0.2;
  const even = mode === "mastering" ? 0.014 : mode === "modern" ? 0.012 : 0.017;
  const odd = mode === "mastering" ? 0.038 : mode === "modern" ? 0.044 : 0.034;
  const norm = Math.tanh(drive * hardness) || 1;
  const curve = newCurve();
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i / (SAMPLES - 1)) * 2 - 1;
    const soft = Math.tanh(x * drive * hardness) / norm;
    const shimmer = even * (x * x - 0.3333333) + odd * x * x * x;
    curve[i] = clamp(soft * 0.16 + x * 0.8 + shimmer, -0.92, 0.92);
  }
  return curve;
}

// Mid Anchor / Projection: mostly clean center support with a little even-harmonic
// sweetness. Used as a very small parallel layer, not as audible distortion.
export function makeMidAnchorCurve(
  driveDb = 2.5,
  mode: "clean" | "warm" | "modern" | "mastering" = "mastering",
): Float32Array<ArrayBuffer> {
  const drive = Math.pow(10, clamp(driveDb, 0, 6.2) / 20);
  const even =
    mode === "warm" ? 0.074 : mode === "mastering" ? 0.058 : mode === "modern" ? 0.052 : 0.04;
  const third = mode === "mastering" ? 0.015 : mode === "modern" ? 0.018 : 0.012;
  const hardness =
    mode === "mastering" ? 0.3 : mode === "modern" ? 0.32 : mode === "warm" ? 0.28 : 0.25;
  const norm = Math.tanh(drive * hardness + even) || 1;
  const curve = newCurve();
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i / (SAMPLES - 1)) * 2 - 1;
    const shaped =
      Math.tanh((x * drive + even * (x * x - 0.3333333) + third * x * x * x) * hardness) / norm;
    curve[i] = clamp(shaped * 0.32 + x * 0.68, -0.96, 0.96);
  }
  return curve;
}
