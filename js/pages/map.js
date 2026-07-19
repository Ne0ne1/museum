import { Gallery } from '../gallery.js?v=13';
import { saveSelectedPlace } from '../storage.js';
import { createPortalStory } from '../portalStory.js?v=15';

const statusEl = document.getElementById('camera-status');
const hintEl = document.getElementById('map-focus-hint');
const cursorEl = document.getElementById('hand-cursor');
const listEl = document.getElementById('place-list');
const listTitleEl = document.getElementById('place-list-title');

let allEvents = [];
let gestures = null;

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log('[map]', msg);
}

const FIST_MS = {
  portal: 2000,    // фото / портал эпох
  districts: 3000, // карта районов → на старт
  places: 2000,    // места → к районам
};

function syncFistHoldMs() {
  if (!gestures?.setFistHoldMs) return;
  if (portal.isOpen()) {
    gestures.setFistHoldMs(FIST_MS.portal);
    return;
  }
  if (gallery?.mode === 'places') {
    gestures.setFistHoldMs(FIST_MS.places);
    return;
  }
  gestures.setFistHoldMs(FIST_MS.districts);
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
    syncFistHoldMs();
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
    syncFistHoldMs();
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
    const { startHandUI } = await import('../handUI.js?v=14');
    setStatus('Карта готова. Камера…');
    const hand = startHandUI(
      (type, payload) => {
        if (portal.isOpen()) {
          gallery.clearHoldProgress();
          if (type === 'cursor') {
            const fistP = payload.fistProgress || 0;
            if (fistP > 0.02) {
              const label = portal.isCompare?.() ? 'выйти из сравнения' : 'назад (2 сек)';
              setStatus(`Кулак ${Math.round(fistP * 100)}% — ${label}`);
            }
          } else if (type === 'fist') {
            setStatus(portal.isCompare?.() ? 'Выход из сравнения…' : 'Назад к карте');
          }
          portal.handleGesture(type, payload);
          return;
        }

        if (type === 'cursor') {
          const fistP = payload.fistProgress || 0;
          const pinchP = payload.pinchProgress || 0;
          if (fistP > 0.02) {
            gallery.setHoldProgress(fistP, 'fist');
            const sec = gallery.mode === 'districts' ? 3 : 2;
            setStatus(`Кулак ${Math.round(fistP * 100)}% — назад (${sec} сек)`);
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
          syncFistHoldMs();
        } else if (type === 'pinchstart') {
          setStatus('Pinch… обводка точки');
        } else if (type === 'fist') {
          gallery.clearHoldProgress();
          if (gallery.exitToDistricts()) {
            setStatus(`Районы · ${gallery.districts.length}`);
          } else {
            window.location.href = 'index.html';
          }
          syncFistHoldMs();
        } else if (type === 'twohand') {
          gallery.zoomByDelta(payload.delta);
        }
      },
      { freeCursor: false, dwellEnabled: false, hideCursor: true }
    );
    gestures = hand?.gestures || null;
    syncFistHoldMs();
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
