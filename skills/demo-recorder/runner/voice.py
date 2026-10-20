"""Chatterbox TTS worker for `record-demo.sh --voice`: reads each caption aloud.

  voice.py                 one JSON request per stdin line → one JSON reply per stdout line
                           {"text", "out", "exaggeration", "cfg", "temperature", "ref"} → {"out", "seconds"}
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


def say(req):
    wav = model.generate(
        req["text"],
        audio_prompt_path=req.get("ref") or None,  # a 10–30 s clip of the voice to clone; empty = built-in voice
        exaggeration=float(req.get("exaggeration", 0.7)),  # emotion: 0.5 neutral … 1 very animated
        cfg_weight=float(req.get("cfg", 0.3)),  # lower = livelier, slower-paced delivery
        temperature=float(req.get("temperature", 0.8)),
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
