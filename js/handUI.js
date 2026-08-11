// Общий запуск трекинга руки на любой странице.

import { HandTracker } from './handTracker.js?v=8';
import { GestureController } from './gestureState.js?v=29';
import { LandmarkStabilizer } from './landmarkStabilizer.js?v=1';
import { applyDebugUi, showStaffAlert, hideStaffAlert, isDebugMode } from './kiosk.js?v=2';
import { loadGestureConfig } from './gestureConfig.js?v=11';
export { saveSelectedPlace, loadSelectedPlace } from './storage.js';

function ensureDebugMetricsEl() {
  let el = document.getElementById('hand-debug-metrics');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'hand-debug-metrics';
  el.className = 'hand-debug-metrics';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
}

/**
 * @param {(type: string, payload: any) => void} onEvent
 * @param {{ freeCursor?: boolean, dwellEnabled?: boolean, hideCursor?: boolean, config?: object }} [options]
 */
export function startHandUI(onEvent, options = {}) {
  applyDebugUi();

  const freeCursor = options.freeCursor !== false;
  const dwellEnabled = options.dwellEnabled !== false;
  const hideCursor = options.hideCursor === true;
  const debugMetrics = isDebugMode();

  const cursorEl = document.getElementById('hand-cursor');
  const statusEl = document.getElementById('camera-status');
  const videoEl = document.getElementById('input-video');
  const canvasEl = document.getElementById('debug-canvas');

  if (!videoEl || !canvasEl) {
    console.warn('Элементы камеры не найдены на странице');
    return null;
  }

  if (statusEl) statusEl.textContent = 'Подключение трекера…';

  if (hideCursor && cursorEl) {
    cursorEl.classList.add('hidden');
  }

  function setHoldProgress(progress, mode) {
    if (hideCursor || !cursorEl) return;
    const p = Math.max(0, Math.min(1, progress || 0));
    cursorEl.style.setProperty('--hold-progress', String(p));
    cursorEl.classList.toggle('holding', p > 0.02);
    cursorEl.classList.toggle('holding-fist', mode === 'fist' && p > 0.02);
    cursorEl.classList.toggle('holding-pinch', mode === 'pinch' && p > 0.02);
    if (p <= 0.02) {
      cursorEl.classList.remove('holding', 'holding-fist', 'holding-pinch');
    }
  }

  const gestureController = new GestureController((type, payload) => {
    if (cursorEl && !hideCursor) {
      if (type === 'cursor') {
        cursorEl.classList.remove('hidden');
        if (freeCursor) cursorEl.classList.remove('snapped');
        cursorEl.style.left = `${payload.x}px`;
        cursorEl.style.top = `${payload.y}px`;

        const fistP = payload.fistProgress || 0;
        const pinchP = payload.pinchProgress || 0;
        if (fistP > 0.02) setHoldProgress(fistP, 'fist');
        else if (pinchP > 0.02) setHoldProgress(pinchP, 'pinch');
        else setHoldProgress(0);
      } else if (type === 'lost') {
        if (freeCursor) {
          cursorEl.classList.add('hidden');
          cursorEl.classList.remove('snapped', 'pinching');
        }
        setHoldProgress(0);
      } else if (type === 'pinchstart' || type === 'pinchmove') {
        cursorEl.classList.add('pinching');
      } else if (type === 'pinchend') {
        cursorEl.classList.remove('pinching');
      } else if (type === 'fiststart') {
        cursorEl.classList.add('holding-fist');
      } else if (type === 'fist' || type === 'fistcancel') {
        setHoldProgress(0);
        cursorEl.classList.remove('pinching');
      }
    } else if (hideCursor && cursorEl) {
      cursorEl.classList.add('hidden');
    }

    onEvent(type, payload);
  }, { dwellEnabled, config: options.config || {} });

  const cfg = options.config || {};
  const stabilizer = new LandmarkStabilizer({
    landmarkSmoothing: cfg.landmarkSmoothing,
    handLostGraceMs: cfg.handLostGraceMs,
  });

  const metricsEl = debugMetrics ? ensureDebugMetricsEl() : null;
  let metricsTick = 0;

  function paintDebugMetrics() {
    if (!metricsEl) return;
    metricsTick += 1;
    // ~every other frame is enough; keep overlay cheap
    if (metricsTick % 2 !== 0) return;
    const m = stabilizer.getMetrics();
    const t = tracker.getDebugStats();
    const n = gestureController.getNudgeDebugMetrics?.() || {};
    const age = m.lastDetectAgeMs == null ? '—' : `${m.lastDetectAgeMs}ms`;
    const cand = n.candidate ? (n.candidate < 0 ? 'L' : 'R') : '—';
    metricsEl.textContent =
      `hand:${m.detected ? 'Y' : 'N'}` +
      `${m.usingGrace ? ' grace' : ''}` +
      `  fps:${t.inferenceFps.toFixed(0)}` +
      `  lost:${m.consecutiveLost}` +
      `  last:${age}` +
      `\nnudge dx:${n.dx} dy:${n.dy} spd:${n.speed}` +
      ` axis:${n.axis} cand:${cand} cf:${n.confirm}` +
      ` palm:${n.openPalm ? 'Y' : 'N'}${n.triggered ? ' FIRE' : ''}`;
  }

  const tracker = new HandTracker(
    videoEl,
    canvasEl,
    (landmarks) => {
      const stable = stabilizer.process(landmarks);
      gestureController.update(stable);
      paintDebugMetrics();
    },
    (status) => {
      if (statusEl) statusEl.textContent = status;
      if (/активна|OK/i.test(status)) hideStaffAlert();
    },
    {
      retryAttempts: cfg.cameraRetryAttempts,
      retryDelayMs: cfg.cameraRetryDelayMs,
      maxNumHands: cfg.maxNumHands,
      modelComplexity: cfg.modelComplexity,
      minDetectionConfidence: cfg.minDetectionConfidence,
      minTrackingConfidence: cfg.minTrackingConfidence,
      cameraDeviceId: cfg.cameraDeviceId,
      cameraLabelMatch: cfg.cameraLabelMatch,
      cameraPreferExternal: cfg.cameraPreferExternal,
      onFatal: (msg) => showStaffAlert(msg),
    }
  );

  tracker.start().catch((err) => {
    console.error(err);
    const msg = 'Сбой камеры: ' + (err.message || err);
    if (statusEl) statusEl.textContent = msg;
    showStaffAlert(msg);
  });

  window.addEventListener('pagehide', () => tracker.stop());

  return { tracker, gestures: gestureController, stabilizer };
}

/** Асинхронный старт с подгрузкой gesture-config.json */
export async function startHandUIWithConfig(onEvent, options = {}) {
  const config = await loadGestureConfig();
  return startHandUI(onEvent, { ...options, config: { ...config, ...(options.config || {}) } });
}
