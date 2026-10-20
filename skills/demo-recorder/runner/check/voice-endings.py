"""Regression: voice.py keeps the caption and drops the tail sentence it reads after it (for a falling end).
Synthetic audio, no model.  Run with the voice venv:  ~/.demo-recorder/voice/venv/bin/python check/voice-endings.py"""
import os, sys
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import voice

SR = 24000
tone = lambda s: torch.sin(torch.arange(int(s * SR)) / SR * 2 * torch.pi * 180).unsqueeze(0) * 0.5
gap = lambda s: torch.zeros(1, int(s * SR))
secs = lambda w: w.shape[-1] / SR

# caption with a comma pause, then the sentence pause, then the tail
clip = torch.cat([tone(0.8), gap(0.15), tone(0.7), gap(0.25), tone(0.5), gap(0.1)], 1)
out = voice.until_last_pause(clip, SR, min_at=0.8 * 0.75)
assert out is not None and 1.6 < secs(out) < 1.8, f"cut after the caption, not at its comma: {out and secs(out)}"
assert out[0, -10:].abs().max() < 0.05, "ends faded, no click"

# tail glued to the caption (no detectable sentence pause) → None: the caller falls back to a plain read,
# rather than cutting at the comma and losing the end of the caption
glued = torch.cat([tone(0.8), gap(0.15), tone(0.7), gap(0.04), tone(0.5), gap(0.1)], 1)
assert voice.until_last_pause(glued, SR, min_at=0.8 * 0.75) is None, "comma pause must not win"

# no pause at all → None
assert voice.until_last_pause(tone(2.0), SR) is None
print("voice endings: ok", file=sys.stderr)
