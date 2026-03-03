# HYAAAAT — Agent Handbook

Browser-based arena brawler where screaming amplifies your attacks. You press a
button to commit to an attack; you scream to determine how hard it hits.

---

## Quick orientation

```
server.js            Node.js + Socket.io server (matchmaking + relay)
public/index.html    Entry point; importmap for Three.js + Socket.io client
public/js/
  main.js            Game loop, Three.js scene, camera, player movement
  audio.js           Microphone analysis — volume, vowel runs, HUP detection
  input.js           Input abstraction layer (keyboard/mouse → named actions)
  targeting.js       Soft facing-direction target selection
  combat.js          Damage formula constants and calculator
  network.js         Socket.io client wrapper
  graphics/
    player-mesh.js   createPlayerMesh() factory — SWAP HERE for real models
    arena.js         createArena() factory — SWAP HERE for real environment
    effects.js       Hit sparks, windup aura, HUP speed trail
tests/               Vitest unit tests (combat, targeting, audio algorithms)
CLAUDE.md            This file
```

---

## Architecture decisions and reasoning

### Audio: no Web Speech API for primary mechanics

Web Speech API has 500ms+ latency and is Chrome-only (Firefox unsupported).
Using it for anything that needs to feel responsive (HUP roll, damage feedback)
would break the game feel.

**HUP detection** uses pure audio analysis instead: detect a short sharp vocal
burst — volume spike above 0.4 that falls back below 0.15 within 200ms. This
matches the physical reality of saying "HUP" without needing word recognition.

**Battle cry words** (ridiculousFactor bonus) use the Web Speech API as a
background bonus. Latency doesn't matter here — it fires retroactively and feels
like a surprise reward.

### Audio: RMS via getFloatTimeDomainData

`getFloatTimeDomainData()` into an RMS calculation is the most accurate approach
for perceived loudness with low latency. `getByteFrequencyData()` is used for
vowel formant detection (200–3500 Hz band). fftSize is 1024 — good frequency
resolution at reasonable CPU cost.

### Targeting: soft facing cone with fallback

Score each enemy: `facingBonus / distance²`
- facingBonus = 2.0 if target is within 70° of facing direction
- facingBonus = 1.0 otherwise (fallback to nearest in range)
- Hard cutoff at ATTACK_RANGE for committed hits; NEARBY_FALLBACK_RANGE for the
  fallback path

This rewards aiming while not punishing players who are slightly off-angle.

### Network: client-authoritative damage (V1 party game trust model)

Server-side damage validation would require streaming audio data from clients,
which is complex and not worth it for a party game. Clients calculate damage
locally and report it; server relays to opponent.

**TODO**: Add server-side damage cap sanity checks (e.g. reject damage > 350 in
a single event) before any public/competitive release.

### Network: 20Hz position sync

Clients send `playerUpdate` at 20Hz (every 50ms). Local rendering runs at the
display refresh rate. Remote player positions are interpolated between received
snapshots. This is standard for web multiplayer and works well for a brawler
where precise hit detection is not frame-critical.

### WebXR preparation

The input system uses abstract actions (`ACTIONS.LIGHT_ATTACK`, etc.) rather
than raw key bindings. VR controller bindings can be added in `input.js` without
changing any game logic.

Camera follow logic is isolated in `main.js` — gameplay code never manually sets
`camera.position` or `camera.rotation`. Instead it reads facing direction from
the camera rig's `matrixWorld`. This means VR can override the camera transform
without breaking gameplay.

**Avoid**: parenting gameplay objects to the camera, hardcoded near/far clip
planes, screen-space HUD (use DOM overlay instead).

### Graphics: factory functions as stable interface

`createPlayerMesh(options)` and `createArena(options)` in `graphics/` return
`THREE.Object3D` instances. The game logic only calls these factories and then
moves/rotates the returned objects. Swapping placeholder geometry for real models
means only changing these factory files — no game logic changes needed.

---

## Damage formula

```
raw    = BASE_DAMAGE × volume × fightingSpirit × ridiculousFactor
damage = clamp(raw, DAMAGE_FLOOR, DAMAGE_SOFT_CAP)       // normal attack
damage = clamp(raw × 2, DAMAGE_FLOOR, WINDUP_SOFT_CAP)   // windup attack

BASE_DAMAGE       = 10
DAMAGE_FLOOR      = 8    (weak screams still register)
DAMAGE_SOFT_CAP   = 150  (per normal hit)
WINDUP_SOFT_CAP   = 300  (per windup release)
MAX_HP            = 800  (10 hearts × 80hp)
```

