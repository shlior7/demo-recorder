#!/usr/bin/env bash
# Regression: a machine with no ffmpeg — brief says so, a take falls back to a raw .webm with the fix
# printed, `setup ffmpeg` downloads the static build (network, ~60 MB), and the next take is complete.
#   bash skills/demo-recorder/runner/check/no-ffmpeg.sh
set -euo pipefail
cd "$(dirname "$0")/../../../.."
R=skills/demo-recorder/record-demo.sh
export DEMO_HOME="$(mktemp -d)"
trap 'rm -rf "$DEMO_HOME"' EXIT
# node/npm stay, ffmpeg (homebrew/apt) goes
PATH="$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin:/sbin"
! command -v ffmpeg >/dev/null || { echo "✗ ffmpeg still on PATH ($(command -v ffmpeg)) — check can't run here" >&2; exit 1; }

grep -q "ffmpeg  MISSING" <<<"$($R brief)" && echo "✓ brief reports ffmpeg missing"
out="$($R examples/todomvc.json 2>&1)"
grep -q "raw .webm only" <<<"$out" && grep -q "setup ffmpeg" <<<"$out" && echo "✓ take without ffmpeg → raw .webm + the fix"
[[ -z "$(ls "$DEMO_HOME"/videos/*/*.mp4 2>/dev/null)" ]] && echo "✓ no mp4 pretended"

$R setup ffmpeg >/dev/null 2>&1 && [[ -x "$DEMO_HOME/ffmpeg/bin/ffmpeg" && -x "$DEMO_HOME/ffmpeg/bin/ffprobe" ]] && echo "✓ setup ffmpeg → $DEMO_HOME/ffmpeg/bin"
grep -q "ffmpeg  $DEMO_HOME/ffmpeg/bin/ffmpeg" <<<"$($R brief)" && echo "✓ brief now finds the static build"
$R examples/todomvc.json >/dev/null 2>&1
T="$(ls "$DEMO_HOME"/videos/*/*.mp4)"
[[ -f "${T%.mp4}-sheet.png" && -f "${T%.mp4}-chapters.json" ]] && echo "✓ next take is complete: mp4 + sheet + chapters"
grep -q "ffmpeg  MISSING" <<<"$(DEMO_FFMPEG=none $R brief)" && echo "✓ DEMO_FFMPEG=none forces the raw path"
