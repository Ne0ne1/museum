// MediaPipe Hands: камера через getUserMedia + rAF, без зависания на CDN-скриптах в HTML.

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

export class HandTracker {
  constructor(videoEl, debugCanvasEl, onLandmarks, onStatus) {
    this.videoEl = videoEl;
    this.debugCanvasEl = debugCanvasEl;
    this.debugCtx = debugCanvasEl.getContext('2d');
    this.onLandmarks = onLandmarks;
    this.onStatus = onStatus || (() => {});
    this.hands = null;
    this.stream = null;
    this.rafId = null;
    this.running = false;
    this.busy = false;
    this.locateFile = null;
  }

  async start() {
    try {
      this.onStatus('Старт…');

      const mp = await loadMediaPipe(this.onStatus);
      this.locateFile = mp.locateFile;

      if (!navigator.mediaDevices?.getUserMedia) {
        this.onStatus('Нет getUserMedia. Открой http://localhost:8080 в Chrome');
        return;
      }

      this.onStatus('Запрос камеры… разреши доступ в браузере');
      this.stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        }),
        CAMERA_TIMEOUT_MS,
        'Таймаут камеры 12с. Проверь: Chrome → настройки сайта → Камера → Разрешить'
      );

      this.videoEl.srcObject = this.stream;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      await this.videoEl.play();

      this.onStatus('Камера OK. Прогрев модели рук…');
      await this._initHands();

      this.running = true;
      this.onStatus('Камера активна — покажи открытую ладонь');
      this._loop();
    } catch (err) {
      console.error(err);
      this.onStatus(this._friendlyError(err));
      this.stop();
    }
  }

  async _initHands() {
    this.hands = new Hands({
      locateFile: this.locateFile,
    });

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.5,
    });

    this.hands.onResults((results) => this._handleResults(results));

    await withTimeout(
      this.hands.send({ image: this.videoEl }),
      MODEL_WARMUP_TIMEOUT_MS,
      'Таймаут модели Hands (WASM). CDN режет файлы — смени сеть/VPN'
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
    const ctx = this.debugCtx;
    ctx.save();
    ctx.clearRect(0, 0, this.debugCanvasEl.width, this.debugCanvasEl.height);

    const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

    if (hasHand) {
      const landmarks = results.multiHandLandmarks[0];
      if (typeof drawConnectors === 'function' && typeof HAND_CONNECTIONS !== 'undefined') {
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#3ddc97', lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: '#ffb648', lineWidth: 1, radius: 2 });
      }
      this.onLandmarks(landmarks);
    } else {
      this.onLandmarks(null);
    }

    ctx.restore();
  }

  _friendlyError(err) {
    const msg = String(err?.message || err);
    if (/Permission|NotAllowed|denied/i.test(msg)) {
      return 'Камера запрещена. Разреши для localhost и обнови страницу';
    }
    if (/NotFound|DevicesNotFound/i.test(msg)) {
      return 'Камера не найдена';
    }
    if (/NotReadable|TrackStart|in use/i.test(msg)) {
      return 'Камера занята другим приложением — закрой его';
    }
    return msg;
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoEl) this.videoEl.srcObject = null;
  }
}
