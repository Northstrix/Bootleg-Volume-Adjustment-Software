"""
Bootleg Volume Adjustment Software
-----------------------------------
Local tool for calibrating word-sound volume against a set of reference
sounds. The browser UI plays audio using a line-for-line port of the
AudioEngine in your Next.js app's AppContext.tsx: one AudioContext,
fetch + decodeAudioData, a buffer source connected straight to
destination with NO client-side gain node (exactly how word audio is
played in Onda Sfasata and Esplendente). Every actual volume change is baked into the WAV
file itself, server-side, with pydub/ffmpeg -- never with a browser gain
node -- so what you hear while calibrating is exactly what will ship.

Everything the browser loads (HTML/CSS/JS/the badge image) is a local
file served straight off disk from web/ -- no CDNs, no external scripts,
no external stylesheets, no fonts pulled from the network.

Credit:
[Chronicle Button](https://codepen.io/Haaguitos/pen/OJrVZdJ) by [Haaguitos](https://codepen.io/Haaguitos)

Copyright (c) 2026 by Haaguitos (https://codepen.io/Haaguitos/pen/OJrVZdJ)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

[Input Floating Label animation](https://codepen.io/Mahe76/pen/qBQgXyK) by [Elpeeda](https://codepen.io/Mahe76)

Copyright (c) 2026 by Elpeeda (https://codepen.io/Mahe76/pen/qBQgXyK)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""

import os
import json
import glob
import time
import webbrowser
import threading
import argparse
from datetime import datetime, timezone

# ============================================================
# CONFIGURATION  --  edit these before running
# ============================================================

# ffmpeg (same setup as your Batch_Processor.py)
FFMPEG_DIR = r"C:\ffmpeg\bin"
FFMPEG_EXE = r"C:\ffmpeg\bin\ffmpeg.exe"
FFPROBE_EXE = r"C:\ffmpeg\bin\ffprobe.exe"

# Folder with the sounds you want to adjust
RAW_FOLDER = r"Unprocessed"

# Folder with your reference sounds. Whatever .wav files are sitting in
# here at the moment the app is launched become the reference sounds --
# nothing to hardcode, nothing to keep in sync by hand.
REF_FOLDER = r"ref_vol_sounds"

# Folder where finished, volume-adjusted files are written
OUTPUT_FOLDER = r"Processed"

# Folder for temporary preview files (safe to wipe any time)
TEMP_FOLDER = r"Temp"

# Log of every applied adjustment -> lets you reproduce output later
LOG_FILE = r"volume_adjustments.json"

# Gap, in ms, AFTER each sound finishes before the next one starts.
# Used identically between two reference sounds, and between the last
# reference sound and the sound being adjusted. E.g. 200 = 0.2s gap.
DELAY_MS = 600

# Local server port
PORT = 5057

# ============================================================
# End of configuration
# ============================================================

os.environ["PATH"] = FFMPEG_DIR + os.pathsep + os.environ.get("PATH", "")

from flask import Flask, request, jsonify, send_from_directory
from pydub import AudioSegment

AudioSegment.converter = FFMPEG_EXE
AudioSegment.ffprobe = FFPROBE_EXE

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
# Only the web/ folder is exposed to the browser -- Namer.png lives right
# next to index.html in here, and nothing outside this folder (source
# code, raw audio, the log file) is reachable via a static URL.
WEB_DIR = os.path.join(BASE_DIR, "web")

app = Flask(__name__, static_folder=WEB_DIR, static_url_path="")


# ---------------------------------------------------------------- session --

class Session:
    """All server-side state for the current calibration run."""

    def __init__(self):
        self.candidates = []       # filenames still to review, in order
        self.reference_files = []  # snapshot of REF_FOLDER at launch
        self.index = 0
        self.adjustments = {}      # filename -> {"adjustment_db": float}
        self.scan()
        self.load_log()

    def scan(self):
        os.makedirs(RAW_FOLDER, exist_ok=True)
        os.makedirs(REF_FOLDER, exist_ok=True)
        self.candidates = sorted(
            f for f in os.listdir(RAW_FOLDER) if f.lower().endswith(".wav")
        )
        self.reference_files = sorted(
            f for f in os.listdir(REF_FOLDER) if f.lower().endswith(".wav")
        )

    def load_log(self):
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            self.adjustments = data.get("files", {})
        else:
            self.adjustments = {}

    def save_log(self):
        with open(LOG_FILE, "w", encoding="utf-8") as fh:
            json.dump({"files": self.adjustments}, fh, indent=2, sort_keys=True)

    def current_filename(self):
        if 0 <= self.index < len(self.candidates):
            return self.candidates[self.index]
        return None


session = Session()
os.makedirs(OUTPUT_FOLDER, exist_ok=True)
os.makedirs(TEMP_FOLDER, exist_ok=True)


def print_reference_summary():
    print(f"[REFERENCES] {len(session.reference_files)} loaded from {REF_FOLDER}, "
          f"{len(session.candidates)} candidate file(s) to review")
    for f in session.reference_files:
        val = dbfs_of(os.path.join(REF_FOLDER, f))
        print(f"  ref: {f}  ->  {val} dBFS")


# ------------------------------------------------------------------ audio --

def dbfs_of(path):
    seg = AudioSegment.from_wav(path)
    val = seg.dBFS
    if val == float("-inf"):
        return None
    return round(val, 2)


def clear_previews_for(stem):
    for f in glob.glob(os.path.join(TEMP_FOLDER, f"{glob.escape(stem)}__preview_*.wav")):
        try:
            os.remove(f)
        except OSError:
            pass


def render_preview(filename, adjustment_db):
    """Bake adjustment_db into filename's audio, write it to TEMP_FOLDER.
    Returns (temp_filename, adjusted_dbfs)."""
    src = os.path.join(RAW_FOLDER, filename)
    seg = AudioSegment.from_wav(src)
    adjusted = seg.apply_gain(adjustment_db)

    stem = os.path.splitext(filename)[0]
    clear_previews_for(stem)
    token = int(time.time() * 1000)
    temp_name = f"{stem}__preview_{token}.wav"
    adjusted.export(os.path.join(TEMP_FOLDER, temp_name), format="wav")

    val = adjusted.dBFS
    return temp_name, (None if val == float("-inf") else round(val, 2))


def build_reference_payload():
    return [
        {"filename": f, "dbfs": dbfs_of(os.path.join(REF_FOLDER, f))}
        for f in session.reference_files
    ]


def build_session_payload():
    filename = session.current_filename()
    payload = {
        "delay_ms": DELAY_MS,
        "references": build_reference_payload(),
        "total": len(session.candidates),
        "index": session.index,
        "done": filename is None,
    }
    if filename:
        original_dbfs = dbfs_of(os.path.join(RAW_FOLDER, filename))
        existing = session.adjustments.get(filename)
        payload["current"] = {
            "filename": filename,
            "original_dbfs": original_dbfs,
            "existing_adjustment_db": existing["adjustment_db"] if existing else None,
            "already_applied": existing is not None,
        }
        print(f"[FILE] {session.index + 1}/{len(session.candidates)}  {filename}  "
              f"original={original_dbfs} dBFS")
    return payload


# ----------------------------------------------------------------- routes --

@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/api/session")
def api_session():
    return jsonify(build_session_payload())


@app.route("/api/audio/raw/<path:filename>")
def api_audio_raw(filename):
    safe = os.path.basename(filename)
    return send_from_directory(RAW_FOLDER, safe, mimetype="audio/wav")


@app.route("/api/audio/ref/<path:filename>")
def api_audio_ref(filename):
    safe = os.path.basename(filename)
    return send_from_directory(REF_FOLDER, safe, mimetype="audio/wav")


@app.route("/api/audio/preview/<path:filename>")
def api_audio_preview(filename):
    safe = os.path.basename(filename)
    return send_from_directory(TEMP_FOLDER, safe, mimetype="audio/wav")


@app.route("/api/preview", methods=["POST"])
def api_preview():
    body = request.get_json(force=True) or {}
    adjustment_db = float(body.get("adjustment_db", 0))
    filename = session.current_filename()
    if not filename:
        return jsonify({"error": "no current file"}), 400

    if abs(adjustment_db) < 1e-9:
        # No change -- point straight at the raw file, no render needed.
        print(f"[PREVIEW] {filename}  0.00 dB (raw)")
        return jsonify({
            "url": f"/api/audio/raw/{filename}",
            "key": f"raw:{filename}",
            "adjusted_dbfs": dbfs_of(os.path.join(RAW_FOLDER, filename)),
        })

    temp_name, adjusted_dbfs = render_preview(filename, adjustment_db)
    print(f"[PREVIEW] {filename}  {adjustment_db:+.2f} dB -> {adjusted_dbfs} dBFS")
    return jsonify({
        "url": f"/api/audio/preview/{temp_name}",
        "key": f"preview:{temp_name}",
        "adjusted_dbfs": adjusted_dbfs,
    })


@app.route("/api/apply", methods=["POST"])
def api_apply():
    body = request.get_json(force=True) or {}
    adjustment_db = float(body.get("adjustment_db", 0))
    filename = session.current_filename()
    if not filename:
        return jsonify({"error": "no current file"}), 400

    src = os.path.join(RAW_FOLDER, filename)
    seg = AudioSegment.from_wav(src).apply_gain(adjustment_db)
    out_path = os.path.join(OUTPUT_FOLDER, filename)
    seg.export(out_path, format="wav")

    session.adjustments[filename] = {"adjustment_db": round(adjustment_db, 3)}
    session.save_log()
    print(f"[APPLY] {filename}  {adjustment_db:+.2f} dB -> {out_path}")

    session.index += 1
    return jsonify(build_session_payload())


@app.route("/api/skip", methods=["POST"])
def api_skip():
    filename = session.current_filename()
    print(f"[SKIP] {filename} -- not written to the log")
    session.index += 1
    return jsonify(build_session_payload())


@app.route("/api/prev", methods=["POST"])
def api_prev():
    session.index = max(0, session.index - 1)
    return jsonify(build_session_payload())


@app.route("/api/rebuild", methods=["POST"])
def api_rebuild():
    count = rebuild_from_log()
    return jsonify({"rebuilt": count})


def rebuild_from_log():
    """Headless reproduction: read LOG_FILE + RAW_FOLDER, regenerate OUTPUT_FOLDER."""
    if not os.path.exists(LOG_FILE):
        print(f"[REBUILD] no log file at {LOG_FILE}")
        return 0
    with open(LOG_FILE, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    files = data.get("files", {})
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    count = 0
    for filename, info in files.items():
        src = os.path.join(RAW_FOLDER, filename)
        if not os.path.exists(src):
            print(f"[REBUILD] missing raw file, skipping: {filename}")
            continue
        seg = AudioSegment.from_wav(src).apply_gain(float(info["adjustment_db"]))
        seg.export(os.path.join(OUTPUT_FOLDER, filename), format="wav")
        print(f"[REBUILD] {filename}  {float(info['adjustment_db']):+.2f} dB")
        count += 1
    print(f"[REBUILD] done -- {count} file(s) written to {OUTPUT_FOLDER}")
    return count


def open_browser():
    time.sleep(1.0)
    webbrowser.open(f"http://127.0.0.1:{PORT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bootleg Volume Adjustment Software")
    parser.add_argument(
        "--rebuild", action="store_true",
        help="Headless: reproduce OUTPUT_FOLDER from LOG_FILE + RAW_FOLDER, then exit"
    )
    args = parser.parse_args()

    if args.rebuild:
        rebuild_from_log()
    else:
        print_reference_summary()
        threading.Thread(target=open_browser, daemon=True).start()
        app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
