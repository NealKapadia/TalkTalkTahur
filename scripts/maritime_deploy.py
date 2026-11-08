"""
Run BlinkTalk's always-on cloud box on Maritime (uses your Maritime credits).

The box runs the hub (Photon iMessage + Nemotron agent) 24/7 and serves the
caregiver dashboard and patient screen at a public HTTPS link, talking to
SpacetimeDB on Maincloud. Your laptop then only runs the board bridge.

    pip install maritime
    spacetime publish --server maincloud -y blinktalk-neal      (from spacetime/, once)
    python scripts/maritime_deploy.py up        # deploy or redeploy the current commit
    python scripts/maritime_deploy.py status    # links + last log lines
    python scripts/maritime_deploy.py down      # stop it (stops spending credits)

Reads from .env: MARITIME_API_KEY, NVIDIA_API_KEY, PHOTON_API_KEY, PHOTON_PROJECT_ID,
NEMOTRON_MODEL, and SPACETIME_CLOUD_DB (default blinktalk-neal).
Only one hub should run at a time: stop `npm run hub` on the laptop while the box is up.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "blinktalk-cloud"
MAINCLOUD = "wss://maincloud.spacetimedb.com"


def load_env():
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for raw in open(path, encoding="utf-8"):
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def client():
    try:
        from maritime import Maritime
    except ImportError:
        sys.exit("Install the SDK first:  pip install maritime")
    key = os.environ.get("MARITIME_API_KEY")
    if not key:
        sys.exit("Add MARITIME_API_KEY=... to .env (Maritime dashboard -> API key).")
    return Maritime(api_key=key)


def sh(sb, cmd, timeout=900):
    out = sb.run(cmd, timeout_seconds=timeout,
                 on_stdout=lambda s: print(s, end=""), on_stderr=lambda s: print(s, end=""))
    if out.exit_code not in (0, None):
        sys.exit(f"\nCommand failed (exit {out.exit_code}): {cmd[:80]}")
    return out


def up():
    db = os.environ.get("SPACETIME_CLOUD_DB", "blinktalk-neal")
    tarball = subprocess.run(["git", "archive", "--format=tar.gz", "HEAD"], cwd=ROOT,
                             capture_output=True, check=True).stdout     # tracked files only: .env never leaves
    env = {k: os.environ[k] for k in ("NVIDIA_API_KEY", "NEMOTRON_MODEL", "NEMOTRON_BASE_URL",
                                     "PHOTON_API_KEY", "PHOTON_PROJECT_ID", "BLINKTALK_PATIENT")
           if os.environ.get(k)}
    if "localhost" in env.get("NEMOTRON_BASE_URL", ""):
        env.pop("NEMOTRON_BASE_URL")            # a laptop-local Ollama is not reachable from the cloud
    env.update(SPACETIME_URI=MAINCLOUD, SPACETIME_DB=db, PORT="8080")

    c = client()
    print(f"Starting sandbox {NAME} (Node 22, medium)...")
    sb = c.sandboxes.create(name=NAME, from_="node:22-bookworm", size="medium",
                            keep_awake=True, env=env)
    print(f"Uploading code ({len(tarball) // 1024} KB) and building...")
    sb.files.write("/root/blinktalk.tgz", tarball)
    sh(sb, "set -e; pkill -f deploy/start.mjs || true; rm -rf /app; mkdir -p /app; "
           "tar -xzf /root/blinktalk.tgz -C /app; cd /app; npm install --no-audit --no-fund; "
           f"VITE_SPACETIME_URI={MAINCLOUD} VITE_SPACETIME_DB={db} npx -w dashboard vite build")
    sb.run("cd /app && node deploy/start.mjs > /app/server.log 2>&1", background=True)
    url = sb.url(8080, token=False).rstrip("/")
    print("\nBlinkTalk cloud box is up:")
    print(f"  Caregiver dashboard: {url}/")
    print(f"  Patient screen:      {url}/?view=patient")
    print(f"  Board bridge on the laptop: python speller/speller.py --serial COM12 --bridge "
          f"--spacetime https://maincloud.spacetimedb.com --db {db}")
    print("Stop `npm run hub` on the laptop so texts are answered once.")


def status():
    sb = client().sandboxes.get(NAME)
    print(f"{NAME}: {sb.state}")
    if sb.state == "running":
        print(f"  {sb.url(8080, token=False).rstrip('/')}/")
        print(sb.run("tail -n 20 /app/server.log || true", timeout_seconds=30).stdout)


def down():
    client().sandboxes.get(NAME).kill()
    print(f"{NAME} stopped. Start `npm run hub` on the laptop again if you need it.")


if __name__ == "__main__":
    load_env()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "up"
    {"up": up, "status": status, "down": down}.get(cmd, lambda: sys.exit(__doc__))()
