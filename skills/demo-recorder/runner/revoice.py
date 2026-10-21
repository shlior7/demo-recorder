"""Re-voice a finished take without re-recording it: captions from <stem>-chapters.json are read again and
laid in at their moments in the final video; the video stream is copied as is. For a voice change, a
silent take that should talk, or lines whose ending came out "open" — all lines, or only some (--line).

  revoice.py <take.mp4> <out.mp4> [--line TEXT]… [--say S] [--energy E] [--exaggeration X] [--cfg X]
             [--temperature X] [--tries N]          voice.* settings as JSON in $DEMO_VOICE_OPTS

Each line reads with voice.* < its own "voice" from the take (manifest/spec) < the flags given here.
--line (case-insensitive substring of the caption, repeatable): only those lines are read again; the
take's audio is kept everywhere else, the old line's span (up to the next caption) replaced.
--tries N: a line is re-read until its ending falls (end pitch ≤ FALL × its median, pYIN), keeping the
lowest of N readings. <out> gets its own -chapters.json with the overrides, so a later revoice keeps them.
"""
import argparse, json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice  # noqa: E402

FALL = 0.85  # measured: lines at 0.85–1.05 still sound unfinished; the ones that sound done sit at 0.4–0.8


def ending(f):
    """end F0 / median F0 of a clip (> 1 = rising)."""
    import librosa, numpy as np  # chatterbox's own dependency, only needed with --tries > 1

    y, sr = librosa.load(f, sr=None)
    f0, vf, _ = librosa.pyin(y, fmin=70, fmax=400, sr=sr, frame_length=1024, hop_length=256)
    v = f0[vf & ~np.isnan(f0)]
    return float(np.median(v[-6:]) / np.median(v)) if len(v) >= 20 else 1.0


def probe(take, *args):
    return subprocess.check_output([os.environ.get("FFPROBE", "ffprobe"), "-v", "error", *args, "-of", "csv=p=0", take]).decode().strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("take"), ap.add_argument("out")
    ap.add_argument("--line", action="append", default=[])
    ap.add_argument("--say"), ap.add_argument("--energy", choices=["calm", "warm", "upbeat", "rainbow"])
    for k in ("exaggeration", "cfg", "temperature"):
        ap.add_argument(f"--{k}", type=float)
    ap.add_argument("--tries", type=int, default=1)
    a = ap.parse_args()

    stem = a.take[: -len(".mp4")]
    try:
        chapters = json.load(open(f"{stem}-chapters.json"))
    except FileNotFoundError:
        sys.exit(f"✗ {stem}-chapters.json not found — re-record the take with demo-recorder 0.4.0 or later")
    caps = [c for c in chapters if c["kind"] == "caption" and c["text"].strip()]
    pick = [c for c in caps if not a.line or any(p.lower() in c["text"].lower() for p in a.line)]
    if a.line and not pick:
        sys.exit(f"✗ no caption matches {a.line} — captions: {[c['text'] for c in caps]}")
    if a.say and len(pick) != 1:
        sys.exit(f"✗ --say needs exactly one line (--line), matched {len(pick)}")
    flags = {k: v for k, v in (("say", a.say), ("energy", a.energy), ("exaggeration", a.exaggeration), ("cfg", a.cfg), ("temperature", a.temperature)) if v is not None}
    for c in pick:  # the take's own per-line voice, then the flags — kept in the output's chapters
        if flags:
            c["voice"] = {**(c.get("voice") or {}), **flags}

    base = json.loads(os.environ.get("DEMO_VOICE_OPTS") or "{}")
    dur = float(probe(a.take, "-show_entries", "format=duration"))
    work = tempfile.mkdtemp(prefix="revoice-")
    clips, spans = [], []
    for c in pick:
        i = caps.index(c)
        span = (c["t"], caps[i + 1]["t"] if i + 1 < len(caps) else dur)
        spans.append(span)
        line = c.get("voice")
        if line is False:
            print(f"  {c['t']:6.2f}s  {c['text']}  (silent)", file=sys.stderr)
            continue
        line = dict(line or {})
        say = line.pop("say", None) or c.get("say") or c["text"]  # takes before `say` existed: caption text
        f, best = os.path.join(work, f"{i}.wav"), None
        for k in range(a.tries):
            fk = f"{f}.{k}.wav"
            r = voice.say({**base, **line, "text": say, "out": fk})
            e = ending(fk) if a.tries > 1 else 0
            if best is None or e < best[0]:
                best = (e, fk, r["seconds"])
            if e <= FALL:
                break
        e, fk, secs = best
        os.replace(fk, f)
        if span[0] + secs > span[1]:
            print(f"⚠ {c['text']!r} now runs {span[0] + secs - span[1]:.1f}s past "
                  f"{'the next caption' if span[1] < dur else 'the end of the video'} — re-record with --voice so the take paces itself to it", file=sys.stderr)
        clips.append((c["t"], f))
        print(f"  {c['t']:6.2f}s  {c['text']}" + (f"  → {say!r}" if say != c.get("say", c["text"]) else "")
              + (f"  (ending {e:.2f}, {k + 1} reading{'s' * (k > 0)})" if a.tries > 1 else ""), file=sys.stderr)

    # keep the take's audio outside the re-read lines (--line); a full revoice replaces all of it
    keep = bool(a.line) and probe(a.take, "-select_streams", "a", "-show_entries", "stream=codec_name") != ""
    args = [os.environ.get("FFMPEG", "ffmpeg"), "-y", "-v", "error", "-i", a.take]
    graph, mix = [], []
    if keep:
        mute = ",".join(f"volume=0:enable='between(t,{s:.3f},{e:.3f})'" for s, e in spans)
        graph.append(f"[0:a]{mute}[kept]")
        mix.append("[kept]")
    for n, (t, f) in enumerate(clips):
        args += ["-i", f]
        graph.append(f"[{n + 1}:a]adelay=delays={round(t * 1000)}:all=1[a{n}]")
        mix.append(f"[a{n}]")
    if not mix:
        sys.exit("✗ nothing to voice")
    graph.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0,apad,atrim=end={dur:.3f}[aout]")
    tmp = f"{a.out}.tmp.mp4"  # out may be the take itself (a re-voiced take, revoiced again)
    args += ["-filter_complex", ";".join(graph), "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]
    subprocess.check_call(args)
    os.replace(tmp, a.out)
    with open(f"{a.out[: -len('.mp4')]}-chapters.json", "w") as fh:
        fh.write("[\n" + ",\n".join(json.dumps(c, ensure_ascii=False) for c in chapters) + "\n]\n")


if __name__ == "__main__":
    main()
