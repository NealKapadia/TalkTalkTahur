# Running BlinkTalk on the SK-AM62B with the AFE4950EVM

This takes you from a powered-off board to live eye commands on the laptop speller,
with the caregiver dashboard and iMessage (Photon) running and Azure AI Foundry drafting replies.

```
electrodes + PPG -> AFE4950EVM --USB--> SK-AM62B (C eye-command model, offline) --UART--> laptop
                                                                                        speller.py  (screen + voice)
                                                                                        SpacetimeDB + hub (Photon, Azure AI)
                                                                                        dashboard   (caregivers)
```

**What runs where**

| Part | Where | Notes |
|---|---|---|
| AFE4950EVM setup + streaming | board, `edge/afe_stream.py` | TI GUI protocol over USB, 500 Hz ECG + 50 Hz PPG |
| Eye-command model | board, `edge/eog_c/` (C, 70 KB forest) | 94% on held-out recordings, 91% on random cued sequences; blink, left, right; 2 blinks = select, 3 = on/off, 5+ = SOS |
| Heart rate | board, `edge/heart.py` | from the PPG sensor |
| Speller | laptop, `speller/speller.py` | reads `BLINKTALK CMD ...` lines from the board's serial console |
| Database, rules, SOS escalation | laptop, SpacetimeDB | `spacetime start` |
| iMessage + AI | laptop, `npm run hub` | Photon for texts; Azure AI Foundry for reply drafts, photo descriptions and briefings |

---

## Step 1: Laptop, one-time setup

1. In the repo folder: `npm install`
2. `.env` already has your Azure AI Foundry key (`AZURE_OPENAI_API_KEY`, endpoint and deployment `gpt-chat-latest-2`).
   With that key set, the hub uses Azure for everything that used Nemotron or Gemini. The old keys can stay; they are only used if the Azure key is removed.
3. Check the model live: `npm run llm-check`. You want four `OK` lines (text, tool call, photo, responses API) and the time each took.
   If `tool call` or `photo` fails, tell me what it printed: the deployment may not support tools or images.
