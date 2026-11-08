"""Speller + SpacetimeDB client tests against a fake SpacetimeDB HTTP API.
Run: python speller/test_cloud.py
"""
import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import tkinter  # noqa: F401
except ImportError:          # headless CI: the logic under test does not touch Tk
    import types
    sys.modules["tkinter"] = types.ModuleType("tkinter")
import speller as sp_mod  # noqa: E402
from cloud import Cloud   # noqa: E402

CALLS = []
TABLES = {
    "suggestion": (["id", "patient", "message_id", "contact_id", "text", "rank", "source", "created_at"],
                   [[2, "neal", 7, 3, "Not tonight.", 1, "nemotron", 0],
                    [1, "neal", 7, 3, "Yes, come at 7.", 0, "nemotron", 0]]),
    "message": (["id", "patient", "contact_id", "direction", "channel", "body", "status", "risk", "risk_reason", "created_at"],
                [[7, "neal", 3, "in", "imessage", "Can I visit tonight?", "received", "ok", "", 0]]),
    "contact": (["id", "patient", "name", "address", "relation", "tier"], [[3, "neal", "Mom", "+14695550101", "mother", 1]]),
    "alert": (["id", "patient", "kind", "detail", "level", "notified_level", "acked_by", "created_at", "acked_at"],
              [[4, "neal", "sos", "x", 1, 1, "Mom", 0, {"some": 0}]]),
}


class FakeStdb(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        if "/call/" in self.path:
            CALLS.append((self.path.rsplit("/", 1)[1], json.loads(body)))
            out = b""
        else:
            table = body.split("FROM")[1].split()[0]
            names, rows = TABLES[table]
            out = json.dumps([{"schema": {"elements": [{"name": {"some": n}, "algebraic_type": {}} for n in names]},
                               "rows": rows}]).encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(out)


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeStdb)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.cloud = Cloud(f"http://127.0.0.1:{cls.srv.server_port}", "blinktalk", "neal", verbose=False)

    def wait_calls(self, n):
        for _ in range(50):
            if len(CALLS) >= n:
                return
            time.sleep(0.02)

    def test_reducer_calls_are_positional_json(self):
        CALLS.clear()
        self.cloud.eye("left")
        self.cloud.heart(74, 0.86)
        self.wait_calls(2)
        self.assertEqual(CALLS[0], ("eye_command", ["neal", "left"]))
        self.assertEqual(CALLS[1], ("heartbeat", ["neal", 74, 0.86]))

    def test_poll_snapshot(self):
        self.cloud.start_polling(interval=0.05)
        snap = self.cloud.updates.get(timeout=3)
        self.assertEqual(snap["suggestions"], ["Yes, come at 7.", "Not tonight."])
        self.assertEqual(snap["inbox"]["from"], "Mom")
        self.assertEqual(snap["last_ack"]["by"], "Mom")
        self.assertFalse(snap["open_sos"])

    def test_speller_reply_flow(self):
        sent, expanded = [], []
        s = sp_mod.Speller(say=lambda t: None, on_reply=sent.append, on_expand=expanded.append)
        fresh = s.set_cloud_state(["Yes, come at 7.", "Not tonight."], {"from": "Mom", "body": "Visit?", "risk": "ok"})
        self.assertTrue(fresh)
        self.assertEqual(s.items[s.idx], ("reply", "Yes, come at 7."))
        s.select()
        self.assertEqual(sent, ["Yes, come at 7."])
        self.assertEqual(s.status, "Texted Mom")
        self.assertEqual(s.replies, [])
        # spell "wa", then AI expand
        s.text = "water"
        s._rebuild()
        s.idx = s.items.index(("expand", "AI expand"))
        s.select()
        self.assertEqual(expanded, ["water"])
        self.assertEqual(s.text, "")

    def test_offline_speller_has_no_cloud_items(self):
        s = sp_mod.Speller(say=lambda t: None)
        s.text = "hello"
        s._rebuild()
        kinds = {k for k, _ in s.items}
        self.assertNotIn("expand", kinds)
        self.assertNotIn("text", kinds)

    def test_offline_backend_never_raises(self):
        c = Cloud("http://127.0.0.1:9", "x", "neal", timeout=0.2, verbose=False)
        c.eye("left")
        time.sleep(0.5)
        self.assertFalse(c.online)


if __name__ == "__main__":
    unittest.main(verbosity=1)
