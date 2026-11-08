"""Gesture rule tests: python edge/test_gestures.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F  # noqa: E402


def blinks(n, t0=1.0, gap=0.35):
    times, preds, signs = [], [], []
    for i in range(n):          # each blink = closing edge (+1) and opening edge (-1)
        times += [t0 + i * gap, t0 + i * gap + 0.12]
        preds += ["blink", "blink"]
        signs += [1, -1]
    return times, preds, signs


class Gestures(unittest.TestCase):
    def cmds(self, n):
        return [c for _, c in F.to_commands(*blinks(n))]

    def test_mapping(self):
        self.assertEqual(self.cmds(1), [])            # natural blink ignored
        self.assertEqual(self.cmds(2), ["select"])
        self.assertEqual(self.cmds(3), ["toggle"])    # on / off
        self.assertEqual(self.cmds(4), [])            # unused gap between toggle and SOS
        self.assertEqual(self.cmds(5), ["sos"])
        self.assertEqual(self.cmds(6), ["sos"])

    def test_glances_still_work(self):
        out = F.to_commands([1.0, 1.4, 3.0], ["left", "right", "right"], [1, -1, 1])
        self.assertEqual([c for _, c in out], ["left", "right"])   # 1.4 is the return

    def test_live_stream_matches(self):
        import blinktalk_live as L
        for n, want in [(2, "select"), (3, "toggle"), (5, "sos")]:
            g = L.GestureStream()
            out = []
            for t, p, s in zip(*blinks(n)):
                out += g.push(t, p, s)
            out += g.push(10.0, "left", 1)   # a later glance flushes the blink group
            self.assertIn(want, [c for _, c in out])


if __name__ == "__main__":
    unittest.main(verbosity=1)
