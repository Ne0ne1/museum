import { createPortalStory, buildPortalPlaces } from '../portalStory.js?v=37';
import { createIdleWatch, applyDebugUi } from '../kiosk.js?v=2';
import { loadGestureConfig } from '../gestureConfig.js?v=11';

applyDebugUi();

const statusEl = document.getElementById('camera-status');

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

const portal = createPortalStory(document.getElementById('place-portal'), {
  onExit: () => {
    window.location.href = 'index.html';
  },
});

window.addEventListener('error', (e) => setStatus('Ошибка: ' + (e.message || e.error)));

let idle = null;

function goIntro() {
  try {
    portal.closeCompare?.();
  } catch (_) {
    /* ignore */
  }
  window.location.href = 'index.html';
}

async function boot() {
  const config = await loadGestureConfig();

  idle = createIdleWatch({
    ms: config.idleMs,
    onIdle: goIntro,
  });
  idle.bump();

  try {
    const [places, events] = await Promise.all([
      fetch('data/places.json?v=9').then((r) => r.json()),
      fetch('data/events.json?v=9').then((r) => r.json()),
    ]);

    const portalPlaces = buildPortalPlaces(places, events);
    const startIndex = Math.max(0, portalPlaces.findIndex((p) => p.id === 'grozny-center'));
    portal.start(portalPlaces, startIndex);
    setStatus(`${portalPlaces.length} мест · ладонь ←→ · pinch — шторка`);
  } catch (err) {
    console.error(err);
    setStatus('Ошибка контента: ' + err.message);
    return;
  }

  try {
    const { startHandUI } = await import('../handUI.js?v=27');
    const hand = startHandUI(
      (type, payload) => {
        idle?.bump();
        if (type === 'cursor') {
          const fistP = payload.fistProgress || 0;
          const pinchP = payload.pinchProgress || 0;
          if (fistP > 0.02) {
            setStatus(
              portal.isCompare?.()
                ? `Кулак ${Math.round(fistP * 100)}% — закрыть шторку`
                : `Кулак ${Math.round(fistP * 100)}% — на старт`
            );
          } else if (pinchP > 0.02 && !portal.isCompare?.()) {
            setStatus(`Pinch ${Math.round(pinchP * 100)}% — держи, откроется шторка`);
          }
        } else if (type === 'nudge') {
          if (payload?.dirY < 0) setStatus('Описание места');
          else if (payload?.dirY > 0) setStatus('Описание скрыто');
          else setStatus('Другое место…');
        } else if (type === 'pinchconfirm') {
          setStatus('Шторка · двигай щипком');
        } else if (type === 'pinchmove' && portal.isCompare?.()) {
          setStatus('Шторка · двигай щипком');
        }
        portal.handleGesture(type, payload);
      },
      { freeCursor: false, dwellEnabled: false, hideCursor: true, config }
    );
    hand?.gestures?.setFistHoldMs?.(config.fistHoldMs ?? 2000);
  } catch (err) {
    console.warn(err);
    setStatus('Без камеры: ' + err.message);
  }
}

boot();
