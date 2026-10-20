"""Chatterbox TTS worker for `record-demo.sh --voice`: reads each caption aloud.

  voice.py                 one JSON request per stdin line → one JSON reply per stdout line
                           {"text", "out", "energy", "exaggeration", "cfg", "temperature", "ref"} → {"out", "seconds"}
  voice.py --say TEXT OUT  one clip (setup check / audition a voice config), opts as JSON in $DEMO_VOICE_OPTS

The model loads once per run, on the first line (first use downloads ~3 GB of weights from Hugging Face).
"""
import json, os, sys

# stdout is the reply channel — library chatter (progress bars, warnings) goes to stderr instead
reply = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
model = None  # loaded on the first line, so runner/check/voice-endings.py can import this file without the weights


# voice.energy → (exaggeration, cfg_weight, temperature, ending). exaggeration = emotion (0.5 ≈ neutral),
# lower cfg = livelier pacing; rainbow is the max, and ends lines on "!".
ENERGY = {
    "calm": (0.4, 0.5, 0.6, "."),
    "warm": (0.45, 0.4, 0.6, "."),
    "upbeat": (0.55, 0.4, 0.65, "."),
    "rainbow": (0.7, 0.3, 0.8, "!"),
}


# Read as a paragraph's last line, a short caption tends to end on a rising, "open" pitch (measured with
# pYIN: 9/15 lines rose at upbeat, 8/15 at rainbow). Followed by another sentence it falls like a finished
# statement (3/14, 3/15). So: say the caption + TAIL, keep only the caption — up to the pause between them.
TAIL = " That's it."


def caption_only(wav, sr, share, min_gap=0.12, tail_min=0.25):
    """wav cut at the pause between the caption and TAIL, or None (no such pause → read it plain).
    That pause is the ≥min_gap one NEAREST to where the caption should end (`share` of the clip, by
    characters) — not the last one: "That's it" has a stop of its own, and cutting there keeps a "Tha…"
    that sounds unfinished. A pause before 0.8·share is a comma inside the caption and never counts."""
    hop = int(0.01 * sr)
    env = wav.abs().mean(0).unfold(0, hop, hop).mean(1)
    quiet = (env < env.max() * 0.05).tolist() + [False]
    pauses, start = [], None  # (start, end) quiet runs ≥ min_gap that leave ≥ tail_min after them
    for i, q in enumerate(quiet):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if i - start >= min_gap / 0.01 and i <= len(env) - tail_min / 0.01:
                pauses.append((start, i))
            start = None
    end = share * len(env)
    pauses = [p for p in pauses if p[0] >= 0.8 * end]
    if not pauses:
        return None
    a, b = min(pauses, key=lambda p: abs(p[0] - end))
    # keep the whole pause up to just before the tail: a soft trailing vowel under the 5% "quiet" line is
    # still heard, and clipping it sounds unfinished — silence is free
    out = wav[:, : max(a + 6, b - 4) * hop].clone()
    fade = min(out.shape[-1], int(0.03 * sr))
    out[:, -fade:] *= torch.linspace(1, 0, fade)
    return out


def say(req):
    global model
    if model is None:
        model = ChatterboxTTS.from_pretrained(device=device)
    level = ENERGY.get(req.get("energy"), ENERGY["upbeat"])
    pick = lambda key, i: float(req[key]) if req.get(key) not in (None, "") else level[i]  # explicit numbers win
    text = req["text"].strip()
    if text[-1:] not in ".!?…":
        text += level[3]
    gen = lambda t: model.generate(
        t,
        audio_prompt_path=req.get("ref") or None,  # a 10–30 s clip of the voice to clone; empty = built-in voice
        exaggeration=pick("exaggeration", 0),
        cfg_weight=pick("cfg", 1),
        temperature=pick("temperature", 2),
    )
    # no clean pause before the tail → plain read; the tail must never be heard
    wav = caption_only(gen(text + TAIL), model.sr, share=len(text) / len(text + TAIL))
    if wav is None:
        wav = gen(text)
    # write-then-rename: a concurrent take voicing the same caption (same cache file) never reads half a wav
    tmp = f"{req['out']}.{os.getpid()}.tmp.wav"
    torchaudio.save(tmp, wav, model.sr)
    os.replace(tmp, req["out"])
    return {"out": req["out"], "seconds": wav.shape[-1] / model.sr}


if __name__ == "__main__":
    if sys.argv[1:2] == ["--say"]:
        print(json.dumps(say({**json.loads(os.environ.get("DEMO_VOICE_OPTS") or "{}"), "text": sys.argv[2], "out": sys.argv[3]})), file=reply)
        sys.exit(0)

    for line in sys.stdin:
        try:
            print(json.dumps(say(json.loads(line))), file=reply)
        except Exception as e:  # one bad caption must not kill the run
            print(json.dumps({"error": str(e)}), file=reply)
