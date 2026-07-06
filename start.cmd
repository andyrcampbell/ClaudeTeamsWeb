@echo off
REM ACS AI Teams - one-click launcher (Windows).
REM Stops any running instance on the port, then starts the server.
cd /d "%~dp0"
echo Stopping any running ACS AI Teams instance...
node scripts\free-port.js
echo Starting ACS AI Teams...
npm start
