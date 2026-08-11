// Конечный автомат жестов.
// Пороги подстраиваются через data/gesture-config.json (музейная камера/дистанция).

const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  MIDDLE_MCP: 9,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

const BUILTIN = {
  pinchThreshold: 0.34,
  pinchRelease: 0.48,
  pinchHoldMs: 520,
  pinchCooldownMs: 800,
  pinchMiddleMin: 0.5,
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
  // После взмаха: пока руки возвращаются — обратный жест глотаем
  twohandSettleMs: 480,
  twohandSettleSpeed: 0.12,
  twohandSettleMaxDrift: 28,
  twohandReturnGuardMs: 1600,
};

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

export class GestureController {
  /**
   * @param {(type: string, payload: any) => void} onEvent
   * @param {{ dwellEnabled?: boolean, config?: Record<string, number> }} [options]
   */
  constructor(onEvent, options = {}) {
    this.onEvent = onEvent;
    this.dwellEnabled = options.dwellEnabled !== false;
    this.cfg = { ...BUILTIN, ...(options.config || {}) };

    this.smoothX = null;
    this.smoothY = null;

    this.isPinching = false;
    this.pinchHoldStart = null;
    this.pinchConfirmed = false;
    this.pinchCooldownUntil = 0;

    this.fistHoldStart = null;
    this.fistFired = false;
    this.fistCooldownUntil = 0;
    this.fistLostSince = null;
    this.fistLatched = false;
    this.fistHoldMs = this.cfg.fistHoldMsDefault;

    this.smoothPalmX = null;
    this.smoothPalmY = null;
    this.swipeOriginX = null;
    this.swipeOriginY = null;
    this.swipeOriginAt = 0;
    this.swipeCooldownUntil = 0;
    this.lastPalmRawX = null;
    this.lastPalmRawY = null;
    this.lastNudgeDirX = 0;
    this.nudgeReturnGuardUntil = 0;

    this.nudgeLockedDirX = 0;
    this.nudgeConfirmCount = 0;
    this.prevSmoothPalmX = null;
    this.prevSmoothPalmY = null;
    this.nudgeDebug = {
      dx: 0,
      dy: 0,
      speed: 0,
      axis: '—',
      candidate: 0,
      confirm: 0,
      openPalm: false,
      triggered: false,
    };

    this.dwellEl = null;
    this.dwellStart = 0;
    this.dwellCooldownUntil = 0;

    this.lastTwoHandDist = null;
    this.twoHandFrames = 0;

    this.handA = null;
    this.handB = null;
    this.twoHandSwipeCooldownUntil = 0;
    this.twoHandArmed = true;
    this.twoHandStillSince = null;
    this.twoHandStillAnchor = null; // { cx, cy } центр ладоней в момент начала «покоя»
    this.twoHandPrev = null;
    this.lastSwipeDirX = 0;
    this.returnGuardUntil = 0;
  }

  /** Debug-only nudge metrics (?debug=1). */
  getNudgeDebugMetrics() {
    return { ...this.nudgeDebug };
  }

  _setNudgeDebug(partial) {
    Object.assign(this.nudgeDebug, partial);
    this.nudgeDebug.triggered = false;
  }

  _resetNudgeCandidate() {
    this.nudgeLockedDirX = 0;
    this.nudgeConfirmCount = 0;
  }

  _isOpenPalm(c, curledCount, avgCurl, curls, pinchingNow, isFistNow) {
    if (pinchingNow || isFistNow) return false;
    if (curledCount > (c.nudgeMaxCurledFingers ?? 1)) return false;
    if (avgCurl < (c.nudgeMinAvgCurl ?? 0.58)) return false;
    const minExt = c.nudgeMinFingerExt ?? 0.48;
    const extended = curls.filter((v) => v >= minExt).length;
    return extended >= 3;
  }

