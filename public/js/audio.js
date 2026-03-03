/**
 * audio.js — microphone analysis for scream-based combat
 *
 * Provides:
 *   AudioAnalyser.init()       — requests mic permission, sets up Web Audio
 *   AudioAnalyser.update()     — call every frame; updates all properties
 *   AudioAnalyser.volume       — RMS loudness, 0–1
 *   AudioAnalyser.fightingSpirit — sustained volume EMA, 1–2
 *   AudioAnalyser.ridiculousFactor — vowel run + battle cry bonus, 1–2.5
 *   AudioAnalyser.hupDetected  — true for one frame when a HUP burst is found
 *
 * Design decisions (see CLAUDE.md §Audio for full reasoning):
 *
 * HUP detection — NO Web Speech API
 *   Web Speech API is 500ms+ latency and Firefox-unsupported. Instead we detect
 *   a "HUP-like burst": rapid volume spike (>0.4) that falls back to <0.15 within
 *   200ms. This matches the physical dynamics of saying "HUP" without word recognition.
 *
 * Vowel run detection — FFT energy in 200–3500 Hz band
 *   We don't need phonetic accuracy. We need to know: is this person sustaining
 *   a voiced vowel sound? Energy in the formant range (200–3500 Hz) sustained for
 *   200ms+ is a good enough proxy. See CLAUDE.md §Audio for the research basis.
 *
 * Battle cry words — Web Speech API (background, latency-tolerant)
 *   Used only for ridiculousFactor bonus. Late detection is fine — it fires as a
 *   surprise reward after the fact. Falls back gracefully if API is unavailable
 *   (Firefox, no mic permission, API absent).
 *
 * TODO (Stage 3): Mid-strike Finishing Cry bonus. Wait for Speech API latency
 *   to improve or use a simpler "sustained post-hit yell" detection (volume only).
 */

// Words that grant a ridiculousFactor bonus when detected by Speech API.
// Case-insensitive. Keep this list ridiculous.
const BATTLE_CRY_WORDS = new Set([
  'hyaaaat', 'hyaat', 'hiyah', 'kiai', 'kai', 'yah', 'yah',
  'unlimited', 'power', 'begone', 'gerald', 'witness', 'thunder',
  'maximum', 'overdrive', 'rampage', 'obliterate', 'annihilate',
  'devastate', 'excalibur', 'bankai', 'shoryuken', 'hadouken',
]);

const BATTLE_CRY_BONUS = 0.6;       // ridiculousFactor += this on battle cry
const BATTLE_CRY_DECAY_MS = 2000;   // how long the bonus lasts

const VOWEL_LOW_HZ = 200;
const VOWEL_HIGH_HZ = 3500;
const VOWEL_RUN_SUSTAIN_MS = 200;   // how long formant energy must be high
const VOWEL_ENERGY_THRESHOLD = 0.35; // normalized 0–1 (from byte freq data)

const HUP_RISE_THRESHOLD = 0.4;    // volume must spike above this
const HUP_FALL_THRESHOLD = 0.15;   // and drop back below this
const HUP_MAX_DURATION_MS = 200;   // within this window
const HUP_COOLDOWN_MS = 150;       // prevent double-fires

const FIGHTING_SPIRIT_ATTACK = 0.04;  // EMA rise rate per frame (~60fps)
const FIGHTING_SPIRIT_DECAY = 0.015;  // EMA fall rate per frame
const FIGHTING_SPIRIT_MIN = 1.0;
const FIGHTING_SPIRIT_MAX = 2.0;

export class AudioAnalyser {
  constructor() {
    this.volume = 0;
    this.fightingSpirit = FIGHTING_SPIRIT_MIN;
    this.ridiculousFactor = 1.0;
    this.hupDetected = false; // one-shot, cleared each frame

    this._ready = false;
    this._ctx = null;
    this._analyser = null;
    this._timeDomainBuf = null;
    this._freqBuf = null;

    // Vowel run state
    this._vowelHighSince = null; // timestamp when formant energy went high

    // HUP burst detection state
    this._hupRising = false;
    this._hupRiseTime = null;
    this._lastHupTime = 0;

    // Battle cry state
    this._battleCryBonusUntil = 0;
    this._speech = null;
    this._speechSupported = false;
  }

  /** Request mic access and set up Web Audio. Returns a promise. */
  async init() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this._ctx = new AudioContext();
      const source = this._ctx.createMediaStreamSource(stream);

      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 1024;
      this._analyser.smoothingTimeConstant = 0.5;
      source.connect(this._analyser);

      this._timeDomainBuf = new Float32Array(this._analyser.fftSize);
      this._freqBuf = new Uint8Array(this._analyser.frequencyBinCount);

