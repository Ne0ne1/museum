// Таймлайн выбранного места: свайп ладонью — путешествие по времени
 // (влево = прошлое, вправо = будущее). Dwell/клик — детали события.

export class Timeline {
  constructor(trackEl, detailEl, titleEl, yearHintEl, regionEl) {
    this.trackEl = trackEl;
    this.detailEl = detailEl;
    this.titleEl = titleEl;
    this.yearHintEl = yearHintEl;
    this.regionEl = regionEl;
    this.offset = 0;
    this.minOffset = 0;
    this.allEvents = [];
    this.events = [];
    this.place = null;
    this.activeIndex = 0;
  }

  async load(url = 'data/events.json') {
    const res = await fetch(url);
    this.allEvents = await res.json();
  }

  /** Открыть историю конкретного места (после выбора на карте). */
  openForPlace(place) {
    this.place = place;
    this.events = this.allEvents
      .filter((ev) => ev.placeId === place.id)
      .sort((a, b) => Number(a.year) - Number(b.year));

    if (this.titleEl) {
      this.titleEl.textContent = place.title;
    }
    if (this.regionEl) {
      this.regionEl.textContent = place.region || 'Чеченская Республика';
    }

    this.offset = 0;
    this.activeIndex = Math.max(0, this.events.length - 1); // старт «сегодня» = последнее событие
    this.detailEl.classList.add('hidden');
    this._render();
    this._centerOnActive();
    this._updateYearHint();
  }

  _render() {
    this.trackEl.innerHTML = '';

    if (this.events.length === 0) {
      this.trackEl.innerHTML = '<p class="timeline-empty">Для этого места пока нет событий.</p>';
      this.minOffset = 0;
      return;
    }

    this.events.forEach((ev, idx) => {
      const card = document.createElement('div');
      card.className = 'timeline-card dwell-target';
      card.dataset.index = String(idx);
      card.innerHTML = `
        <div class="dwell-progress"></div>
        <div class="year">${ev.year}</div>
        <div class="title">${ev.title}</div>
      `;
      card.addEventListener('click', () => this._openDetail(idx));
      this.trackEl.appendChild(card);
    });

    requestAnimationFrame(() => {
      const trackWidth = this.trackEl.scrollWidth;
      const visibleWidth = this.trackEl.parentElement
        ? this.trackEl.getBoundingClientRect().width
        : window.innerWidth;
      this.minOffset = Math.min(0, visibleWidth - trackWidth - 80);
      this._centerOnActive();
    });
  }

  /** Свайп: влево (отрицательный delta) = прошлое, вправо = будущее. */
  handleSwipe(deltaX) {
    if (this.events.length === 0) return;

    this.offset += deltaX * 1.4;
    this.offset = Math.max(this.minOffset, Math.min(0, this.offset));
    this.trackEl.style.transform = `translateX(${this.offset}px)`;

    // Какая карточка ближе к центру экрана — та и «активный год»
    this._updateActiveFromOffset();
  }

  _centerOnActive() {
    const cards = this.trackEl.querySelectorAll('.timeline-card');
    if (!cards.length) return;
    const card = cards[this.activeIndex];
    if (!card) return;

    const parent = this.trackEl.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const cardWidth = card.getBoundingClientRect().width;
    const gap = 24;
    const targetOffset = parentRect.width / 2 - (this.activeIndex * (cardWidth + gap) + cardWidth / 2);
    this.offset = Math.max(this.minOffset, Math.min(0, targetOffset));
    this.trackEl.style.transform = `translateX(${this.offset}px)`;
    this._highlightActive();
  }

  _updateActiveFromOffset() {
    const cards = this.trackEl.querySelectorAll('.timeline-card');
    if (!cards.length) return;

    const parent = this.trackEl.parentElement;
    const centerX = parent.getBoundingClientRect().left + parent.getBoundingClientRect().width / 2;
    let bestIdx = 0;
    let bestDist = Infinity;

    cards.forEach((card, idx) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const dist = Math.abs(cardCenter - centerX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });

    if (bestIdx !== this.activeIndex) {
      this.activeIndex = bestIdx;
      this._highlightActive();
      this._updateYearHint();
    }
  }

  _highlightActive() {
    this.trackEl.querySelectorAll('.timeline-card').forEach((card, idx) => {
      card.classList.toggle('active-year', idx === this.activeIndex);
    });
  }

  _updateYearHint() {
    if (!this.yearHintEl || this.events.length === 0) return;
    const year = this.events[this.activeIndex].year;
    this.yearHintEl.innerHTML = `
      <span class="time-arrow past">← прошлое</span>
      <span class="time-year">${year}</span>
      <span class="time-arrow future">будущее →</span>
    `;
  }

  handleDwellProgress(el, progress) {
    if (!el || !el.classList.contains('timeline-card')) return;
    const bar = el.querySelector('.dwell-progress');
    if (bar) bar.style.width = `${progress * 100}%`;
    el.classList.toggle('dwelling', progress > 0 && progress < 1);
  }

  handleDwellComplete(el) {
    if (!el || !el.classList.contains('timeline-card')) return;
    this._openDetail(Number(el.dataset.index));
  }

  _openDetail(idx) {
    const ev = this.events[idx];
    if (!ev) return;
    this.activeIndex = idx;
    this._highlightActive();
    this._updateYearHint();
    this.detailEl.classList.remove('hidden');
    this.detailEl.innerHTML = `
      <h3>${ev.year} — ${ev.title}</h3>
      <p>${ev.description}</p>
      <button class="mode-switch-btn close-detail">Закрыть</button>
    `;
    this.detailEl.querySelector('.close-detail').addEventListener('click', () => {
      this.detailEl.classList.add('hidden');
    });
  }
}
