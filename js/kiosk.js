/**
 * Museum kiosk helpers: debug preview, idle reset, staff alerts.
 */

export function isDebugMode() {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

/** Превью камеры видно по умолчанию; скрыть: ?hideCam=1 */
export function applyDebugUi() {
  const hideCam = (() => {
    try {
      return new URLSearchParams(window.location.search).get('hideCam') === '1';
    } catch {
      return false;
    }
  })();
  const debug = isDebugMode() || !hideCam;

  document.documentElement.classList.toggle('kiosk-debug', debug);
  document.body.classList.toggle('kiosk-debug', debug);

  const video = document.getElementById('input-video');
  const canvas = document.getElementById('debug-canvas');
  const status = document.getElementById('camera-status');

  if (hideCam && !isDebugMode()) {
    video?.classList.add('kiosk-hidden');
    canvas?.classList.add('kiosk-hidden');
    status?.classList.add('kiosk-status-quiet');
    document.documentElement.classList.remove('kiosk-debug');
    document.body.classList.remove('kiosk-debug');
  } else {
    video?.classList.remove('kiosk-hidden');
    canvas?.classList.remove('kiosk-hidden');
    status?.classList.remove('kiosk-status-quiet');
  }
}

/**
 * Сброс на intro после простоя.
 * @param {{ ms?: number, onIdle: () => void }} opts
 */
export function createIdleWatch({ ms = 60000, onIdle } = {}) {
  let timer = null;
  const delay = Math.max(15000, Number(ms) || 60000);

  function bump() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      onIdle?.();
    }, delay);
  }

  const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
  events.forEach((name) => window.addEventListener(name, bump, { passive: true }));

  return {
    bump,
    stop() {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, bump));
    },
  };
}

export function showStaffAlert(message) {
  let el = document.getElementById('staff-alert');
  if (!el) {
    el = document.createElement('div');
    el.id = 'staff-alert';
    el.className = 'staff-alert';
    el.setAttribute('role', 'alert');
    document.body.appendChild(el);
  }
  el.innerHTML = `<strong>Нужен сотрудник</strong><p>${message}</p>`;
  el.hidden = false;
}

export function hideStaffAlert() {
  const el = document.getElementById('staff-alert');
  if (el) el.hidden = true;
}
