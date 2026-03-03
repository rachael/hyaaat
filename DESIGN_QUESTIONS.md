# Design Questions — for HCI review

Open UX/interaction design questions I don't have good answers to.
Flagged for HCI review before building Stage 2 UI on top of uncertain foundations.

---

## 1. Core mechanic legibility: can players tell screaming is working?

The scream meter (vertical bar, bottom-left) shows microphone volume in real
time. But the causal chain is: scream → volume → fightingSpirit × ridiculousFactor
→ damage on hit → HP change on opponent.

There are multiple steps, a 400ms cooldown between attack and next opportunity,
and the damage number only appears at the moment of impact — after the scream.

**Questions:**
- Does the temporal gap between "scream" and "see damage number" break the
  causal connection for most players, or is 400ms close enough?
- Is a volume bar the right feedback affordance, or does something that looks
  more like "charging up" (e.g. the player mesh glowing brighter as you scream)
  communicate the mechanic better?
- Should the damage formula be surfaced at all (showing a "power" number before
  you swing), or does hiding it create better "feel"?

---

## 2. fightingSpirit and ridiculousFactor are invisible and slow to build

`fightingSpirit` builds over ~3 seconds of sustained loud screaming (range 1–2).
`ridiculousFactor` builds from vowel runs and battle cry words (range 1–2.5).
Neither is currently shown in the HUD. The scream meter only shows instantaneous
volume.

A player who screams consistently for 10 seconds will deal significantly more
damage than one who screams only at the moment of hitting. This is a deep
mechanic but completely invisible.

**Questions:**
- Should fightingSpirit have its own HUD indicator, or does showing it
  over-complicate the UI for a party game?
- If it should be shown, what metaphor communicates "sustained screaming over
  time" better than a bar? (An aura? A heat level? A "rage" meter?)
- Is the 3-second build time correct? Fast enough to feel responsive but long
  enough that it's a meaningful sustained commitment? Or should it be tunable
  by feel?
- Should ridiculousFactor give an explicit audio/visual reward when it ticks
  up (e.g. a flash of "+VOWEL RUN" text) so players can learn the behavior?

---

## 3. HUP roll discoverability

"Yell 'HUP' while pressing Space to roll faster" is a combo that requires both
a physical action (say a word) and a key press simultaneously. The chain mechanic
(up to 3× for 3 chained HUPs) is even further layered.

Currently the game just shows "HUP ×N" as a notification when it fires.

**Questions:**
- How do players discover this at all without being told? Is "discovery" even
  the right goal for a party game, or should it be explicitly taught in onboarding?
- Does the "HUP ×N" notification tell players what just happened, or is it
  confusing because they don't know why it appeared?
- Is it actually fun to HUP-chain in practice, or does it require too much
  coordination between physical (screaming) and digital (timing roll key)?
  This is a playtesting question but worth flagging.

---

## 4. Physical interaction design — screaming while gaming

Screaming while playing a video game is genuinely unusual. Players might:
- Use headphones (mic close to mouth, scream directly into mic — works great)
- Use laptop mic (might be too far away, sensitivity varies wildly)
- Be in a shared space (embarrassment, noise constraints)
- Not want to scream (accessibility)

The audio.js ×4 volume scaling is a rough approximation for typical laptop mics.
It will be way too sensitive for a close headset mic, and possibly not sensitive
enough for a distant laptop mic.

