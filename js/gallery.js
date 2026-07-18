// Карта мест на реальной геокарте (Leaflet).
// Фокус на одной точке, nudge ладонью — соседняя точка по направлению,
// pinch (с удержанием) — открыть, клик мышью — то же самое.

export class Gallery {
  /**
   * @param {HTMLElement} canvasEl
   * @param {(place: object) => void} onSelectPlace
   * @param {{ focusCursorEl?: HTMLElement, hintEl?: HTMLElement, listEl?: HTMLElement }} [ui]
   */
  constructor(canvasEl, onSelectPlace, ui = {}) {
    this.canvasEl = canvasEl;
    this.onSelectPlace = onSelectPlace;
    this.focusCursorEl = ui.focusCursorEl || null;
    this.hintEl = ui.hintEl || null;
    this.listEl = ui.listEl || null;
    this.places = [];
    this.focusIndex = 0;
    this.map = null;
    this.markers = [];
    /** Когда false — не приклеиваем курсор к маркеру (история места / свободная рука). */
    this.cursorSnapEnabled = true;
  }

  async load(url = 'data/places.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' для ' + url);
    this.places = await res.json();
    if (!Array.isArray(this.places) || this.places.length === 0) {
      throw new Error('places.json пустой');
    }
    this.focusIndex = 0;
    this._initMap();
    this._renderMarkers();
    this._renderList();
    this._applyFocus(false);
  }

  _initMap() {
    if (typeof L === 'undefined') {
      throw new Error('Leaflet не загрузился (vendor/leaflet/leaflet.js)');
    }

    // На всякий случай — если карта уже была (горячий reload)
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.map = L.map(this.canvasEl, {
      zoomControl: true,
      attributionControl: true,
      zoomSnap: 0.5,
    });

    this.initialBounds = L.latLngBounds(this.places.map((p) => [p.lat, p.lng])).pad(0.18);

    // Только OSM — меньше сюрпризов с CDN
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    this.map.fitBounds(this.initialBounds);
    // Не снапаем на каждом move — иначе курсор «прилипает» к точке и не слушает руку
    this.map.on('zoomend moveend', () => {
      if (this.cursorSnapEnabled) this.snapCursorToFocus();
    });

    const fixSize = () => {
      if (!this.map) return;
      this.map.invalidateSize(false);
    };
    requestAnimationFrame(() => {
      fixSize();
      this.map.fitBounds(this.initialBounds, { animate: false });
      setTimeout(fixSize, 150);
      setTimeout(fixSize, 500);
    });
  }

