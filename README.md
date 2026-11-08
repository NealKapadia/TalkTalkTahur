# BlinkTalk

**Talk, text and call for help with your eyes.**

People with ALS, locked-in syndrome or a severe stroke often understand everything and can say nothing. BlinkTalk reads eye movements from three electrodes on the forehead and turns glances and blinks into speech, iMessages and SOS alerts. Family can see what their person is saying, live, from anywhere.

HackUTD 2026: Zero Day · Tracks: **Spacetime**, **Photon**, **NVIDIA Nemotron**
Team: Neal Kapadia, Adrian Miciano, Alexander Montesino

```
 electrodes ─► TI AFE4950EVM ─► SK-AM62B (on-device ML: blink / left / right)
                                   │ serial
                                   ▼
                       Speller (laptop, eyes only) ──HTTP──┐
                                                           ▼
      iMessage ◄─► Photon ◄─► Hub ◄──WebSocket──► SpacetimeDB module ◄──WebSocket──► Caregiver dashboard
                               │                   (all state + rules)
                               └─► NVIDIA Nemotron agent (tools, scam screen, reply drafts)
```

## What it does

1. **Neal glances and blinks.** The board classifies each eye movement on-device. Left/right moves the highlight, a double blink selects and a triple blink is SOS.
2. **Every letter is live.** The speller streams Neal's draft, his eye movements and his heart rate (PPG) into SpacetimeDB. The caregiver dashboard shows his words appearing as he chooses them.
3. **Mom texts Neal's number.** Photon delivers the iMessage into SpacetimeDB, and the **Nemotron agent** starts a run:
   - reads the conversation and Neal's live state
   - screens the text for scams
   - drafts four replies in Neal's voice, which appear on his screen

   One double blink sends a reply back over iMessage. Neal can also spell a few keywords ("water later") and pick **AI expand** to get full sentences.
4. **A scam text arrives** ("Medicare suspended, send your SSN"). The agent flags it, offers protective replies only, and texts Mom. A rule-based screen is a floor the model can't override.
5. **Neal triple-blinks.** SpacetimeDB raises an SOS and Photon texts tier-1 caregivers. If nobody replies "OK" within 45 s, a **scheduled reducer** escalates to tier 2, then tier 3. When Mom texts "OK" (or taps *I'm on it*), Neal's screen says help is coming.

## Why each sponsor's tech is load-bearing

| Track | What it does in BlinkTalk |
|---|---|
| **Spacetime** | The whole backend is one SpacetimeDB module (`spacetime/src/index.ts`): 11 tables, 22 reducers and a scheduled SOS-escalation reducer. It handles validation, pruning, heart-rate alert rules, phrase learning, conversation routing and acknowledgement. The speller, hub and dashboard are thin clients. The dashboard is a pure live subscription, so a new eye movement reaches Mom's screen in one round trip. It can run locally (`spacetime start`) for a fully offline home setup, or on Maincloud for remote family. |
| **Photon** | Gives Neal a real iMessage presence (`hub/src/photon.ts`, spectrum-ts). People text him like anyone else, he answers with his eyes, and caregivers are reached in the chat app they already use. Replying "OK" acknowledges an alert. |
| **NVIDIA Nemotron** | Not a chatbot: a tool-calling agent (`hub/src/agent.ts`). It plans, calls `get_conversation`, `get_patient_state`, `screen_message` and `alert_caregivers`, then `propose_replies`. Every step is written to SpacetimeDB and shown on the dashboard. It degrades to JSON mode if tools are rejected, and to on-device rules if Nemotron is unreachable. |

## Run it (Windows, ~10 minutes)

Prerequisites: Node 22+, Python 3.10+, the SpacetimeDB CLI.

```powershell
# 1. SpacetimeDB CLI (once)
iwr https://windows.spacetimedb.com -useb | iex

# 2. Install JS deps (repo root, npm workspaces)
npm install

# 3. Secrets: copy .env.example to .env and fill in NVIDIA_API_KEY (+ Photon if you have it)
copy .env.example .env

# 4. Backend: start SpacetimeDB and publish the module (new terminal)
spacetime start
cd spacetime ; spacetime publish --server local blinktalk ; cd ..
#    (re-publish after changing the module; add  -c  to wipe data)

# 5. Hub: Photon bridge + Nemotron agent (new terminal)
npm run hub

# 6. Caregiver dashboard (new terminal) -> http://localhost:5173
npm run dashboard

# 7. Speller (new terminal). Keyboard stands in for the eyes: arrows / Space / S
pip install pyserial
python speller/speller.py                 # add --serial COM12 with the SK-AM62B board
```

Add a caregiver in the dashboard's care circle with a real phone number, then use **Send Neal a test text** (or text the Photon number) and watch the agent run. Press `S` in the speller to trigger an SOS.

No backend handy (e.g. on the judging table)? `npm run dashboard`, then open `http://localhost:5173/?demo` for a scripted run with no live data.

### Configuration

| Variable | Default | |
|---|---|---|
| `NVIDIA_API_KEY` | | build.nvidia.com key (`nvapi-…`). Without it, the agent uses on-device rules. |
| `NEMOTRON_MODEL` | `nvidia/nemotron-3.5-super-vl-120b-a12b` | Any tool-calling Nemotron on build.nvidia.com |
| `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET` | | Photon project credentials. Without them, texting is simulated (printed by the hub). |
| `SPACETIME_URI` / `SPACETIME_DB` | `ws://localhost:3000` / `blinktalk` | Dashboard: `?uri=…&db=…` |

Secrets live only in `.env` (gitignored). `npm run check-secrets` scans tracked files, and `node scripts/install-hooks.mjs` makes that check a pre-commit hook.

## Tests

```bash
npm test -w spacetime        # 7 reducer tests on SpacetimeDB's in-process datastore
npm test -w hub              # 7 agent tests with a scripted Nemotron (tool loop, outage, JSON fallback, scam floor)
python speller/test_cloud.py # 5 speller <-> SpacetimeDB HTTP tests against a fake server
```

## Repository

| Path | |
|---|---|
| `spacetime/` | SpacetimeDB module: the backend (TypeScript) |
| `bindings/` | Typed client bindings (same shape as `spacetime generate`) |
| `hub/` | Photon iMessage bridge + Nemotron agent + caregiver alert texting |
| `dashboard/` | Caregiver console (React + SpacetimeDB live subscription) |
| `speller/` | Eyes-only speller (Tk): `cloud.py` talks to SpacetimeDB |
| `edge/`, `board/` | EOG signal processing, on-board model training and live AFE4950 streaming. See [docs/HARDWARE.md](docs/HARDWARE.md) |

## What we built before vs. during HackUTD

To be transparent with judges: the **eye-signal pipeline** (`edge/`, `board/`, the original Tk speller and `docs/HARDWARE.md`) existed before HackUTD; we built it earlier this month. It's the input device. Everything that makes BlinkTalk a connected communication system was built during HackUTD 2026, and the git history shows the split:

- the SpacetimeDB backend
- the bindings
- the hub (Photon + Nemotron agent + escalating alerts)
- the caregiver dashboard
- the speller's messaging, AI and SOS loop (`speller/cloud.py` and changes to `speller.py`)

## Limits and safety

BlinkTalk is a research prototype, not a medical device. Eye-movement accuracy was measured on two people. Heart rate comes from a fingertip PPG sensor. SOS escalation depends on the laptop, network and Photon being up, so it does not replace a nurse-call system. The agent only drafts; nothing is sent without the patient's own selection, except caregiver alerts.
