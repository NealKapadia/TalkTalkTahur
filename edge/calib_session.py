"""
BlinkTalk - guided calibration session on the SK-AM62B (driven by the laptop GUI).

The laptop speller starts this over the serial console:
    python3 calib_session.py --user alex --led 12
and shows big on-screen prompts from the lines it prints. It can also be run by
hand in PuTTY (the prompts are readable as text).

Steps, all on the board and offline:
  1. record 60 s each of blink, look left, look right and rest, one action at
     every 5 s mark and quick repeats from 50 to 60 s
  2. right after each recording, check that the action was found at enough of
     the 5 s prompts (6 of 9) and moved the expected way (a repeat must match
     the first recording; left and right must be opposite); if not, record
     that action again straight away
  3. train and test the personal model (calibrate.py: train on the first 30 s,
     test on the rest)
  4. if any gesture's held-out recall is below --min-recall (0.5), record that
     gesture once more (adding to its data) and retrain, up to --max-rounds times
  5. save models/<user>.joblib

Output lines (all start with "BLINKTALK"):
  CAL START user=alex
  CAL STEP <action> <attempt>
  CUE <action> <second> <now|wait|fast|rest|done>
  CAL CHECK <action> hits=<n>/9 <ok|redo|weak>
  CAL LOG <text>                       (calibrate.py output)
  CAL RECALL blink=1.00 left=1.00 right=0.60 none=0.88 acc=0.86 spaced=1.00
  CAL REDO <action> recall=0.55
  CAL DONE user=alex acc=0.86 spaced=1.00 model=models/alex.joblib
  CAL ERROR <text>
  USERS default,alex,neal,...          (--list-users; builds the default model if missing)
  RENAMED person1 alex                 (--rename person1 alex)

Other uses:
  python3 calib_session.py --list-users
  python3 calib_session.py --build-default          shared model from all recordings on the board
  python3 calib_session.py --rename person3 alex    name a calibrated person
"""
import argparse
import contextlib
import glob
import io
import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

ACTIONS = ["blink", "left", "right", "rest"]
CUE_TIMES = list(range(5, 50, 5))        # the nine spaced prompts
MIN_HITS = 6                             # of 9 prompts must show the action


def say(line):
    print("BLINKTALK " + line, flush=True)


NAME_RE = r"[a-z0-9][a-z0-9_-]{0,31}"
DEFAULT = "default"
FILE_RE = re.compile(r"^(?P<user>.+?)_(?P<action>blink|left|right|rest)(?:\d+|_test\d+)?(?:_ECG)?\.csv$")


def list_users(model_dir, data_dir=None):
    """Print the users (the shared default model first), building it if missing."""
    if data_dir and not os.path.exists(os.path.join(model_dir, DEFAULT + ".joblib")):
        build_default(data_dir, model_dir)
    names = sorted(os.path.basename(p)[:-7] for p in glob.glob(os.path.join(model_dir, "*.joblib")))
    names = ([DEFAULT] if DEFAULT in names else []) + [n for n in names if n != DEFAULT]
    say("USERS " + ",".join(names))


def build_default(data_dir, model_dir):
    """Shared 'default' model from every calibration recording on the board.
    Works for a new person straight away (less accurately than a personal model)
    and improves as more people calibrate. Recordings made with a mirrored
    electrode placement (left/right moving the other way than most) are left out."""
    import joblib
    import features as F
    from calibrate import new_model
    from prepare_dataset import label_file, ONSET_SIGN
    found = []
    for path in sorted(glob.glob(os.path.join(data_dir, "*.csv"))):
        m = FILE_RE.match(os.path.basename(path))
        if m:
            found.append((m.group("action"), path))
    if not found:
        say("INFO no recordings for a default model yet")
        return False
    say(f"INFO building the default model from {len(found)} recordings...")
    rows = []
    for action, path in found:
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                times, X, labels, _, _ = label_file(path, action)
        except Exception:
            continue
        sel = labels == action
        sign = int(np.sign(np.median(X[sel, 0]))) if sel.any() else 0
        rows.append((action, path, X, labels, sign))
    keep_sign = {}
    for action in ("left", "right"):
        votes = sum(r[4] * int((r[3] == action).sum()) for r in rows if r[0] == action)
        keep_sign[action] = int(np.sign(votes)) or ONSET_SIGN[action]
    used = [r for r in rows if r[0] not in keep_sign or r[4] in (0, keep_sign[r[0]])]
    if not used:
        return False
    X = np.vstack([r[2] for r in used])
    Y = np.concatenate([r[3] for r in used])
    if not all((Y == c).any() for c in ("blink", "left", "right", "none")):
        say("INFO not enough recordings for a default model yet")
        return False
    model = new_model().fit(X, Y)
    config = {"fs_hz": F.FS_DEFAULT, "window_s": [-F.PRE_S, F.POST_S], "refractory_s": F.REFRACTORY_S,
              "slope_k": F.SLOPE_K, "return_s": F.RETURN_S, "multi_blink_s": F.MULTI_BLINK_S}
    out = os.path.join(model_dir, DEFAULT + ".joblib")
    joblib.dump({"model": model, "features": F.FEATURES, "classes": list(model.classes_),
                 "config": config, "user": DEFAULT,
                 "trained_on": [os.path.basename(r[1]) for r in used]}, out + ".tmp")
    os.replace(out + ".tmp", out)                  # never leave a half-written model
    say(f"INFO default model trained on {len(used)} recordings ({len(Y)} movements), "
        f"left out {len(rows) - len(used)} mirrored")
    return True


