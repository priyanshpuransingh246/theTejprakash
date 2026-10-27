import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAiFanDecision,
  formatArduinoCommand,
  percentToSafeAdapterPwm,
  clampSpeedPercent,
} from './tejprakashLogic.ts';

describe('The Tejprakash — AI Occupancy & Hardware Logic', () => {
  it('follows exact DOCX rules for 0, 1, 2, 3, and 4+ persons', () => {
    // 0 persons -> both off
    const d0 = computeAiFanDecision(0);
    assert.equal(d0.fan1Speed, 0);
    assert.equal(d0.fan2Speed, 0);
    assert.equal(d0.lightsOn, false);

    // 1 person -> 1 motor at 50% speed
    const d1 = computeAiFanDecision(1);
    assert.equal(d1.fan1Speed, 50);
    assert.equal(d1.fan2Speed, 0);
    assert.equal(d1.lightsOn, true);

    // 2 persons -> 1 motor at 100% speed
    const d2 = computeAiFanDecision(2);
    assert.equal(d2.fan1Speed, 100);
    assert.equal(d2.fan2Speed, 0);
    assert.equal(d2.lightsOn, true);

    // 3 persons -> both motors at 50% speed
    const d3 = computeAiFanDecision(3);
    assert.equal(d3.fan1Speed, 50);
    assert.equal(d3.fan2Speed, 50);
    assert.equal(d3.lightsOn, true);

    // 4 persons -> both motors at 100% speed
    const d4 = computeAiFanDecision(4);
    assert.equal(d4.fan1Speed, 100);
    assert.equal(d4.fan2Speed, 100);
    assert.equal(d4.lightsOn, true);

    // 6 persons -> both motors at 100% speed
    const d6 = computeAiFanDecision(6);
    assert.equal(d6.fan1Speed, 100);
    assert.equal(d6.fan2Speed, 100);
  });

  it('formats independent Fan 1 and Fan 2 commands without cross-talk', () => {
    // Only Fan 1 ON
    assert.equal(formatArduinoCommand(100, 0), 'F1:100,F2:0\n');
    // Only Fan 2 ON
    assert.equal(formatArduinoCommand(0, 100), 'F1:0,F2:100\n');
    // Both ON at 50%
    assert.equal(formatArduinoCommand(50, 50), 'F1:50,F2:50\n');
    // Both OFF
    assert.equal(formatArduinoCommand(0, 0), 'F1:0,F2:0\n');
  });

  it('maps 0-100% to safe adapter PWM to prevent 12V 1A setup-box adapter overload', () => {
    assert.equal(percentToSafeAdapterPwm(0), 0);
    const pwm50 = percentToSafeAdapterPwm(50, 118, 48);
    const pwm100 = percentToSafeAdapterPwm(100, 118, 48);
    assert.ok(pwm50 >= 48 && pwm50 < pwm100);
    assert.equal(pwm100, 118);
    assert.equal(clampSpeedPercent(-20), 0);
    assert.equal(clampSpeedPercent(150), 100);
  });
});
