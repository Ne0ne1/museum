@echo off
REM Полный автозапуск стенда: сервер + Chrome kiosk (Windows).
REM Добавьте ярлык в shell:startup или Task Scheduler (при входе в систему).

setlocal
cd /d "%~dp0"
start "MuseumServer" /min cmd /c "%~dp0start-server.bat"
timeout /t 3 /nobreak >nul
call "%~dp0start-chrome-kiosk.bat"
endlocal
