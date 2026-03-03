# Agent Playbook — Browser Games & Realtime Web Apps

Patterns and rules of thumb extracted from building HYAAAAT (Stage 1).
Intended as transferable input for agents starting similar projects.

---

## Quick reference: how to go faster with fewer mistakes

The mistakes that cost the most time in this build, and how to avoid them:

### Create `.gitignore` before running `npm install`

`npm install` creates `node_modules/` immediately. If `.gitignore` doesn't exist
yet, a `git add .` or sloppy staging will commit hundreds of files. Requires a
cleanup commit to fix, which pollutes git history.

**Order of operations:** `.gitignore` → `npm install` → first commit. Always.

### Cross-check every spec formula against the implementation before writing tests

The windup damage multiplier (`raw × 2`) was in the spec doc but missing from
the code. It would have been found in ~30 seconds by reading the formula in
CLAUDE.md and checking the function line by line. Instead it was found by a
failing test, which required reading the test output, tracing back to the
function, comparing to the spec, and making the fix — 5× longer.

**Habit:** After implementing any formula, paste the spec formula next to the
code and visually diff them. Then write the tests.

### Write one system and its tests together, then move to the next

All 9 files were written before any tests ran. The two bugs found were in the
earliest written file (combat.js) — they just weren't discovered until much
later. Writing tests immediately after each pure-logic file would have caught
the windup multiplier before writing 8 more files.

**Sequence:** write combat.js → write combat.test.js → run tests → fix →
write targeting.js → write targeting.test.js → run tests → fix → etc.

### For formulas with quadratic terms: compute two specific examples before writing assertions

The targeting test with 0.5 vs 2.45 distances asserted the wrong winner because
the author didn't calculate the actual scores. This took two fix iterations.

**Habit:** Before any assertion about a nonlinear formula, write the expected
score as a comment: `// score = 2.0 / (9.0 + 0.01) ≈ 0.222`. If you can't
write that number, you don't know what the formula will produce.

### Don't test browser-environment-dependent classes in Node — extract pure functions

`AudioAnalyser.update()` calls `window.dispatchEvent()` which doesn't exist in
Node. This means the class itself can't be instantiated in tests. The workaround
(duplicating HUP logic in the test file) is fragile — if the production logic
changes, the test copy won't.

**Better pattern:** Extract pure algorithmic functions to a sibling file
(`audio-utils.js`), import and test those directly. The `AudioAnalyser` class
wraps them with Web Audio I/O. Tests only cover the utils file. Production code
stays testable even as side effects grow.

### Research only the decisions that are genuinely uncertain

In this build, researching Web Audio API latency before writing code was very
valuable (changed the design of HUP detection). Researching Three.js camera
setup was less valuable (standard patterns, nothing surprising). The time
difference: ~45 minutes vs ~5 minutes.

**Rule:** Research when you're choosing between approaches with materially
different tradeoffs (latency, browser support, complexity). Don't research when
you're confirming how to use an API you already know.

### State machine transitions are easy to miss — draw it first

The title screen → waiting screen transition was missing from the "Allow Mic"
button handler. This was caught on review but would have been immediately
obvious from a simple state diagram:

```
title  →[allow mic clicked]→  waiting  →[2nd player joins]→  playing  →[0 hp]→  gameover
                                         ↑[opponent disconnects]←──────────────────┘
```

For any project with multiple screens/phases, write this diagram as a comment
in the entry point file before coding any transitions.

---

## 1. Research API limitations before writing any code

If a feature depends on a browser API, spend 5 minutes checking:
- **Latency** — is it fast enough for the use case?
- **Browser support** — is it Chrome-only, or cross-browser?
- **Alternatives** — is there a lower-level API that gives you the same signal faster?

**Example from this project:** Web Speech Recognition API has 500ms+ latency
and is unavailable in Firefox. If we had built HUP detection on it, we'd have
discovered this late and had to rewrite the whole flow. Instead, research first
revealed that the physical signal (audio spike/decay pattern) is detectable
with pure Web Audio FFT — no word recognition needed, works in all browsers,
<16ms latency.

**Rule of thumb:** When a high-level API seems like the obvious choice, look for
the underlying signal it's processing. Often you can detect that signal directly
at lower latency and wider compatibility.

---

## 2. Write tests for pure functions before touching the browser

Browser game code has two kinds of code:
- Pure functions (damage formulas, scoring algorithms, signal processing math)
- Side-effectful code (Three.js, DOM, audio context, network)

