#!/usr/bin/env bash
# Chrome / Chromium в режиме киоска (macOS).
# Перед первым запуском один раз откройте http://localhost:8080 и разрешите камеру.

set -euo pipefail
URL="${MUSEUM_URL:-http://localhost:8080/index.html}"
PROFILE="${MUSEUM_CHROME_PROFILE:-$HOME/Library/Application Support/museum-kiosk-chrome}"
mkdir -p "$PROFILE"

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
do
  if [[ -x "$c" ]]; then CHROME="$c"; break; fi
done

if [[ -z "$CHROME" ]]; then
  echo "Chrome/Edge не найден в /Applications" >&2
  exit 1
fi

exec "$CHROME" \
  --kiosk \
  --app="$URL" \
  --user-data-dir="$PROFILE" \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000
