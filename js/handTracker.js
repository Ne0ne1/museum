// MediaPipe Hands: камера через getUserMedia + rAF, с retry для музейного киоска.

import { loadMediaPipe } from './loadMediaPipe.js';

const CAMERA_TIMEOUT_MS = 12000;
const MODEL_WARMUP_TIMEOUT_MS = 25000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Mac/USB kiosk setup — not public Vercel/tablet deploy. */
function isLocalKioskHost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
}

function isSecureCameraContext() {
  return (
    window.isSecureContext === true ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  );
}

export class HandTracker {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLCanvasElement} debugCanvasEl
   * @param {(hands: any) => void} onLandmarks
   * @param {(status: string) => void} [onStatus]
   * @param {{
   *   retryAttempts?: number,
   *   retryDelayMs?: number,
   *   onFatal?: (msg: string) => void,
   *   maxNumHands?: number,
   *   modelComplexity?: number,
   *   minDetectionConfidence?: number,
   *   minTrackingConfidence?: number,
   * }} [options]
   */
  constructor(videoEl, debugCanvasEl, onLandmarks, onStatus, options = {}) {
    this.videoEl = videoEl;
    this.debugCanvasEl = debugCanvasEl;
    this.debugCtx = debugCanvasEl.getContext('2d');
    this.onLandmarks = onLandmarks;
    this.onStatus = onStatus || (() => {});
    this.onFatal = options.onFatal || (() => {});
    this.retryAttempts = Math.max(1, Number(options.retryAttempts) || 8);
    this.retryDelayMs = Math.max(500, Number(options.retryDelayMs) || 2500);

    // Kiosk default: one hand. Cap complexity at 1 (never 2 on this step).
    this.maxNumHands = clampInt(options.maxNumHands, 1, 2, 1);
    this.modelComplexity = clampInt(options.modelComplexity, 0, 1, 1);
    this.minDetectionConfidence =
      Number(options.minDetectionConfidence) > 0
        ? Number(options.minDetectionConfidence)
        : 0.65;
    this.minTrackingConfidence =
      Number(options.minTrackingConfidence) > 0
        ? Number(options.minTrackingConfidence)
        : 0.5;

    /** Exact MediaPipe/Chrome deviceId, or empty */
    this.cameraDeviceId = String(options.cameraDeviceId || '').trim();
    /** Substring match against device label, e.g. "Logitech", "USB" */
    this.cameraLabelMatch = String(options.cameraLabelMatch || '').trim();
    /** Prefer first non-built-in Mac camera when no id/label set (local kiosk only) */
    this.cameraPreferExternal =
      isLocalKioskHost() && options.cameraPreferExternal !== false;

    // camera.html selection applies only on the same machine (local kiosk).
    if (isLocalKioskHost()) {
      try {
        const storedId = String(localStorage.getItem('museum.cameraDeviceId') || '').trim();
        if (storedId) this.cameraDeviceId = storedId;
      } catch (_) {
        /* ignore */
      }
    }

    this.hands = null;
    this.stream = null;
    this.rafId = null;
    this.running = false;
    this.busy = false;
    this.locateFile = null;
    this._endedHandler = null;

    this._inferFps = 0;
    this._resultCount = 0;
    this._fpsWindowStart = 0;
    this._lastInferAt = 0;
    this._lastInferDurationMs = 0;
    this._inferStartedAt = 0;
  }

  async start() {
    try {
      this.onStatus('Старт…');

      const mp = await loadMediaPipe(this.onStatus);
      this.locateFile = mp.locateFile;

      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = isSecureCameraContext()
          ? 'Браузер не поддерживает камеру (getUserMedia).'
          : 'Камера доступна только по HTTPS. Откройте сайт через https://…';
        this.onStatus(msg);
        this.onFatal(msg);
        return;
      }

      await this._openCameraWithRetry();
      this.videoEl.srcObject = this.stream;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      await this.videoEl.play();

      this._watchTrackEnded();

      this.onStatus(
        `Камера OK. Hands c=${this.modelComplexity} hands=${this.maxNumHands}…`
      );
      await this._initHands();

      this.running = true;
      this.onStatus('Камера активна');
      this._loop();
    } catch (err) {
      console.error(err);
      const msg = this._friendlyError(err);
      this.onStatus(msg);
      this.onFatal(msg);
      this.stop();
    }
  }

  async _openCameraWithRetry() {
    let lastErr = null;
    const attempts = await this._buildCameraAttemptList();

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      const constraints = attempts[Math.min(attempt - 1, attempts.length - 1)];
      this.onStatus(
        attempt === 1
          ? 'Запрос камеры…'
          : `Повтор камеры ${attempt}/${this.retryAttempts}…`
      );
      try {
        this.stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: constraints,
          }),
          CAMERA_TIMEOUT_MS,
          'Таймаут камеры. Разрешите доступ к камере в настройках браузера.'
        );
        const track = this.stream.getVideoTracks()[0];
        const label = track?.label || 'камера';
        console.info('[camera] using:', label, track?.getSettings?.());
        this.onStatus(`Камера: ${label}`);
        return;
      } catch (err) {
        lastErr = err;
        console.warn('getUserMedia attempt', attempt, constraints, err);
        this.stopTracksOnly();
        if (this._shouldClearStoredDeviceId(err)) {
          this._clearStoredCameraDeviceId();
          this.cameraDeviceId = '';
        }
        if (attempt < this.retryAttempts) {
          await sleep(this.retryDelayMs);
        }
      }
    }
    throw lastErr || new Error('Камера недоступна');
  }

  _shouldClearStoredDeviceId(err) {
    const name = String(err?.name || '');
    const msg = String(err?.message || err);
    return (
      /Overconstrained|NotFound|DevicesNotFound/i.test(name) ||
      /Overconstrained|requested device|not found/i.test(msg)
    );
  }

  _clearStoredCameraDeviceId() {
    try {
      localStorage.removeItem('museum.cameraDeviceId');
      localStorage.removeItem('museum.cameraLabel');
    } catch (_) {
      /* ignore */
    }
  }

  /** Progressive fallback: ideal deviceId → facingMode → any camera. */
  async _buildCameraAttemptList() {
    const base = { width: { ideal: 640 }, height: { ideal: 480 } };
    const list = [];
    const resolved = await this._resolveVideoConstraints();

    if (resolved.deviceId) {
      list.push({ ...base, deviceId: { ideal: resolved.deviceId } });
      list.push({ ...base, deviceId: { exact: resolved.deviceId } });
    }
    if (resolved.facingMode) {
      list.push({ ...base, facingMode: resolved.facingMode });
    }
    list.push({ ...base, facingMode: 'user' });
    list.push(true);
    return list;
  }

  /**
   * Build preferred camera hints (deviceId / facingMode).
   * Priority on local kiosk: cameraDeviceId → cameraLabelMatch → prefer external.
   * On Vercel/public HTTPS: front camera (user-facing).
   */
  async _resolveVideoConstraints() {
    const base = { width: { ideal: 640 }, height: { ideal: 480 } };

    if (!isLocalKioskHost()) {
      return { ...base, facingMode: 'user' };
    }

    let deviceId = this.cameraDeviceId;
    if (!deviceId && (this.cameraLabelMatch || this.cameraPreferExternal)) {
      deviceId = await this._findCameraDeviceId();
    }

    if (deviceId) {
      return { ...base, deviceId };
    }

    return { ...base, facingMode: 'user' };
  }

  _isBuiltInMacCamera(label = '') {
    return /facetime|macbook|built-?in|iphone|continuity|studio display/i.test(label);
  }

  async _findCameraDeviceId() {
    // Labels are empty until permission is granted at least once
    let temp = null;
    try {
      temp = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (err) {
      console.warn('[camera] permission probe failed', err);
    } finally {
      temp?.getTracks?.().forEach((t) => t.stop());
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    console.info(
      '[camera] available:',
      cams.map((c) => ({ id: c.deviceId, label: c.label || '(no label)' }))
    );

    if (!cams.length) return '';

    const match = this.cameraLabelMatch.toLowerCase();
    if (match) {
      const byLabel = cams.find((c) => (c.label || '').toLowerCase().includes(match));
      if (byLabel) {
        console.info('[camera] matched label:', byLabel.label);
        return byLabel.deviceId;
      }
      console.warn('[camera] label match not found:', this.cameraLabelMatch);
    }

    if (this.cameraPreferExternal) {
      const external = cams.find((c) => c.label && !this._isBuiltInMacCamera(c.label));
      if (external) {
        console.info('[camera] prefer external:', external.label);
        return external.deviceId;
      }
      // unlabeled extras: if >1 camera, pick the one that is not the first FaceTime-looking
      if (cams.length > 1) {
        const nonDefault = cams.find((c) => !this._isBuiltInMacCamera(c.label || ''));
        if (nonDefault) return nonDefault.deviceId;
        return cams[cams.length - 1].deviceId;
      }
    }

    return '';
  }

  _watchTrackEnded() {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return;
    this._endedHandler = () => {
      if (!this.running) return;
      this.onStatus('Камера отключилась — переподключение…');
      this._reacquire();
    };
    track.addEventListener('ended', this._endedHandler);
  }

  async _reacquire() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stopTracksOnly();
    try {
      await this._openCameraWithRetry();
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this._watchTrackEnded();
      this.running = true;
      this.onStatus('Камера снова активна');
      this._loop();
    } catch (err) {
      const msg = this._friendlyError(err);
      this.onStatus(msg);
      this.onFatal(msg);
    }
  }

  async _initHands() {
    this.hands = new Hands({
      locateFile: this.locateFile,
    });

    this.hands.setOptions({
      maxNumHands: this.maxNumHands,
      modelComplexity: this.modelComplexity,
      minDetectionConfidence: this.minDetectionConfidence,
      minTrackingConfidence: this.minTrackingConfidence,
    });

    this.hands.onResults((results) => this._handleResults(results));

    await withTimeout(
      this.hands.send({ image: this.videoEl }),
      MODEL_WARMUP_TIMEOUT_MS,
      'Таймаут модели Hands (WASM). Проверьте vendor/mediapipe'
    );
  }

  _loop() {
    if (!this.running) return;

    this.rafId = requestAnimationFrame(async () => {
      if (!this.running) return;

      if (
        this.hands &&
        !this.busy &&
        this.videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        this.busy = true;
        this._inferStartedAt = performance.now();
        try {
          await this.hands.send({ image: this.videoEl });
        } catch (err) {
          console.warn('hands.send', err);
        } finally {
          this.busy = false;
        }
      }

      this._loop();
    });
  }

  _handleResults(results) {
    const now = performance.now();
    if (this._inferStartedAt) {
      this._lastInferDurationMs = now - this._inferStartedAt;
    }
    this._lastInferAt = now;

    if (!this._fpsWindowStart) this._fpsWindowStart = now;
    this._resultCount += 1;
    const windowMs = now - this._fpsWindowStart;
    if (windowMs >= 1000) {
      this._inferFps = (this._resultCount * 1000) / windowMs;
      this._resultCount = 0;
      this._fpsWindowStart = now;
    }

    const ctx = this.debugCtx;
    if (ctx) {
      ctx.save();
      ctx.clearRect(0, 0, this.debugCanvasEl.width, this.debugCanvasEl.height);
    }

    const hands = results.multiHandLandmarks || [];

    if (hands.length > 0) {
      if (
        ctx &&
        document.documentElement.classList.contains('kiosk-debug') &&
        typeof drawConnectors === 'function' &&
        typeof HAND_CONNECTIONS !== 'undefined'
      ) {
        const colors = ['#3ddc97', '#4aa8ff'];
        hands.forEach((landmarks, i) => {
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: colors[i % 2], lineWidth: 2 });
          drawLandmarks(ctx, landmarks, { color: '#ffb648', lineWidth: 1, radius: 2 });
        });
      }
      this.onLandmarks(hands);
    } else {
      this.onLandmarks(null);
    }

    if (ctx) ctx.restore();
  }

  /** Inference / landmarks callback rate (approx). */
  getInferenceFps() {
    return this._inferFps;
  }

  getDebugStats() {
    return {
      inferenceFps: this._inferFps,
      lastInferDurationMs: this._lastInferDurationMs,
      lastInferAt: this._lastInferAt,
      modelComplexity: this.modelComplexity,
      maxNumHands: this.maxNumHands,
    };
  }

  _friendlyError(err) {
    const msg = String(err?.message || err);
    if (/Permission|NotAllowed|denied/i.test(msg)) {
      return `Камера запрещена. Нажмите 🔒 слева от адреса → Камера → Разрешить, затем обновите страницу.`;
    }
    if (/NotFound|DevicesNotFound/i.test(msg)) {
      return 'Камера не найдена. Проверьте кабель и Диспетчер устройств.';
    }
    if (/NotReadable|TrackStart|in use/i.test(msg)) {
      return 'Камера занята другим приложением. Закройте Zoom/Teams и перезапустите стенд.';
    }
    return msg;
  }

  stopTracksOnly() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        if (this._endedHandler) t.removeEventListener('ended', this._endedHandler);
        t.stop();
      });
      this.stream = null;
    }
    this._endedHandler = null;
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stopTracksOnly();
    if (this.videoEl) this.videoEl.srcObject = null;
  }
}