  _renderMarkers() {
    this.markers = this.places.map((place, idx) => {
      const icon = L.divIcon({
        className: 'gallery-marker',
        html: `
          <div class="gallery-point" data-index="${idx}">
            <div class="gallery-point-label">
              <strong>${place.title}</strong>
              ${place.region ? `<span>${place.region}</span>` : ''}
            </div>
          </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([place.lat, place.lng], { icon }).addTo(this.map);
      marker.on('click', () => {
        this.focusIndex = idx;
        this._applyFocus();
        this.confirmFocus();
      });
      return marker;
    });
  }

  _renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    this.places.forEach((place, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'place-list-item';
      btn.dataset.index = String(idx);
      btn.innerHTML = `<span class="place-list-title">${place.title}</span><span class="place-list-region">${place.region || ''}</span>`;
      btn.addEventListener('click', () => {
        this.focusIndex = idx;
        this._applyFocus();
        this.confirmFocus();
      });
      this.listEl.appendChild(btn);
    });
  }

  /** Экранные координаты точки (пиксели внутри контейнера карты). */
  _screenPoint(idx) {
    const place = this.places[idx];
    return this.map.latLngToContainerPoint([place.lat, place.lng]);
  }

  handleNudge(dirX, dirY) {
    if (!this.places.length || !this.map) return;
    const next = this._findNeighbor(this.focusIndex, dirX, dirY);
    if (next < 0 || next === this.focusIndex) return;
    this.focusIndex = next;
    this._applyFocus();
  }

  confirmFocus() {
    const place = this.places[this.focusIndex];
    if (!place) return;
    this.onSelectPlace(place);
  }

  getFocusedPlace() {
    return this.places[this.focusIndex] || null;
  }

  _findNeighbor(fromIdx, dirX, dirY) {
    const from = this._screenPoint(fromIdx);

    // Нормализуем в кардинальное направление (как приходит из жеста)
    let ux = 0;
    let uy = 0;
    if (Math.abs(dirX) >= Math.abs(dirY)) {
      ux = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
    } else {
      uy = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
    }
    if (ux === 0 && uy === 0) return -1;

    let best = -1;
    let bestScore = Infinity;

    this.places.forEach((_, idx) => {
      if (idx === fromIdx) return;
      const pt = this._screenPoint(idx);
      const vx = pt.x - from.x;
      const vy = pt.y - from.y;
      const len = Math.hypot(vx, vy);
      if (len < 8) return;

      // Должна быть в нужной полуплоскости
      const along = vx * ux + vy * uy;
      if (along < 12) return;

      // Штраф за отклонение от оси (чтобы не прыгало «вбок»)
      const cross = Math.abs(vx * uy - vy * ux);
      const score = along + cross * 1.8;
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    });

    // Фолбэк: если строго по оси никого нет — берём ближайшую в полуплоскости
    if (best < 0) {
      this.places.forEach((_, idx) => {
        if (idx === fromIdx) return;
        const pt = this._screenPoint(idx);
        const vx = pt.x - from.x;
        const vy = pt.y - from.y;
        const along = vx * ux + vy * uy;
        if (along < 8) return;
        const len = Math.hypot(vx, vy);
        if (len < bestScore) {
          bestScore = len;
          best = idx;
        }
      });
    }

    return best;
  }

  _applyFocus(pan = true) {
    this.canvasEl.querySelectorAll('.gallery-point').forEach((p) => {
      p.classList.toggle('focused', Number(p.dataset.index) === this.focusIndex);
    });
    if (this.listEl) {
      this.listEl.querySelectorAll('.place-list-item').forEach((p, idx) => {
        p.classList.toggle('focused', idx === this.focusIndex);
      });
    }

    const place = this.places[this.focusIndex];
    if (this.hintEl && place) {
      this.hintEl.textContent = `Выбрано: ${place.title}. Свайп ←→↑↓ · pinch — открыть · кулак — назад`;
    }

    if (pan && this.map && place) {
      this.map.panTo([place.lat, place.lng], { animate: true, duration: 0.4 });
    }

    this.snapCursorToFocus();
  }

  snapCursorToFocus() {
    if (!this.cursorSnapEnabled || !this.focusCursorEl) return;
    const point = this.canvasEl.querySelector(`.gallery-point[data-index="${this.focusIndex}"]`);
    if (!point) {
      this.focusCursorEl.classList.add('hidden');
      return;
    }
    const rect = point.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.focusCursorEl.classList.add('hidden');
      return;
    }
    this.focusCursorEl.classList.remove('hidden');
    this.focusCursorEl.classList.add('snapped');
    this.focusCursorEl.style.left = `${rect.left + rect.width / 2}px`;
    this.focusCursorEl.style.top = `${rect.top + rect.height / 2}px`;
  }

  /** Вернуть обзор всей республики (после закрытия истории места). */
  resetView() {
    if (this.map && this.initialBounds) {
      this.map.flyToBounds(this.initialBounds, { duration: 0.9 });
    }
  }

  /** Зум двумя руками: delta — изменение расстояния между ладонями в px. */
  zoomByDelta(delta) {
    if (!this.map || !delta) return;
    this._zoomAcc = (this._zoomAcc || 0) + delta;
    const STEP_PX = 70; // накопленные px на один шаг зума
    while (Math.abs(this._zoomAcc) >= STEP_PX) {
      const dir = Math.sign(this._zoomAcc);
      const target = this.map.getZoom() + dir * 0.5;
      const clamped = Math.max(7, Math.min(16, target));
      this.map.setZoom(clamped, { animate: true });
      this._zoomAcc -= dir * STEP_PX;
    }
  }

  handleLost() {}
}
