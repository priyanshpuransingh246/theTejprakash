export interface NorvaScrollDerivedState {
  p: number;
  h: number;
  headlineTransform: string;
  headlineOpacity: number;
  processListOpacity: number;
  processListTranslateY: number;
  activeStepIndex: number; // 0 for Step 01, 1 for Step 02
  scrollCueOpacity: number;
  scrollCueUnderlineScale: number;
}

export function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export function easeInOutQuad(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Pure function of scroll progress p in [0, 1] computing all UI transforms and opacities
 * for the 3D isometric night-city glide view.
 */
export function computeNorvaScrollState(rawP: number): NorvaScrollDerivedState {
  const p = clamp01(rawP);

  // Headline block: h = easeInOutQuad(p / .38)
  // translateY(-34h vh) rotateX(62h deg) scale(1 - .12h) around bottom edge
  // Opacity falls from 1 to 0 between p .10 and .24
  const h = easeInOutQuad(p / 0.38);
  const tyVh = (-34 * h) || 0;
  const rxDeg = (62 * h) || 0;
  const sc = 1 - 0.12 * h;
  const headlineTransform = `translateY(${tyVh.toFixed(3)}vh) rotateX(${rxDeg.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
  const headlineOpacity = 1 - clamp01((p - 0.1) / (0.24 - 0.1));

  // Process list: rises 40px and fades in between p .08 and .24
  // Step 01 is active below p .62, and step 02 above it
  const listT = clamp01((p - 0.08) / (0.24 - 0.08));
  const processListOpacity = listT;
  const processListTranslateY = ((1 - listT) * 40) || 0;
  const activeStepIndex = p < 0.62 ? 0 : 1;

  // Scroll cue: underline drains over the first 10%, cue fades out between p .04 and .12
  const scrollCueUnderlineScale = 1 - clamp01(p / 0.1);
  const scrollCueOpacity = 1 - clamp01((p - 0.04) / (0.12 - 0.04));

  return {
    p,
    h,
    headlineTransform,
    headlineOpacity,
    processListOpacity,
    processListTranslateY,
    activeStepIndex,
    scrollCueOpacity,
    scrollCueUnderlineScale,
  };
}

/**
 * Computes recorder mode scroll progress p for a 6.5s timeline:
 * hold 0.55s (p=0), linear glide of 5.04s (p: 0 -> 1), then hold (p=1).
 */
export function computeRecorderProgress(timeSec: number): number {
  if (timeSec <= 0.55) return 0;
  const glideElapsed = timeSec - 0.55;
  if (glideElapsed >= 5.04) return 1;
  return clamp01(glideElapsed / 5.04);
}