      this._initSpeechRecognition();
      this._ready = true;
    } catch (err) {
      console.warn('[audio] Mic access denied or unavailable:', err.message);
      // Game still runs — all audio values stay at minimum (1.0 fightingSpirit etc.)
    }
  }

  /** Call every frame before reading properties. */
  update() {
    this.hupDetected = false;
    if (!this._ready) return;

    this._analyser.getFloatTimeDomainData(this._timeDomainBuf);
    this._analyser.getByteFrequencyData(this._freqBuf);

    this._updateVolume();
    this._updateFightingSpirit();
    this._updateVowelRun();
    this._updateHupDetection();
    this._updateRidiculousFactor();

    // Notify HUD scream meter (index.html listens on window)
    window.dispatchEvent(new CustomEvent('screamLevel', { detail: this.volume }));
  }

  get audioState() {
    return {
      volume: this.volume,
      fightingSpirit: this.fightingSpirit,
      ridiculousFactor: this.ridiculousFactor,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _updateVolume() {
    // RMS of time-domain signal — best proxy for perceived loudness
    let sum = 0;
    for (let i = 0; i < this._timeDomainBuf.length; i++) {
      sum += this._timeDomainBuf[i] * this._timeDomainBuf[i];
    }
    this.volume = Math.min(1, Math.sqrt(sum / this._timeDomainBuf.length) * 4);
    // ×4 scale: RMS of typical speech is ~0.1–0.3; we want 0.4–1.0 for a good scream
  }

  _updateFightingSpirit() {
    if (this.volume > 0.3) {
      this.fightingSpirit = Math.min(
        FIGHTING_SPIRIT_MAX,
        this.fightingSpirit + FIGHTING_SPIRIT_ATTACK,
      );
    } else {
      this.fightingSpirit = Math.max(
        FIGHTING_SPIRIT_MIN,
        this.fightingSpirit - FIGHTING_SPIRIT_DECAY,
      );
    }
  }

  _updateVowelRun() {
    // Check energy in the vowel formant band (200–3500 Hz)
    const sampleRate = this._ctx.sampleRate;
    const binCount = this._freqBuf.length;
    const nyquist = sampleRate / 2;
    const binWidth = nyquist / binCount;

    const lowBin = Math.max(0, Math.floor(VOWEL_LOW_HZ / binWidth));
    const highBin = Math.min(binCount - 1, Math.floor(VOWEL_HIGH_HZ / binWidth));

    let sum = 0;
    for (let i = lowBin; i <= highBin; i++) {
      sum += this._freqBuf[i];
    }
    const bandEnergy = sum / ((highBin - lowBin + 1) * 255); // 0–1 normalized

    const now = performance.now();
    if (bandEnergy >= VOWEL_ENERGY_THRESHOLD) {
      if (this._vowelHighSince === null) this._vowelHighSince = now;
    } else {
      this._vowelHighSince = null;
    }

    const sustainedMs =
      this._vowelHighSince !== null ? now - this._vowelHighSince : 0;
    // vowelRun ramps from 0→1 over 1 second of sustained vowel
    this._vowelRun = Math.min(1, sustainedMs / 1000);
  }

  _updateHupDetection() {
    const now = performance.now();
    const vol = this.volume;

    if (vol >= HUP_RISE_THRESHOLD && !this._hupRising) {
      // Volume just spiked — start tracking a potential HUP burst
      this._hupRising = true;
      this._hupRiseTime = now;
    }

    if (this._hupRising) {
      const elapsed = now - this._hupRiseTime;
      if (vol < HUP_FALL_THRESHOLD) {
        // Fast decay — this looks like a HUP
        if (elapsed <= HUP_MAX_DURATION_MS && now - this._lastHupTime > HUP_COOLDOWN_MS) {
          this.hupDetected = true;
          this._lastHupTime = now;
        }
        this._hupRising = false;
      } else if (elapsed > HUP_MAX_DURATION_MS) {
        // Sustained — not a HUP, more like a sustained scream
        this._hupRising = false;
      }
    }
  }

  _updateRidiculousFactor() {
    const now = performance.now();
    const battleCryBonus =
      now < this._battleCryBonusUntil ? BATTLE_CRY_BONUS : 0;

    // Base 1.0 + vowel run contribution (up to +1.0) + battle cry (+0.6)
    // Capped at 2.5 per the damage design doc
    this.ridiculousFactor = Math.min(
      2.5,
      1.0 + this._vowelRun * 1.0 + battleCryBonus,
    );
  }

  _initSpeechRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // Firefox and some browsers don't support this — degrade gracefully
      return;
    }

    try {
      this._speech = new SpeechRecognition();
      this._speech.continuous = true;
      this._speech.interimResults = true;
      this._speech.lang = 'en-US';

      this._speech.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim().toLowerCase();
          const words = transcript.split(/\s+/);
          for (const word of words) {
            if (BATTLE_CRY_WORDS.has(word)) {
              this._battleCryBonusUntil = performance.now() + BATTLE_CRY_DECAY_MS;
              break;
            }
          }
        }
      };

      this._speech.onerror = (e) => {
        if (e.error !== 'no-speech') {
          console.warn('[audio] Speech recognition error:', e.error);
        }
      };

      this._speech.onend = () => {
        // Auto-restart (continuous recognition sometimes stops on silence)
        if (this._ready) {
          try { this._speech.start(); } catch (_) {}
        }
      };

      this._speech.start();
      this._speechSupported = true;
    } catch (err) {
      console.warn('[audio] Speech recognition init failed:', err.message);
    }
  }
}
