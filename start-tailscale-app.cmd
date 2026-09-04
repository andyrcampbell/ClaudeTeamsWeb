@echo off
setlocal
REM ACS AI Teams (packaged app) - Tailscale mode, reachable from your iPhone.
REM Same idea as start-tailscale.cmd, but launches the installed app instead
REM of the dev server. Binds ONLY to this PC's Tailscale IP, so it is never
REM exposed on your LAN.

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

REM Find the installed exe via its Start Menu shortcut, so this still works
REM if the app was installed to a non-default directory (the installer lets
REM you change it). Falls back to the default per-user install path.
set "APPEXE="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "try { (New-Object -ComObject WScript.Shell).CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\ACS AI Teams.lnk').TargetPath } catch {}"`) do set "APPEXE=%%p"

if not defined APPEXE if exist "%LOCALAPPDATA%\Programs\ACS AI Teams\ACS AI Teams.exe" set "APPEXE=%LOCALAPPDATA%\Programs\ACS AI Teams\ACS AI Teams.exe"

if not defined APPEXE (
  echo.
  echo   Could not find the installed "ACS AI Teams" app.
  echo   Install it first (dist\ACS AI Teams Setup *.exe), then try again.
  echo.
  pause
  exit /b 1
)

set "HOST=%TSIP%"
set "ALLOWED_ORIGINS=http://%TSIP%:4173"

echo.
echo ============================================================
echo   ACS AI Teams - Tailscale mode (packaged app)
echo   Open this on the PC or your iPhone (Tailscale connected):
echo.
echo       http://%TSIP%:4173
echo.
echo   (First time only: run the firewall command in the README
echo    as Administrator if the page will not load.)
echo ============================================================
echo.

start "" "%APPEXE%"
endlocal