  /**
   * Горизонтальный nudge: speed + axis + open palm + multi-frame confirm + direction lock.
   * @returns {boolean} true if nudge fired
   */
  _tryHorizontalNudge(now, dx, dy, elapsed, absX, absY, c, openPalm) {
    const ratio = c.nudgeHorizontalAxisRatio ?? 1.5;
    const minPx = c.nudgeMinPx ?? 42;
    const minSpeed = c.nudgeMinSpeedPxMs ?? 0.14;
    const needFrames = Math.max(1, Math.round(c.nudgeConfirmFrames ?? 3));
    const speed = absX / Math.max(elapsed, 16);

    this._setNudgeDebug({
      dx: Math.round(dx),
      dy: Math.round(dy),
      speed: Math.round(speed * 1000) / 1000,
      openPalm,
      confirm: this.nudgeConfirmCount,
      candidate: this.nudgeLockedDirX,
    });

    if (!openPalm) {
      this._resetNudgeCandidate();
      this.nudgeDebug.axis = 'blocked';
      return false;
    }

    if (absX < absY * ratio) {
      this._resetNudgeCandidate();
      this.nudgeDebug.axis = absY > absX ? 'Y' : 'diag';
      return false;
    }

    this.nudgeDebug.axis = 'X';

    if (absX < minPx * 0.35) {
      this.nudgeDebug.candidate = this.nudgeLockedDirX;
      return false;
    }

    if (speed < minSpeed) {
      this._resetNudgeCandidate();
      return false;
    }

    const dirX = dx > 0 ? 1 : -1;

    if (this.prevSmoothPalmX != null) {
      const frameDx = this.smoothPalmX - this.prevSmoothPalmX;
      if (this.nudgeLockedDirX && frameDx * this.nudgeLockedDirX < -2.5) {
        this._resetNudgeCandidate();
        return false;
      }
    }

    if (this.nudgeLockedDirX === 0) {
      this.nudgeLockedDirX = dirX;
      this.nudgeConfirmCount = 1;
    } else if (dirX !== this.nudgeLockedDirX) {
      this._resetNudgeCandidate();
      return false;
    } else {
      this.nudgeConfirmCount += 1;
    }

    this.nudgeDebug.candidate = this.nudgeLockedDirX;
    this.nudgeDebug.confirm = this.nudgeConfirmCount;

    if (this.nudgeConfirmCount < needFrames || absX < minPx) {
      return false;
    }

    if (
      this.lastNudgeDirX &&
      dirX === -this.lastNudgeDirX &&
      now < this.nudgeReturnGuardUntil
    ) {
      this.swipeOriginX = this.smoothPalmX;
      this.swipeOriginY = this.smoothPalmY;
      this.swipeOriginAt = now;
      this.swipeCooldownUntil = now + Math.min(280, c.swipeCooldownMs);
      this._resetNudgeCandidate();
      return false;
    }

    this.lastNudgeDirX = dirX;
    this.nudgeReturnGuardUntil = now + (c.nudgeReturnGuardMs ?? 1600);
    this.onEvent('nudge', { dirX, dirY: 0 });
    this.nudgeDebug.triggered = true;
    this.swipeCooldownUntil = now + c.swipeCooldownMs;
    this.swipeOriginX = this.smoothPalmX;
    this.swipeOriginY = this.smoothPalmY;
    this.swipeOriginAt = now;
    this._resetNudgeCandidate();
    return true;
  }

  /** Подставить пороги из gesture-config.json (можно на лету). */
  applyConfig(config = {}) {
    this.cfg = { ...this.cfg, ...config };
    if (config.fistHoldMs != null) {
      this.setFistHoldMs(config.fistHoldMs);
    } else if (config.fistHoldMsDefault != null && this.fistHoldMs === BUILTIN.fistHoldMsDefault) {
      this.fistHoldMs = config.fistHoldMsDefault;
    }
  }

