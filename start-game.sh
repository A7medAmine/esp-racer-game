#!/usr/bin/env sh
# Start the game on macOS / Linux: serves game/ on http://localhost:8080 and opens the browser.
# Needs Python 3 (preinstalled on macOS and most Linux distributions).
cd "$(dirname "$0")/game" || exit 1
PORT="${1:-8080}"
URL="http://localhost:$PORT/"
echo ""
echo "  ESP Racer is running at $URL  (Ctrl+C to stop)"
echo "  Use Chrome or Edge for USB controller support."
echo ""
( sleep 1; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") ) >/dev/null 2>&1 &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
