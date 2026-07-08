@echo off
setlocal
REM ACS AI Teams - Tailscale mode (reachable from your iPhone over Tailscale).
REM Binds ONLY to this PC's Tailscale IP, so it is never exposed on your LAN.
cd /d "%~dp0"

echo Detecting Tailscale IP...
set "TSIP="
for /f "usebackq delims=" %%i in (`tailscale ip -4 2^>nul`) do if not defined TSIP set "TSIP=%%i"

if not defined TSIP (
  echo.
  echo   Could not get a Tailscale IPv4 address.
  echo   Make sure Tailscale is installed, running, and connected, then try again.
  echo.
  pause
  exit /b 1
)

set "HOST=%TSIP%"
set "ALLOWED_ORIGINS=http://%TSIP%:4173"

echo Stopping any running instance...
node scripts\free-port.js

echo.
echo ============================================================
echo   ACS AI Teams - Tailscale mode
echo   Open this on the PC or your iPhone (Tailscale connected):
echo.
echo       http://%TSIP%:4173
echo.
echo   (First time only: run the firewall command in the README
echo    as Administrator if the page will not load.)
echo ============================================================
echo.

npm start
endlocal