  /**
   * @param {Array<Array<{x,y,z}>>|null} handsInput
   */
  update(handsInput) {
    const hands = handsInput || [];
    const c = this.cfg;

    if (hands.length === 0) {
      if (this.smoothX !== null) this.onEvent('lost', {});
      this.smoothX = null;
      this.smoothY = null;
      this._resetPalmSwipe();
      this.lastTwoHandDist = null;
      this.twoHandFrames = 0;
      this._resetTwoHandSwipeTrack();
      this._rearmTwoHandSwipe(true);
      this._resetPinch();
      this._resetFist();
      this._resetDwell();
      return;
    }

    if (hands.length >= 2) {
      this.twoHandFrames += 1;
      if (this.twoHandFrames < c.twohandFrames || this.isPinching || this.fistHoldStart != null) {
        this._processOneHand(hands[0]);
        return;
      }

      this._resetPinch();
      this._resetFist();
      this._resetDwell();
      this._resetPalmSwipe();

      const now = performance.now();
      const c1 = hands[0][LM.MIDDLE_MCP];
      const c2 = hands[1][LM.MIDDLE_MCP];
      const x1 = (1 - c1.x) * window.innerWidth;
      const y1 = c1.y * window.innerHeight;
      const x2 = (1 - c2.x) * window.innerWidth;
      const y2 = c2.y * window.innerHeight;

      if (this._tryTwoHandSwipe(now, x1, y1, x2, y2)) {
        return;
      }

      const distPx = Math.hypot(x2 - x1, y2 - y1);
      let delta = 0;
      if (this.lastTwoHandDist != null) {
        delta = distPx - this.lastTwoHandDist;
        if (Math.abs(delta) < c.twohandDeadzonePx) delta = 0;
      }
      this.lastTwoHandDist = distPx;

      this.onEvent('twohand', {
        dist: distPx,
        delta,
        centerX: (x1 + x2) / 2,
        centerY: (y1 + y2) / 2,
      });
      return;
    }

    this.twoHandFrames = 0;
    this.lastTwoHandDist = null;
    this._resetTwoHandSwipeTrack();
    // Одна рука — копим покой, чтобы следующий двуручный взмах не сработал на возврате
    if (!this.twoHandArmed) this._updateTwoHandSettle(performance.now(), null);
    this._processOneHand(hands[0]);
  }

  _resetTwoHandSwipeTrack() {
    this.handA = null;
    this.handB = null;
  }

  _rearmTwoHandSwipe(clearDir = false) {
    this.twoHandArmed = true;
    this.twoHandStillSince = null;
    this.twoHandStillAnchor = null;
    this.twoHandPrev = null;
    if (clearDir) {
      this.lastSwipeDirX = 0;
      this.returnGuardUntil = 0;
    }
    this._resetTwoHandSwipeTrack();
  }

  _trackHand(slot, x, y, now) {
    const windowMs = this.cfg.twohandSwipeWindowMs;
    if (!slot) {
      return { x, y, at: now, originX: x, originY: y, originAt: now };
    }
    const moved = Math.hypot(x - slot.originX, y - slot.originY);
    if (moved < 18 && now - slot.originAt > windowMs) {
      return { x, y, at: now, originX: x, originY: y, originAt: now };
    }
    return {
      x,
      y,
      at: now,
      originX: slot.originX,
      originY: slot.originY,
      originAt: slot.originAt,
    };
  }

  _mid(x1, y1, x2, y2) {
    return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }

