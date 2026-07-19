// Общий запуск трекинга руки на любой странице.

import { HandTracker } from './handTracker.js?v=4';
import { GestureController } from './gestureState.js?v=14';
export { saveSelectedPlace, loadSelectedPlace } from './storage.js';

/**
 * @param {(type: string, payload: any) => void} onEvent
 * @param {{ freeCursor?: boolean, dwellEnabled?: boolean, hideCursor?: boolean }} [options]
 */
export function startHandUI(onEvent, options = {}) {
  const freeCursor = options.freeCursor !== false;
  const dwellEnabled = options.dwellEnabled !== false;
  const hideCursor = options.hideCursor === true;

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
  }, { dwellEnabled });

  const tracker = new HandTracker(
    videoEl,
    canvasEl,
    (landmarks) => gestureController.update(landmarks),
    (status) => {
      if (statusEl) statusEl.textContent = status;
    }
  );

  tracker.start().catch((err) => {
    console.error(err);
    if (statusEl) statusEl.textContent = 'Сбой: ' + (err.message || err);
  });

  window.addEventListener('pagehide', () => tracker.stop());

  return { tracker, gestures: gestureController };
}
