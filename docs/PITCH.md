# How to present BlinkTalk (judging 1–4pm, table demos)

Judges walk table to table and give each team a few minutes. **Lead with the live demo; the slides are the backdrop and the backup.**

## Table setup

- **Laptop A (the patient):** `localhost:5173/?view=patient`, full screen (F11). A teammate wears the electrodes with the board running and the bridge connected. The keyboard is the fallback: arrows look, Space = 2 blinks, P = 3, S = 5.
- **Laptop B or a phone (the family):** `localhost:5173`, the caregiver dashboard, turned towards the judge.
- **Your iPhone:** it's "Mom", assigned to the Photon line, so SOS and replies arrive on a real phone.
- **The deck** on a second screen or a tablet, looping on the cover; open it for the sponsor beats.
- **A backup:** the demo video on a phone, plus `?demo` pages if Wi-Fi or Photon fails.

## The 2-minute talk track (speaker notes are in the deck too)

1. **Hook (10 s):** "Imagine understanding every word your family says and not being able to answer. That's late-stage ALS. BlinkTalk gives people their voice back with only their eyes."
2. **Hardware (15 s):** point at the electrodes and the TI board. Offline model, ~90 ms per movement. 2 blinks choose, 3 on/off, 5 help.
3. **Live text (30 s):** text the line from your phone ("Want me to bring dinner?"). Replies appear on the patient screen; the wearer blinks twice; the reply lands on your phone. Show the dashboard: words appear live, and the eye trace draws steps and spikes.
4. **Nemotron (25 s):** spell "alex pho" → AI expand → "to Alex: Can you bring pho tonight?" → send. Send a photo to the line and show the description. Point at "eye movements saved" and the agent steps.
5. **SOS (20 s):** five blinks → red screen → your phone buzzes → reply "OK" → patient sees "help is on the way". Mention the 45-second escalation lives in the database (scheduled reducer).
6. **Close (10 s):** "Blink twice to talk, five times and help is on the way. Want to try?" Hand the judge the keyboard.

## Per-sponsor one-liners (when a sponsor judge stops by)

- **Spacetime:** "No Express server. Every rule, including the SOS escalation timer, is in one SpacetimeDB module; both screens are pure subscriptions."
- **Photon:** "It's a real iMessage line. Family use the chat they already have; SOS goes to their phones tier by tier and 'OK' stops it."
- **NVIDIA:** "Nemotron is the patient's keyboard, never their voice: a tool-using agent that routes messages to the right person, reads photos, decides when to alert family, and we measure the eye movements it saves."

## Demo video (record before noon, ~2 min)

Same order as the talk track, filmed with a phone over the shoulder: electrodes → patient screen → a text arriving → reply on the phone → "alex pho" → photo description → dashboard trace and savings → five blinks → phone buzzes → "OK" → help is on the way.

## Likely judge questions

- *Accuracy?* Measured on two people: 100% for spaced gestures, 86% held-out with fast repeats; per-user calibration takes about a minute.
- *Why not a camera eye tracker?* Works in the dark, with glasses, lying flat, with no camera in a bedroom, and the hardware is far cheaper.
- *Privacy?* SpacetimeDB and Nemotron (via Ollama) can run entirely on the laptop; only iMessage leaves the house.
- *What if the AI is wrong?* It never sends anything; the patient always chooses. Rule-based fallbacks keep working offline.
- *Security?* Not production-hardened: reducers are open on the local network today; identity-based access is the next step.
