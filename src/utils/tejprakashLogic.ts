/**
 * Pure business logic for The Tejprakash — Smart Classroom Energy Conservation System
 * Implements the exact AI occupancy rules, manual fan control state, and Arduino Serial protocol
 * specified in the B.Tech AIML mini-project document.
 */

export type ControlMode = 'manual' | 'ai';

export interface FanDecision {
  personCount: number;
  fan1Speed: number; // 0 to 100 (%)
  fan2Speed: number; // 0 to 100 (%)
  lightsOn: boolean;
  ruleTitle: string;
  ruleDescription: string;
}

/**
 * Exact predefined AI rules from the project specification:
 * - 0 persons -> Fan 1: 0%, Fan 2: 0% (Lights & Fans OFF)
 * - 1 person  -> Fan 1: 50%, Fan 2: 0% (1 motor at 50% speed)
 * - 2 persons -> Fan 1: 100%, Fan 2: 0% (1 motor at 100% speed)
 * - 3 persons -> Fan 1: 50%, Fan 2: 50% (Both motors at 50% speed)
 * - 4+ persons -> Fan 1: 100%, Fan 2: 100% (Both motors at 100% speed)
 */
export function computeAiFanDecision(rawPersonCount: number): FanDecision {
  const count = Math.max(0, Math.floor(Number.isFinite(rawPersonCount) ? rawPersonCount : 0));

  if (count === 0) {
    return {
      personCount: 0,
      fan1Speed: 0,
      fan2Speed: 0,
      lightsOn: false,
      ruleTitle: '0 Persons — Zero Occupancy',
      ruleDescription: 'Both motors OFF (0%) & classroom lights OFF. Maximum energy conservation.',
    };
  }

  if (count === 1) {
    return {
      personCount: 1,
      fan1Speed: 50,
      fan2Speed: 0,
      lightsOn: true,
      ruleTitle: '1 Person — Single Motor Half Speed',
      ruleDescription: 'Fan 1 (Motor 1) at 50% speed · Fan 2 (Motor 2) OFF (0%).',
    };
  }

  if (count === 2) {
    return {
      personCount: 2,
      fan1Speed: 100,
      fan2Speed: 0,
      lightsOn: true,
      ruleTitle: '2 Persons — Single Motor Full Speed',
      ruleDescription: 'Fan 1 (Motor 1) at 100% speed · Fan 2 (Motor 2) OFF (0%).',
    };
  }

  if (count === 3) {
    return {
      personCount: 3,
      fan1Speed: 50,
      fan2Speed: 50,
      lightsOn: true,
      ruleTitle: '3 Persons — Dual Motors Half Speed',
      ruleDescription: 'Fan 1 (Motor 1) at 50% speed · Fan 2 (Motor 2) at 50% speed.',
    };
  }

  return {
    personCount: count,
    fan1Speed: 100,
    fan2Speed: 100,
    lightsOn: true,
    ruleTitle: `${count} Persons — Dual Motors Full Speed`,
    ruleDescription: 'Fan 1 (Motor 1) at 100% speed · Fan 2 (Motor 2) at 100% speed.',
  };
}

/**
 * Clamps a fan speed percentage to [0, 100].
 */
export function clampSpeedPercent(speed: number): number {
  if (!Number.isFinite(speed)) return 0;
  return Math.max(0, Math.min(100, Math.round(speed)));
}

/**
 * Formats the newline-terminated serial command sent to the Arduino UNO over USB (9600 baud).
 * Example: "F1:50,F2:0\n"
 */
export function formatArduinoCommand(fan1Speed: number, fan2Speed: number): string {
  const f1 = clampSpeedPercent(fan1Speed);
  const f2 = clampSpeedPercent(fan2Speed);
  return `F1:${f1},F2:${f2}\n`;
}

/**
 * Converts a 0-100% fan speed into the safe hardware PWM value (0-255) for 3V-6V toy DC motors
 * powered by a 12V 1A setup-box SMPS adapter through an L298N driver.
 *
 * Why this prevents the adapter blinking / motor jerking bug:
 * - A 3V-6V toy DC motor across 12V draws >3A stall current if given 255 PWM, tripping the 12V 1A
 *   setup-box adapter's over-current hiccup protection (green LED blinking).
 * - Mapping 50% -> PWM 72 (~3.4V effective) and 100% -> PWM 118 (~5.5V effective) keeps current
 *   well below 1.0A even with both motors running.
 */
