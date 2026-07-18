import { Gallery } from '../gallery.js?v=6';
import { saveSelectedPlace } from '../storage.js';
import { createPortalStory } from '../portalStory.js?v=5';

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
      gallery.cursorSnapEnabled = true;
      gallery.resetView();
      setTimeout(() => gallery.snapCursorToFocus(), 200);
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
    gallery.cursorSnapEnabled = false;
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
      gallery.snapCursorToFocus();
    });
    setTimeout(() => gallery.map?.invalidateSize(), 250);
  } catch (err) {
    console.error(err);
    setStatus('Ошибка карты: ' + err.message);
    return;
  }

  try {
    const { startHandUI } = await import('../handUI.js?v=9');
    setStatus('Карта готова. Камера…');
    startHandUI(
      (type, payload) => {
        if (type === 'cursor' && payload.fistProgress > 0.02) {
          const pct = Math.round(payload.fistProgress * 100);
          setStatus(`Кулак ${pct}% — держи 2 сек`);
        }

        if (portal.isOpen()) {
          if (type === 'fist') setStatus('Назад к карте');
          portal.handleGesture(type, payload);
          return;
        }

        if (type === 'nudge') {
          gallery.handleNudge(payload.dirX, payload.dirY);
        } else if (type === 'pinchconfirm') {
          if (gallery.mode === 'districts') {
            setStatus('Pinch → приближаю район…');
          } else {
            setStatus('Pinch → открываю место…');
          }
          gallery.confirmFocus();
        } else if (type === 'pinchstart') {
          setStatus('Pinch… держи ~0.2с');
        } else if (type === 'fist') {
          if (gallery.exitToDistricts()) {
            setStatus(`Районы · ${gallery.districts.length}`);
          } else {
            window.location.href = 'index.html';
          }
        } else if (type === 'twohand') {
          gallery.zoomByDelta(payload.delta);
        }
      },
      { freeCursor: true, dwellEnabled: false }
    );
  } catch (err) {
    console.warn(err);
    setStatus('Карта без камеры: ' + err.message);
  }
}

window.addEventListener('resize', () => {
  if (!portal.isOpen()) {
    gallery.map?.invalidateSize();
    gallery.snapCursorToFocus();
  }
});

boot();