Test the pure functions first with a unit test runner (Vitest, Jest). They run
in milliseconds with no browser. This is where spec mismatches hide.

**Example from this project:** The windup damage multiplier (`raw × 2`) was
missing from the implementation. The formula was in the spec doc. A unit test
caught it in the same session before it ever ran in a browser. Without the test,
this would have appeared as "windup attacks feel the same as normal attacks" —
a confusing gameplay bug.

**Rule of thumb:** If a function takes only numbers/plain objects and returns a
number/plain object, it should have a unit test. Postpone browser/integration
testing until pure logic is verified.

---

## 3. Compute expected test values — don't trust intuition on nonlinear formulas

When a scoring or damage formula involves exponents, products, or divisions,
intuition about "X should beat Y" is often wrong. Work out the actual numbers.

**Example from this project:** The targeting test claimed that a target in the
facing cone (2× bonus) would beat a closer target behind. But the test used
0.5 units behind vs 2.45 units in front. The scores were:
```
behind: 1.0 / (0.25 + ε) ≈ 3.85
front:  2.0 / (6.00 + ε) ≈ 0.33
```
Behind wins by 10×. The facing bonus (2×) can't compete with a 24× distance²
advantage. The test was wrong, not the code.

Fix: compute threshold explicitly — `facing beats proximity when d_front < d_back × √2`
— then pick distances that satisfy that inequality.

**Rule of thumb:** For any formula with quadratic or multiplicative terms, work
out two or three specific input/output pairs before writing assertions. Put the
math in a comment next to the assertion.

---

## 4. Use the physical signal, not the semantic API

High-level APIs (speech recognition, gesture detection, activity recognition)
add latency, compatibility issues, and opacity. The physical signal they wrap
(audio waveform, accelerometer data, pixel changes) is always available and
always faster.

**Mapping of semantic API → physical signal:**

| High-level API | Physical signal | Typical latency savings |
|---|---|---|
| Web Speech Recognition | FFT + RMS waveform | 300–800ms |
| MediaRecorder (for loudness) | AnalyserNode RMS | 200ms+ |
| Gamepad `button.pressed` | `axes` raw values | negligible |
| `deviceorientation` for gestures | `accelerometer` raw | 10–50ms |

**When to use the high-level API anyway:** When latency doesn't matter and
the semantic output is what you actually need (e.g. getting transcribed text,
not just "is speaking"). In HYAAAAT, battle cry word bonuses use Speech API
because latency is irrelevant there — the bonus fires retroactively.

---

## 5. Abstract input from the start — even if you only have one input device

Create an `ACTIONS` enum and an `InputManager` that maps devices to actions.
Do this on day one, before writing any game logic. Cost: ~100 lines. Payoff:

- Adding VR controllers, gamepad, touch — zero changes to game logic
- Key remapping is a settings screen, not a refactor
- Tests can inject fake input by just calling `input.justPressed(ACTIONS.X)`
  without simulating keyboard events

Pattern:
```javascript
// Bad: game logic reads hardware directly
if (keys['Space']) startRoll();

// Good: game logic reads abstract actions
if (input.justPressed(ACTIONS.ROLL)) startRoll();
```

---

## 6. Rate-limit at the send site, not the call site

If a function sends network data and should be rate-limited, put the rate limit
inside the function. Don't require callers to throttle.

```javascript
// Bad: every caller must remember to throttle
if (now - lastSync > 50) network.sendPlayerUpdate(state);

// Good: caller doesn't need to think about it
network.sendPlayerUpdate(state); // internally rate-limited to 20Hz
```

This applies to: network sends, analytics events, audio analysis triggers,
localStorage writes — anything where "call every frame but only fire sometimes"
is the intended behavior.

---

## 7. Factory functions over classes for swappable components

If a component will eventually be replaced (placeholder mesh → real character
model, simple physics → real physics engine), make it a factory function that
returns a standard interface.

```javascript
// Factory returns something with a stable API
const playerMesh = createPlayerMesh({ color: 0x3399ff });
playerMesh.setWindup(0.5);  // API contract
playerMesh.setRolling(true); // API contract

// Game logic never knows what's inside playerMesh
scene.add(playerMesh);
```

When the artist delivers a real model, only `createPlayerMesh` changes.
No game logic changes. No merge conflicts between art and gameplay branches.

---

