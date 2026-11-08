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
                               └─► Nemotron agent (NVIDIA API or local Ollama)
```

## What it does

1. **Neal glances and blinks.** The board classifies each eye movement on-device. Left/right moves the highlight, a double blink selects and a triple blink is SOS.
2. **Every letter is live.** The speller streams Neal's draft, his eye movements and his heart rate (PPG) into SpacetimeDB. The caregiver dashboard shows his words appearing as he chooses them.
3. **Someone texts Neal.** Photon delivers the iMessage into SpacetimeDB, and the **Nemotron agent** starts a run:
   - reads the conversation and Neal's live state (heart rate, time, favourite phrases)
   - decides whether caregivers need to know
   - puts four replies, written in Neal's voice, on his screen

   One double blink sends a reply back over iMessage. Neal can also spell a few keywords ("water later") and pick **AI expand** to get full sentences.
4. **Neal triple-blinks.** SpacetimeDB raises an SOS and Photon texts tier-1 caregivers. If nobody replies "OK" within 45 s, a **scheduled reducer** escalates to tier 2, then tier 3. When someone replies "OK" (or taps *I'm on it* on the dashboard), Neal's screen says help is coming.

## How each sponsor's tech is used

| Track | What it does in BlinkTalk |
|---|---|
| **Spacetime** | The whole backend is one SpacetimeDB module (`spacetime/src/index.ts`): 11 tables, 21 reducers and a scheduled SOS-escalation reducer. It handles validation, pruning, heart-rate alert rules, phrase learning, conversation routing and acknowledgement. The speller, hub and dashboard are thin clients. The dashboard is a pure live subscription, so a new eye movement reaches a caregiver's screen in one round trip. It runs locally (`spacetime start`) for an offline home setup, or on Maincloud for remote family. |
| **Photon** | Gives Neal a real iMessage line (`hub/src/photon.ts`, Photon 2.0 API). People text him like anyone else, he answers with his eyes, and caregivers get SOS alerts in the chat app they already use. Replying "OK" acknowledges an alert. |
| **NVIDIA Nemotron** | Not a chatbot: a tool-calling agent (`hub/src/agent.ts`). It plans, calls `get_conversation`, `get_patient_state` and `alert_caregivers`, then `propose_replies`. Every step is written to SpacetimeDB and shown on the dashboard. It runs on build.nvidia.com or fully offline on a local `nemotron-3-nano` through Ollama. It degrades to JSON mode if tools are rejected, and to built-in replies if no model is reachable. |

## Run it (Windows)

Prerequisites: Node 22+, Python 3.10+, the SpacetimeDB CLI.

```powershell
# 1. SpacetimeDB CLI (once)
iwr https://windows.spacetimedb.com -useb | iex

# 2. JS dependencies (repo root, npm workspaces)
npm install

# 3. Secrets: copy .env.example to .env, then fill in NVIDIA_API_KEY and the Photon keys
copy .env.example .env

# 4. Backend (terminal 1, leave running)
spacetime start
# (terminal 2)
cd spacetime ; spacetime publish --server local -y blinktalk ; cd ..

# 5. Smoke test: plays speller + hub + dashboard against the server, ~20 s
npm run e2e

# 6. Hub: Photon bridge + Nemotron agent (terminal 2)
npm run hub

# 7. Caregiver dashboard (terminal 3) -> http://localhost:5173
npm run dashboard

# 8. Speller (terminal 4). Keyboard stands in for the eyes: arrows / Space / S
pip install pyserial
python speller/speller.py                 # add --serial COM12 with the SK-AM62B board
```

`http://localhost:5173/?demo` plays a scripted run with no backend.

### Photon setup (app.beta.photon.codes)

1. **API keys:** create a key with `project:read` and `project:write`. Put it in `.env` as `PHOTON_API_KEY`, and the project id (`pho_prj_…`) as `PHOTON_PROJECT_ID`.
2. **iMessage, then Add someone to the line:** add the iPhone number of every person who should text Neal or get his SOS alerts (e.g. Mom), and assign each one a number from the shared pool. That number is "Neal's" BlinkTalk line.
3. **Each person texts that line once** (e.g. "hi"). A shared line can only reply to people who texted it first. The hub remembers each chat in `hub/.photon-routes.json`.
4. Add the same people in the dashboard's **Care circle** with a tier, so SOS alerts reach them in order.

### Fully offline Nemotron (no internet except iMessage)

```powershell
ollama pull nemotron-3-nano        # 30B MoE, ~24 GB. Smaller machine: nemotron-3-nano:4b (~3 GB)
```
In `.env`: `NEMOTRON_BASE_URL=http://localhost:11434/v1` and `NEMOTRON_MODEL=nemotron-3-nano`. No key is needed. With local SpacetimeDB and the on-board eye model, nothing but the messaging leaves the house.

### SpacetimeDB on Maincloud (remote caregivers)

```powershell
spacetime login
cd spacetime ; spacetime publish --server maincloud -y blinktalk-neal ; cd ..
```
Then set `SPACETIME_URI=wss://maincloud.spacetimedb.com` and `SPACETIME_DB=blinktalk-neal` in `.env`, run `python speller/speller.py --spacetime https://maincloud.spacetimedb.com --db blinktalk-neal`, and open the dashboard with `?uri=wss://maincloud.spacetimedb.com&db=blinktalk-neal`.

Secrets live only in `.env` (gitignored). `npm run check-secrets` scans tracked files, and `node scripts/install-hooks.mjs` makes that check a pre-commit hook.

## Tests

```bash
npm test -w spacetime        # 6 reducer tests on SpacetimeDB's in-process datastore
npm test -w hub              # 10 tests: agent tool loop / outage / JSON fallback, Photon polling + replies
python speller/test_cloud.py # 5 speller <-> SpacetimeDB HTTP tests
npm run e2e                  # 19 end-to-end checks against a running server (E2E_ESCALATION=1 adds the 45 s escalation)
```

## Repository

| Path | |
|---|---|
| `spacetime/` | SpacetimeDB module: the backend (TypeScript) |
| `bindings/` | Typed client bindings (same shape as `spacetime generate`) |
| `hub/` | Photon iMessage bridge + Nemotron agent + caregiver alert texting |
| `dashboard/` | Caregiver console (React + SpacetimeDB live subscription) |
| `speller/` | Eyes-only speller (Tk): `cloud.py` talks to SpacetimeDB |
| `edge/`, `board/` | EOG signal processing, on-board model training, live AFE4950 streaming. See [docs/HARDWARE.md](docs/HARDWARE.md) |
| `scripts/` | End-to-end test, secret scanner |

## Limits and safety

BlinkTalk is a research prototype, not a medical device. Eye-movement accuracy was measured on two people. Heart rate comes from a fingertip PPG sensor. SOS escalation depends on the laptop, network and Photon being up, so it does not replace a nurse-call system. The agent only drafts; nothing is sent without the patient's own selection, except caregiver alerts.
