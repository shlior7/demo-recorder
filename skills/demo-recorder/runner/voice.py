"""Chatterbox TTS worker for `record-demo.sh --voice`: reads each caption aloud.

  voice.py                 one JSON request per stdin line → one JSON reply per stdout line
                           {"text", "out", "energy", "exaggeration", "cfg", "temperature", "ref"} → {"out", "seconds"}
  voice.py --say TEXT OUT  one clip (setup check / audition a voice config), opts as JSON in $DEMO_VOICE_OPTS

The model loads once per run (first use downloads ~3 GB of weights from Hugging Face).
"""
import json, os, sys

# stdout is the reply channel — library chatter (progress bars, warnings) goes to stderr instead
reply = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
model = ChatterboxTTS.from_pretrained(device=device)


# voice.energy → (exaggeration, cfg_weight, temperature, ending). exaggeration = emotion (0.5 ≈ neutral),
# lower cfg = livelier pacing; rainbow is the max, and ends lines on "!".
ENERGY = {
    "calm": (0.4, 0.5, 0.6, "."),
    "warm": (0.45, 0.4, 0.6, "."),
    "upbeat": (0.55, 0.4, 0.65, "."),
    "rainbow": (0.7, 0.3, 0.8, "!"),
}


def say(req):
    level = ENERGY.get(req.get("energy"), ENERGY["upbeat"])
    pick = lambda key, i: float(req[key]) if req.get(key) not in (None, "") else level[i]  # explicit numbers win
    text = req["text"].strip()
    if text[-1:] not in ".!?…":
        text += level[3]
    wav = model.generate(
        text,
        audio_prompt_path=req.get("ref") or None,  # a 10–30 s clip of the voice to clone; empty = built-in voice
        exaggeration=pick("exaggeration", 0),
        cfg_weight=pick("cfg", 1),
        temperature=pick("temperature", 2),
    )
    torchaudio.save(req["out"], wav, model.sr)
    return {"out": req["out"], "seconds": wav.shape[-1] / model.sr}


if sys.argv[1:2] == ["--say"]:
    print(json.dumps(say({**json.loads(os.environ.get("DEMO_VOICE_OPTS") or "{}"), "text": sys.argv[2], "out": sys.argv[3]})), file=reply)
    sys.exit(0)

for line in sys.stdin:
    try:
        print(json.dumps(say(json.loads(line))), file=reply)
    except Exception as e:  # one bad caption must not kill the run
        print(json.dumps({"error": str(e)}), file=reply)
