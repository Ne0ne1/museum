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

    this.focusIndex = Math.max(0, this.districts.findIndex((d) => d.id === 'grozny'));
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
      minZoom: 8,
      maxZoom: 13,
    });

    // Убрать флаг Leaflet из атрибуции
    if (this.map.attributionControl) {
      this.map.attributionControl.setPrefix('');
    }

    const allLatLngs = [
      ...this.districts.map((d) => [d.lat, d.lng]),
      ...this.allPlaces.map((p) => [p.lat, p.lng]),
    ];
    if (this.districtsGeo?.features) {
      this.districtsGeo.features.forEach((f) => {
        this._collectLatLngs(f.geometry, allLatLngs);
      });
    }
    this.republicBounds = L.latLngBounds(allLatLngs).pad(0.08);
    this.initialBounds = this.republicBounds;

    // Спутник: локальный кэш, иначе онлайн Esri (пока качается архив)
    this.baseLayer = L.tileLayer('vendor/tiles/satellite/{z}/{x}/{y}.jpg', {
      minZoom: 8,
      maxZoom: 13,
      maxNativeZoom: 13,
      attribution: 'Esri World Imagery',
      errorTileUrl:
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      keepBuffer: 4,
      updateWhenIdle: true,
      updateWhenZooming: false,
    }).addTo(this.map);

    this._assertLocalTiles();

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

  _collectLatLngs(geometry, out) {
    if (!geometry) return;
    const pushRing = (ring) => {
      (ring || []).forEach(([lng, lat]) => out.push([lat, lng]));
    };
    if (geometry.type === 'Polygon') {
      (geometry.coordinates || []).forEach(pushRing);
    } else if (geometry.type === 'MultiPolygon') {
      (geometry.coordinates || []).forEach((poly) => (poly || []).forEach(pushRing));
    }
  }

  async _assertLocalTiles() {
    try {
      const probe = await fetch('vendor/tiles/satellite/READY.txt', { cache: 'no-store' });
      if (!probe.ok) throw new Error('нет READY.txt');
      const sample = await fetch('vendor/tiles/satellite/10/639/372.jpg', { method: 'HEAD' });
      if (!sample.ok) throw new Error('нет тайлов');
    } catch (err) {
      console.warn('[map] local tiles missing — online Esri fallback', err);
      if (this.baseLayer && this.map) {
        try { this.map.removeLayer(this.baseLayer); } catch (_) {}
      }
      this.baseLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          minZoom: 8,
          maxZoom: 13,
          attribution: 'Esri World Imagery',
          maxNativeZoom: 19,
        }
      ).addTo(this.map);
      const status = document.getElementById('camera-status');
      if (status) {
        status.textContent = 'Спутник онлайн (локальные тайлы качаются…)';
      }
    }
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
      color: focused ? '#ffffff' : color,
      weight: focused ? 3.2 : 2,
      opacity: focused ? 1 : 0.92,
      fillColor: color,
      fillOpacity: focused ? 0.36 : 0.16,
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
        iconSize: isDistrict ? [48, 48] : [28, 28],
        iconAnchor: isDistrict ? [24, 24] : [14, 14],
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
    // Демо-путь: Центр Грозного / ЧГУ первыми в фокусе
    const prefer = ['grozny-center', 'chsu-campus', 'national-museum'];
    let focus = 0;
    for (const id of prefer) {
      const idx = this.places.findIndex((p) => p.id === id);
      if (idx >= 0) { focus = idx; break; }
    }
    this.focusIndex = focus;

    this._renderMarkers();
    this._renderList();
    this._updateDistrictPolygonFocus();
    this._applyFocus(false);

    // Реальный контур района, если есть; иначе точки мест
    let bounds = null;
    const layer = this.districtLayersById[d.id];
    if (layer && typeof layer.getBounds === 'function') {
      bounds = layer.getBounds();
    }
    if (!bounds || !bounds.isValid()) {
      bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
    }
    const pad = d.pad != null ? Math.min(d.pad, 0.2) : 0.12;
    this.map.flyToBounds(bounds.pad(pad), {
      duration: 1.15,
      maxZoom: Math.min(13, d.minZoom ? d.minZoom + 1 : 12),
    });

    if (this.hintEl) {
        this.hintEl.textContent = `${d.title}: выбери место · pinch — открыть · кулак 2 сек — к районам`;
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
      this.hintEl.textContent = 'Выбери район · свайп ←→↑↓ · pinch — приблизить · кулак 3 сек — на старт';
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
    // И районы, и места — шаг по оси + цикл (не застреваем на краю)
    return this._findNeighborByAxis(fromIdx, dirX, dirY);
  }

  /** Следующая точка по горизонтали/вертикали экрана, с циклом. */
  _findNeighborByAxis(fromIdx, dirX, dirY) {
    const horizontal = Math.abs(dirX) >= Math.abs(dirY);
    const step = horizontal
      ? (dirX > 0 ? 1 : dirX < 0 ? -1 : 0)
      : (dirY > 0 ? 1 : dirY < 0 ? -1 : 0);
    if (!step) return -1;

    const rows = this.places.map((_, idx) => {
      const pt = this._screenPoint(idx);
      return { idx, x: pt.x, y: pt.y };
    });

    if (rows.length < 2) return -1;

    if (horizontal) {
      rows.sort((a, b) => a.x - b.x || a.y - b.y);
    } else {
      rows.sort((a, b) => a.y - b.y || a.x - b.x);
    }

    const pos = rows.findIndex((r) => r.idx === fromIdx);
    if (pos < 0) return -1;
    const next = (pos + step + rows.length) % rows.length;
    return rows[next].idx;
  }

  _applyFocus(pan = true) {
    // Сброс кольца удержания при смене точки
    this.clearHoldProgress();

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
        this.hintEl.textContent = `Район: ${place.title}. Свайп ←→↑↓ · pinch — приблизить · кулак 3 сек — на старт`;
      } else {
        this.hintEl.textContent = `Место: ${place.title}. Свайп ←→↑↓ · pinch — открыть · кулак 2 сек — к районам`;
      }
    }

    if (pan && this.map && place) {
      if (this.mode === 'districts') {
        // Не дёргаем камеру на каждый свайп — только лёгкий pan, если точка у края
        const pt = this.map.latLngToContainerPoint([place.lat, place.lng]);
        const size = this.map.getSize();
        const margin = 90;
        const nearEdge =
          pt.x < margin || pt.y < margin || pt.x > size.x - margin || pt.y > size.y - margin;
        if (nearEdge) {
          this.map.panTo([place.lat, place.lng], { animate: true, duration: 0.35 });
        }
      } else {
        this.map.panTo([place.lat, place.lng], { animate: true, duration: 0.4 });
      }
    }

    this._updateDistrictPolygonFocus();
    this.snapCursorToFocus();
  }

  /** Кольцо удержания на активной точке (pinch / кулак), без курсора руки. */
  setHoldProgress(progress, mode = 'pinch') {
    const p = Math.max(0, Math.min(1, progress || 0));
    const point = this.canvasEl.querySelector(`.gallery-point[data-index="${this.focusIndex}"]`);
    const listItem = this.listEl?.querySelector(`.place-list-item[data-index="${this.focusIndex}"]`);

    const apply = (el) => {
      if (!el) return;
      el.style.setProperty('--hold-progress', String(p));
      el.classList.toggle('holding', p > 0.02);
      el.classList.toggle('holding-pinch', mode === 'pinch' && p > 0.02);
      el.classList.toggle('holding-fist', mode === 'fist' && p > 0.02);
      if (p <= 0.02) {
        el.classList.remove('holding', 'holding-pinch', 'holding-fist');
      }
    };

    // Снять кольцо с остальных точек
    this.canvasEl.querySelectorAll('.gallery-point.holding').forEach((el) => {
      if (el !== point) {
        el.classList.remove('holding', 'holding-pinch', 'holding-fist');
        el.style.setProperty('--hold-progress', '0');
      }
    });
    this.listEl?.querySelectorAll('.place-list-item.holding').forEach((el) => {
      if (el !== listItem) {
        el.classList.remove('holding', 'holding-pinch', 'holding-fist');
        el.style.setProperty('--hold-progress', '0');
      }
    });

    apply(point);
    apply(listItem);
  }

  clearHoldProgress() {
    this.setHoldProgress(0);
  }

  snapCursorToFocus() {
    // Курсор руки на карте скрыт — фокус только на точках
    if (this.focusCursorEl) {
      this.focusCursorEl.classList.add('hidden');
      this.focusCursorEl.classList.remove('snapped', 'holding', 'holding-fist', 'holding-pinch', 'pinching');
    }
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