**Questions:**
- What's the right onboarding flow for a mechanic that requires physical
  vocalization? Does the mic permission screen need more guidance ("try a
  medium-volume yell to test your mic level")?
- Should there be a calibration step? If yes, what's the minimal version that
  works without being annoying?
- Is "screaming" the right framing, or does "speaking loudly" or "yelling" work
  better for players who are hesitant? Does the framing affect the behavior?
- For players who genuinely can't or won't vocalize, should silent play still
  be fun (minimum-damage attacks), or does the game need to feel like it's for
  them too?

---

## 5. Pointer lock + mic permission: two friction points before anything is playable

Current setup flow:
1. Load page → title screen
2. Click "Allow Microphone" → browser mic permission dialog
3. Click on canvas → browser pointer lock request
4. Wait for opponent

That's three clicks and a browser permission before seeing any gameplay.
Players who deny mic permission get minimum-damage silent play (game still
runs, but with no feedback that this is what's happening).

**Questions:**
- Is one combined "Set up and play" button better than two separate steps?
- Should the pointer lock and mic be requested simultaneously (single gesture)?
- What should happen when mic permission is denied — explicit acknowledgment
  screen ("you'll deal minimum damage, continue anyway?") or silent fallback?
- Should the game show something interactive while waiting for an opponent
  (practice target, tutorial) rather than a static "waiting" screen?

---

## 6. The windup attack: right-click hold, release to fire

Hold right mouse button → charge animation → release → attack fires.
A tap that's too short (< 150ms) is ignored silently.

**Questions:**
- Is the "release to fire" model the right pattern, or should it be
  "hold to charge, press again to release"? The latter is safer for
  accidental releases.
- The silent discard of short taps is not communicated. Players don't know
  if their windup fired or was discarded. Should there be feedback on a
  discarded windup?
- Does the 6-second cooldown on windup feel punishing enough to make it a
  strategic decision, or just annoying? (Untested — playtesting question.)

---

## 7. Health representation: 10 hearts × 80 HP

Each heart = 80 HP. A typical good scream deals ~40–60 damage, so roughly
half a heart per hit. 10 hearts = significant fight length.

**Questions:**
- Does showing fractional hearts (partial fill) help players understand how
  close they are to losing a heart, or is it confusing?
- Is "hearts" the right metaphor for this game's tone, or does something
  more aggressive (health bars, battle damage indicators) fit better?
- The partial heart is implemented with CSS clip-path — does it read clearly
  at the icon size, or does it look broken?

---

## 8. Accessibility

The primary mechanic requires microphone access and vocal input. This excludes:
- Players with speech/voice disabilities or conditions affecting volume
- Players in environments where vocalization is not possible (library, office)
- Players who are simply reluctant to vocalize

**Questions:**
- Is there a meaningful alternative input for the audio mechanic? (Key hold
  for "charging" a scream? Breath sensor?) Or is the game explicitly for people
  who will scream, and that's okay?
- If the game is positioned as "silent mode is available but lesser," how is
  that communicated without making players feel excluded?
- Are there specific scream patterns (like HUP's spike+decay detection) that
  are harder or easier for people with different vocal abilities?

---

## 9. Session design and scream fatigue

Multiple matches require sustained vocalization. A best-of-3 or tournament
format means potentially 15–30 minutes of intermittent screaming.

**Questions:**
- Is scream fatigue (actual voice tiredness) a design constraint to account for?
  Should match length, breathing-out windows, or "rest" moves be designed around it?
- Does the fighting spirit mechanic (rewards sustained screaming) conflict with
  sustainable session play? If you play optimally, you're screaming constantly,
  which is physically tiring.
- Is there a natural "rest move" in the design (e.g. rolling, blocking) that
  gives players a moment without screaming pressure?

---

## 10. Multiplayer latency and the hit feel

Light attack → `findTarget()` runs → damage calculated → `network.sendAttackLanded`
→ server relays → opponent takes damage.

From the attacker's perspective, the hit is immediate (they see the effect ring).
From the defender's perspective, the damage arrives 1–2 network round trips later.

**Questions:**
- Does the attacker-side immediacy feel good, or does the defender's perspective
  (sudden damage with no perceived wind-up) feel unfair?
- For a party game where all players are in the same room on the same wifi,
  is this a non-issue? Does the answer change for online play?
- Should the defender see any visual telegraph of an incoming attack (opponent
  flash, warning indicator) to give them a chance to react?

---

*These questions are in rough priority order — 1–4 most fundamental,
5–10 more refinement-level. Flagged for HCI review before Stage 2.*
