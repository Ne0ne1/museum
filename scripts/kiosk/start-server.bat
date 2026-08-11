@echo off
REM Статический сервер стенда (Windows).
REM Двойной клик или Task Scheduler.

setlocal
cd /d "%~dp0..\.."
set PORT=8080
if defined MUSEUM_PORT set PORT=%MUSEUM_PORT%
echo Museum server: http://localhost:%PORT%
echo Root: %CD%
python -m http.server %PORT%
if errorlevel 1 python3 -m http.server %PORT%
endlocal
