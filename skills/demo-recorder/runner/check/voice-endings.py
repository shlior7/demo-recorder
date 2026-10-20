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
cut = lambda clip, share: voice.caption_only(clip, SR, share)

# caption (with a comma pause) · sentence pause · "That's it" with a stop inside it, as Chatterbox reads it
caption = [tone(0.8), gap(0.15), tone(0.7)]
tail = [tone(0.2), gap(0.15), tone(0.25), gap(0.1)]
clip = torch.cat(caption + [gap(0.25)] + tail, 1)
share = 1.65 / secs(clip)  # where the caption ends
out = cut(clip, share)
# keeps the caption and the whole pause after it (its soft decay), none of the tail (starts at 1.90 s)
assert out is not None and 1.65 < secs(out) <= 1.90, f"cut between caption and tail, not at its comma or inside the tail: {out is not None and secs(out)}"
assert out[0, -10:].abs().max() < 0.05, "ends faded, no click"

# tail glued to the caption (no detectable sentence pause) → None: plain read, rather than cutting at
# the caption's comma (losing its end) or inside the tail (keeping a "Tha…")
glued = torch.cat(caption + [gap(0.04)] + [tone(0.2), gap(0.05), tone(0.25), gap(0.1)], 1)
assert cut(glued, 1.54 / secs(glued)) is None, "no pause between caption and tail → plain read"

# no pause at all → None
assert cut(tone(2.0), 0.75) is None
print("voice endings: ok", file=sys.stderr)