## 8. Three WebXR readiness rules (cost nothing now, save a rewrite later)

1. **Never set `camera.position` or `camera.rotation` in game logic.**
   Mount the camera on a rig (`cameraRig.add(camera)`). Move the rig.
   VR overrides the camera transform; if your code sets it directly, it fights
   the headset tracking.

2. **Abstract input actions** (covered above). VR controller mappings go in
   the same input module, zero game logic changes.

3. **DOM overlay for HUD, not 3D sprites.**
   `position: fixed` CSS over the canvas works in both desktop and WebXR
   DOM overlay mode. 3D billboard sprites in world space are hard to read in VR
   and require special depth handling.

---

## 9. Multiplayer authority model — decide early and document it

The choice between client-authoritative and server-authoritative affects
everything downstream. Choose based on what data the server would need to
validate:

| What you're validating | Server needs | Worth it? |
|---|---|---|
| Position (cheating hitbox) | Client position history | Usually yes |
| Damage amount | All inputs that produced it | Depends |
| Damage from audio volume | Microphone audio stream | Complex — defer |
| Timing of actions | Client timestamp + latency | Usually yes |

For HYAAAAT, damage validation would require streaming microphone audio to the
server — high complexity, high bandwidth, brittle. For a party game where
cheating isn't economically motivated, client-authoritative + a server-side
damage cap sanity check is the right tradeoff.

**Always document the tradeoff explicitly** so future agents don't "fix" it
naively. The `server.js` file and CLAUDE.md both state why it's client-
authoritative and what the TODO is before competitive release.

---

## 10. 20Hz is the right position sync rate for most web multiplayer

- < 10Hz: jerky, interpolation gaps are visible
- 20Hz: smooth with lerp interpolation, ~2KB/s per player
- 60Hz: wastes bandwidth, no perceptible improvement for most games
- > 60Hz: never justified for browser games

Implement: rate-limit `sendPlayerUpdate` to every 50ms. Lerp remote positions
toward received snapshots every frame. This decouples visual smoothness (60fps)
from network traffic (20Hz).

---

## 11. Freeze your constants objects

```javascript
export const COMBAT = Object.freeze({
  BASE_DAMAGE: 10,
  MAX_HP: 800,
  // ...
});
```

Cost: nothing. Benefit: accidental mutations throw in strict mode rather than
silently producing impossible game states. Bugs that would have manifested as
"damage feels wrong in certain situations" become immediate throws.

Same applies to action enums, config objects, anything that shouldn't change
at runtime.

---

## 12. Use `performance.now()` everywhere in game code, never `Date.now()`

- `performance.now()`: monotonic (never goes backwards), sub-millisecond
  resolution, starts from page load
- `Date.now()`: millisecond resolution, can jump backwards (NTP sync), tied
  to wall clock

For game timers (cooldowns, HUP chain window, roll duration): `performance.now()`.
For logging timestamps or "what time did this match end": `Date.now()` or `new Date()`.

---

## 13. Screen state as a single `showScreen(id)` function

For a game with discrete phases (title → waiting → playing → gameover), the
simplest HUD management is:

```javascript
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.style.display = 'none');
  document.getElementById(id).style.display = 'flex';
}
```

All screens are `display: none` except the active one. No state to track, no
class toggling logic. Add new screens by adding a new `<div class="screen">`.
Transitions via CSS opacity/transform if desired.

---

## 14. Commit in semantic layers, not in time order

Structure commits as logical layers, each independently useful:

1. Project setup + server + agent handbook (`CLAUDE.md`)
2. Pure-logic systems (combat, targeting, audio algorithms, input, network)
3. Unit tests for the pure-logic systems
4. Graphics factory layer
5. Game loop + entry point

This means: if a future agent only cares about the damage formula, they can
read commit 2 and its tests in commit 3 without wading through Three.js setup.
It also makes bisecting easier if something breaks.

---

## 15. Document decisions where you'll make them, not in a separate doc

Architecture decision records are most useful when they're adjacent to the code
they describe. A wall of reasoning in a README is ignored; a comment above a
function is read.

```javascript
// Web Speech API is 500ms+ latency and Firefox-unsupported.
// Using it for HUP detection would break the game feel.
// Instead: detect the physical spike+decay pattern directly.
// See CLAUDE.md §Audio for full reasoning.
_updateHupDetection() { ... }
```

Point to the longer doc for depth, but put the decision summary where the
affected code lives.