  /**
   * Пока руки едут обратно — не слушаем новый взмах.
   * Rearm только после настоящего покоя (низкая скорость + мало дрейфа).
   */
  _updateTwoHandSettle(now, coords) {
    const c = this.cfg;
    if (this.twoHandArmed) return false;

    // В окне возврата одна рука не должна «разблокировать» жест раньше времени
    if (!coords) {
      if (now < this.returnGuardUntil) {
        this.twoHandStillSince = null;
        this.twoHandStillAnchor = null;
        return true;
      }
      if (this.twoHandStillSince == null) this.twoHandStillSince = now;
      if (now - this.twoHandStillSince >= c.twohandSettleMs) {
        this._rearmTwoHandSwipe(now >= this.returnGuardUntil);
      }
      return true;
    }

    const { x1, y1, x2, y2 } = coords;
    const mid = this._mid(x1, y1, x2, y2);
    let speed = 0;
    let moveDx = 0;
    if (this.twoHandPrev) {
      const dt = Math.max(16, now - this.twoHandPrev.at);
      const s1 = Math.hypot(x1 - this.twoHandPrev.x1, y1 - this.twoHandPrev.y1) / dt;
      const s2 = Math.hypot(x2 - this.twoHandPrev.x2, y2 - this.twoHandPrev.y2) / dt;
      speed = s1 + s2;
      moveDx = (x1 - this.twoHandPrev.x1) + (x2 - this.twoHandPrev.x2);
    }
    this.twoHandPrev = { x1, y1, x2, y2, at: now };

    // Движение против последнего взмаха = возврат рук — сбрасываем таймер покоя
    const returning =
      this.lastSwipeDirX !== 0 &&
      moveDx * this.lastSwipeDirX < -2;

    if (returning || speed >= c.twohandSettleSpeed) {
      this.twoHandStillSince = null;
      this.twoHandStillAnchor = null;
      return true;
    }

    if (this.twoHandStillSince == null) {
      this.twoHandStillSince = now;
      this.twoHandStillAnchor = mid;
      return true;
    }

    const drift = Math.hypot(mid.cx - this.twoHandStillAnchor.cx, mid.cy - this.twoHandStillAnchor.cy);
    if (drift > c.twohandSettleMaxDrift) {
      this.twoHandStillSince = now;
      this.twoHandStillAnchor = mid;
      return true;
    }

    if (now - this.twoHandStillSince >= c.twohandSettleMs) {
      this.twoHandArmed = true;
      this.twoHandStillSince = null;
      this.twoHandStillAnchor = null;
      // lastSwipeDirX держим до конца returnGuard — глотаем обратный взмах
      if (now >= this.returnGuardUntil) this.lastSwipeDirX = 0;
      this.handA = { x: x1, y: y1, at: now, originX: x1, originY: y1, originAt: now };
      this.handB = { x: x2, y: y2, at: now, originX: x2, originY: y2, originAt: now };
      this.twoHandPrev = { x1, y1, x2, y2, at: now };
    }
    return true;
  }

  _tryTwoHandSwipe(now, x1, y1, x2, y2) {
    const c = this.cfg;

    if (!this.twoHandArmed || now < this.twoHandSwipeCooldownUntil) {
      this._updateTwoHandSettle(now, { x1, y1, x2, y2 });
      return false;
    }

    if (this.lastSwipeDirX && now >= this.returnGuardUntil) {
      this.lastSwipeDirX = 0;
    }

    this.handA = this._trackHand(this.handA, x1, y1, now);
    this.handB = this._trackHand(this.handB, x2, y2, now);

    const a = this.handA;
    const b = this.handB;
    const distA = Math.hypot(a.x - a.originX, a.y - a.originY);
    const distB = Math.hypot(b.x - b.originX, b.y - b.originY);
    const minPx = c.twohandSwipeMinPx;
    if (distA < minPx * 0.55 || distB < minPx * 0.55) return false;
    if (distA + distB < minPx * 1.5) return false;

    const startDelta = Math.abs(a.originAt - b.originAt);
    if (startDelta > c.twohandSwipeWindowMs) return false;

    const elapsedA = Math.max(16, now - a.originAt);
    const elapsedB = Math.max(16, now - b.originAt);
    const speedA = distA / elapsedA;
    const speedB = distB / elapsedB;
    if (speedA + speedB < c.twohandSwipeMinSpeed) return false;

    const dxA = a.x - a.originX;
    const dxB = b.x - b.originX;
    if (dxA * dxB < 0 && Math.min(Math.abs(dxA), Math.abs(dxB)) > 40) {
      return false;
    }

    const dx = dxA + dxB;
    const dy = (a.y - a.originY) + (b.y - b.originY);
    if (Math.abs(dx) < Math.abs(dy) * 0.85) return false;

    const dirX = dx > 0 ? 1 : -1;

    // Обратный ход после листания — сбросить origin и НЕ листать
    if (
      this.lastSwipeDirX !== 0 &&
      dirX === -this.lastSwipeDirX &&
      now < this.returnGuardUntil
    ) {
      this.handA = { x: x1, y: y1, at: now, originX: x1, originY: y1, originAt: now };
      this.handB = { x: x2, y: y2, at: now, originX: x2, originY: y2, originAt: now };
      return false;
    }

    this.twoHandArmed = false;
    this.twoHandStillSince = null;
    this.twoHandStillAnchor = null;
    this.lastSwipeDirX = dirX;
    this.returnGuardUntil = now + (c.twohandReturnGuardMs ?? 1600);
    this.twoHandSwipeCooldownUntil = now + c.twohandSwipeCooldownMs;
    this.twoHandPrev = { x1, y1, x2, y2, at: now };
    this._resetTwoHandSwipeTrack();
    this.lastTwoHandDist = null;

    this.onEvent('twohandswipe', {
      distA,
      distB,
      dirX,
      dirY: 0,
      speed: speedA + speedB,
    });
    return true;
  }

