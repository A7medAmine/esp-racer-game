#!/usr/bin/env sh
# Builds the controller firmware with PlatformIO and refreshes game/flash/firmware.bin.
set -e
cd "$(dirname "$0")/../firmware"
PIO=$(command -v pio || echo "$HOME/.platformio/penv/bin/pio")
"$PIO" run -e nodemcuv2
cp .pio/build/nodemcuv2/firmware.bin ../game/flash/firmware.bin
echo "Updated game/flash/firmware.bin"
