// Конечный автомат жестов.
// Ладонь: дискретный свайп в 4 стороны (не накопление дрожи).
// Pinch/кулак — с коротким удержанием.

const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  MIDDLE_MCP: 9,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

// Pinch: чуть мягче порог + гистерезис, чтобы удержание успевало дойти до confirm
const PINCH_THRESHOLD = 0.4;
const PINCH_RELEASE = 0.52;
const PINCH_HOLD_MS = 200;
const PINCH_COOLDOWN_MS = 700;

// Кулак строже pinch — щипок не должен уходить в fist
const FIST_THRESHOLD = 0.4;
const FIST_HOLD_MS = 420;
const FIST_COOLDOWN_MS = 1300;

// Ладонь для свайпа: достаточно «не кулак и не pinch» (не требуем идеально открытую)
const OPEN_PALM_THRESHOLD = 0.42;
const DWELL_MS = 750;

const CURSOR_SMOOTHING = 0.22;
const CURSOR_DEADZONE_PX = 3;

// Свайп ладонью: один жест = один шаг
const SWIPE_MIN_PX = 32;
const SWIPE_MAX_MS = 550;
const SWIPE_COOLDOWN_MS = 320;
const SWIPE_AXIS_RATIO = 1.1;
const PALM_SMOOTHING = 0.45;
const SWIPE_SCALE = 1.35;

const TWOHAND_DEADZONE_PX = 3;
const TWOHAND_FRAMES = 10; // не глушить pinch/кулак из‑за ложной «второй руки»

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

export class GestureController {
  /**
   * @param {(type: string, payload: any) => void} onEvent
   * @param {{ dwellEnabled?: boolean }} [options]
   */
  constructor(onEvent, options = {}) {
    this.onEvent = onEvent;
    this.dwellEnabled = options.dwellEnabled !== false;
    this.smoothX = null;
    this.smoothY = null;

    this.isPinching = false;
    this.pinchHoldStart = null;
    this.pinchConfirmed = false;
    this.pinchCooldownUntil = 0;

    this.fistHoldStart = null;
    this.fistFired = false;
    this.fistCooldownUntil = 0;

    // Ладонь / свайп
    this.smoothPalmX = null;
    this.smoothPalmY = null;
    this.swipeOriginX = null;
    this.swipeOriginY = null;
    this.swipeOriginAt = 0;
    this.swipeCooldownUntil = 0;
    this.lastPalmRawX = null;
    this.lastPalmRawY = null;

    this.dwellEl = null;
    this.dwellStart = 0;
    this.dwellCooldownUntil = 0;

    this.lastTwoHandDist = null;
    this.twoHandFrames = 0;
  }

  /**
   * @param {Array<Array<{x,y,z}>>|null} handsInput
   */
  update(handsInput) {
    const hands = handsInput || [];

    if (hands.length === 0) {
      if (this.smoothX !== null) this.onEvent('lost', {});
      this.smoothX = null;
      this.smoothY = null;
      this._resetPalmSwipe();
      this.lastTwoHandDist = null;
      this.twoHandFrames = 0;
      this._resetPinch();
      this._resetFist();
      this._resetDwell();
      return;
    }

    // Две руки: зум только если вторая рука стабильна.
    // Если уже идёт pinch/кулак одной рукой — не сбрасываем жест (ложный 2-й детект).
    if (hands.length >= 2) {
      this.twoHandFrames += 1;
      if (this.twoHandFrames < TWOHAND_FRAMES || this.isPinching || this.fistHoldStart != null) {
        this._processOneHand(hands[0]);
        return;
      }

      this._resetPinch();
      this._resetFist();
      this._resetDwell();
      this._resetPalmSwipe();

      const c1 = hands[0][LM.MIDDLE_MCP];
      const c2 = hands[1][LM.MIDDLE_MCP];
      const x1 = (1 - c1.x) * window.innerWidth;
      const y1 = c1.y * window.innerHeight;
      const x2 = (1 - c2.x) * window.innerWidth;
      const y2 = c2.y * window.innerHeight;
      const distPx = Math.hypot(x2 - x1, y2 - y1);

      let delta = 0;
      if (this.lastTwoHandDist != null) {
        delta = distPx - this.lastTwoHandDist;
        if (Math.abs(delta) < TWOHAND_DEADZONE_PX) delta = 0;
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
    this._processOneHand(hands[0]);
  }

  _processOneHand(landmarks) {
    const now = performance.now();
    const handSize = dist(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]) || 0.001;

    const rawX = (1 - landmarks[LM.INDEX_TIP].x) * window.innerWidth;
    const rawY = landmarks[LM.INDEX_TIP].y * window.innerHeight;

    if (this.smoothX === null) {
      this.smoothX = rawX;
      this.smoothY = rawY;
    } else {
      const jump = Math.hypot(rawX - this.smoothX, rawY - this.smoothY);
      if (jump > CURSOR_DEADZONE_PX) {
        this.smoothX += (rawX - this.smoothX) * CURSOR_SMOOTHING;
        this.smoothY += (rawY - this.smoothY) * CURSOR_SMOOTHING;
      }
    }

    const pinchDist = dist(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / handSize;
    // Гистерезис: войти в pinch легче, выйти — только когда пальцы заметно разомкнулись
    const pinchingNow = this.isPinching
      ? pinchDist < PINCH_RELEASE
      : pinchDist < PINCH_THRESHOLD;

    const palmCenter = landmarks[LM.MIDDLE_MCP];
    const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP].map((i) => landmarks[i]);
    const avgTipDist = tips.reduce((sum, t) => sum + dist(t, palmCenter), 0) / tips.length / handSize;

    // Кулак только если это не щипок и пальцы реально собраны
    const isFistNow = !pinchingNow && pinchDist > PINCH_RELEASE && avgTipDist < FIST_THRESHOLD;

    this.onEvent('cursor', {
      x: this.smoothX,
      y: this.smoothY,
      visible: true,
      pinchDist,
      pinchProgress: this._pinchProgress(now, pinchingNow),
      fistProgress: this._fistProgress(now, isFistNow),
    });

    // --- PINCH ---
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
          strength: 1 - pinchDist / PINCH_THRESHOLD,
        });