def rename_user(old, new, model_dir, data_dir):
    """Give a calibrated person a name: models and their recordings are renamed."""
    import joblib
    new = new.lower()
    if not re.fullmatch(NAME_RE, new) or new == DEFAULT:
        say(f"ERROR '{new}' is not a valid name (letters, numbers, - or _)")
        return 1
    src = os.path.join(model_dir, old + ".joblib")
    if not os.path.exists(src):
        say(f"ERROR no model for {old}")
        return 1
    if os.path.exists(os.path.join(model_dir, new + ".joblib")):
        say(f"ERROR the name {new} is already used")
        return 1
    bundle = joblib.load(src)
    bundle["user"] = new
    dst = os.path.join(model_dir, new + ".joblib")
    joblib.dump(bundle, dst + ".tmp")
    os.replace(dst + ".tmp", dst)
    os.remove(src)
    js = os.path.join(model_dir, old + "_calibration.json")
    if os.path.exists(js):
        with open(js) as f:
            rep = json.load(f)
        rep["user"] = new
        with open(os.path.join(model_dir, new + "_calibration.json"), "w") as f:
            json.dump(rep, f, indent=2)
        os.remove(js)
    for path in glob.glob(os.path.join(data_dir, old + "_*.csv")):
        os.rename(path, os.path.join(data_dir, new + os.path.basename(path)[len(old):]))
    say(f"RENAMED {old} {new}")
    list_users(model_dir)
    return 0


def record_action(evm, action, path, seconds=60.0):
    """Record one calibration file. Time is counted in samples so the prompts
    line up exactly with the data."""
    from afe_stream import save_csv
    fs = evm.rates.get("ECG", 500.0)
    ecg = []
    evm.start()
    last = -1
    try:
        while len(ecg) < seconds * fs:
            new = evm.read(0.05)
            if new.get("ECG") is not None:
                ecg.extend(new["ECG"].tolist())
            sec = int(len(ecg) / fs)
            if sec != last and sec < seconds:
                last = sec
                if action == "rest":
                    phase = "rest"
                elif sec >= 50:
                    phase = "fast"
                elif sec in CUE_TIMES:
                    phase = "now"
                else:
                    phase = "wait"
                say(f"CUE {action} {sec} {phase}")
    finally:
        evm.stop()
    say(f"CUE {action} {int(seconds)} done")
    save_csv(path, ecg[:int(seconds * fs)], fs)
    return path


def cue_hits(path, action):
    """(hits, sign): how many of the nine 5 s prompts have a labelled `action`
    near them, and which way that action's signal moves (+1 / -1)."""
    from prepare_dataset import label_file
    with contextlib.redirect_stdout(io.StringIO()):
        times, X, labels, _, _ = label_file(path, action)
    hits = sum(1 for g in CUE_TIMES
               if np.any((labels == action) & (times > g - 1.6) & (times < g + 1.0)))
    m = labels == action
    sign = int(np.sign(np.median(X[m, 0]))) if m.any() else 0
    return hits, sign


