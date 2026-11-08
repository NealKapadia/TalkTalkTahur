"""Send one eye command straight to SpacetimeDB and report what happened.
    python speller/eye_test.py right        (or left / select / toggle / sos)
"""
import json, sys, time, urllib.error, urllib.request

cmd = sys.argv[1] if len(sys.argv) > 1 else "right"
host = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
base = f"{host}/v1/database/blinktalk"
t0 = time.time()
try:
    req = urllib.request.Request(f"{base}/call/eye_command", json.dumps(["neal", cmd]).encode(),
                                 {"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req, timeout=5).read()
    print(f"OK: sent '{cmd}' in {(time.time() - t0) * 1000:.0f} ms")
    q = urllib.request.Request(f"{base}/sql", b"SELECT status, draft FROM patient WHERE handle = 'neal'",
                               {"Content-Type": "text/plain"}, method="POST")
    rows = json.loads(urllib.request.urlopen(q, timeout=5).read())[0]["rows"]
    print("patient status:", rows)
except urllib.error.HTTPError as e:
    print("REJECTED:", e.code, e.read().decode(errors="replace")[:300])
except Exception as e:
    print("CANNOT REACH SpacetimeDB at", host, "->", type(e).__name__, e)
