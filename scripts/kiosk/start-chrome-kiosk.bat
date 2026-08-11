@echo off
REM Chrome в режиме киоска (Windows).
REM Перед первым запуском: откройте http://localhost:8080 и разрешите камеру навсегда.

setlocal
set URL=http://localhost:8080/index.html
if defined MUSEUM_URL set URL=%MUSEUM_URL%

set PROFILE=%LOCALAPPDATA%\museum-kiosk-chrome
if defined MUSEUM_CHROME_PROFILE set PROFILE=%MUSEUM_CHROME_PROFILE%
if not exist "%PROFILE%" mkdir "%PROFILE%"

set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe
if not defined CHROME if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe

if not defined CHROME (
  echo Chrome/Edge не найден. Установите Google Chrome.
  exit /b 1
)

"%CHROME%" --kiosk --app="%URL%" --user-data-dir="%PROFILE%" --autoplay-policy=no-user-gesture-required --no-first-run --disable-session-crashed-bubble --check-for-update-interval=31536000
endlocal