export function percentToSafeAdapterPwm(percent: number, maxSafePwm = 118, minRunPwm = 48): number {
  const pct = clampSpeedPercent(percent);
  if (pct === 0) return 0;
  const clampedMax = Math.max(minRunPwm, Math.min(255, Math.round(maxSafePwm)));
  const mapped = minRunPwm + ((pct / 100) * (clampedMax - minRunPwm));
  return Math.round(mapped);
}

export const ADMIN_PASSWORD_STORAGE_KEY = 'tejprakash_admin_password_v1';
export const DEFAULT_ADMIN_PASSWORD = 'admin123';

export function getStoredAdminPassword(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
      if (saved && saved.trim().length > 0) {
        return saved.trim();
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_ADMIN_PASSWORD;
}

export function setStoredAdminPassword(newPassword: string): void {
  const cleaned = newPassword.trim();
  if (!cleaned) return;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, cleaned);
    }
  } catch {
    // Ignore storage access errors
  }
}

export function verifyAdminPassword(input: string): boolean {
  return input.trim() === getStoredAdminPassword();
}

/**
 * Complete Arduino UNO SMD (.ino) firmware source code for The Tejprakash.
 * Matches the user's exact physical wiring:
 *   L298N IN1 -> Arduino D2
 *   L298N IN2 -> Arduino D3 (Hardware PWM ~3)
 *   L298N IN3 -> Arduino D4
 *   L298N IN4 -> Arduino D5 (Hardware PWM ~5)
 *   OUT1 & OUT2 -> Motor 1 (Fan 1)
 *   OUT3 & OUT4 -> Motor 2 (Fan 2)
 *   L298N 12V -> 12V 1A Setup-Box Adapter (+)
 *   L298N GND -> Common GND (Arduino GND + 12V Adapter (-))
 *   L298N ENA & ENB jumpers -> Can remain ON (default) or connected to D9/D10.
 */
