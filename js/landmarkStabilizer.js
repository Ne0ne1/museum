/**
 * Lightweight landmark EMA + lost-hand grace before GestureController.
 * Does not change gesture logic — only stabilizes / holds input frames.
 */

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function graceMs(v, fallback = 200) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function cloneHands(hands) {
  return hands.map((hand) =>
    hand.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z || 0,
    }))
  );
}

export class LandmarkStabilizer {
  /**
   * @param {{ landmarkSmoothing?: number, handLostGraceMs?: number }} [options]
   * landmarkSmoothing: EMA alpha; 1.0 = pass-through (filter off)
   */
  constructor(options = {}) {
    this.alpha = clamp01(options.landmarkSmoothing ?? 0.55);
    this.lostGraceMs = graceMs(options.handLostGraceMs, 200);

    /** @type {Array<Array<{x:number,y:number,z:number}>>|null} */
    this.smoothed = null;
    this.lastDetectAt = 0;
    this.lostSince = null;
    this.consecutiveLost = 0;
    this.usingGrace = false;
    /** Raw MediaPipe detection on last process() call */
    this.rawDetected = false;
  }

  applyConfig(options = {}) {
    if (options.landmarkSmoothing != null) {
      this.alpha = clamp01(options.landmarkSmoothing);
    }
    if (options.handLostGraceMs != null) {
      this.lostGraceMs = graceMs(options.handLostGraceMs, this.lostGraceMs);
    }
  }

  /**
   * @param {Array<Array<{x:number,y:number,z:number}>>|null} hands
   * @returns {Array<Array<{x:number,y:number,z:number}>>|null}
   */
  process(hands) {
    const now = performance.now();
    const has = Array.isArray(hands) && hands.length > 0;
    this.rawDetected = has;

    if (has) {
      this.consecutiveLost = 0;
      this.lostSince = null;
      this.usingGrace = false;
      this.lastDetectAt = now;
      this.smoothed = this._smooth(hands);
      return this.smoothed;
    }

    this.consecutiveLost += 1;

    if (this.smoothed == null) {
      this.usingGrace = false;
      return null;
    }

    if (this.lostSince == null) this.lostSince = now;
    const elapsed = now - this.lostSince;

    if (elapsed < this.lostGraceMs) {
      this.usingGrace = true;
      // Hold last valid smoothed landmarks — do not invent motion
      return this.smoothed;
    }

    // Grace expired: real loss → caller must reset GestureController
    this.smoothed = null;
    this.lostSince = null;
    this.usingGrace = false;
    return null;
  }

  getMetrics() {
    const now = performance.now();
    return {
      detected: this.rawDetected,
      holding: this.smoothed != null,
      usingGrace: this.usingGrace,
      consecutiveLost: this.consecutiveLost,
      lastDetectAt: this.lastDetectAt,
      lastDetectAgeMs: this.lastDetectAt ? Math.round(now - this.lastDetectAt) : null,
      landmarkSmoothing: this.alpha,
      handLostGraceMs: this.lostGraceMs,
    };
  }

  _smooth(hands) {
    const alpha = this.alpha;

    if (alpha >= 1) {
      return cloneHands(hands);
    }

    if (
      !this.smoothed ||
      this.smoothed.length !== hands.length ||
      this.smoothed[0]?.length !== hands[0]?.length
    ) {
      return cloneHands(hands);
    }

    for (let hi = 0; hi < hands.length; hi += 1) {
      const raw = hands[hi];
      const sm = this.smoothed[hi];
      if (!sm || sm.length !== raw.length) {
        this.smoothed[hi] = raw.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
        continue;
      }
      for (let i = 0; i < raw.length; i += 1) {
        const rz = raw[i].z || 0;
        sm[i].x += alpha * (raw[i].x - sm[i].x);
        sm[i].y += alpha * (raw[i].y - sm[i].y);
        sm[i].z += alpha * (rz - sm[i].z);
      }
    }

    return this.smoothed;
  }
}
