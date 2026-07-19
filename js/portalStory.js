/**
 * Full-bleed Lucy-style place timeline + compare seam.
 */

function yearKey(year) {
  const m = String(year).match(/\d+/);
  return m ? Number(m[0]) : 0;
}

export function createPortalStory(rootEl, { onClose } = {}) {
  const heroA = rootEl.querySelector('[data-hero="a"]');
  const heroB = rootEl.querySelector('[data-hero="b"]');
  const railEl = rootEl.querySelector('[data-rail]');
  const statusEl = rootEl.querySelector('[data-status]');
  const btnPrev = rootEl.querySelector('[data-prev]');
  const btnNext = rootEl.querySelector('[data-next]');
  const backBtn = rootEl.querySelector('[data-back]');
  const placeNameEl = rootEl.querySelector('[data-place-name]');
  const eventTitleEl = rootEl.querySelector('[data-event-title]');
  const eventTeaserEl = rootEl.querySelector('[data-event-teaser]');
  const sheetEl = rootEl.querySelector('[data-story-sheet]');
  const sheetYearEl = rootEl.querySelector('[data-sheet-year]');
  const sheetTitleEl = rootEl.querySelector('[data-sheet-title]');
  const sheetTextEl = rootEl.querySelector('[data-sheet-text]');
  const compareBtn = rootEl.querySelector('[data-compare-btn]');
  const compareEl = rootEl.querySelector('[data-compare]');
  const compareLeft = rootEl.querySelector('[data-compare-left]');
  const compareRight = rootEl.querySelector('[data-compare-right]');
  const compareHandle = rootEl.querySelector('[data-compare-handle]');
  const compareYearA = rootEl.querySelector('[data-compare-year-a]');
  const compareYearB = rootEl.querySelector('[data-compare-year-b]');

  let events = [];
  let index = 0;
  let fallbackPhoto = '';
  let placeTitle = '';
  let frontIsA = true;
  let busy = false;
  let open = false;
  let compareOn = false;
  let comparePos = 50;
  let sheetOpen = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function imageFor(ev) {
    return (ev && ev.image) || fallbackPhoto;
  }

  function activeHero() {
    return frontIsA ? heroA : heroB;
  }

  function idleHero() {
    return frontIsA ? heroB : heroA;
  }

  function setSheet(openSheet) {
    sheetOpen = !!openSheet && !compareOn;
    rootEl.classList.toggle('sheet-open', sheetOpen);
    if (sheetEl) {
      sheetEl.classList.toggle('is-open', sheetOpen);
      sheetEl.setAttribute('aria-hidden', sheetOpen ? 'false' : 'true');
    }
  }

  function setFistProgress(progress) {
    const p = Math.max(0, Math.min(1, progress || 0));
    rootEl.style.setProperty('--fist-progress', String(p));
    rootEl.classList.toggle('fist-holding', p > 0.02);
    if (backBtn) {
      backBtn.style.setProperty('--hold-progress', String(p));
      backBtn.classList.toggle('holding', p > 0.02);
      backBtn.classList.toggle('holding-fist', p > 0.02);
    }
  }

  function updateChrome() {
    const ev = events[index];
    if (!ev) return;
    railEl.querySelectorAll('.rail-year').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === index);
    });
    if (btnPrev) btnPrev.disabled = index <= 0 || compareOn;
    if (btnNext) btnNext.disabled = index >= events.length - 1 || compareOn;
    if (placeNameEl) placeNameEl.textContent = placeTitle;
    if (eventTitleEl) eventTitleEl.textContent = compareOn ? 'Сравнение эпох' : (ev.title || '');
    if (eventTeaserEl) {
      eventTeaserEl.textContent = compareOn
        ? 'Pinch — шов · кулак — выйти из сравнения'
        : (sheetOpen ? 'Свайп вниз — свернуть текст' : 'Свайп вверх — короткий текст эпохи');
    }
    if (sheetYearEl) sheetYearEl.textContent = ev.year || '';
    if (sheetTitleEl) sheetTitleEl.textContent = ev.title || '';
    if (sheetTextEl) {
      const body = (ev.detail && ev.detail.trim()) || ev.description || '';
      sheetTextEl.textContent = body;
    }
    const pair = compareOn ? pickComparePair() : null;
    setStatus(compareOn && pair
      ? `${pair.past.year} ↔ ${pair.present.year}`
      : `${ev.year} · ${index + 1}/${events.length}`);
  }

  function showAt(i, { animate = true } = {}) {
    if (!events.length || compareOn) return;
    const next = Math.max(0, Math.min(events.length - 1, i));
    if (next === index && animate) return;
    if (animate && busy) return;

    const ev = events[next];
    const url = imageFor(ev);
    index = next;
    setSheet(false);

    if (!animate) {
      const front = activeHero();
      const back = idleHero();
      front.style.backgroundImage = `url("${url}")`;
      front.classList.remove('is-back', 'is-leaving');
      front.classList.add('is-front');
      back.classList.remove('is-front', 'is-leaving');
      back.classList.add('is-back');
      front.style.animation = 'none';
      void front.offsetWidth;
      front.style.animation = '';
      updateChrome();
      return;
    }

    busy = true;
    const front = activeHero();
    const back = idleHero();

    back.style.backgroundImage = `url("${url}")`;
    back.style.animation = 'none';
    back.classList.remove('is-front', 'is-leaving', 'is-back');
    void back.offsetWidth;

    front.classList.remove('is-front');
    front.classList.add('is-leaving');
    back.classList.add('is-front');
    frontIsA = !frontIsA;

    updateChrome();

    window.clearTimeout(showAt._t);
    showAt._t = window.setTimeout(() => {
      front.classList.remove('is-leaving');
      front.classList.add('is-back');
      busy = false;
    }, 1050);
  }

  function go(delta) {
    if (compareOn) return;
    showAt(index + delta);
  }

  function setComparePos(pct) {
    comparePos = Math.max(8, Math.min(92, pct));
    if (compareLeft) {
      // clip-path: картинка на весь экран, без «зума» при движении шва
      compareLeft.style.width = '';
      compareLeft.style.clipPath = `inset(0 ${100 - comparePos}% 0 0)`;
    }
    if (compareHandle) compareHandle.style.left = `${comparePos}%`;
  }

  /** Позиция шва по экранной X руки / курсора. */
  function setComparePosFromX(clientX) {
    const rect = (compareEl || rootEl).getBoundingClientRect();
    if (!rect.width) return;
    setComparePos(((clientX - rect.left) / rect.width) * 100);
  }

  /**
   * Пара для шва: текущий кадр ↔ противоположный край таймлайна.
   * В первой половине (ближе к «сейчас») — с самым старым;
   * во второй (в прошлом) — с самым новым.
   * На экране всегда: слева старше, справа новее.
   */
  function pickComparePair() {
    const n = events.length;
    if (n < 2) return null;
    const current = events[index];
    const newest = events[0];
    const oldest = events[n - 1];
    const mid = (n - 1) / 2;
    // index 0 = новое слева; малые индексы → сравниваем со старым краем
    let other = index <= mid ? oldest : newest;
    if (other === current) {
      other = index === 0 ? oldest : newest;
    }
    if (other === current) return null;

    const a = current;
    const b = other;
    const past = yearKey(a.year) <= yearKey(b.year) ? a : b;
    const present = past === a ? b : a;
    return { past, present, current, other };
  }

  function openCompare({ pos } = {}) {
    if (events.length < 2 || !compareEl) return;
    const pair = pickComparePair();
    if (!pair) return;

    setSheet(false);
    const wasOn = compareOn;
    compareOn = true;
    rootEl.classList.add('compare-mode');
    compareEl.hidden = false;
    if (compareLeft) compareLeft.style.backgroundImage = `url("${imageFor(pair.past)}")`;
    if (compareRight) compareRight.style.backgroundImage = `url("${imageFor(pair.present)}")`;
    if (compareYearA) compareYearA.textContent = pair.past.year;
    if (compareYearB) compareYearB.textContent = pair.present.year;
    if (compareBtn) compareBtn.textContent = 'Выйти из сравнения';
    if (typeof pos === 'number') setComparePos(pos);
    else if (!wasOn) setComparePos(50);
    updateChrome();
  }

  function closeCompare() {
    compareOn = false;
    rootEl.classList.remove('compare-mode');
    if (compareEl) compareEl.hidden = true;
    if (compareBtn) compareBtn.textContent = 'Сравнить эпохи';
    updateChrome();
  }

  function toggleCompare() {
    if (compareOn) closeCompare();
    else openCompare();
  }

  function buildRail() {
    railEl.innerHTML = '';
    events.forEach((ev, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rail-year' + (i === index ? ' is-active' : '');
      btn.textContent = ev.year;
      btn.setAttribute('aria-label', `Год ${ev.year}`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (compareOn) closeCompare();
        showAt(i);
      });
      railEl.appendChild(btn);
    });
  }

  function preload(urls) {
    urls.forEach((src) => {
      if (!src) return;
      const img = new Image();
      img.src = src;
    });
  }

  function close() {
    if (!open) return;
    closeCompare();
    setSheet(false);
    setFistProgress(0);
    open = false;
    rootEl.classList.remove('open');
    events = [];
    index = 0;
    onClose?.();
  }

  async function openPlace(place, allEvents) {
    if (!place) return;
    fallbackPhoto = place.photo || place.image;
    placeTitle = place.title || '';
    // Новое слева → старое справа
    events = (allEvents || [])
      .filter((ev) => ev.placeId === place.id)
      .sort((a, b) => yearKey(b.year) - yearKey(a.year));

    index = 0;
    frontIsA = true;
    open = true;
    closeCompare();
    setSheet(false);
    setFistProgress(0);
    rootEl.classList.add('open');

    if (!events.length) {
      heroA.style.backgroundImage = fallbackPhoto ? `url("${fallbackPhoto}")` : 'none';
      heroA.classList.add('is-front');
      heroA.classList.remove('is-back');
      heroB.classList.add('is-back');
      heroB.classList.remove('is-front');
      railEl.innerHTML = '';
      if (placeNameEl) placeNameEl.textContent = placeTitle;
      if (eventTitleEl) eventTitleEl.textContent = '';
      if (eventTeaserEl) eventTeaserEl.textContent = 'Для этого места эпохи ещё не добавлены.';
      setStatus(`${place.title} · нет эпох`);
      return;
    }

    preload(events.map(imageFor));
    buildRail();
    showAt(0, { animate: false });
  }

  function handleGesture(type, payload) {
    if (!open) return false;

    if (type === 'cursor') {
      const fistP = payload.fistProgress || 0;
      setFistProgress(fistP);
      return true;
    }

    // В сравнении: pinch двигает шторку. Вход — pinchconfirm или кнопка.
    if (type === 'pinchstart' || type === 'pinchmove') {
      if (compareOn && payload && typeof payload.x === 'number') {
        setComparePosFromX(payload.x);
      }
      return true;
    }

    if (type === 'pinchconfirm') {
      if (events.length < 2) return true;
      if (!compareOn) {
        openCompare();
        if (payload && typeof payload.x === 'number') setComparePosFromX(payload.x);
      } else if (payload && typeof payload.x === 'number') {
        setComparePosFromX(payload.x);
      }
      return true;
    }

    if (type === 'pinchend') return true;

    if (type === 'nudge') {
      if (compareOn) {
        if (payload.dirX > 0) setComparePos(comparePos + 8);
        else if (payload.dirX < 0) setComparePos(comparePos - 8);
        return true;
      }
      if (payload.dirY < 0) {
        setSheet(true);
        updateChrome();
        return true;
      }
      if (payload.dirY > 0) {
        setSheet(false);
        updateChrome();
        return true;
      }
      // ← новое, → прошлое (таймлайн: новое слева)
      if (payload.dirX > 0) go(1);
      else if (payload.dirX < 0) go(-1);
      return true;
    }

    if (type === 'swipe') return true;

    if (type === 'fist') {
      setFistProgress(0);
      if (compareOn) {
        closeCompare();
        return true;
      }
      close();
      return true;
    }

    if (type === 'lost' || type === 'fistcancel') {
      setFistProgress(0);
      return true;
    }

    return true;
  }

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let pointerId = null;

  rootEl.addEventListener('pointerdown', (e) => {
    if (!open) return;
    if (e.target.closest('a, button')) return;
    if (compareOn && compareEl && !compareEl.hidden) {
      const rect = compareEl.getBoundingClientRect();
      setComparePos(((e.clientX - rect.left) / rect.width) * 100);
      dragging = true;
      pointerId = e.pointerId;
      rootEl.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
    rootEl.setPointerCapture?.(e.pointerId);
  });

  rootEl.addEventListener('pointermove', (e) => {
    if (!dragging || !compareOn) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    const rect = compareEl.getBoundingClientRect();
    setComparePos(((e.clientX - rect.left) / rect.width) * 100);
  });

  rootEl.addEventListener('pointerup', (e) => {
    if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
    if (compareOn) {
      dragging = false;
      pointerId = null;
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    dragging = false;
    pointerId = null;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 56) {
      if (dy < 0) {
        setSheet(true);
        updateChrome();
      } else {
        setSheet(false);
        updateChrome();
      }
      return;
    }
    if (dx > 70) go(-1);
    else if (dx < -70) go(1);
  });

  rootEl.addEventListener('pointercancel', () => {
    dragging = false;
    pointerId = null;
  });

  rootEl.addEventListener(
    'wheel',
    (e) => {
      if (!open) return;
      e.preventDefault();
      if (compareOn) {
        setComparePos(comparePos + (e.deltaY > 0 ? 4 : -4));
        return;
      }
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 18) {
        if (e.deltaY < 0) {
          setSheet(true);
          updateChrome();
        } else if (sheetOpen) {
          setSheet(false);
          updateChrome();
        } else {
          go(1);
        }
        return;
      }
      if (e.deltaX > 20) go(1);
      else if (e.deltaX < -20) go(-1);
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'ArrowLeft') {
      if (compareOn) setComparePos(comparePos - 6);
      else go(-1);
    } else if (e.key === 'ArrowRight') {
      if (compareOn) setComparePos(comparePos + 6);
      else go(1);
    } else if (e.key === 'ArrowUp') {
      if (!compareOn) {
        setSheet(true);
        updateChrome();
      }
    } else if (e.key === 'ArrowDown') {
      if (sheetOpen) {
        setSheet(false);
        updateChrome();
      } else if (compareOn) {
        closeCompare();
      }
    } else if (e.key === 'c' || e.key === 'C') {
      toggleCompare();
    } else if (e.key === 'Escape') {
      if (sheetOpen) {
        setSheet(false);
        updateChrome();
      } else if (compareOn) closeCompare();
      else close();
    }
  });

  btnPrev?.addEventListener('click', () => go(-1));
  btnNext?.addEventListener('click', () => go(1));
  backBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    close();
  });
  compareBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCompare();
  });

  eventTeaserEl?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (compareOn || !events.length) return;
    setSheet(!sheetOpen);
    updateChrome();
  });
  if (eventTeaserEl) eventTeaserEl.style.pointerEvents = 'auto';
  if (eventTeaserEl) eventTeaserEl.style.cursor = 'pointer';

  return {
    openPlace,
    close,
    handleGesture,
    isOpen: () => open,
    isCompare: () => compareOn,
    go,
  };
}