`volume` is RMS of microphone input, 0–1.
`fightingSpirit` is an exponential moving average of volume over ~3s, range 1–2.
`ridiculousFactor` is 1–2.5, built from sustained vowel runs + battle cry bonus.

---

## HUP roll chain

1. Player presses ROLL (Space by default)
2. If a HUP-like burst was detected within the last 300ms: `hupRoll = true`
3. Roll speed multiplier:
   - Normal roll: 2.5×
   - HUP roll:    3.5×
   - Chain 2:     3.0× (second HUP within 1.2s of last)
   - Chain 3+:    3.5× (third HUP, peak)
4. After 3+ chained HUPs: 2s fatigue (normal roll speed)

---

## Weapons (Stage 2 — not yet implemented)

Each weapon has a "resonant scream type" that multiplies damage when matched.
Weapons are arena pickups (everyone starts with fists).

| Weapon     | Resonant scream           | Multiplier |
|------------|---------------------------|------------|
| Katana     | Short burst <0.5s         | 1.8×       |
| Axe        | Sustained >2s             | 2.2×       |
| Fists      | Any, consecutive stacks   | up to 2.5× |
| Nunchucks  | Vowel run (aaaa/oooo)     | 2.0×       |
| Staff      | Battle dictionary word    | 1.7×       |

TODO: Implement weapon pickup spawns, weapon mesh swap in player-mesh.js,
resonance detection in audio.js.

---

## Future work (prioritised)

1. Wind-up power meter UI (real-time feedback during windup hold)
2. FFA-4 player mode (room cap = 4, broader broadcast logic in server.js)
3. Weapon pickups (Stage 2)
4. Finishing Cry — post-hit scream bonus (Stage 3, deferred due to Speech API
   reliability concerns — see audio.js comments)
5. Server-side damage validation (before public competitive release)
6. VR prototype build
7. Teams 2v2

---

## Running locally

```bash
npm install
npm run dev     # starts server with --watch
# open http://localhost:3000 in two browser tabs to test 1v1
```

## Tests

```bash
npm test
```

Tests cover: damage formula (combat.js), targeting algorithm (targeting.js),
audio analysis utilities (audio.js). Three.js / DOM systems are not tested
(browser environment not available in Node test runner).

---

## Lessons from Stage 1 — what bit us and why

### The windup multiplier was missing from the formula

`calculateDamage()` was initially implemented with only a higher soft cap for
windup, without the `raw × 2` multiplier that the design doc specifies. The
formula in CLAUDE.md is:

```
damage = clamp(raw × 2, DAMAGE_FLOOR, WINDUP_SOFT_CAP)   // windup attack
```

The initial code did `clamp(raw, DAMAGE_FLOOR, WINDUP_SOFT_CAP)` — wrong cap,
missing multiplier. A unit test caught it. Future agents: if you touch
`calculateDamage`, verify both the multiplier AND the cap.

### Targeting score formula has a distance² dominance zone

The score `facingBonus / (dist² + ε)` means that at close range, distance
completely overpowers the facing bonus. Specifically:

- facing beats proximity ONLY when: `d_front < d_back × √2`
- Example: if close-behind is 0.5 units away, a facing target must be < 0.7
  units away for facing to win. A target 2 units away in front LOSES to 0.5
  units behind.

This is intentional — point-blank targets should be hard to miss regardless of
angle. But it means you cannot write tests like "facing always beats proximity"
without checking the actual distance ratio. Always compute scores manually when
writing targeting tests.

### `_vowelRun` is private but probably shouldn't be

`this._vowelRun` is computed in `_updateVowelRun()` and used only inside
`_updateRidiculousFactor()`. If you want to expose vowel run strength in the
HUD (e.g. a "vowel streak" indicator), rename it to `this.vowelRun` and add it
to the `audioState` getter. No other changes needed.

### The scream meter uses `window.dispatchEvent` — slightly smelly

`audio.js` dispatches a `window.screamLevel` custom event for the HUD meter.
This works but ties audio.js to the browser environment in a subtle way and
makes the flow hard to trace. If the HUD is rewritten, consider having main.js
read `audio.volume` directly in the game loop and update the meter there instead.
The current approach was chosen to avoid adding a UI update call inside main.js's
game loop for a non-gameplay element, but the event bus approach has tradeoffs.

### HUD code belongs in its own module

`renderHearts()`, `updateWindupBar()`, `showDamageNumber()`, `showNotification()`
are all in main.js. They work but don't belong there. When the HUD grows (Stage 2
weapon display, fighting spirit bar, etc.), extract these into a `hud.js` module
that exports an `updateHud(gameState)` function. main.js should just call that.
