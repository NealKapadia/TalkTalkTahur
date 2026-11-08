"""
BlinkTalk speller <-> SpacetimeDB (standard library only).

Every eye command, the live draft, spoken phrases, heart rate and SOS go to the
BlinkTalk SpacetimeDB module through its HTTP API, and a poller brings back
incoming texts, Nemotron reply suggestions and alert acknowledgements. Calls are
queued on a background thread so the speller never waits on the network; if
SpacetimeDB is not running the speller keeps working offline.

    POST /v1/database/<db>/call/<reducer>   body: JSON array of arguments
    POST /v1/database/<db>/sql              body: SQL text
"""
import json
import queue
import threading
import time
import urllib.error
import urllib.request


class Cloud:
    def __init__(self, host="http://localhost:3000", db="blinktalk", patient="neal",
                 timeout=4.0, verbose=True):
        self.base = host.rstrip("/") + f"/v1/database/{db}"
        self.patient = patient
        self.timeout = timeout
        self.verbose = verbose
        self.online = None              # None = unknown, True/False after first call
        self._calls = queue.Queue()
        self.updates = queue.Queue()     # state snapshots for the GUI thread
        self._stop = threading.Event()
        threading.Thread(target=self._call_worker, daemon=True).start()

    # ------------------------------------------------------------ transport
    def _post(self, path, data, content_type):
        req = urllib.request.Request(self.base + path, data=data, method="POST",
                                     headers={"Content-Type": content_type})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            body = r.read()
        return body

    def _set_online(self, ok, why=""):
        if ok != self.online and self.verbose:
            print("[cloud] SpacetimeDB " + ("connected" if ok else f"offline ({why}); speller keeps working"))
        self.online = ok

    def _call_worker(self):
        while not self._stop.is_set():
            reducer, args = self._calls.get()
            try:
                self._post(f"/call/{reducer}", json.dumps(args).encode(), "application/json")
                self._set_online(True)
            except urllib.error.HTTPError as e:
                self._set_online(True)
                if self.verbose:
                    print(f"[cloud] {reducer} rejected: {e.read().decode(errors='replace')[:200]}")
            except Exception as e:      # offline: drop the call, never block the speller
                self._set_online(False, type(e).__name__)

    def call(self, reducer, *args):
        """Queue a reducer call (fire and forget)."""
        self._calls.put((reducer, list(args)))

    def query(self, sql):
        """Run SQL, return a list of dicts per statement's rows (first statement)."""
        raw = self._post("/sql", sql.encode(), "text/plain")
        results = json.loads(raw)
        if not results:
            return []
        res = results[0]
        names = []
        for el in res["schema"]["elements"]:
            n = el.get("name")
            names.append(n.get("some") if isinstance(n, dict) else n)
        return [dict(zip(names, row)) for row in res["rows"]]

    # ------------------------------------------------------------ speller events
    def eye(self, command):
        self.call("eye_command", self.patient, command)

    def draft(self, text):
        self.call("set_draft", self.patient, text)

    def spoken(self, text):
        self.call("speak", self.patient, text)

    def reply(self, text):
        self.call("reply_latest", self.patient, text)

    def expand(self, keywords):
        self.call("request_intent", self.patient, keywords)

    def heart(self, bpm, quality):
        self.call("heartbeat", self.patient, int(bpm), float(quality))

    def cancel_sos(self):
        self.call("cancel_sos", self.patient)

    # ------------------------------------------------------------ polling
    def start_polling(self, interval=0.8):
        threading.Thread(target=self._poll_loop, args=(interval,), daemon=True).start()

    def _poll_loop(self, interval):
        p = self.patient.replace("'", "''")
        last = None
        while not self._stop.is_set():
            try:
                sugg = self.query(f"SELECT * FROM suggestion WHERE patient = '{p}'")
                sugg.sort(key=lambda s: s.get("rank", 0))
                msgs = self.query(f"SELECT * FROM message WHERE patient = '{p}' AND direction = 'in'")
                latest = max(msgs, key=lambda m: m["id"]) if msgs else None
                contact = None
                if latest:
                    rows = self.query(f"SELECT * FROM contact WHERE id = {int(latest['contact_id'])}")
                    contact = rows[0] if rows else None
                alerts = self.query(f"SELECT * FROM alert WHERE patient = '{p}'")
                acked = [a for a in alerts if a.get("acked_by")]
                last_ack = max(acked, key=lambda a: a["id"]) if acked else None
                open_sos = any(a["kind"] == "sos" and not a.get("acked_by") for a in alerts)
                snap = {
                    "suggestions": [s["text"] for s in sugg],
                    "inbox": None if not latest else {
                        "id": latest["id"], "body": latest["body"], "risk": latest.get("risk", ""),
                        "from": (contact or {}).get("name") or "Someone",
                    },
                    "open_sos": open_sos,
                    "last_ack": None if not last_ack else {"id": last_ack["id"], "by": last_ack["acked_by"],
                                                            "kind": last_ack["kind"]},
                }
                self._set_online(True)
                if snap != last:
                    self.updates.put(snap)
                    last = snap
            except Exception as e:
                self._set_online(False, type(e).__name__)
                time.sleep(3)
            time.sleep(interval)

    def stop(self):
        self._stop.set()
