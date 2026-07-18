import { Gallery } from '../gallery.js';
import { saveSelectedPlace } from '../storage.js';

const statusEl = document.getElementById('camera-status');
const hintEl = document.getElementById('map-focus-hint');
const cursorEl = document.getElementById('hand-cursor');
const listEl = document.getElementById('place-list');

const storyEl = document.getElementById('place-story');
const storyBgEl = document.getElementById('story-bg');
const storyTitleEl = document.getElementById('story-title');
const storyRegionEl = document.getElementById('story-region');
const storyCardsEl = document.getElementById('story-cards');
const storyDotsEl = document.getElementById('story-dots');
const storyPrevBtn = document.getElementById('story-prev');
const storyNextBtn = document.getElementById('story-next');
const storyHintEl = document.querySelector('.story-hint');

let allEvents = [];
let storyOpen = false;
let storyIndex = 0;
let storyCount = 0;
let storySwipeAcc = 0;

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

setStatus('Скрипт карты запущен…');

const gallery = new Gallery(
  document.getElementById('gallery-canvas'),
  (place) => {
    saveSelectedPlace(place);
    openStory(place);
  },
  { focusCursorEl: cursorEl, hintEl, listEl }
);

function setMapInteractive(on) {
  const map = gallery.map;
  if (!map) return;
  try {
    if (on) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
    } else {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
    }
  } catch (_) {}
}

function updateStoryCarousel() {
  const cards = storyCardsEl.querySelectorAll('.story-card');
  cards.forEach((card, idx) => {
    card.classList.remove('is-active', 'is-prev', 'is-next');
    if (idx === storyIndex) card.classList.add('is-active');
    else if (idx === storyIndex - 1) card.classList.add('is-prev');
    else if (idx === storyIndex + 1) card.classList.add('is-next');
  });

  if (storyDotsEl) {
    storyDotsEl.querySelectorAll('.story-dot').forEach((dot, idx) => {
      dot.classList.toggle('is-active', idx === storyIndex);
    });
  }

  if (storyPrevBtn) storyPrevBtn.disabled = storyIndex <= 0 || storyCount === 0;
  if (storyNextBtn) storyNextBtn.disabled = storyIndex >= storyCount - 1 || storyCount === 0;
}

function goStory(delta) {
  if (!storyOpen || storyCount === 0) return;
  const next = Math.max(0, Math.min(storyCount - 1, storyIndex + delta));
  if (next === storyIndex) return;
  storyIndex = next;
  storySwipeAcc = 0;
  updateStoryCarousel();
  setStatus(`Год ${storyIndex + 1}/${storyCount}`);
}

function openStory(place) {
  if (!place || !storyEl) return;
  storyOpen = true;
  storyIndex = 0;
  storySwipeAcc = 0;
  setMapInteractive(false);
  gallery.cursorSnapEnabled = false;

  try {
    if (gallery.map) {
      gallery.map.flyTo([place.lat, place.lng], 13, { duration: 1.1 });
    }
  } catch (err) {
    console.warn(err);
  }

  storyBgEl.style.backgroundImage = place.photo ? `url("${place.photo}")` : 'none';
  storyTitleEl.textContent = place.title;
  storyRegionEl.textContent = place.region || 'Чеченская Республика';

  const events = allEvents
    .filter((ev) => ev.placeId === place.id)
    .sort((a, b) => Number(a.year) - Number(b.year));

  storyCount = events.length;
  storyCardsEl.innerHTML = '';
  if (storyDotsEl) storyDotsEl.innerHTML = '';

  events.forEach((ev, idx) => {
    const card = document.createElement('article');
    card.className = 'story-card';
    card.dataset.index = String(idx);
    const img = ev.image && String(ev.image).startsWith('assets/photos/') ? ev.image : place.photo;
    card.innerHTML = `
      ${img ? `<div class="story-card-img" style="background-image:url('${img}')"></div>` : ''}
      <div class="story-card-body">
        <div class="story-card-year">${ev.year}</div>
        <div class="story-card-title">${ev.title}</div>
        <p class="story-card-text">${ev.description}</p>
      </div>`;
    storyCardsEl.appendChild(card);

    if (storyDotsEl) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'story-dot';
      dot.setAttribute('aria-label', `Год ${ev.year}`);
      dot.addEventListener('click', () => {
        storyIndex = idx;
        updateStoryCarousel();
      });
      storyDotsEl.appendChild(dot);
    }
  });

  if (events.length === 0) {
    storyCardsEl.innerHTML = '<p class="story-empty">Для этого места события ещё не добавлены.</p>';
  }

  if (cursorEl) {
    cursorEl.classList.remove('hidden', 'snapped', 'pinching');
  }
  if (storyHintEl) {
    storyHintEl.textContent = 'Стрелки / колесо / свайп ←→ · кулак/pinch — назад';
  }

  storyEl.classList.remove('hidden');
  storyEl.classList.add('open');
  updateStoryCarousel();
  setStatus(`История: ${place.title}. Листай годы ←→`);
}