  _processOneHand(landmarks) {
    const c = this.cfg;
    const now = performance.now();
    const handSize = dist(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]) || 0.001;

    const rawX = (1 - landmarks[LM.INDEX_TIP].x) * window.innerWidth;
    const rawY = landmarks[LM.INDEX_TIP].y * window.innerHeight;

    if (this.smoothX === null) {
      this.smoothX = rawX;
      this.smoothY = rawY;
    } else {
      const jump = Math.hypot(rawX - this.smoothX, rawY - this.smoothY);
      if (jump > c.cursorDeadzonePx) {
        this.smoothX += (rawX - this.smoothX) * c.cursorSmoothing;
        this.smoothY += (rawY - this.smoothY) * c.cursorSmoothing;
      }
    }

    const pinchDist = dist(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / handSize;

    const palmCenter = landmarks[LM.MIDDLE_MCP];
    const tipIdx = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
    const curls = tipIdx.map((i) => dist(landmarks[i], palmCenter) / handSize);
    const curlLimit = this.fistLatched ? c.fistCurlExit : c.fistCurlEnter;
    const curledCount = curls.filter((v) => v < curlLimit).length;
    const avgCurl = curls.reduce((a, b) => a + b, 0) / curls.length;
    const middleExt = curls[1];

    const fistRaw = curledCount >= c.fistMinCurled && avgCurl < curlLimit;

    let isFistNow = false;
    if (fistRaw) {
      this.fistLostSince = null;
      this.fistLatched = true;
      isFistNow = true;
    } else if (this.fistLatched || this.fistHoldStart != null) {
      if (this.fistLostSince == null) this.fistLostSince = now;
      if (now - this.fistLostSince < c.fistLostGraceMs) {
        isFistNow = true;
      } else {
        this.fistLatched = false;
        this.fistLostSince = null;
        isFistNow = false;
      }
    }

    const wantPinch = this.isPinching
      ? pinchDist < c.pinchRelease
      : pinchDist < c.pinchThreshold;
    // Строже порог щипка; open шторки только на pinchconfirm (в portalStory)
    const pinchMiddleMin = c.pinchMiddleMin ?? 0.48;
    const pinchingNow =
      !isFistNow &&
      wantPinch &&
      curledCount <= 2 &&
      middleExt >= pinchMiddleMin;

    this.onEvent('cursor', {
      x: this.smoothX,
      y: this.smoothY,
      visible: true,
      pinchDist,
      curledCount,
      avgCurl,
      pinchProgress: this._pinchProgress(now, pinchingNow),
      fistProgress: this._fistProgress(now, isFistNow),
    });

    if (isFistNow) {
      if (this.isPinching) {
        this.isPinching = false;
        this.pinchHoldStart = null;
        this.pinchConfirmed = false;
        this.onEvent('pinchend', { x: this.smoothX, y: this.smoothY });
      }
      if (this.fistHoldStart == null) {
        this.fistHoldStart = now;
        this.fistFired = false;
        this.onEvent('fiststart', { curledCount, avgCurl });
      } else if (
        !this.fistFired &&
        now - this.fistHoldStart >= this.fistHoldMs &&
        now >= this.fistCooldownUntil
      ) {
        this.fistFired = true;
        this.fistCooldownUntil = now + c.fistCooldownMs;
        this.onEvent('fist', { curledCount, avgCurl });
      }
      this._resetPalmSwipe();
    } else if (this.fistHoldStart != null) {
      if (!this.fistFired) this.onEvent('fistcancel', {});
      this._resetFist();
    }

    if (pinchingNow) {
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchHoldStart = now;
        this.pinchConfirmed = false;
        this.onEvent('pinchstart', { x: this.smoothX, y: this.smoothY });
      } else {
        this.onEvent('pinchmove', {
          x: this.smoothX,
          y: this.smoothY,
          strength: 1 - pinchDist / c.pinchThreshold,
        });

        if (
          !this.pinchConfirmed &&
          this.pinchHoldStart != null &&
          now - this.pinchHoldStart >= c.pinchHoldMs &&
          now >= this.pinchCooldownUntil
        ) {
          this.pinchConfirmed = true;
          this.pinchCooldownUntil = now + c.pinchCooldownMs;
          this.onEvent('pinchconfirm', { x: this.smoothX, y: this.smoothY });
        }
      }
      this._resetPalmSwipe();
    } else if (this.isPinching) {
      this.isPinching = false;
      this.pinchHoldStart = null;
      this.pinchConfirmed = false;
      this.onEvent('pinchend', { x: this.smoothX, y: this.smoothY });
    }