def train(user, files, model_dir):
    """Run calibrate.py; forward its report; return the saved calibration json."""
    cmd = [sys.executable, os.path.join(HERE, "calibrate.py"), "--user", user, "--out-dir", model_dir]
    for action in ACTIONS:
        if files.get(action):
            cmd += ["--" + action] + files[action]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=HERE)
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            say("CAL LOG " + line)
    if proc.wait() != 0:
        return None
    with open(os.path.join(model_dir, f"{user}_calibration.json")) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description="Guided BlinkTalk calibration")
    ap.add_argument("--user", help="name for the new personal model, e.g. alex")
    ap.add_argument("--led", type=int, default=12, help="green LED current code")
    ap.add_argument("--min-recall", type=float, default=0.5,
                    help="redo a gesture whose held-out recall is below this")
    ap.add_argument("--max-rounds", type=int, default=2, help="extra recording rounds at most")
    ap.add_argument("--max-tries", type=int, default=3, help="tries per recording if prompts are missed")
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--data-dir", default=os.path.join(HERE, "data"))
    ap.add_argument("--model-dir", default=os.path.join(HERE, "models"))
    ap.add_argument("--ports", nargs="*")
    ap.add_argument("--list-users", action="store_true")
    ap.add_argument("--build-default", action="store_true", help="(re)build the shared default model")
    ap.add_argument("--rename", nargs=2, metavar=("OLD", "NEW"), help="name a calibrated person")
    a = ap.parse_args()

    if a.list_users:
        list_users(a.model_dir, a.data_dir)
        return 0
    if a.build_default:
        build_default(a.data_dir, a.model_dir)
        list_users(a.model_dir)
        return 0
    if a.rename:
        return rename_user(a.rename[0], a.rename[1], a.model_dir, a.data_dir)
    if not a.user or not re.fullmatch(NAME_RE, a.user.lower()) or a.user.lower() == DEFAULT:
        say("CAL ERROR the person's name must be letters/numbers (and not 'default')")
        return 1
    user = a.user.lower()
    os.makedirs(a.data_dir, exist_ok=True)
    os.makedirs(a.model_dir, exist_ok=True)

    from afe_stream import AFE4950EVM
    say(f"CAL START user={user}")
    try:
        evm = AFE4950EVM(a.ports, log=lambda m: None)
        evm.configure()
        evm.set_led(a.led)
    except Exception as e:
        say(f"CAL ERROR could not start the AFE4950EVM: {e}")
        return 1

    files = {k: [] for k in ACTIONS}
    counter = {k: 0 for k in ACTIONS}
    ref_sign = {}                         # direction of each action's first good recording
    opposite = {"left": "right", "right": "left"}

    def take(action):
        """Record `action` until enough prompts are hit (or tries run out)."""
        best = None
        for attempt in range(1, a.max_tries + 1):
            counter[action] += 1
            path = os.path.join(a.data_dir, f"{user}_{action}{counter[action]}_ECG.csv")
            say(f"CAL STEP {action} {attempt}")
            record_action(evm, action, path, a.seconds)
            if action == "rest":
                say("CAL CHECK rest hits=-/- ok")
                return path
            hits, sign = cue_hits(path, action)
            # a repeat must move the same way as before, and left/right must differ
            wrong = (action in ref_sign and sign != ref_sign[action]) or \
                    (opposite.get(action) in ref_sign and sign == ref_sign[opposite[action]])
            ok = hits >= MIN_HITS and not wrong
            last = attempt == a.max_tries
            status = "ok" if ok else ("wrong_direction" if wrong else ("weak" if last else "redo"))
            say(f"CAL CHECK {action} hits={hits}/9 {status}")
            if not wrong and (best is None or hits > best[0]):
                best = (hits, path, sign)
            if ok:
                ref_sign.setdefault(action, sign)
                return path
        if best is None:
            say(f"CAL ERROR {action}: the signal kept moving the wrong way; check the electrodes")
            raise SystemExit(1)
        ref_sign.setdefault(action, best[2])
        return best[1]

    try:
        for action in ACTIONS:
            files[action].append(take(action))

        report = None
        for rnd in range(a.max_rounds + 1):
            say("CAL TRAIN")
            report = train(user, files, a.model_dir)
            if report is None:
                say("CAL ERROR training failed (see log above)")
                return 1
            rec = report["recall"]
            say("CAL RECALL " + " ".join(f"{k}={(rec[k] if rec[k] is not None else 0):.2f}"
                                         for k in ("blink", "left", "right", "none"))
                + f" acc={report['accuracy']:.2f} spaced={report['spaced_accuracy']:.2f}")
            weak = [k for k in ("blink", "left", "right")
                    if rec.get(k) is not None and rec[k] < a.min_recall]
            if not weak or rnd == a.max_rounds:
                break
            for action in weak:
                say(f"CAL REDO {action} recall={rec[action]:.2f}")
                files[action].append(take(action))

        say("CAL TRAIN default")
        build_default(a.data_dir, a.model_dir)        # the default learns from everyone
        list_users(a.model_dir)
        say(f"CAL DONE user={user} acc={report['accuracy']:.2f} "
            f"spaced={report['spaced_accuracy']:.2f} model=models/{user}.joblib")
        return 0
    except KeyboardInterrupt:
        say("CAL ERROR calibration stopped")
        return 1
    finally:
        try:
            evm.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
