// Карта: уровень районов → уровень мест (Leaflet).
// nudge — соседняя точка, pinch — войти/открыть, fist снаружи — назад.

export class Gallery {
  /**
   * @param {HTMLElement} canvasEl
   * @param {(place: object) => void} onSelectPlace
   * @param {{ focusCursorEl?: HTMLElement, hintEl?: HTMLElement, listEl?: HTMLElement, listTitleEl?: HTMLElement }} [ui]
   */
  constructor(canvasEl, onSelectPlace, ui = {}) {
    this.canvasEl = canvasEl;
    this.onSelectPlace = onSelectPlace;
    this.focusCursorEl = ui.focusCursorEl || null;
    this.hintEl = ui.hintEl || null;
    this.listEl = ui.listEl || null;
    this.listTitleEl = ui.listTitleEl || null;

    this.districts = [];
    this.allPlaces = [];
    /** Текущие точки на карте: районы или места выбранного района */
    this.places = [];
    this.focusIndex = 0;
    this.mode = 'districts'; // 'districts' | 'places'
    this.activeDistrict = null;

    this.map = null;
    this.markers = [];
    this.districtLayer = null;
    this.districtLayersById = {};
    this.districtsGeo = null;
    this.cursorSnapEnabled = true;
    this.republicBounds = null;
  }

  async load({
    placesUrl = 'data/places.json',
    districtsUrl = 'data/districts.json',
    districtsGeoUrl = 'data/districts-geo.json',
  } = {}) {
    const [placesRes, districtsRes, geoRes] = await Promise.all([
      fetch(placesUrl),
      fetch(districtsUrl),
      fetch(districtsGeoUrl),
    ]);
    if (!placesRes.ok) throw new Error('HTTP ' + placesRes.status + ' для ' + placesUrl);
    if (!districtsRes.ok) throw new Error('HTTP ' + districtsRes.status + ' для ' + districtsUrl);

    this.allPlaces = await placesRes.json();
    this.districts = await districtsRes.json();
    this.districtsGeo = geoRes.ok ? await geoRes.json() : null;

    if (!Array.isArray(this.allPlaces) || this.allPlaces.length === 0) {
      throw new Error('places.json пустой');
    }
    if (!Array.isArray(this.districts) || this.districts.length === 0) {
      throw new Error('districts.json пустой');
    }

    // Обогащаем районы числом мест
    this.districts = this.districts.map((d) => ({
      ...d,
      placeCount: this.allPlaces.filter((p) => p.districtId === d.id).length,
    }));

    this.focusIndex = 0;
    this.mode = 'districts';
    this.activeDistrict = null;
    this.places = this.districts.map((d) => this._districtAsPoint(d));

    this._initMap();
    this._renderDistrictPolygons();
    this._renderMarkers();
    this._renderList();
    this._applyFocus(false);
  }

  _districtAsPoint(d) {
    return {
      id: d.id,
      title: d.title,
      region: d.subtitle || 'Район',
      lat: d.lat,
      lng: d.lng,
      _kind: 'district',
      _district: d,
      placeCount: d.placeCount,
    };
  }