4. `pip install pyserial` (for the speller's serial link).

## Step 2: Copy the board software (SD card)

The board runs TI SDK Linux (Arago) offline. Skip 2a if the Python packages are already installed from before.

a. **Python packages (once):** on the laptop run `board\download_packages.bat`, copy the `board` folder to the SD card's boot partition,
   then on the board: `sh /run/media/boot-mmcblk1p1/board/install.sh`

b. **The edge folder (every time it changes):**
   1. On the board type `poweroff`, wait 10 s, unplug power, and take out the micro-SD card.
   2. Put the card in the laptop. A small drive (often called `boot`) appears in File Explorer: copy the repo's `edge` folder onto it, so the drive has `edge` at its top level. Eject it, put the card back in the board and power on.
   3. In PuTTY (logged in as `root`), check the drive name with `ls /run/media/` (normally `boot-mmcblk1p1`), then:
```
cp -r /root/edge/models /root/models_backup 2>/dev/null      # keep personal models made on the board
cp -r /root/edge/data /root/data_backup 2>/dev/null          # and recordings made on the board
rm -rf /root/edge && cp -r /run/media/boot-mmcblk1p1/edge /root/
cp -rn /root/models_backup/* /root/edge/models/ 2>/dev/null
ls /root/edge/eog_c                                          # should list libeog_aarch64.so
```
   A USB stick works the same way; it usually appears as `/run/media/sda1`.
`edge/eog_c/libeog_aarch64.so` is the C model, already compiled for the AM62B's Cortex-A53. Nothing else to install.
(If the board has `gcc`, you can rebuild it there with `cd /root/edge/eog_c && gcc -O2 -shared -fPIC -o libeog.so eog.c eog_api.c -lm`; a `libeog.so` built on the board is used first.)

## Step 3: Wire it up

| Connection | From | To |
|---|---|---|
| Power | USB-C charger, or a USB-C power bank when electrodes are on a person | board **J11** |
| Console | board **UART** micro-USB | laptop (shows up as a COM port, e.g. COM12) |
| EVM | AFE4950EVM **J10** micro-USB | board **USB-A** |
| PPG sensor | optical sensor (white dot to pin 10) | EVM **J1**, strapped to a fingertip |

**Electrodes (must match how the model was trained):**
- **Red:** beside the outer corner of the **right** eye, at pupil height
- **Black:** beside the outer corner of the **left** eye, at pupil height
- **White:** centre of the forehead (reference)

Clean the skin with an alcohol wipe and use fresh gel electrodes. If red and black are swapped, left and right swap too (Step 5 shows how to check).

Research EVM, not a medical device: get supervisor approval before connecting electrodes to people.

## Step 4: Log in to the board

PuTTY (or any serial terminal): the board's COM port, **115200** baud. Log in as `root`. Then:
```
cd /root/edge
python3 eog_c/eog_c.py data/neal_blink.csv
```
You should see a list of `blink` lines (times in seconds). That proves the C model loads on the board.

## Step 5: Check the signal (2 minutes)

1. Record 20 s while you do: 3 blinks, then 3 quick looks **left** and back, then 3 quick looks **right** and back, about 2 s apart:
```
python3 afe_stream.py --seconds 20 --out data/check
python3 eog_c/eog_c.py data/check_ECG.csv
```
2. Read the output:
   - Blinks show as `blink`, looks as `left` / `right`: all good.
   - Your **left** looks come out as `right` (and the reverse): red and black are swapped. Either swap them on the face, or add `--swap-lr` to every `blinktalk_live.py` command below.
   - Nothing at all: check the electrodes stick and that `data/check_ECG.csv` is not flat.
3. Heart rate: `python3 heart.py --ppg data/check_PPG.csv`. If the PPG saturates or reads nothing, pick an LED level with
   `python3 afe_stream.py --led-sweep` (12 worked before) and use it as `--led` below.

## Step 6: Live test on the board

```
python3 blinktalk_live.py --engine c --led 12
```
Expected lines:
```
BLINKTALK READY model=eog_c engine=c user=default ...
BLINKTALK CMD left t=12.40 delay_ms=900
BLINKTALK CMD select t=20.85 delay_ms=2000
BLINKTALK HR 74 good q=0.86
```
- Looks arrive about 0.9 s after you move; blink commands about 2 s after the last blink (the board waits to be sure no further blink is coming).
- A single blink prints `INFO blink` and is ignored on purpose (people blink all the time).
- 2 quick blinks = `select`, 3 = `toggle` (on/off), 5 or more = `sos`. Four blinks are ignored.
- Typing `sens 7` and Enter makes it more sensitive (1 strict ... 10 sensitive, 5 = tested default). `quit` stops.
- No electrodes on hand? `python3 blinktalk_live.py --engine c --replay data/neal_left.csv`

Press Ctrl+C when it works.

## Step 7: Run the whole system

Close PuTTY first (the speller needs the COM port). Then on the laptop, in separate terminals from the repo folder:

1. `spacetime start`
2. `npm run hub`. The first lines should include `[hub] AI: Azure AI Foundry ... deployment=gpt-chat-latest-2`.
3. `npm run dashboard` and open the printed address (patient screen and caregiver dashboard).
4. `python speller/speller.py --serial COM12` (your COM port).
5. In the speller's bottom bar pick user **default** (or **neal**) and press **Start**. That runs the C model on the board (`--engine auto` picks it for neal / nealb / default; calibrated people keep their personal model).

Now: glance to move the highlight, 2 blinks to select, 3 to switch on/off, 5 for SOS. A text to the BlinkTalk number gets four AI-drafted replies on the patient screen within a few seconds; "Catch me up" on the dashboard writes a briefing with the Azure model.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ERROR no C recognizer library` | `edge/eog_c/libeog_aarch64.so` was not copied; redo Step 2b |
| `OSError ... wrong ELF class` | the file is from another CPU; recopy, or rebuild on the board (Step 2b) |
| Left and right swapped | swap red and black, or add `--swap-lr` |
| Too many false commands | `sens 3`; check the electrodes and keep the face relaxed |
| Misses movements | `sens 7`; make looks quicker and fuller; re-stick electrodes |
| Speller shows nothing | PuTTY still open on the COM port, or wrong COM number |
| Hub says `AI model unavailable` | run `npm run llm-check`; check the key and that the laptop is online |
| Briefing says "Plain summary" | same as above; the hub log shows the Azure error |
| No heart rate | adjust `--led` (Step 5.3); keep the finger still |