function closeStory() {
  if (!storyOpen) return;
  storyOpen = false;
  storyCount = 0;
  storyIndex = 0;
  storySwipeAcc = 0;
  storyEl.classList.remove('open');
  storyEl.classList.add('hidden');
  setMapInteractive(true);
  gallery.cursorSnapEnabled = true;
  try {
    gallery.resetView();
  } catch (_) {}
  setTimeout(() => {
    if (!storyOpen) gallery.snapCursorToFocus();
  }, 400);
  setStatus(`Карта OK · ${gallery.places.length} мест`);
}

const closeBtn = document.getElementById('story-close');
if (closeBtn) closeBtn.addEventListener('click', closeStory);
if (storyPrevBtn) storyPrevBtn.addEventListener('click', () => goStory(-1));
if (storyNextBtn) storyNextBtn.addEventListener('click', () => goStory(1));

/** Карусель годов: мышь, колесо, стрелки */
function setupStoryControls() {
  let dragging = false;
  let startX = 0;
  let activeId = null;

  storyCardsEl.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.story-nav')) return;
    dragging = true;
    startX = e.clientX;
    activeId = e.pointerId;
    storyCardsEl.setPointerCapture(e.pointerId);
  });

  storyCardsEl.addEventListener('pointerup', (e) => {
    if (!dragging || e.pointerId !== activeId) return;
    const dx = e.clientX - startX;
    dragging = false;
    activeId = null;
    if (dx > 60) goStory(-1);
    else if (dx < -60) goStory(1);
  });

  storyCardsEl.addEventListener('pointercancel', () => {
    dragging = false;
    activeId = null;
  });

  const carousel = document.getElementById('story-carousel') || storyEl;
  carousel.addEventListener(
    'wheel',
    (e) => {
      if (!storyOpen) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta > 20) goStory(1);
      else if (delta < -20) goStory(-1);
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (!storyOpen) return;
    if (e.key === 'ArrowLeft') goStory(-1);
    else if (e.key === 'ArrowRight') goStory(1);
    else if (e.key === 'Escape') closeStory();
  });
}

setupStoryControls();

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

    await gallery.load('data/places.json');
    allEvents = await eventsPromise;

    setStatus(`Карта OK · ${gallery.places.length} мест. Кликай список или pinch`);
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
    const { startHandUI } = await import('../handUI.js');
    setStatus('Карта готова. Камера…');
    startHandUI(
      (type, payload) => {
        if (storyOpen) {
          if (type === 'nudge') {
            if (payload.dirX < 0) goStory(-1);
            else if (payload.dirX > 0) goStory(1);
          } else if (type === 'swipe') {
            storySwipeAcc += payload.deltaX || 0;
            if (storySwipeAcc > 70) {
              goStory(-1);
            } else if (storySwipeAcc < -70) {
              goStory(1);
            }
          } else if (type === 'fist' || type === 'pinchconfirm') {
            closeStory();
          }
          return;
        }

        if (type === 'nudge') {
          gallery.handleNudge(payload.dirX, payload.dirY);
        } else if (type === 'pinchconfirm') {
          setStatus('Pinch → открываю место…');
          gallery.confirmFocus();
        } else if (type === 'pinchstart') {
          setStatus('Pinch… держи ~0.2с');
        } else if (type === 'fist') {
          window.location.href = 'index.html';
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
  if (!storyOpen) {
    gallery.map?.invalidateSize();
    gallery.snapCursorToFocus();
  }
});

boot();