        if (
          !this.pinchConfirmed &&
          this.pinchHoldStart != null &&
          now - this.pinchHoldStart >= PINCH_HOLD_MS &&
          now >= this.pinchCooldownUntil
        ) {
          this.pinchConfirmed = true;
          this.pinchCooldownUntil = now + PINCH_COOLDOWN_MS;
          this.onEvent('pinchconfirm', { x: this.smoothX, y: this.smoothY });
        }
      }
      this._resetFist();
      this._resetPalmSwipe();
    } else if (this.isPinching) {
      this.isPinching = false;
      this.pinchHoldStart = null;
      this.pinchConfirmed = false;
      this.onEvent('pinchend', { x: this.smoothX, y: this.smoothY });
    }

    // --- FIST ---
    if (isFistNow) {
      if (this.fistHoldStart == null) {
        this.fistHoldStart = now;
      } else if (
        !this.fistFired &&
        now - this.fistHoldStart >= FIST_HOLD_MS &&
        now >= this.fistCooldownUntil
      ) {
        this.fistFired = true;
        this.fistCooldownUntil = now + FIST_COOLDOWN_MS;
        this.onEvent('fist', {});
      }
      this._resetPalmSwipe();
    } else {
      this._resetFist();
    }

    // --- СВАЙП ЛАДОНЬЮ ---
    const palmRawX = (1 - palmCenter.x) * window.innerWidth;
    const palmRawY = palmCenter.y * window.innerHeight;

    if (this.smoothPalmX == null) {
      this.smoothPalmX = palmRawX;
      this.smoothPalmY = palmRawY;
    } else {
      this.smoothPalmX += (palmRawX - this.smoothPalmX) * PALM_SMOOTHING;
      this.smoothPalmY += (palmRawY - this.smoothPalmY) * PALM_SMOOTHING;
    }

    const canPalmNav = !pinchingNow && !isFistNow;

    if (canPalmNav && this.lastPalmRawX != null) {
      const dx = (palmRawX - this.lastPalmRawX) * SWIPE_SCALE;
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

        if (elapsed > SWIPE_MAX_MS) {
          this.swipeOriginX = this.smoothPalmX;
          this.swipeOriginY = this.smoothPalmY;
          this.swipeOriginAt = now;
        } else if (distMove >= SWIPE_MIN_PX) {
          let dirX = 0;
          let dirY = 0;
          if (absX >= absY * SWIPE_AXIS_RATIO) {
            dirX = dx > 0 ? 1 : -1;
          } else if (absY >= absX * SWIPE_AXIS_RATIO) {
            dirY = dy > 0 ? 1 : -1;
          } else if (absX >= absY) {
            dirX = dx > 0 ? 1 : -1;
          } else {
            dirY = dy > 0 ? 1 : -1;
          }

          this.onEvent('nudge', { dirX, dirY });
          this.swipeCooldownUntil = now + SWIPE_COOLDOWN_MS;
          this.swipeOriginX = this.smoothPalmX;
          this.swipeOriginY = this.smoothPalmY;
          this.swipeOriginAt = now;
        }
      }
    } else if (!canPalmNav) {
      this.swipeOriginX = null;
      this.swipeOriginY = null;
    }

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
  }

  _pinchProgress(now, pinchingNow) {
    if (!pinchingNow || this.pinchHoldStart == null || this.pinchConfirmed) return 0;
    return Math.min(1, (now - this.pinchHoldStart) / PINCH_HOLD_MS);
  }

  _fistProgress(now, isFistNow) {
    if (!isFistNow || this.fistHoldStart == null || this.fistFired) return 0;
    return Math.min(1, (now - this.fistHoldStart) / FIST_HOLD_MS);
  }

  _resetPinch() {
    this.isPinching = false;
    this.pinchHoldStart = null;
    this.pinchConfirmed = false;
  }

  _resetFist() {
    this.fistHoldStart = null;
    this.fistFired = false;
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

    const progress = Math.min(1, (now - this.dwellStart) / DWELL_MS);
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
