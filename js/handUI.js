// Общий запуск трекинга руки на любой странице.

import { HandTracker } from './handTracker.js';
import { GestureController } from './gestureState.js';
export { saveSelectedPlace, loadSelectedPlace } from './storage.js';

/**
 * @param {(type: string, payload: any) => void} onEvent
 * @param {{ freeCursor?: boolean, dwellEnabled?: boolean }} [options]
 */
export function startHandUI(onEvent, options = {}) {
  const freeCursor = options.freeCursor !== false;
  const dwellEnabled = options.dwellEnabled !== false;

  const cursorEl = document.getElementById('hand-cursor');
  const statusEl = document.getElementById('camera-status');
  const videoEl = document.getElementById('input-video');
  const canvasEl = document.getElementById('debug-canvas');

  if (!videoEl || !canvasEl) {
    console.warn('Элементы камеры не найдены на странице');
    return null;
  }

  if (statusEl) statusEl.textContent = 'Подключение трекера…';

  const gestureController = new GestureController((type, payload) => {
    if (freeCursor && cursorEl) {
      if (type === 'cursor') {
        cursorEl.classList.remove('hidden', 'snapped');
        cursorEl.style.left = `${payload.x}px`;
        cursorEl.style.top = `${payload.y}px`;
      } else if (type === 'lost') {
        // В свободном режиме просто прячем — не оставляем «прилипший» кружок
        cursorEl.classList.add('hidden');
        cursorEl.classList.remove('snapped', 'pinching');
      } else if (type === 'pinchstart' || type === 'pinchmove') {
        cursorEl.classList.add('pinching');
      } else if (type === 'pinchend') {
        cursorEl.classList.remove('pinching');
      }
    } else if (cursorEl && (type === 'pinchstart' || type === 'pinchmove')) {
      cursorEl.classList.add('pinching');
    } else if (cursorEl && type === 'pinchend') {
      cursorEl.classList.remove('pinching');
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

  return tracker;
}