    const palmRawX = (1 - palmCenter.x) * window.innerWidth;
    const palmRawY = palmCenter.y * window.innerHeight;

    if (this.smoothPalmX == null) {
      this.smoothPalmX = palmRawX;
      this.smoothPalmY = palmRawY;
    } else {
      this.smoothPalmX += (palmRawX - this.smoothPalmX) * c.palmSmoothing;
      this.smoothPalmY += (palmRawY - this.smoothPalmY) * c.palmSmoothing;
    }

    const canPalmNav = !pinchingNow && !isFistNow;

    if (canPalmNav && this.lastPalmRawX != null) {
      const dx = (palmRawX - this.lastPalmRawX) * c.swipeScale;
      if (Math.abs(dx) > 0.6) {
        this.onEvent('swipe', { deltaX: dx, deltaY: palmRawY - this.lastPalmRawY });
      }
    }
    this.lastPalmRawX = palmRawX;
    this.lastPalmRawY = palmRawY;

    if (canPalmNav && now >= this.swipeCooldownUntil) {
      if (this.swipeOriginX == null) {
        this.swipeOriginX = this.smoothPalmX;
        this.swipeOriginY = this.smoothPalmY;
        this.swipeOriginAt = now;
      } else {
        const dx = this.smoothPalmX - this.swipeOriginX;
        const dy = this.smoothPalmY - this.swipeOriginY;
        const elapsed = now - this.swipeOriginAt;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const distMove = Math.hypot(dx, dy);

        if (elapsed > c.swipeMaxMs) {
          this.swipeOriginX = this.smoothPalmX;
          this.swipeOriginY = this.smoothPalmY;
          this.swipeOriginAt = now;
          this._resetNudgeCandidate();
        } else if (distMove >= c.swipeMinPx) {
          let dirY = 0;
          // Вертикальный nudge — без изменений (sheet ↑↓)
          if (absY >= absX * c.swipeAxisRatio) {
            dirY = dy > 0 ? 1 : -1;
            this._resetNudgeCandidate();
            this.onEvent('nudge', { dirX: 0, dirY });
            this.swipeCooldownUntil = now + c.swipeCooldownMs;
            this.swipeOriginX = this.smoothPalmX;
            this.swipeOriginY = this.smoothPalmY;
            this.swipeOriginAt = now;
          } else {
            const openPalm = this._isOpenPalm(c, curledCount, avgCurl, curls, pinchingNow, isFistNow);
            this._tryHorizontalNudge(now, dx, dy, elapsed, absX, absY, c, openPalm);
          }
        } else {
          const openPalm = this._isOpenPalm(c, curledCount, avgCurl, curls, pinchingNow, isFistNow);
          if (openPalm && absX >= absY * (c.nudgeHorizontalAxisRatio ?? 1.5)) {
            this._tryHorizontalNudge(now, dx, dy, elapsed, absX, absY, c, openPalm);
          } else if (!openPalm || absY >= absX) {
            this._resetNudgeCandidate();
          }
        }
      }
    } else if (!canPalmNav) {
      this.swipeOriginX = null;
      this.swipeOriginY = null;
      this._resetNudgeCandidate();
    }

