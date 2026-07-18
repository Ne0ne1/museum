/**
 * Full-bleed Lucy-style place timeline.
 * Used from map.html (overlay) and story-prototype.html (standalone).
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

  let events = [];
  let index = 0;
  let fallbackPhoto = '';
  let frontIsA = true;
  let busy = false;
  let open = false;

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

  function updateChrome() {
    const ev = events[index];
    if (!ev) return;
    railEl.querySelectorAll('.rail-year').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === index);
    });
    if (btnPrev) btnPrev.disabled = index <= 0;
    if (btnNext) btnNext.disabled = index >= events.length - 1;
    setStatus(`${ev.year} · ${index + 1}/${events.length}`);
  }

  function showAt(i, { animate = true } = {}) {
    if (!events.length) return;
    const next = Math.max(0, Math.min(events.length - 1, i));
    if (next === index && animate) return;
    if (animate && busy) return;

    const ev = events[next];
    const url = imageFor(ev);
    index = next;

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

    // Новый кадр снизу: без рывка масштаба
    back.style.backgroundImage = `url("${url}")`;
    back.style.animation = 'none';
    back.classList.remove('is-front', 'is-leaving', 'is-back');
    void back.offsetWidth;

    // Старый уходит мягко, новый проявляется поверх
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
    showAt(index + delta);
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
    open = false;
    rootEl.classList.remove('open');
    events = [];
    index = 0;
    onClose?.();
  }

  async function openPlace(place, allEvents) {
    if (!place) return;
    fallbackPhoto = place.photo || place.image;
    events = (allEvents || [])
      .filter((ev) => ev.placeId === place.id)
      .sort((a, b) => yearKey(a.year) - yearKey(b.year));

    index = 0;
    frontIsA = true;
    open = true;
    rootEl.classList.add('open');

    if (!events.length) {
      heroA.style.backgroundImage = fallbackPhoto ? `url("${fallbackPhoto}")` : 'none';
      heroA.classList.add('is-front');
      heroA.classList.remove('is-back');
      heroB.classList.add('is-back');
      heroB.classList.remove('is-front');
      railEl.innerHTML = '';
      setStatus(`${place.title} · нет эпох`);
      return;
    }

    preload(events.map(imageFor));
    buildRail();
    showAt(0, { animate: false });
    setStatus(`${place.title} · ${events.length} эпох`);
  }

  /**
   * Жесты портала: горизонтальный взмах ладонью = смена года.
   * Только nudge (один взмах → один год), continuous swipe игнорируем — иначе двойной шаг.
   */
  function handleGesture(type, payload) {
    if (!open) return false;

    if (type === 'nudge') {
      // Мах вправо (на экране) → будущее, влево → прошлое
      if (payload.dirX > 0) go(1);
      else if (payload.dirX < 0) go(-1);
      return true;
    }

    // Continuous swipe: быстрый «мах» тоже переключает, но реже чем nudge
    if (type === 'swipe') {
      return true;
    }

    if (type === 'fist') {
      close();
      return true;
    }

    // pinch на портале не закрывает — только кулак / кнопка назад
    return true;
  }

  let dragging = false;
  let startX = 0;
  let pointerId = null;

  rootEl.addEventListener('pointerdown', (e) => {
    if (!open) return;
    if (e.target.closest('a, button')) return;
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    pointerId = e.pointerId;
    rootEl.setPointerCapture?.(e.pointerId);
  });

  rootEl.addEventListener('pointerup', (e) => {
    if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
    const dx = e.clientX - startX;
    dragging = false;
    pointerId = null;
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
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta > 20) go(1);
      else if (delta < -20) go(-1);
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Escape') close();
  });

  btnPrev?.addEventListener('click', () => go(-1));
  btnNext?.addEventListener('click', () => go(1));
  backBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    close();
  });

  return {
    openPlace,
    close,
    handleGesture,
    isOpen: () => open,
    go,
  };
}