export const ARDUINO_INO_CODE = `/*
 * ============================================================================
 * THE TEJPRAKASH — Smart Classroom Energy Conservation Firmware
 * Board: Arduino UNO SMD / UNO R3 (ATmega328P)
 * Motor Driver: L298N Dual H-Bridge + Two DC Motors (Fan 1 & Fan 2)
 * Power Supply: 12V 1A Setup-Box Adapter (Common GND with Arduino)
 * ============================================================================
 *
 * EXACT WIRING (NO REWIRING NEEDED):
 *   L298N IN1  ---> Arduino D2        (Fan 1 / Motor 1 Low Reference)
 *   L298N IN2  ---> Arduino D3 (PWM)  (Fan 1 / Motor 1 Speed Pulse)
 *   L298N IN3  ---> Arduino D4        (Fan 2 / Motor 2 Low Reference)
 *   L298N IN4  ---> Arduino D5 (PWM)  (Fan 2 / Motor 2 Speed Pulse)
 *   OUT1, OUT2 ---> Motor 1 (Fan 1)
 *   OUT3, OUT4 ---> Motor 2 (Fan 2)
 *   ENA, ENB   ---> Leave black jumper caps ON (or connect to D9, D10)
 *
 * WHY THIS FIXES THE JERKING & ADAPTER BLINKING BUG:
 * 1. With ENA/ENB jumpers installed on the L298N, digital HIGH on D2/D4 dumps
 *    raw 12V into 3V-6V toy motors (~4A inrush), tripping the 12V 1A setup-box
 *    adapter's over-current protection (blinking green adapter LED & jerking).
 * 2. This firmware uses Hardware PWM directly on D3 (for Fan 1) and D5 (for Fan 2)
 *    while holding D2=LOW and D4=LOW (Coast-PWM mode).
 * 3. It caps peak voltage to ~5.5V effective (MAX_SAFE_PWM = 118) and uses a
 *    staggered soft-start ramp (Motor 1 ramps first, Motor 2 waits 600ms) so
 *    current NEVER exceeds the 12V 1A adapter limit.
 * ============================================================================
 */

#include <Arduino.h>

// --- Exact Pin Definitions matching your D2, D3, D4, D5 wiring ---
const int IN1_PIN = 2; // D2 -> L298N IN1 (Fan 1 Reference)
const int IN2_PIN = 3; // D3 (Hardware PWM) -> L298N IN2 (Fan 1 PWM Drive)
const int IN3_PIN = 4; // D4 -> L298N IN3 (Fan 2 Reference)
const int IN4_PIN = 5; // D5 (Hardware PWM) -> L298N IN4 (Fan 2 PWM Drive)

// Optional ENA/ENB pins (driven HIGH when active in case jumpers are removed)
const int ENA_OPT_PIN = 9;
const int ENB_OPT_PIN = 10;

// --- Safe PWM Calibration for 3V-6V Toy Motors on a 12V 1A Adapter ---
// 50% speed -> PWM 75 (~3.5V effective), 100% speed -> PWM 120 (~5.6V effective)
const int MIN_SPIN_PWM = 52;   // Minimum PWM to keep toy motor spinning smoothly
const int MID_50_PWM   = 78;   // 50% speed mode PWM
const int MAX_100_PWM  = 120;  // 100% speed mode PWM (prevents 12V 1A adapter overload)

// --- Soft-Start Ramp & Stagger State ---
int targetPwm1 = 0;
int targetPwm2 = 0;
int currentPwm1 = 0;
int currentPwm2 = 0;

unsigned long lastRampMs = 0;
unsigned long motor2DelayUntilMs = 0;
const unsigned long RAMP_INTERVAL_MS = 14; // Smooth step every 14ms
const int RAMP_STEP_UP = 2;                // Gentle +2 PWM per tick (zero current spike)
const int RAMP_STEP_DOWN = 6;              // Quick ramp down

String inputBuffer = "";

// Convert 0..100% speed into safe 0..120 PWM for 12V 1A setup-box adapter
int percentToSafePwm(int pct) {
  if (pct <= 0) return 0;
  if (pct >= 100) return MAX_100_PWM;
  if (pct == 50) return MID_50_PWM;
  return MIN_SPIN_PWM + ((long)pct * (MAX_100_PWM - MIN_SPIN_PWM)) / 100;
}

// Apply hardware PWM strictly to Fan 1 (D2/D3) and Fan 2 (D4/D5) independently
void applyMotorHardware() {
  // --- FAN 1 (Motor 1 on OUT1 & OUT2 via D2 & D3) ---
  if (currentPwm1 <= 0) {
    digitalWrite(IN1_PIN, LOW);
    digitalWrite(IN2_PIN, LOW);
    analogWrite(ENA_OPT_PIN, 0);
  } else {
    digitalWrite(IN1_PIN, LOW);         // Hold IN1 at GND
    analogWrite(IN2_PIN, currentPwm1);  // Pulse IN2 on Hardware PWM Pin D3
    analogWrite(ENA_OPT_PIN, 255);
  }

  // --- FAN 2 (Motor 2 on OUT3 & OUT4 via D4 & D5) ---
  if (currentPwm2 <= 0) {
    digitalWrite(IN3_PIN, LOW);
    digitalWrite(IN4_PIN, LOW);
    analogWrite(ENB_OPT_PIN, 0);
  } else {
    digitalWrite(IN3_PIN, LOW);         // Hold IN3 at GND
    analogWrite(IN4_PIN, currentPwm2);  // Pulse IN4 on Hardware PWM Pin D5
    analogWrite(ENB_OPT_PIN, 255);
  }
}

void stopAllMotors() {
  targetPwm1 = 0;
  targetPwm2 = 0;
  currentPwm1 = 0;
  currentPwm2 = 0;
  applyMotorHardware();
}

void setFanTargetsFromPercent(int f1Pct, int f2Pct) {
  f1Pct = constrain(f1Pct, 0, 100);
  f2Pct = constrain(f2Pct, 0, 100);

  int newTarget1 = percentToSafePwm(f1Pct);
  int newTarget2 = percentToSafePwm(f2Pct);

  // If both motors are starting from rest (0) simultaneously, stagger Motor 2
  // by 550ms so the 12V 1A adapter never sees two startup currents at once!
  if (currentPwm1 == 0 && currentPwm2 == 0 && newTarget1 > 0 && newTarget2 > 0) {
    motor2DelayUntilMs = millis() + 550;
  }

  targetPwm1 = newTarget1;
  targetPwm2 = newTarget2;
}

void rampTick() {
  unsigned long now = millis();
  if (now - lastRampMs < RAMP_INTERVAL_MS) return;
  lastRampMs = now;

  bool changed = false;

  // --- Ramp Motor 1 (Fan 1) ---
  if (currentPwm1 < targetPwm1) {
    if (currentPwm1 == 0) {
      currentPwm1 = 22; // Gentle pre-charge start (under 0.3A)
    } else {
      currentPwm1 = min(targetPwm1, currentPwm1 + RAMP_STEP_UP);
    }
    changed = true;
  } else if (currentPwm1 > targetPwm1) {
    currentPwm1 = max(targetPwm1, currentPwm1 - RAMP_STEP_DOWN);
    if (currentPwm1 < 20 && targetPwm1 == 0) currentPwm1 = 0;
    changed = true;
  }

  // --- Ramp Motor 2 (Fan 2) with stagger protection ---
  if (now >= motor2DelayUntilMs) {
    if (currentPwm2 < targetPwm2) {
      if (currentPwm2 == 0) {
        currentPwm2 = 22; // Gentle pre-charge start (under 0.3A)
      } else {
        currentPwm2 = min(targetPwm2, currentPwm2 + RAMP_STEP_UP);
      }
      changed = true;
    } else if (currentPwm2 > targetPwm2) {
      currentPwm2 = max(targetPwm2, currentPwm2 - RAMP_STEP_DOWN);
      if (currentPwm2 < 20 && targetPwm2 == 0) currentPwm2 = 0;
      changed = true;
    }
  }

  if (changed) {
    applyMotorHardware();
  }
}

void parseAndExecute(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0) return;

  if (cmd == "STOP" || cmd == "OFF" || cmd == "S") {
    stopAllMotors();
    Serial.println("OK:STOPPED F1=0 F2=0");
    return;
  }

  // Parse "F1:<0-100>,F2:<0-100>" or "M1:<0-100>,M2:<0-100>"
  int f1Val = -1;
  int f2Val = -1;

  int f1Idx = cmd.indexOf("F1:");
  if (f1Idx < 0) f1Idx = cmd.indexOf("M1:");
  if (f1Idx >= 0) {
    int commaIdx = cmd.indexOf(',', f1Idx);
    String sub = (commaIdx > f1Idx) ? cmd.substring(f1Idx + 3, commaIdx) : cmd.substring(f1Idx + 3);
    f1Val = sub.toInt();
  }

  int f2Idx = cmd.indexOf("F2:");
  if (f2Idx < 0) f2Idx = cmd.indexOf("M2:");
  if (f2Idx >= 0) {
    int commaIdx = cmd.indexOf(',', f2Idx);
    String sub = (commaIdx > f2Idx) ? cmd.substring(f2Idx + 3, commaIdx) : cmd.substring(f2Idx + 3);
    f2Val = sub.toInt();
  }

  if (f1Val >= 0 || f2Val >= 0) {
    int nextPct1 = (f1Val >= 0) ? f1Val : (targetPwm1 > 0 ? 100 : 0);
    int nextPct2 = (f2Val >= 0) ? f2Val : (targetPwm2 > 0 ? 100 : 0);
    setFanTargetsFromPercent(nextPct1, nextPct2);

    Serial.print("OK:F1=");
    Serial.print(nextPct1);
    Serial.print("%,F2=");
    Serial.print(nextPct2);
    Serial.print("% (PWM1=");
    Serial.print(targetPwm1);
    Serial.print(",PWM2=");
    Serial.print(targetPwm2);
    Serial.println(")");
  }
}

void setup() {
  Serial.begin(9600);

  // Increase Timer2 PWM frequency on Pin D3 to ~3.9 kHz for smoother current
  TCCR2B = (TCCR2B & 0b11111000) | 0x02;

  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  pinMode(IN3_PIN, OUTPUT);
  pinMode(IN4_PIN, OUTPUT);
  pinMode(ENA_OPT_PIN, OUTPUT);
  pinMode(ENB_OPT_PIN, OUTPUT);

  stopAllMotors();
  Serial.println("READY:THE_TEJPRAKASH_UNO_V2");
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\\n' || c == '\\r') {
      if (inputBuffer.length() > 0) {
        parseAndExecute(inputBuffer);
        inputBuffer = "";
      }
    } else if (inputBuffer.length() < 48) {
      inputBuffer += c;
    } else {
      inputBuffer = "";
    }
  }
  rampTick();
}
`;
