#!/bin/sh
# ACS AI Teams (packaged app) - Tailscale mode, reachable from your iPhone.
# Same idea as start-tailscale.cmd, but launches the installed .app instead
# of the dev server. Binds ONLY to this Mac's Tailscale IP, so it is never
# exposed on your LAN.
#
# Note: `open -a` doesn't forward environment variables to the app it
# launches (Launch Services strips them), so this execs the binary inside
# the .app bundle directly instead.

set -e

echo "Detecting Tailscale IP..."
TSIP="$(tailscale ip -4 2>/dev/null | head -n1)"
if [ -z "$TSIP" ]; then
  echo
  echo "  Could not get a Tailscale IPv4 address."
  echo "  Make sure Tailscale is installed, running, and connected, then try again."
  echo
  exit 1
fi

APP_BIN="/Applications/ACS AI Teams.app/Contents/MacOS/ACS AI Teams"
if [ ! -x "$APP_BIN" ]; then
  echo
  echo "  Could not find the installed \"ACS AI Teams\" app at:"
  echo "    $APP_BIN"
  echo "  Install it first (drag the .dmg into Applications), then try again."
  echo
  exit 1
fi

echo
echo "============================================================"
echo "  ACS AI Teams - Tailscale mode (packaged app)"
echo "  Open this on the Mac or your iPhone (Tailscale connected):"
echo
echo "      http://$TSIP:41730"
echo
echo "  (First time only: allow inbound connections on port 41730"
echo "   from the Tailscale range, e.g. via macOS's application"
echo "   firewall settings, if the page will not load.)"
echo "============================================================"
echo

HOST="$TSIP" ALLOWED_ORIGINS="http://$TSIP:41730" "$APP_BIN" &
