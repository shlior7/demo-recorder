"""Re-voice a finished take without re-recording it: every caption in <stem>-chapters.json is read again
with the current voice settings and laid in at its moment in the final video; the video stream is copied
as is. For a voice change, a silent take that should talk, or lines whose ending came out "open".

  revoice.py <take.mp4> <out.mp4> [tries]     voice options as JSON in $DEMO_VOICE_OPTS (config voice)

tries > 1: a line is re-read until its ending falls (end pitch ≤ FALL × the line's median, pYIN), keeping
the lowest of `tries` readings.
"""
import json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice  # noqa: E402

FALL = 0.85  # measured: lines at 0.85–1.05 still sound unfinished; the ones that sound done sit at 0.4–0.8


def ending(f):
    """end F0 / median F0 of a clip (> 1 = rising)."""
    import librosa, numpy as np  # chatterbox's own dependency, only needed with tries > 1

    y, sr = librosa.load(f, sr=None)
    f0, vf, _ = librosa.pyin(y, fmin=70, fmax=400, sr=sr, frame_length=1024, hop_length=256)
    v = f0[vf & ~np.isnan(f0)]
    return float(np.median(v[-6:]) / np.median(v)) if len(v) >= 20 else 1.0


def main():
    take, out = sys.argv[1], sys.argv[2]
    tries = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    stem = take[: -len(".mp4")]
    try:
        chapters = json.load(open(f"{stem}-chapters.json"))
    except FileNotFoundError:
        sys.exit(f"✗ {stem}-chapters.json not found — re-record the take with demo-recorder 0.4.0 or later")
    opts = json.loads(os.environ.get("DEMO_VOICE_OPTS") or "{}")
    caps = [c for c in chapters if c["kind"] == "caption" and c["text"].strip()]
    work = tempfile.mkdtemp(prefix="revoice-")
    clips = []
    for i, c in enumerate(caps):
        f, best = os.path.join(work, f"{i}.wav"), None
        for k in range(tries):
            fk = f"{f}.{k}.wav"
            # takes recorded before chapters carried `say` fall back to the caption text
            r = voice.say({**opts, "text": c.get("say") or c["text"], "out": fk})
            e = ending(fk) if tries > 1 else 0
            if best is None or e < best[0]:
                best = (e, fk, r["seconds"])
            if e <= FALL:
                break
        e, fk, secs = best
        os.replace(fk, f)
        nxt = caps[i + 1]["t"] if i + 1 < len(caps) else None
        if nxt is not None and c["t"] + secs > nxt:
            print(f"⚠ {c['text']!r} now runs {c['t'] + secs - nxt:.1f}s into the next caption — "
                  f"re-record with --voice so the take paces itself to the voice", file=sys.stderr)
        clips.append((c["t"], f))
        print(f"  {c['t']:6.2f}s  {c['text']}" + (f"  (ending {e:.2f}, {k + 1} reading{'s' * (k > 0)})" if tries > 1 else ""), file=sys.stderr)
    if not clips:
        sys.exit("✗ no captions to voice in this take")

    dur = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", take]).decode().strip()
    args = ["ffmpeg", "-y", "-v", "error", "-i", take]
    graph = []
    for i, (t, f) in enumerate(clips):
        args += ["-i", f]
        graph.append(f"[{i + 1}:a]adelay=delays={round(t * 1000)}:all=1[a{i}]")
    graph.append(f"{''.join(f'[a{i}]' for i in range(len(clips)))}amix=inputs={len(clips)}:normalize=0,apad,atrim=end={dur}[aout]")
    args += ["-filter_complex", ";".join(graph), "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]
    subprocess.check_call(args)


if __name__ == "__main__":
    main()
