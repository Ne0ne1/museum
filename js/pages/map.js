import { Gallery } from '../gallery.js?v=8';
import { saveSelectedPlace } from '../storage.js';
import { createPortalStory } from '../portalStory.js?v=6';

const statusEl = document.getElementById('camera-status');
const hintEl = document.getElementById('map-focus-hint');
const cursorEl = document.getElementById('hand-cursor');
const listEl = document.getElementById('place-list');
const listTitleEl = document.getElementById('place-list-title');

let allEvents = [];

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log('[map]', msg);
}

window.addEventListener('error', (e) => {
  setStatus('JS ошибка: ' + (e.message || e.error));
});
window.addEventListener('unhandledrejection', (e) => {
  setStatus('Promise ошибка: ' + (e.reason?.message || e.reason));
});

setStatus('Скрипт карты v-districts…');

let gallery;

const portal = createPortalStory(document.getElementById('place-portal'), {
  onClose: () => {
    if (gallery) {
      gallery.clearHoldProgress();
      gallery.resetView();
      setStatus(
        gallery.isInDistrict()
          ? `Район: ${gallery.activeDistrict?.title || ''} · ${gallery.places.length} мест`
          : `Карта OK · ${gallery.districts.length} районов`
      );
    }
  },
});

gallery = new Gallery(
  document.getElementById('gallery-canvas'),
  (place) => {
    saveSelectedPlace(place);
    gallery.clearHoldProgress();
    setStatus(`Портал: ${place.title}`);
    portal.openPlace(place, allEvents);
  },
  { focusCursorEl: cursorEl, hintEl, listEl, listTitleEl }
);

async function boot() {
  try {
    setStatus('Загрузка карты…');
    if (typeof L === 'undefined') {
      throw new Error('Leaflet не загрузился');
    }

    const eventsPromise = fetch('data/events.json').then((r) => {
      if (!r.ok) throw new Error('events.json ' + r.status);
      return r.json();
    });

    await gallery.load();
    allEvents = await eventsPromise;

    setStatus(`Карта OK · ${gallery.districts.length} районов · ${gallery.allPlaces.length} мест`);
    requestAnimationFrame(() => {
      gallery.map?.invalidateSize();
      gallery._applyFocus(false);
    });
    setTimeout(() => gallery.map?.invalidateSize(), 250);
  } catch (err) {
    console.error(err);
    setStatus('Ошибка карты: ' + err.message);
    return;
  }

  try {
    const { startHandUI } = await import('../handUI.js?v=10');
    setStatus('Карта готова. Камера…');
    startHandUI(
      (type, payload) => {
        if (portal.isOpen()) {
          gallery.clearHoldProgress();
          if (type === 'fist') setStatus('Назад к карте');
          portal.handleGesture(type, payload);
          return;
        }

        if (type === 'cursor') {
          const fistP = payload.fistProgress || 0;
          const pinchP = payload.pinchProgress || 0;
          if (fistP > 0.02) {
            gallery.setHoldProgress(fistP, 'fist');
            setStatus(`Кулак ${Math.round(fistP * 100)}% — назад`);
          } else if (pinchP > 0.02) {
            gallery.setHoldProgress(pinchP, 'pinch');
            setStatus(`Pinch ${Math.round(pinchP * 100)}% — выбрать`);
          } else {
            gallery.clearHoldProgress();
          }
        } else if (type === 'lost' || type === 'pinchend' || type === 'fistcancel') {
          gallery.clearHoldProgress();
        } else if (type === 'nudge') {
          gallery.handleNudge(payload.dirX, payload.dirY);
        } else if (type === 'pinchconfirm') {
          gallery.clearHoldProgress();
          if (gallery.mode === 'districts') {
            setStatus('Pinch → приближаю район…');
          } else {
            setStatus('Pinch → открываю место…');
          }
          gallery.confirmFocus();
        } else if (type === 'pinchstart') {
          setStatus('Pinch… обводка точки');
        } else if (type === 'fist') {
          gallery.clearHoldProgress();
          if (gallery.exitToDistricts()) {
            setStatus(`Районы · ${gallery.districts.length}`);
          } else {
            window.location.href = 'index.html';
          }
        } else if (type === 'twohand') {
          gallery.zoomByDelta(payload.delta);
        }
      },
      { freeCursor: false, dwellEnabled: false, hideCursor: true }
    );
  } catch (err) {
    console.warn(err);
    setStatus('Карта без камеры: ' + err.message);
  }
}

window.addEventListener('resize', () => {
  if (!portal.isOpen()) {
    gallery.map?.invalidateSize();
  }
});

boot();
