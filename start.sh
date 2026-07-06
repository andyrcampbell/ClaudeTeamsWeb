#!/usr/bin/env bash
# ACS AI Teams - one-click launcher (macOS / Linux).
# Stops any running instance on the port, then starts the server.
cd "$(dirname "$0")" || exit 1
echo "Stopping any running ACS AI Teams instance..."
node scripts/free-port.js
echo "Starting ACS AI Teams..."
npm start
