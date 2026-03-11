# HYAAAAT — Game Specification

**Logline:** Browser-based 1v1 arena brawler. You press a button to commit to
an attack. You scream to determine how hard it hits.

---

## Table of contents

1. [What the game is](#1-what-the-game-is)
2. [Core mechanic](#2-core-mechanic)
3. [Audio pipeline](#3-audio-pipeline)
4. [Damage formula](#4-damage-formula)
5. [Combat system](#5-combat-system)
6. [Movement and roll](#6-movement-and-roll)
7. [Input bindings](#7-input-bindings)
8. [Networking](#8-networking)
9. [Visual aesthetic](#9-visual-aesthetic)
10. [Design pillars](#10-design-pillars)
11. [Implementation status](#11-implementation-status)
12. [Open design questions](#12-open-design-questions)
13. [Future work](#13-future-work)
14. [Running and testing](#14-running-and-testing)

---

## 1. What the game is

HYAAAAT is a two-player browser-based arena brawler where the scream you make
determines how much damage your attacks deal. One sentence to explain, thirty
seconds to understand, under five dollars to buy.

Players move around a circular arena in third-person. You press a button to
swing; you yell into the microphone to make it hurt. The louder, longer, and
more ridiculous your battle cry, the more damage you deal. Windup attacks charge
up before firing and do more damage — screaming the whole time they charge is
the optimal play.

The game is intentionally absurd. It is designed to produce funny moments and
short matches (2–3 minutes per round). Spectator legibility matters: someone
watching who has never played should be able to tell what is happening and find
it funny within 10 seconds.

**Price target:** Under $5. Cost should not be a consideration.

**Match target:** 2–3 minutes of active play per round.

---

## 2. Core mechanic

Three audio signals feed into every hit:

| Signal | What it measures | Range | How it builds |
|--------|-----------------|-------|---------------|
| `volume` | Instantaneous RMS loudness | 0–1 | Instant |
| `fightingSpirit` | Sustained screaming over ~3s (EMA) | 1–2 | Slow build; decays if quiet |
| `ridiculousFactor` | Sustained vowel runs + battle cry words | 1–2.5 | Vowel run + Speech API bonus |

A player who screams consistently for several seconds before hitting will deal
significantly more damage than one who screams only at the moment of impact.
This is the deep mechanic. Whether and how to surface it is an open design
question — see [§12](#12-open-design-questions) and `DESIGN_QUESTIONS.md §2`.

### HUP detection

"HUP" is a special bonus mechanic: if you yell a short sharp burst while
pressing roll, your roll is faster. The game detects this via pure audio
analysis (no speech recognition): a rapid volume spike above 0.4 that falls
below 0.15 within 200ms. This matches the physical dynamics of saying "HUP"
without needing word recognition. See `CLAUDE.md §Audio` for why Web Speech
API is not used here.

---

## 3. Audio pipeline

Implemented in `public/js/audio.js`. The `AudioAnalyser` class exposes:

```
AudioAnalyser.volume          // RMS 0–1, updated every frame
AudioAnalyser.fightingSpirit  // EMA of volume, 1–2
AudioAnalyser.ridiculousFactor // vowel + battle cry bonus, 1–2.5
AudioAnalyser.hupDetected     // true for one frame when a HUP burst fires
```

### Volume: RMS via `getFloatTimeDomainData`

`getFloatTimeDomainData()` into an RMS calculation. `fftSize = 1024`. Most
accurate for perceived loudness at low latency. ×4 scaling applied for typical
laptop microphones (rough — see `DESIGN_QUESTIONS.md §4` on calibration).

### fightingSpirit: exponential moving average

EMA of `volume` across frames. Rise rate `0.04/frame`, decay `0.015/frame`
at ~60fps. Takes roughly 2–3 seconds of sustained loud screaming to reach the
2.0 ceiling. Decays passively when quiet. Currently invisible to the player.

### ridiculousFactor: vowel runs + battle cries

**Vowel runs:** FFT energy in the 200–3500 Hz formant band via
`getByteFrequencyData()`. Sustained for 200ms+ above threshold → vowel run
accumulates → ridiculousFactor climbs toward 2.5.

**Battle cry words:** Web Speech API in continuous mode (Chrome/Edge only).
Fires retroactively — latency doesn't matter here because it's a surprise
reward, not timing-critical. Recognized words include: `hyaaaat`, `kiai`,
`unlimited`, `power`, `begone`, `bankai`, `shoryuken`, etc. Bonus `+0.6` to
ridiculousFactor, lasting 2 seconds. Falls back gracefully if API unavailable.

### HUP detection

Volume spike > 0.4 that drops back below 0.15 within 200ms.
150ms cooldown to prevent double-fires.

---

## 4. Damage formula

```
raw    = BASE_DAMAGE × volume × fightingSpirit × ridiculousFactor
damage = clamp(raw,     DAMAGE_FLOOR, DAMAGE_SOFT_CAP)  // normal attack
damage = clamp(raw × 2, DAMAGE_FLOOR, WINDUP_SOFT_CAP)  // windup attack

BASE_DAMAGE       = 10
DAMAGE_FLOOR      = 8    (floor case: weak screams still register)
DAMAGE_SOFT_CAP   = 150  (per normal hit)
WINDUP_SOFT_CAP   = 300  (per windup release)
MAX_HP            = 600  (10 hearts × 60 HP)
```

Constants are in `public/js/combat.js` as a frozen `COMBAT` object.
`calculateDamage(audioState, isWindup)` is a pure function — no DOM, no side
effects, fully unit-tested.

**Calibration note:** 600 HP is set by math, not playtesting. The target is
60–90s kill time at average scream intensity (good-faith scream, ~60% connect
rate, ~1 attack/1.5s ≈ 6.8 DPS → 88s). Adjust `MAX_HP` or `BASE_DAMAGE` in
`combat.js` after real recorded match data. Do not adjust these constants
without also checking that tests still pass.

---

## 5. Combat system

Implemented in `public/js/main.js` `updateCombat()`.

### Light attack

- Input: left mouse button (`ACTIONS.LIGHT_ATTACK`)
- Cooldown: 450ms
- Damage: standard formula (no windup multiplier)
- Immediate: damage calculated at moment of press, `network.sendAttackLanded`
  fires immediately

### Windup attack

- Input: hold right mouse button (`ACTIONS.HEAVY_ATTACK`), release to fire
- Minimum hold to register: 150ms (silent discard below this)
- Full charge: 2000ms hold
- Cooldown after release: 6000ms
- Damage: `raw × 2`, capped at 300
- Visual: aura ring on player mesh scales up as charge fraction rises

### Targeting

Implemented in `public/js/targeting.js`. Score formula for each candidate:

```
score = facingBonus / (distance² + ε)
facingBonus = 2.0  if target within 70° of facing direction
facingBonus = 1.0  otherwise
```

Hard cutoffs: `ATTACK_RANGE = 3.5` for committed hits,
`NEARBY_FALLBACK_RANGE = 5.5` for fallback path (facing not required).

**Distance² dominance at close range:** At very close range, distance
completely overrides facing bonus (see `CLAUDE.md §Lessons`). This is
intentional — point-blank targets should be hard to miss.

### Trust model

Damage is calculated client-side and relayed by the server. Audio data is not
streamed to the server. This is appropriate for a party game. A server-side cap
sanity check (reject damage > 350 per event) should be added before any
competitive/public release. See `CLAUDE.md §Network`.

---

## 6. Movement and roll

- Speed: 6 units/second
- Camera-relative WASD movement
- Arena boundary: `ARENA_RADIUS = 12` — player bounces with friction at edge
- Roll: Space key, `ROLL_DURATION_MS = 380ms`

### HUP roll chain

1. Player presses ROLL (Space)
2. If `audio.hupDetected` fired within the past 300ms → `hupRoll = true`
3. Speed multiplier:
   - Normal roll: 2.5×
   - HUP roll: 3.5× (first or after reset)
   - Chain 2: 3.0× (second HUP within 1200ms of first)
   - Chain 3+: 3.5× (third HUP, peak)
4. After 3+ chained HUPs: 2000ms fatigue (normal roll speed only)

Shows `"HUP ×N"` notification when chain fires. HUD notification disappears
after a short timeout.

---

## 7. Input bindings

Implemented in `public/js/input.js` (`InputManager`, `ACTIONS`).
Bindings are data, not hardcoded logic — VR controller bindings can be added
in `input.js` without touching game logic.

| Action | Default binding |
|--------|----------------|
| Move forward | W / ↑ |
| Move backward | S / ↓ |
| Move left | A / ← |
| Move right | D / → |
| Light attack | Left mouse button |
| Windup (charge) | Right mouse button hold |
| Roll | Space |
| Camera rotate | Mouse (pointer lock) |

Mouse sensitivity: `0.003 rad/px`. First click on canvas requests pointer lock.

---

## 8. Networking

Implemented in `public/js/network.js` (client) and `server.js`.

### Transport

Node.js + Socket.io. Server acts as relay only — no game state authority beyond
matchmaking and sanity checks.

### Position sync

Players send `playerUpdate` at 20Hz (every 50ms). Remote player positions are
interpolated at `OPPONENT_INTERP_FACTOR = 0.25` lerp per frame for smooth
motion at display refresh rate.

### Events

| Client → Server | Payload |
|-----------------|---------|
| `playerUpdate` | `{ position, yaw, hp, isWindingUp, windupFraction }` |
| `attackLanded` | `{ damage, isWindup }` |

| Server → Client | Payload |
|-----------------|---------|
| `playerJoined` | `{ playerIndex }` |
| `opponentUpdate` | `{ position, yaw, hp, isWindingUp, windupFraction }` |
| `opponentAttack` | `{ damage, isWindup }` |
| `opponentDisconnected` | `{}` |

### Practice mode bot

When no second player connects, a bot runs locally (`updateBot(dt)` in
`main.js`). Simple 4-state machine: patrol → chase → attack → retreat.
Generates realistic scream variance for damage. Used for solo testing; not
shipped as a feature.

---

## 9. Visual aesthetic

Full spec with do/don't table and implementation notes: `CLAUDE.md §Graphics
aesthetic`. Summary:

**World geometry: N64/OOT (Ocarina of Time, Majora's Mask).** Low-poly, chunky,
bold silhouettes. MeshToonMaterial with a 2-tone DataTexture gradient map
(NearestFilter = hard shadow band). Box geometry for limbs, 8×6 spheres for
heads. No normal maps, no PBR, no smooth highlights.

**Hit effects: No More Heroes (Wii, 2007 — Suda51).** Travis Touchdown, beam
katana, toilet save points. The kill/hit feedback is the reference: big bold
rank text, color bursts, graphic-design-forward impact numbers. Color tiers:
white (< 20), orange (20–59), red (60–99), yellow flash (100+). This aesthetic
applies only to hit feedback — not the world, which stays OOT.

The two references are compatible and will look intentional together.

**Why OOT and not GC/TP:** Lower polygon counts, no texture work, less asset
effort regardless of AI-assisted code generation. The art isn't delegatable
the same way code is. OOT-style runs on every device the target demographic
has. See `DESIGN_QUESTIONS.md §Visual aesthetic` for the full reasoning.

**Current character:** Low-poly humanoid in `graphics/player-mesh.js`.
MeshToonMaterial, box torso/limbs, 8×6 sphere head (slightly oversized, chibi
ratio), nose nub direction indicator. Aura ring for windup. `setColor()`,
`setWindup()`, `setRolling()` API unchanged.

---

## 10. Design pillars

Full discussion with open questions: `DESIGN_QUESTIONS.md §Design pillars`.
Condensed:

**Effortless and funny.** One-sentence explanation, 30-second pickup. Every
mechanic (ridiculousFactor, vowel runs, HUP chain, Papyrus-style meters) should
be designed to produce funny moments. A match that doesn't generate laughs from
spectators and players is a failed match regardless of combat balance.

**Primary persona: young men and boys in casual gaming sessions.** 15–30
minutes with friends, zero tolerance for setup friction, zero tolerance for long
matches.

**Streamers and content creators (secondary).** A single clip of someone going
full-send on a vowel run could drive significant acquisition. Design for
spectator legibility: a bystander watching the screen should understand what's
happening and find it funny within 10 seconds.

**It's a party game, not an esport.** Client-authoritative damage, no replay,
no ranked mode. The mechanics should reward commitment and ridiculousness, not
optimization.

---

## 11. Implementation status

### Working and tested

| System | Location | Notes |
|--------|----------|-------|
| Damage formula | `combat.js` | Pure functions, 19 unit tests |
| Targeting algorithm | `targeting.js` | 12 unit tests |
| Audio analysis | `audio.js` | 9 unit tests |
| HUP detection | `audio.js` | Spike+decay model |
| fightingSpirit EMA | `audio.js` | 3s ramp |
| ridiculousFactor | `audio.js` | Vowel run + Speech API |
| Light attack flow | `main.js` | Client-auth, server relay |
| Windup attack flow | `main.js` | 2× multiplier, 150ms discard |
| HUP roll chain | `main.js` | 3 tiers + fatigue |
| Camera rig | `main.js` | WebXR-compatible, no direct camera.position |
| Heart rendering | `main.js` | Partial fill via CSS clip-path |
| Windup bar | `main.js` | Yellow→orange at 80% |
| Position sync | `network.js` | 20Hz, interpolated |
| Practice bot | `main.js` | 4-state AI for solo testing |
| Player mesh | `graphics/player-mesh.js` | OOT low-poly humanoid, MeshToonMaterial |
| Arena | `graphics/arena.js` | Placeholder flat floor + wall |
| Hit effects | `graphics/effects.js` | Sparks, aura, HUP trail |

### Placeholder / Stage 2

| System | Current state | Target |
|--------|--------------|--------|
| `showDamageNumber()` | Bare DOM text, emoji on windup | NMH-style: color-coded by tier, float-up animation |
| Screen vignette flash | Not implemented | Brief dark edge pulse on hits > 100 |
| fightingSpirit HUD | Invisible (not displayed) | Open design question — see `DESIGN_QUESTIONS.md §2` |
| HUD module | Inline in `main.js` | Extract to `hud.js` before Stage 2 HUD grows |
| Arena geometry | Flat floor, 48-seg circle | OOT-style arena environment |
| Lobby / waiting screen | Static "waiting" text | Interactive or at minimum styled |

### Not started (Stage 2+)

- Weapon pickups and mesh swap
- FFA 4-player mode
- Finishing Cry (Stage 3, deferred — see `audio.js` TODO)
- Server-side damage cap validation
- VR prototype

---

## 12. Open design questions

All open questions are documented in full in `DESIGN_QUESTIONS.md` with options,
trade-offs, and research questions. In priority order:

1. **Core mechanic legibility** — can players tell screaming is working? Does
   the scream → damage causal chain read, or is it too many steps?
2. **fightingSpirit and ridiculousFactor visibility** — they're invisible and
   slow to build. Papyrus-style meters? Ambient/embodied response? Nothing?
3. **HUP roll discoverability** — how do players find this mechanic? Is it
   fun in practice?
4. **Physical interaction design** — screaming while gaming is unusual.
   Calibration, onboarding, mic sensitivity, accessibility?
5. **Setup friction** — mic permission + pointer lock is two browser dialogs.
   Combined gesture? What happens if mic is denied?
6. **Windup attack UX** — right-click hold, release to fire. Right pattern?
   Silent discard on short taps is not communicated.
7. **Health representation** — fractional hearts: does it read clearly?
8. **Accessibility** — primary mechanic requires vocalization. Is silent mode
   a real option or an afterthought?
9. **Session design and scream fatigue** — multiple matches require sustained
   screaming. Is there a natural rest move?
10. **Multiplayer latency and hit feel** — attacker sees immediate feedback;
    defender takes damage with no perceived wind-up. Fair?

---

## 13. Future work

Ordered by priority per `CLAUDE.md §Future work`:

1. **Wind-up power meter UI** — real-time feedback during windup hold
2. **NMH-style damage numbers** — color-coded tiers, float-up animation,
   screen vignette flash on heavy hits
3. **FFA 4-player mode** — room cap 4, broader broadcast in `server.js`
4. **Weapon pickups** (Stage 2) — resonant scream type per weapon, arena spawns

   | Weapon | Resonant scream | Multiplier |
   |--------|----------------|------------|
   | Katana | Short burst < 0.5s | 1.8× |
   | Axe | Sustained > 2s | 2.2× |
   | Fists | Any, consecutive stacks | up to 2.5× |
   | Nunchucks | Vowel run (aaaa/oooo) | 2.0× |
   | Staff | Battle dictionary word | 1.7× |

5. **Finishing Cry** (Stage 3) — post-hit scream bonus; deferred due to
   Speech API latency concerns
6. **HUD module extraction** — `renderHearts()`, `updateWindupBar()`,
   `showDamageNumber()`, `showNotification()` into `hud.js`
7. **Server-side damage cap** — reject > 350 damage per event before public
   competitive release
8. **VR prototype**
9. **Teams 2v2**

---

## 14. Running and testing

```bash
npm install
npm run dev     # Node.js + Socket.io, --watch mode
# http://localhost:3000 — open in two browser tabs to test 1v1
# Single tab with no opponent → practice bot activates automatically
```

```bash
npm test        # Vitest unit tests
# Tests cover: combat.js, targeting.js, audio.js
# Three.js / DOM systems are not unit-tested (browser environment)
```

**To verify a match:**
1. Two tabs, both grant mic permission
2. Click canvas to pointer-lock
3. Left-click to light attack — damage number should appear
4. Hold right-click, release — windup fires; larger number, longer cooldown
5. Yell while attacking — louder scream → higher number
6. Space to roll; yell "HUP" then Space — notification "HUP ×1" should appear

---

*For agent instructions, architecture decisions, and lessons learned:
see `CLAUDE.md`.*

*For open UX and design questions: see `DESIGN_QUESTIONS.md`.*
