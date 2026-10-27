import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01,
  easeInOutQuad,
  computeNorvaScrollState,
  computeRecorderProgress,
} from './norvaScrollMath';

test('clamp01 and easeInOutQuad satisfy boundary conditions', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(1.5), 1);

  assert.equal(easeInOutQuad(0), 0);
  assert.equal(easeInOutQuad(0.5), 0.5);
  assert.equal(easeInOutQuad(1), 1);
});

test('computeNorvaScrollState at p=0 shows headline and scroll cue with process list hidden', () => {
  const s0 = computeNorvaScrollState(0);
  assert.equal(s0.p, 0);
  assert.equal(s0.h, 0);
  assert.equal(s0.headlineOpacity, 1);
  assert.equal(s0.processListOpacity, 0);
  assert.equal(s0.processListTranslateY, 40);
  assert.equal(s0.activeStepIndex, 0);
  assert.equal(s0.scrollCueOpacity, 1);
  assert.equal(s0.scrollCueUnderlineScale, 1);
});

test('computeNorvaScrollState transitions headline, scroll cue, and process list across p', () => {
  // At p=0.38, h=1, headlineOpacity=0, processListOpacity=1, step 01 active
  const sMid = computeNorvaScrollState(0.38);
  assert.equal(sMid.h, 1);
  assert.equal(sMid.headlineOpacity, 0);
  assert.equal(sMid.processListOpacity, 1);
  assert.equal(sMid.processListTranslateY, 0);
  assert.equal(sMid.activeStepIndex, 0);
  assert.equal(sMid.scrollCueOpacity, 0);
  assert.equal(sMid.scrollCueUnderlineScale, 0);

  // Above p=0.62, step 02 (index 1) is active
  const sEnd = computeNorvaScrollState(0.75);
  assert.equal(sEnd.activeStepIndex, 1);
  assert.equal(sEnd.processListOpacity, 1);
});

test('computeRecorderProgress holds 0.55s then glides linearly over 5.04s', () => {
  assert.equal(computeRecorderProgress(0.2), 0);
  assert.equal(computeRecorderProgress(0.55), 0);
  assert.ok(Math.abs(computeRecorderProgress(0.55 + 2.52) - 0.5) < 1e-6);
  assert.equal(computeRecorderProgress(0.55 + 5.04), 1);
  assert.equal(computeRecorderProgress(6.4), 1);
});