    this.prevSmoothPalmX = this.smoothPalmX;
    this.prevSmoothPalmY = this.smoothPalmY;

    if (this.dwellEnabled) {
      this._updateDwell(this.smoothX, this.smoothY, pinchingNow || isFistNow);
    }
  }

  _resetPalmSwipe() {
    this.smoothPalmX = null;
    this.smoothPalmY = null;
    this.swipeOriginX = null;
    this.swipeOriginY = null;
    this.lastPalmRawX = null;
    this.lastPalmRawY = null;
    this.prevSmoothPalmX = null;
    this.prevSmoothPalmY = null;
    this._resetNudgeCandidate();
  }

  _pinchProgress(now, pinchingNow) {
    if (!pinchingNow || this.pinchHoldStart == null || this.pinchConfirmed) return 0;
    return Math.min(1, (now - this.pinchHoldStart) / this.cfg.pinchHoldMs);
  }

  _fistProgress(now, isFistNow) {
    if (!isFistNow || this.fistHoldStart == null || this.fistFired) return 0;
    return Math.min(1, (now - this.fistHoldStart) / this.fistHoldMs);
  }

  setFistHoldMs(ms) {
    const next = Math.max(200, Number(ms) || this.cfg.fistHoldMsDefault);
    if (next === this.fistHoldMs) return;
    this.fistHoldMs = next;
    this._resetFist();
  }

  _resetPinch() {
    this.isPinching = false;
    this.pinchHoldStart = null;
    this.pinchConfirmed = false;
  }

  _resetFist() {
    this.fistHoldStart = null;
    this.fistFired = false;
    this.fistLostSince = null;
    this.fistLatched = false;
  }

  _updateDwell(x, y, blocked) {
    if (blocked) {
      this._resetDwell();
      return;
    }

    const el = document.elementFromPoint(x, y);
    const target = el ? el.closest('.dwell-target') : null;
    const now = performance.now();

    if (now < this.dwellCooldownUntil) return;

    if (target !== this.dwellEl) {
      this.dwellEl = target;
      this.dwellStart = now;
      if (target) this.onEvent('dwellstart', { el: target });
      return;
    }

    if (!target) return;

    const progress = Math.min(1, (now - this.dwellStart) / this.cfg.dwellMs);
    this.onEvent('dwellprogress', { el: target, progress });

    if (progress >= 1) {
      this.onEvent('dwellcomplete', { el: target });
      this.dwellCooldownUntil = now + 1200;
      this.dwellEl = null;
    }
  }

  _resetDwell() {
    if (this.dwellEl) {
      this.onEvent('dwellprogress', { el: this.dwellEl, progress: 0 });
    }
    this.dwellEl = null;
  }
}
