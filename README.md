# HYAAAAT

Browser-based arena brawler where screaming amplifies your attacks.

Press a button to commit to an attack. Scream to determine how hard it hits.

---

## Quick start

```bash
npm install
npm run dev        # Node server with --watch on http://localhost:3000
```

Open two browser tabs (or two machines on the same network) at
`http://localhost:3000` to get a 1v1 match. You'll be matched automatically.

---

## Playtesting protocol

### Option A — Solo (practice mode, one browser tab)

Good for: learning controls, testing audio feedback, checking damage numbers,
verifying HUP chain without needing a second player.

1. `npm run dev`, open `http://localhost:3000`
2. Click **Allow Microphone** (grants mic access)
3. On the waiting screen, click **🤖 Practice Mode** — a bot opponent spawns
4. Click the canvas once to capture mouse (pointer lock)

**Checklist — work through these in order:**

```
Audio
[ ] Speak or hum — volume bar (bottom-left) responds immediately
[ ] Shout loudly — bar reaches top, damage numbers should be higher on hits
[ ] Sustain an "AAAAAAA" for 2-3 seconds — ridiculousFactor builds
    (not shown in HUD yet — verify by comparing damage numbers to silent play)
[ ] Say a battle cry word ("HYAAAAT", "UNLIMITED", "POWER", etc.)
    — ridiculousFactor gets a brief bonus (again, visible only in damage numbers)

Movement
[ ] WASD moves player, camera follows
[ ] Mouse drag rotates camera + player facing direction
[ ] Space bar — normal roll (quick dash)
[ ] Say "HUP" sharply and immediately press Space
    → "HUP ×1" notification should appear, roll feels faster
[ ] Do it again within ~1.2s → "HUP ×2" (slightly faster)
[ ] Once more → "HUP ×3" (peak speed), then normal speed for ~2s (fatigue)

Combat — light attack
[ ] Face the bot, move within ~3.5 units, left click
    → damage ring effect, number pops up, bot HP decreases
[ ] Left click facing away from bot at max range → no hit (targeting miss)
[ ] Vary scream volume between clicks — higher volume = higher damage number

Combat — windup
[ ] Move near bot, hold right mouse button for 2 seconds
    → yellow charge bar fills at bottom of screen, turns red at full charge
[ ] Release right click → shockwave ring effect, higher damage
[ ] Right-click tap (< 150ms) → nothing fires (sub-threshold, intentional)
[ ] Windup has a 6s cooldown — verify it doesn't fire again immediately

Damage received
[ ] Wait near bot — it will attack every ~2.8s
    → red screen flash, hearts decrease
[ ] Let yourself reach 0 HP → "DEFEATED" screen

Win condition
[ ] Reduce bot to 0 HP → "VICTORY" screen
[ ] Click "Play Again" → page reloads, fresh state
```

---

### Option B — Local multiplayer, same machine (two browser tabs)

Good for: verifying network relay, opponent position sync, damage events
reaching the correct player.

1. `npm run dev`
2. Open Tab 1: `http://localhost:3000` — allow mic, wait
3. Open Tab 2: `http://localhost:3000` — allow mic (or skip)
4. Both tabs should show "FIGHT!" and start the match

**Checklist on top of Option A:**

```
[ ] Moving Tab 1 player — Tab 2 should see opponent move (may lag 1-2 frames, normal)
[ ] Tab 1 attacks Tab 2 — Tab 2's health bar decreases, Tab 2 gets red flash
[ ] Tab 2 attacks Tab 1 — Tab 1's health bar decreases
[ ] Close Tab 2 mid-match → Tab 1 shows "Opponent disconnected"
[ ] Reopen Tab 2 → both tabs re-enter waiting, then auto-match again
```

---

### Option C — Local network (two machines on same Wi-Fi)

Good for: testing real network latency, mobile browser compatibility,
mic variation between devices.

**Setup:**

1. Find the server machine's local IP:
   ```bash
   # macOS / Linux
   ipconfig getifaddr en0        # Wi-Fi interface
   # or
   ip route get 1 | awk '{print $7; exit}'

   # Windows
   ipconfig | findstr "IPv4"
   ```

2. Start the server:
   ```bash
   npm run dev
   ```

3. On **both machines**, open `http://<server-ip>:3000`
   - Replace `<server-ip>` with the IP from step 1
   - Example: `http://192.168.1.42:3000`

4. Both should auto-match into a room.

> **Firewall note:** Port 3000 must be accessible on the server machine's
> local network. On macOS you may get a "Allow incoming connections?" prompt
> the first time — click Allow.

**Additional checks:**

```
[ ] Both machines connect and match (confirms server is reachable)
[ ] Attack latency feels acceptable on local Wi-Fi (<50ms RTT expected)
[ ] Test on a phone browser (Chrome/Safari) — touch input won't have mouse look,
    but attack buttons can be tapped; good for testing mic quality variation
[ ] Scream from machine B, attack machine A — verify damage numbers are
    calculated from B's mic (not A's)
```

---

## What each damage number tells you

During testing, read damage numbers to verify the audio system is working:

| Scenario | Expected damage range |
|---|---|
| No mic / silent | 8 (floor) |
| Quiet speech | 8–15 |
| Moderate yell | 15–35 |
| Loud sustained scream | 35–60 |
| Peak scream + vowel run | 60–150 |
| Windup + peak scream | 60–300 |

If all hits show exactly 8, the mic isn't being picked up — check browser
mic permission (🔴 in address bar) and reload.

---

## Known limitations at this stage

- **No calibration step** — mic sensitivity varies by device. Laptop mics
  typically need to be spoken to loudly; headset mics may saturate quickly.
  See `DESIGN_QUESTIONS.md §4` for the planned calibration discussion.

- **fightingSpirit and ridiculousFactor are not shown in the HUD.**
  You can infer them from comparing damage numbers over time:
  consistent screaming over 3+ seconds will noticeably increase damage.

- **Practice bot attacks are random-timed**, not reactive. It doesn't dodge
  or combo. It's useful for testing damage systems, not for practicing timing.

- **No mobile touch controls yet.** Phone browsers can test mic quality but
  can't attack without mouse buttons. Use two desktop tabs for combat testing.

- **HUD hearts show partial fill via CSS clip-path** — verify this renders
  correctly on your browser/OS (known rendering variation in Firefox vs Chrome).

---

## File reference

```
CLAUDE.md           Architecture decisions + damage formula + HUP spec
DESIGN_QUESTIONS.md Open UX questions for HCI review
AGENT_PLAYBOOK.md   Transferable patterns for future projects
```
