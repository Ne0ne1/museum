import { Timeline } from '../timeline.js';
import { loadSelectedPlace } from '../storage.js';

const statusEl = document.getElementById('camera-status');
const place = loadSelectedPlace();

if (!place) {
  window.location.replace('portal.html');
  throw new Error('Место не выбрано');
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

setStatus('Таймлайн: загрузка событий…');

const timeline = new Timeline(
  document.getElementById('timeline-track'),
  document.getElementById('timeline-detail'),
  document.getElementById('timeline-place-title'),
  document.getElementById('year-hint'),
  document.getElementById('timeline-place-region')
);

timeline.load().then(() => {
  timeline.openForPlace(place);
  setStatus('Ладонь — время. Dwell — карточка. Кулак — назад к карте.');
}).catch((err) => {
  setStatus('Ошибка events.json: ' + err.message);
});

import('../handUI.js')
  .then(({ startHandUI }) => {
    startHandUI(
      (type, payload) => {
        switch (type) {
          case 'swipe':
            timeline.handleSwipe(payload.deltaX);
            break;
          case 'fist':
            window.location.href = 'portal.html';
            break;
          case 'dwellprogress':
            timeline.handleDwellProgress(payload.el, payload.progress);
            break;
          case 'dwellcomplete':
            timeline.handleDwellComplete(payload.el);
            break;
          default:
            break;
        }
      },
      { freeCursor: true, dwellEnabled: true }
    );
  })
  .catch((err) => {
    console.warn(err);
    setStatus('Ошибка трекера: ' + err.message);
  });
