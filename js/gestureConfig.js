/**
 * Load museum gesture / kiosk thresholds from data/gesture-config.json
 */

const DEFAULTS = {
  idleMs: 90000,
  fistHoldMs: 2000,
  pinchThreshold: 0.34,
  pinchRelease: 0.48,
  pinchHoldMs: 520,
  pinchCooldownMs: 800,
  pinchMiddleMin: 0.48,
  fistCurlEnter: 0.55,
  fistCurlExit: 0.7,
  fistMinCurled: 3,
  fistHoldMsDefault: 1000,
  fistCooldownMs: 800,
  fistLostGraceMs: 450,
  dwellMs: 750,
  cursorSmoothing: 0.18,
  cursorDeadzonePx: 5,
  swipeMinPx: 32,
  swipeMaxMs: 900,
  swipeCooldownMs: 900,
  swipeAxisRatio: 1.1,
  palmSmoothing: 0.28,
  swipeScale: 1.35,
  nudgeReturnGuardMs: 1600,
  nudgeMinSpeedPxMs: 0.14,
  nudgeHorizontalAxisRatio: 1.5,
  nudgeConfirmFrames: 3,
  nudgeMinPx: 42,
  nudgeMaxCurledFingers: 1,
  nudgeMinAvgCurl: 0.58,
  nudgeMinFingerExt: 0.48,
  twohandDeadzonePx: 3,
  twohandFrames: 4,
  twohandSwipeMinPx: 40,
  twohandSwipeWindowMs: 420,
  twohandSwipeCooldownMs: 500,
  twohandSwipeMinSpeed: 0.22,
  twohandSettleMs: 480,
  twohandSettleSpeed: 0.12,
  twohandSettleMaxDrift: 28,
  twohandReturnGuardMs: 1600,
  cameraRetryAttempts: 8,
  cameraRetryDelayMs: 2500,
  // Camera selection: empty deviceId → label match → prefer USB/external over FaceTime
  cameraDeviceId: '',
  cameraLabelMatch: '',
  cameraPreferExternal: true,
  // MediaPipe Hands (Solutions) — kiosk defaults
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.65,
  minTrackingConfidence: 0.5,
  // Landmark EMA alpha: 1.0 = off; lower = smoother / more lag
  landmarkSmoothing: 0.55,
  // Hold last landmarks on brief MediaPipe dropouts before GestureController reset
  handLostGraceMs: 200,
};

let cached = null;

export async function loadGestureConfig() {
  if (cached) return cached;
  try {
    const res = await fetch('data/gesture-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    cached = { ...DEFAULTS, ...json };
  } catch (err) {
    console.warn('gesture-config.json:', err);
    cached = { ...DEFAULTS };
  }
  return cached;
}

export function getDefaultGestureConfig() {
  return { ...DEFAULTS };
}
