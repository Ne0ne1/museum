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

    this.map = L.map(this.canvasEl, {
      zoomControl: false,
      attributionControl: true,
    });

    this.initialBounds = L.latLngBounds(this.places.map((p) => [p.lat, p.lng])).pad(0.18);
    this.map.fitBounds(this.initialBounds);

    // Тёмные тайлы CARTO под стиль стенда; фолбэк — обычный OSM
    const carto = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 18,
        subdomains: 'abcd',
        attribution: '© OpenStreetMap · © CARTO',
      }
    );
    carto.on('tileerror', () => {
      if (this._fallbackApplied) return;
      this._fallbackApplied = true;
      this.map.removeLayer(carto);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(this.map);
    });
    carto.addTo(this.map);

    this.map.on('move zoom zoomend moveend', () => this.snapCursorToFocus());
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

    const lenDir = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / lenDir;
    const uy = dirY / lenDir;

    let best = -1;
    let bestScore = Infinity;

    this.places.forEach((place, idx) => {
      if (idx === fromIdx) return;
      const pt = this._screenPoint(idx);
      const vx = pt.x - from.x;
      const vy = pt.y - from.y;
      const len = Math.hypot(vx, vy);
      if (len < 4) return;

      const alignment = (vx / len) * ux + (vy / len) * uy;
      if (alignment < 0.25) return;

      const score = len / (alignment * alignment);
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    });

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
      this.hintEl.textContent = `Выбрано: ${place.title}. Pinch — открыть · кулак — назад`;
    }

    if (pan && this.map && place) {
      this.map.panTo([place.lat, place.lng], { animate: true, duration: 0.4 });
    }

    this.snapCursorToFocus();
  }

  snapCursorToFocus() {
    if (!this.focusCursorEl) return;
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

  handleLost() {}
}
