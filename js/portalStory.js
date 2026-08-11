/**
 * Single-screen time portal.
 * Two hands swipe — next/previous place.
 * Pinch — compare curtain (past ↔ present), drag while held.
 */

function yearKey(year) {
  const m = String(year).match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function eraPair(events, fallbackPhoto) {
  const list = (events || []).slice().sort((a, b) => yearKey(a.year) - yearKey(b.year));
  if (!list.length) return null;

  const preferImage = (arr) => {
    const scored = arr.filter((e) => e.image);
    return scored.length ? scored : arr;
  };

  const modernList = preferImage(list.filter((e) => yearKey(e.year) >= 2020));
  const warList = preferImage(
    list.filter((e) => {
      const y = yearKey(e.year);
      return y >= 1994 && y <= 2000;
    })
  );

  const modern = modernList.length ? modernList[modernList.length - 1] : preferImage(list)[preferImage(list).length - 1];
  let war = warList.length ? warList[0] : list.find((e) => e !== modern && e.image);
  if (!war) war = list.find((e) => e !== modern) || list[0];
  if (!modern || war === modern) return null;

  const modernImg = modern.image || fallbackPhoto;
  const warImg = war.image || fallbackPhoto;
  // Без двух разных кадров место в портал не берём
  if (!modernImg || !warImg || modernImg === warImg) return null;

  const warYear = yearKey(war.year);
  const isWartime = warYear >= 1994 && warYear <= 2000;

  return {
    modern: {
      image: modernImg,
      year: String(modern.year || '2025'),
      label: String(modern.year || '2025'),
      title: modern.title || '',
      detail: (modern.detail && String(modern.detail).trim()) || modern.description || '',
    },
    war: {
      image: warImg,
      year: String(war.year || '1995'),
      label: isWartime ? `Во время войны (${war.year})` : String(war.year || '—'),
      title: war.title || '',
      detail: (war.detail && String(war.detail).trim()) || war.description || '',
    },
  };
}

/** Места, у которых есть обе эпохи. */
export function buildPortalPlaces(places, events) {
  return (places || [])
    .map((place) => {
      const own = (events || []).filter((ev) => ev.placeId === place.id);
      const pair = eraPair(own, place.photo || place.image || '');
      if (!pair) return null;
      return {
        id: place.id,
        title: place.title || '',
        region: place.region || '',
        description: place.description || '',
        ...pair,
      };
    })
    .filter(Boolean);
}

const OPEN_MS = 950;
/** Синхронно с --place-flip-ms в portal.css */
const PLACE_MS = 720;
/** Caption после ~60% slide */
const CAPTION_AT_MS = Math.round(PLACE_MS * 0.6);
/** Минимальная пауза между сменами мест (мс) */
const PLACE_FLIP_COOLDOWN_MS = 1600;

export function createPortalStory(rootEl, { onExit } = {}) {
  const heroA = rootEl.querySelector('[data-hero="a"]');
  const heroB = rootEl.querySelector('[data-hero="b"]');
  const gateEl = rootEl.querySelector('[data-portal-gate]');
  const captionPlaceEl = rootEl.querySelector('[data-caption-place]');
  const captionEraEl = rootEl.querySelector('[data-caption-era]');
  const statusEl = rootEl.querySelector('[data-status]');
  const compareEl = rootEl.querySelector('[data-compare]');
  const compareLeft = rootEl.querySelector('[data-compare-left]');
  const compareRight = rootEl.querySelector('[data-compare-right]');
  const compareHandle = rootEl.querySelector('[data-compare-handle]');
  const compareYearA = rootEl.querySelector('[data-compare-year-a]');
  const compareYearB = rootEl.querySelector('[data-compare-year-b]');
  const sheetEl = rootEl.querySelector('[data-story-sheet]');
  const sheetYearEl = rootEl.querySelector('[data-sheet-year]');
  const sheetTitleEl = rootEl.querySelector('[data-sheet-title]');
  const sheetTextEl = rootEl.querySelector('[data-sheet-text]');

  let places = [];
  let index = 0;
  let frontIsA = true;
  let busy = false;
  let compareOn = false;
  let comparePos = 50;
  let dragging = false;
  let placeSwipeGuardUntil = 0;
  let lastPlaceDirX = 0;
  let sheetOpen = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  const activeHero = () => (frontIsA ? heroA : heroB);
  const idleHero = () => (frontIsA ? heroB : heroA);
  const currentPlace = () => places[index] || null;

  function setSheet(openSheet) {
    sheetOpen = !!openSheet && !compareOn;
    rootEl.classList.toggle('sheet-open', sheetOpen);
    if (sheetEl) {
      sheetEl.classList.toggle('is-open', sheetOpen);
      sheetEl.setAttribute('aria-hidden', sheetOpen ? 'false' : 'true');
    }
    updateCaption();
  }

  function fillSheet() {
    const place = currentPlace();
    if (!place) return;
    const era = place.modern;
    if (sheetYearEl) sheetYearEl.textContent = place.region || era?.label || '';
    if (sheetTitleEl) sheetTitleEl.textContent = place.title || '';
    if (sheetTextEl) {
      const body =
        (place.description && place.description.trim()) ||
        era?.detail ||
        '';
      sheetTextEl.textContent = body;
    }
  }

  function updateCaption() {
    const place = currentPlace();
    if (captionPlaceEl) captionPlaceEl.textContent = place?.title || '';
    if (captionEraEl) {
      captionEraEl.textContent = compareOn
        ? `${place?.war?.year || ''} ←→ ${place?.modern?.year || ''}`
        : (place?.modern?.label || '');
    }
    fillSheet();
    if (place) {
      setStatus(
        compareOn
          ? `${place.title} · шторка ${Math.round(comparePos)}%`
          : sheetOpen
            ? `${place.title} · описание`
            : `${place.title} · ${place.modern?.label || ''}`
      );
    }
  }

  function setFistProgress(progress) {
    const p = Math.max(0, Math.min(1, progress || 0));
    rootEl.style.setProperty('--fist-progress', String(p));
    rootEl.classList.toggle('fist-holding', p > 0.02);
    if (p > 0.02) rootEl.classList.remove('pinch-holding');
  }

  /** Кольцо прогресса до открытия шторки (только pinch). */
  function setPinchProgress(progress) {
    const p = Math.max(0, Math.min(1, progress || 0));
    rootEl.style.setProperty('--fist-progress', String(p));
    rootEl.classList.toggle('pinch-holding', p > 0.02);
    if (p > 0.02) rootEl.classList.remove('fist-holding');
  }

  function clearHoldProgress() {
    rootEl.style.setProperty('--fist-progress', '0');
    rootEl.classList.remove('fist-holding', 'pinch-holding');
  }

  function preloadPlace(i) {
    const place = places[i];
    if (!place) return;
    [place.modern?.image, place.war?.image].forEach((src) => {
      if (!src) return;
      const img = new Image();
      img.src = src;
    });
  }

  function playGate(kind) {
    if (!gateEl) return;
    gateEl.classList.remove('is-open', 'is-switch');
    void gateEl.offsetWidth;
    gateEl.classList.add(kind === 'open' ? 'is-open' : 'is-switch');
    window.clearTimeout(playGate._t);
    playGate._t = window.setTimeout(() => {
      gateEl.classList.remove('is-open', 'is-switch');
    }, OPEN_MS);
  }

  function setHeroImage(heroEl, url) {
    if (!heroEl) return;
    const media = heroEl.querySelector('.hero-media');
    const value = url ? `url("${url}")` : 'none';
    if (media) media.style.backgroundImage = value;
    else heroEl.style.backgroundImage = value;
  }

  function paintInstant() {
    const place = currentPlace();
    const front = activeHero();
    const back = idleHero();
    const url = place?.modern?.image;
    setHeroImage(front, url);
    front.className = 'hero is-front';
    back.className = 'hero is-back';
    updateCaption();
  }

  function setComparePos(pct) {
    comparePos = Math.max(8, Math.min(92, pct));
    if (compareLeft) {
      compareLeft.style.width = '';
      compareLeft.style.clipPath = `inset(0 ${100 - comparePos}% 0 0)`;
    }
    if (compareHandle) compareHandle.style.left = `${comparePos}%`;
    if (compareOn) updateCaption();
  }

  function setComparePosFromX(clientX) {
    const rect = (compareEl || rootEl).getBoundingClientRect();
    if (!rect.width) return;
    setComparePos(((clientX - rect.left) / rect.width) * 100);
  }

  function openCompare({ pos } = {}) {
    const place = currentPlace();
    if (!place || !compareEl) return;

    setSheet(false);
    const wasOn = compareOn;
    compareOn = true;
    rootEl.classList.add('compare-mode');
    compareEl.hidden = false;

    if (compareLeft) compareLeft.style.backgroundImage = place.war?.image ? `url("${place.war.image}")` : 'none';
    if (compareRight) compareRight.style.backgroundImage = place.modern?.image ? `url("${place.modern.image}")` : 'none';
    if (compareYearA) compareYearA.textContent = place.war?.year || '';
    if (compareYearB) compareYearB.textContent = place.modern?.year || '';

    if (typeof pos === 'number') setComparePos(pos);
    else if (!wasOn) setComparePos(50);
    else updateCaption();
  }

  function closeCompare() {
    if (!compareOn) return;
    compareOn = false;
    rootEl.classList.remove('compare-mode');
    if (compareEl) compareEl.hidden = true;
    updateCaption();
  }

  /** @param {number} step +1 вправо, -1 влево (как dirX из nudge) */
  function goPlace(step) {
    if (busy || places.length < 2) return;
    setSheet(false);
    closeCompare();
    index = (index + step + places.length) % places.length;
    preloadPlace((index + step + places.length) % places.length);

    const place = currentPlace();
    if (!place) return;

    busy = true;
    const front = activeHero();
    const back = idleHero();
    // Рука влево (step < 0): уход влево, вход справа. Рука вправо: уход вправо, вход слева.
    const enterClass = step < 0 ? 'enter-from-right' : 'enter-from-left';
    const leaveClass = step < 0 ? 'leave-to-left' : 'leave-to-right';

    window.clearTimeout(goPlace._captionT);
    window.clearTimeout(goPlace._t);
    window.clearTimeout(goPlace._cueT);

    // Один непрерывный flip: freeze Ken Burns, затем параллельные leave/enter keyframes
    rootEl.classList.add('is-place-flipping');
    rootEl.classList.remove('edge-cue-left', 'edge-cue-right');

    setHeroImage(back, place.modern?.image);
    back.className = 'hero';
    void back.offsetWidth;

    front.classList.remove('is-front');
    front.classList.add(leaveClass);
    back.classList.add(enterClass);
    frontIsA = !frontIsA;

    goPlace._captionT = window.setTimeout(() => {
      updateCaption();
    }, CAPTION_AT_MS);

    goPlace._t = window.setTimeout(() => {
      // Стабилизация после slide: финальные классы без transform-скачка
      front.className = 'hero is-back';
      back.className = 'hero is-front';
      void back.offsetWidth;
      rootEl.classList.remove('is-place-flipping');
      busy = false;
    }, PLACE_MS);
  }

  function start(portalPlaces, startIndex = 0) {
    places = portalPlaces || [];
    if (!places.length) {
      setStatus('Нет мест с двумя эпохами');
      return;
    }
    index = Math.max(0, Math.min(places.length - 1, startIndex));
    frontIsA = true;
    busy = true;
    compareOn = false;

    places.forEach((_, i) => preloadPlace(i));
    rootEl.classList.add('open', 'is-opening');
    paintInstant();
    playGate('open');

    window.clearTimeout(start._t);
    start._t = window.setTimeout(() => {
      rootEl.classList.remove('is-opening');
      busy = false;
    }, OPEN_MS);
  }

  function exit() {
    clearHoldProgress();
    onExit?.();
  }

  function handleGesture(type, payload) {
    if (type === 'cursor') {
      const fistP = payload?.fistProgress || 0;
      const pinchP = payload?.pinchProgress || 0;
      if (fistP > 0.02) setFistProgress(fistP);
      else if (pinchP > 0.02 && !compareOn) setPinchProgress(pinchP);
      else if (fistP <= 0.02 && pinchP <= 0.02) clearHoldProgress();
      return true;
    }

    if (type === 'lost' || type === 'fistcancel') {
      clearHoldProgress();
      return true;
    }

    if (type === 'twohandswipe' || type === 'twohand') {
      // Двуручные жесты больше не листают — только одна рука
      return true;
    }

    // Одна рука: ←→ место, ↑ описание, ↓ свернуть
    if (type === 'nudge') {
      if (compareOn || busy) return true;
      const dirX = payload?.dirX || 0;
      const dirY = payload?.dirY || 0;

      if (dirY < 0) {
        setSheet(true);
        return true;
      }
      if (dirY > 0) {
        setSheet(false);
        return true;
      }
      if (!dirX) return true;

      const now = performance.now();
      if (now < placeSwipeGuardUntil) return true;

      lastPlaceDirX = dirX;
      placeSwipeGuardUntil = now + PLACE_FLIP_COOLDOWN_MS;
      clearHoldProgress();
      goPlace(dirX < 0 ? -1 : 1);
      return true;
    }

    if (type === 'swipe') {
      return true;
    }

    // Шторка ТОЛЬКО после удержания pinch (confirm). Старт/движение до confirm — игнор.
    if (type === 'pinchstart') {
      return true;
    }

    if (type === 'pinchconfirm') {
      clearHoldProgress();
      setSheet(false);
      openCompare();
      if (payload && typeof payload.x === 'number') setComparePosFromX(payload.x);
      return true;
    }

    if (type === 'pinchmove') {
      if (compareOn && payload && typeof payload.x === 'number') {
        setComparePosFromX(payload.x);
      }
      return true;
    }

    if (type === 'pinchend') {
      clearHoldProgress();
      return true;
    }

    if (type === 'fist') {
      clearHoldProgress();
      if (sheetOpen) {
        setSheet(false);
        return true;
      }
      if (compareOn) {
        closeCompare();
        return true;
      }
      exit();
      return true;
    }

    return true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      if (compareOn) setComparePos(comparePos + 6);
      else if (performance.now() >= placeSwipeGuardUntil) {
        placeSwipeGuardUntil = performance.now() + PLACE_FLIP_COOLDOWN_MS;
        goPlace(1);
      }
    } else if (e.key === 'ArrowLeft') {
      if (compareOn) setComparePos(comparePos - 6);
      else if (performance.now() >= placeSwipeGuardUntil) {
        placeSwipeGuardUntil = performance.now() + PLACE_FLIP_COOLDOWN_MS;
        goPlace(-1);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!compareOn) setSheet(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSheet(false);
    } else if (e.key === ' ') {
      e.preventDefault();
      if (compareOn) closeCompare();
      else openCompare();
    } else if (e.key === 'Escape') {
      if (sheetOpen) setSheet(false);
      else if (compareOn) closeCompare();
      else exit();
    }
  });

  // Клик по подписи — открыть/закрыть описание места
  rootEl.querySelector('.portal-caption')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (compareOn) return;
    setSheet(!sheetOpen);
  });

  // Мышь: только двойной клик открывает/закрывает шторку (не мешает демо)
  rootEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('a, button, .portal-caption, .story-sheet')) return;
    if (compareOn) closeCompare();
    else openCompare({ pos: ((e.clientX - rootEl.getBoundingClientRect().left) / rootEl.getBoundingClientRect().width) * 100 });
  });

  rootEl.addEventListener('pointerdown', (e) => {
    if (!compareOn) return;
    if (e.target.closest('a, button, .story-sheet')) return;
    dragging = true;
    setComparePosFromX(e.clientX);
    rootEl.setPointerCapture?.(e.pointerId);
  });

  rootEl.addEventListener('pointermove', (e) => {
    if (!dragging || !compareOn) return;
    setComparePosFromX(e.clientX);
  });

  rootEl.addEventListener('pointerup', () => {
    dragging = false;
  });

  return {
    start,
    handleGesture,
    goPlace,
    openCompare,
    closeCompare,
    setSheet,
    isOpen: () => true,
    isCompare: () => compareOn,
  };
}
