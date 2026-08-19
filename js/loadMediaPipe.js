// Динамическая загрузка MediaPipe. Сначала локальный vendor/, потом CDN.

const HANDS_VERSION = '0.4.1675469240';
const DRAWING_VERSION = '0.3.1675466124';

// Android APK / offline kiosk: local vendor only (no CDN).
const OFFLINE_ONLY =
  typeof window !== 'undefined' &&
  (window.Capacitor?.isNativePlatform?.() === true ||
    new URLSearchParams(location.search).has('offline'));

const CDN_SOURCES = [
  {
    name: 'jsdelivr',
    hands: `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}/hands.js`,
    drawing: `https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@${DRAWING_VERSION}/drawing_utils.js`,
    locate: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}/${file}`,
  },
  {
    name: 'unpkg',
    hands: `https://unpkg.com/@mediapipe/hands@${HANDS_VERSION}/hands.js`,
    drawing: `https://unpkg.com/@mediapipe/drawing_utils@${DRAWING_VERSION}/drawing_utils.js`,
    locate: (file) => `https://unpkg.com/@mediapipe/hands@${HANDS_VERSION}/${file}`,
  },
];

const LOCAL_SOURCE = {
  name: 'local',
  hands: 'vendor/mediapipe/hands/hands.js',
  drawing: 'vendor/mediapipe/drawing_utils/drawing_utils.js',
  locate: (file) => `vendor/mediapipe/hands/${file}`,
};

const SOURCES = OFFLINE_ONLY ? [LOCAL_SOURCE] : [LOCAL_SOURCE, ...CDN_SOURCES];

function loadScript(src, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-mp-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.mpSrc = src;

    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Таймаут: ' + src));
    }, timeoutMs);

    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Ошибка загрузки: ' + src));
    };

    document.head.appendChild(script);
  });
}

/**
 * @param {(msg: string) => void} onStatus
 * @returns {Promise<{ locateFile: (file: string) => string, source: string }>}
 */
export async function loadMediaPipe(onStatus = () => {}) {
  if (typeof Hands !== 'undefined' && window.__mpLocateFile) {
    return { locateFile: window.__mpLocateFile, source: window.__mpSource || 'cached' };
  }

  let lastError = null;

  for (const src of SOURCES) {
    onStatus(`Загрузка MediaPipe (${src.name})…`);
    try {
      await loadScript(src.drawing);
      await loadScript(src.hands);

      if (typeof Hands === 'undefined') {
        throw new Error('Hands не определён после ' + src.name);
      }

      window.__mpLocateFile = src.locate;
      window.__mpSource = src.name;
      onStatus(`MediaPipe готов (${src.name})`);
      return { locateFile: src.locate, source: src.name };
    } catch (err) {
      lastError = err;
      console.warn('[MediaPipe]', src.name, err);
    }
  }

  throw lastError || new Error('MediaPipe недоступен');
}
