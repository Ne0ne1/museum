// Конечный автомат жестов.
// Курсор — как есть (сглаживание не трогаем).
// Pinch/кулак — только после удержания, чтобы убрать ложные срабатывания.

const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  MIDDLE_MCP: 9,
  RING_TIP: 16,
  PINKY_TIP: 20,
};

// Pinch: сведённые пальцы + короткое удержание
const PINCH_THRESHOLD = 0.3;
const PINCH_HOLD_MS = 280;
const PINCH_COOLDOWN_MS = 1000;

// Кулак: сжатая ладонь + короткое удержание
const FIST_THRESHOLD = 0.48;
const FIST_HOLD_MS = 380;
const FIST_COOLDOWN_MS = 1300;

const OPEN_PALM_THRESHOLD = 0.78;
const DWELL_MS = 750;

// Курсор: чуть отзывчивее, но без «полёта»
const CURSOR_SMOOTHING = 0.22;
const CURSOR_DEADZONE_PX = 3;

const NUDGE_THRESHOLD_PX = 85;
const NUDGE_COOLDOWN_MS = 550;
const SWIPE_SCALE = 0.55;

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

    this.wasOpenPalm = false;
    this.lastPalmX = null;
    this.lastPalmY = null;
    this.nudgeAccX = 0;
    this.nudgeAccY = 0;
    this.nudgeCooldownUntil = 0;

    this.dwellEl = null;
    this.dwellStart = 0;
    this.dwellCooldownUntil = 0;
  }

  update(landmarks) {
    if (!landmarks) {
      if (this.smoothX !== null) this.onEvent('lost', {});
      this.smoothX = null;
      this.smoothY = null;
      this.wasOpenPalm = false;
      this.lastPalmX = null;
      this.lastPalmY = null;
      this.nudgeAccX = 0;
      this.nudgeAccY = 0;
      this._resetPinch();
      this._resetFist();
      this._resetDwell();
      return;
    }

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
    const pinchingNow = pinchDist < PINCH_THRESHOLD;

    const palmCenter = landmarks[LM.MIDDLE_MCP];
    const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP].map((i) => landmarks[i]);
    const avgTipDist = tips.reduce((sum, t) => sum + dist(t, palmCenter), 0) / tips.length / handSize;

    const isOpenNow = avgTipDist > OPEN_PALM_THRESHOLD;
    // Кулак только если пальцы близко к ладони И это не pinch
    const isFistNow = !pinchingNow && avgTipDist < FIST_THRESHOLD;

    this.onEvent('cursor', {
      x: this.smoothX,
      y: this.smoothY,
      visible: true,
      pinchDist,
      pinchProgress: this._pinchProgress(now, pinchingNow),
      fistProgress: this._fistProgress(now, isFistNow),
    });

    // --- PINCH: подтверждение только после удержания ---
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
      // во время pinch кулак не копим
      this._resetFist();
    } else if (this.isPinching) {
      this.isPinching = false;
      this.pinchHoldStart = null;
      this.pinchConfirmed = false;
      this.onEvent('pinchend', { x: this.smoothX, y: this.smoothY });
    }

    // --- FIST: назад только после удержания сжатой ладони ---
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
    } else {
      this._resetFist();
    }

    // --- Свайп / nudge только открытой ладонью без pinch ---
    const palmX = (1 - palmCenter.x) * window.innerWidth;
    const palmY = palmCenter.y * window.innerHeight;

    if (isOpenNow && !pinchingNow && !isFistNow) {
      if (this.wasOpenPalm && this.lastPalmX !== null) {
        const deltaX = (palmX - this.lastPalmX) * SWIPE_SCALE;
        const deltaY = (palmY - this.lastPalmY) * SWIPE_SCALE;

        if (Math.abs(deltaX) > 0.8) {
          this.onEvent('swipe', { deltaX, deltaY });
        }

        this.nudgeAccX += palmX - this.lastPalmX;
        this.nudgeAccY += palmY - this.lastPalmY;
        const accLen = Math.hypot(this.nudgeAccX, this.nudgeAccY);

        if (accLen >= NUDGE_THRESHOLD_PX && now >= this.nudgeCooldownUntil) {
          this.onEvent('nudge', {
            dirX: this.nudgeAccX / accLen,
            dirY: this.nudgeAccY / accLen,
          });
          this.nudgeAccX = 0;
          this.nudgeAccY = 0;
          this.nudgeCooldownUntil = now + NUDGE_COOLDOWN_MS;
        }
      }
      this.wasOpenPalm = true;
      this.lastPalmX = palmX;
      this.lastPalmY = palmY;
    } else {
      this.wasOpenPalm = false;
      this.lastPalmX = null;
      this.lastPalmY = null;
      this.nudgeAccX = 0;
      this.nudgeAccY = 0;
    }

    if (this.dwellEnabled) {
      this._updateDwell(this.smoothX, this.smoothY, pinchingNow || isFistNow);
    }
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
