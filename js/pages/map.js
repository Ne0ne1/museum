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

let allEvents = [];
let storyOpen = false;

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

setStatus('Скрипт карты OK — грузим места…');

const gallery = new Gallery(
  document.getElementById('gallery-canvas'),
  (place) => {
    saveSelectedPlace(place);
    openStory(place);
  },
  { focusCursorEl: cursorEl, hintEl, listEl }
);

function openStory(place) {
  storyOpen = true;

  // Красивый подлёт камеры карты к месту
  gallery.map.flyTo([place.lat, place.lng], 13, { duration: 1.1 });

  storyBgEl.style.backgroundImage = place.photo ? `url("${place.photo}")` : 'none';
  storyTitleEl.textContent = place.title;
  storyRegionEl.textContent = place.region || 'Чеченская Республика';

  const events = allEvents
    .filter((ev) => ev.placeId === place.id)
    .sort((a, b) => Number(a.year) - Number(b.year));

  storyCardsEl.innerHTML = '';
  events.forEach((ev, idx) => {
    const card = document.createElement('article');
    card.className = 'story-card';
    card.style.transitionDelay = `${0.15 + idx * 0.12}s`;
    const img = ev.image && ev.image.startsWith('assets/photos/') ? ev.image : place.photo;
    card.innerHTML = `
      ${img ? `<div class="story-card-img" style="background-image:url('${img}')"></div>` : ''}
      <div class="story-card-body">
        <div class="story-card-year">${ev.year}</div>
        <div class="story-card-title">${ev.title}</div>
        <p class="story-card-text">${ev.description}</p>
      </div>`;
    storyCardsEl.appendChild(card);
  });

  if (events.length === 0) {
    storyCardsEl.innerHTML = '<p class="story-empty">Для этого места события ещё не добавлены.</p>';
  }

  if (cursorEl) cursorEl.classList.add('hidden');
  storyEl.classList.remove('hidden');
  // Плашки въезжают после подлёта карты
  setTimeout(() => storyEl.classList.add('open'), 650);
  storyCardsEl.scrollLeft = 0;
}

function closeStory() {
  if (!storyOpen) return;
  storyOpen = false;
  storyEl.classList.remove('open');
  setTimeout(() => {
    storyEl.classList.add('hidden');
    gallery.resetView();
    gallery.snapCursorToFocus();
  }, 350);
}

document.getElementById('story-close').addEventListener('click', closeStory);

async function boot() {
  try {
    const [, eventsRes] = await Promise.all([
      gallery.load('data/places.json'),
      fetch('data/events.json'),
    ]);
    allEvents = await eventsRes.json();
    setStatus(`Мест: ${gallery.places.length}. Ладонь — точки. Pinch — открыть. Кулак — назад.`);
    requestAnimationFrame(() => gallery.snapCursorToFocus());
  } catch (err) {
    console.error(err);
    setStatus('Ошибка данных: ' + err.message);
    return;
  }

  try {
    const { startHandUI } = await import('../handUI.js');
    setStatus('Данные загружены. Подключаем камеру…');
    startHandUI(
      (type, payload) => {
        if (storyOpen) {
          if (type === 'swipe') {
            storyCardsEl.scrollLeft -= payload.deltaX * 2.2;
          } else if (type === 'fist') {
            closeStory();
          }
          return;
        }

        switch (type) {
          case 'nudge':
            gallery.handleNudge(payload.dirX, payload.dirY);
            break;
          case 'lost':
            gallery.handleLost();
            break;
          case 'pinchconfirm':
            gallery.confirmFocus();
            break;
          case 'fist':
            window.location.href = 'index.html';
            break;
          default:
            break;
        }
      },
      { freeCursor: false, dwellEnabled: false }
    );
  } catch (err) {
    console.warn(err);
    setStatus('Ошибка трекера: ' + err.message);
  }
}

window.addEventListener('resize', () => gallery.snapCursorToFocus());
boot();