  _initMap() {
    if (typeof L === 'undefined') {
      throw new Error('Leaflet не загрузился (vendor/leaflet/leaflet.js)');
    }

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.map = L.map(this.canvasEl, {
      zoomControl: true,
      attributionControl: true,
      zoomSnap: 0.5,
    });

    const allLatLngs = [
      ...this.districts.map((d) => [d.lat, d.lng]),
      ...this.allPlaces.map((p) => [p.lat, p.lng]),
    ];
    // Расширяем обзор по полигонам районов, если есть
    if (this.districtsGeo?.features) {
      this.districtsGeo.features.forEach((f) => {
        const ring = f.geometry?.coordinates?.[0] || [];
        ring.forEach(([lng, lat]) => allLatLngs.push([lat, lng]));
      });
    }
    this.republicBounds = L.latLngBounds(allLatLngs).pad(0.12);
    this.initialBounds = this.republicBounds;

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      className: 'map-tiles-dim',
    }).addTo(this.map);

    this.map.fitBounds(this.republicBounds);
    this.map.on('zoomend moveend', () => {
      if (this.cursorSnapEnabled) this.snapCursorToFocus();
    });

    const fixSize = () => {
      if (!this.map) return;
      this.map.invalidateSize(false);
    };
    requestAnimationFrame(() => {
      fixSize();
      this.map.fitBounds(this.republicBounds, { animate: false });
      setTimeout(fixSize, 150);
      setTimeout(fixSize, 500);
    });
  }

  _clearMarkers() {
    this.markers.forEach((m) => {
      try { this.map.removeLayer(m); } catch (_) {}
    });
    this.markers = [];
  }

  _districtPathStyle(props, focused) {
    const color = props.color || '#3ddc97';
    return {
      color,
      weight: focused ? 3.5 : 2,
      opacity: focused ? 1 : 0.85,
      fillColor: props.fill || color,
      fillOpacity: focused ? 0.42 : 0.26,
      lineJoin: 'round',
      lineCap: 'round',
      className: focused ? 'district-poly is-focused' : 'district-poly',
    };
  }

  _renderDistrictPolygons() {
    if (!this.map) return;
    if (this.districtLayer) {
      try { this.map.removeLayer(this.districtLayer); } catch (_) {}
      this.districtLayer = null;
    }
    this.districtLayersById = {};
    if (!this.districtsGeo?.features?.length) return;

    this.districtLayer = L.geoJSON(this.districtsGeo, {
      style: (feature) => this._districtPathStyle(feature.properties, false),
      onEachFeature: (feature, layer) => {
        const id = feature.properties?.id;
        if (id) this.districtLayersById[id] = layer;

        const title = feature.properties?.title || id;
        layer.bindTooltip(title, {
          permanent: true,
          direction: 'center',
          className: 'district-label',
          opacity: 1,
        });

        layer.on('click', () => {
          if (this.mode !== 'districts') return;
          const idx = this.places.findIndex((p) => p.id === id);
          if (idx < 0) return;
          this.focusIndex = idx;
          this._applyFocus();
          this.confirmFocus();
        });

        layer.on('mouseover', () => {
          if (this.mode !== 'districts') return;
          layer.setStyle({
            weight: 3,
            fillOpacity: 0.38,
          });
        });
        layer.on('mouseout', () => {
          if (this.mode !== 'districts') return;
          const focusedId = this.places[this.focusIndex]?.id;
          layer.setStyle(this._districtPathStyle(feature.properties, id === focusedId));
        });
      },
    }).addTo(this.map);

    // Полигоны под маркерами
    this.districtLayer.bringToBack();
    this._updateDistrictPolygonFocus();
  }

  _updateDistrictPolygonFocus() {
    if (!this.districtLayer) return;

    if (this.mode === 'places') {
      const activeId = this.activeDistrict?.id;
      Object.entries(this.districtLayersById).forEach(([id, layer]) => {
        const props = layer.feature?.properties || {};
        if (id === activeId) {
          layer.setStyle({
            ...this._districtPathStyle(props, true),
            fillOpacity: 0.18,
            weight: 2.5,
            opacity: 0.7,
          });
          layer.bringToBack();
        } else {
          layer.setStyle({
            ...this._districtPathStyle(props, false),
            fillOpacity: 0.04,
            opacity: 0.15,
            weight: 1,
          });
        }
      });
      return;
    }

    const focusedId = this.places[this.focusIndex]?.id;
    Object.entries(this.districtLayersById).forEach(([id, layer]) => {
      const props = layer.feature?.properties || {};
      layer.setStyle(this._districtPathStyle(props, id === focusedId));
    });
  }

  _renderMarkers() {
    this._clearMarkers();
    const isDistrict = this.mode === 'districts';

    this.markers = this.places.map((place, idx) => {
      const count = place.placeCount != null ? place.placeCount : null;
      const icon = L.divIcon({
        className: 'gallery-marker',
        html: `
          <div class="gallery-point ${isDistrict ? 'is-district' : 'is-place'}" data-index="${idx}">
            <div class="gallery-point-dot"></div>
            <div class="gallery-point-label">
              <strong>${place.title}</strong>
              <span>${isDistrict
                ? `${count || 0} ${this._pluralPlaces(count || 0)}`
                : (place.region || '')}</span>
            </div>
          </div>`,
        iconSize: isDistrict ? [36, 36] : [28, 28],
        iconAnchor: isDistrict ? [18, 18] : [14, 14],
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

  _pluralPlaces(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'место';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'места';
    return 'мест';
  }

  _renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (this.listTitleEl) {
      this.listTitleEl.textContent = this.mode === 'districts'
        ? 'Районы'
        : (this.activeDistrict?.title || 'Места');
    }

    this.places.forEach((place, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'place-list-item';
      btn.dataset.index = String(idx);
      const sub = this.mode === 'districts'
        ? `${place.placeCount || 0} ${this._pluralPlaces(place.placeCount || 0)}`
        : (place.region || '');
      btn.innerHTML = `<span class="place-list-title">${place.title}</span><span class="place-list-region">${sub}</span>`;
      btn.addEventListener('click', () => {
        this.focusIndex = idx;
        this._applyFocus();
        this.confirmFocus();
      });
      this.listEl.appendChild(btn);
    });
  }

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
    const item = this.places[this.focusIndex];
    if (!item) return;

    if (this.mode === 'districts') {
      this.enterDistrict(item._district || item);
      return;
    }

    this.onSelectPlace(item);
  }

  /**
   * Pinch / клик по району → приближение и места района.
   */
  enterDistrict(district) {
    const d = district._district || district;
    const places = this.allPlaces.filter((p) => p.districtId === d.id);
    if (!places.length) return;

    this.mode = 'places';
    this.activeDistrict = d;
    this.places = places.map((p) => ({ ...p, _kind: 'place' }));
    this.focusIndex = 0;

    this._renderMarkers();
    this._renderList();
    this._updateDistrictPolygonFocus();
    this._applyFocus(false);

    const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
    const pad = d.pad != null ? d.pad : 0.25;
    this.map.flyToBounds(bounds.pad(pad), {
      duration: 1.15,
      maxZoom: d.minZoom ? Math.max(d.minZoom + 1, 14) : 14,
    });

    if (this.hintEl) {
      this.hintEl.textContent = `${d.title}: выбери место · pinch — открыть · кулак — к районам`;
    }
  }

  /**
   * Назад с уровня мест к районам. @returns {boolean} удалось ли выйти
   */
  exitToDistricts() {
    if (this.mode !== 'places') return false;

    this.mode = 'districts';
    this.activeDistrict = null;
    this.places = this.districts.map((d) => this._districtAsPoint(d));
    this.focusIndex = 0;

    this._renderMarkers();
    this._renderList();
    this._updateDistrictPolygonFocus();
    this._applyFocus(false);

    if (this.map && this.republicBounds) {
      this.map.flyToBounds(this.republicBounds, { duration: 1.0 });
    }

    if (this.hintEl) {
      this.hintEl.textContent = 'Выбери район · свайп ←→↑↓ · pinch — приблизить · кулак — на старт';
    }
    return true;
  }

  getFocusedPlace() {
    if (this.mode !== 'places') return null;
    return this.places[this.focusIndex] || null;
  }

  isInDistrict() {
    return this.mode === 'places';
  }

  _findNeighbor(fromIdx, dirX, dirY) {
    const from = this._screenPoint(fromIdx);

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

      const along = vx * ux + vy * uy;
      if (along < 12) return;

      const cross = Math.abs(vx * uy - vy * ux);
      const score = along + cross * 1.8;
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    });

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
      if (this.mode === 'districts') {
        this.hintEl.textContent = `Район: ${place.title}. Свайп ←→↑↓ · pinch — приблизить · кулак — на старт`;
      } else {
        this.hintEl.textContent = `Место: ${place.title}. Свайп ←→↑↓ · pinch — открыть · кулак — к районам`;
      }
    }

    if (pan && this.map && place) {
      this.map.panTo([place.lat, place.lng], { animate: true, duration: 0.4 });
    }

    this._updateDistrictPolygonFocus();
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

  /** После закрытия портала — остаёмся в районе (не улетаем на всю ЧР). */
  resetView() {
    if (this.mode === 'places' && this.activeDistrict && this.places.length) {
      const bounds = L.latLngBounds(this.places.map((p) => [p.lat, p.lng]));
      const pad = this.activeDistrict.pad != null ? this.activeDistrict.pad : 0.25;
      this.map.flyToBounds(bounds.pad(pad), { duration: 0.8 });
      return;
    }
    if (this.map && this.republicBounds) {
      this.map.flyToBounds(this.republicBounds, { duration: 0.9 });
    }
  }

  zoomByDelta(delta) {
    if (!this.map || !delta) return;
    this._zoomAcc = (this._zoomAcc || 0) + delta;
    const STEP_PX = 70;
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
