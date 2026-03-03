/**
 * main.js — game loop, Three.js scene, player movement, combat flow
 *
 * Coordinates all systems:
 *   AudioAnalyser  → scream data
 *   InputManager   → abstract actions
 *   NetworkManager → server sync
 *   findTarget     → who gets hit
 *   calculateDamage → how hard
 *   createPlayerMesh / createArena / effects → visuals
 *
 * Camera:
 *   Third-person follow camera. Pointer lock + mouse drag rotates yaw.
 *   Player faces in the camera's forward direction.
 *   WASD movement is camera-relative.
 *   Camera position is NEVER set directly in gameplay code — always via the
 *   cameraRig transform. This keeps WebXR-compatible (see CLAUDE.md §WebXR).
 *
 * HUP roll chain (see CLAUDE.md §HUP roll chain):
 *   1. Player presses ROLL
 *   2. If audio.hupDetected within last 300ms → hupRoll = true
 *   3. Speed multiplier scales with chain depth (up to 3.5×)
 *   4. Fatigue (2s of normal speed) after 3+ chained HUPs
 *
 * Local player is always playerIndex 0 or 1 (assigned by server on join).
 * Opponent state is received via network and interpolated.
 */

import * as THREE from 'three';
import { AudioAnalyser } from './audio.js';
import { InputManager, ACTIONS } from './input.js';
import { NetworkManager } from './network.js';
import { calculateDamage, windupCharge, hpToHearts, COMBAT } from './combat.js';
import { findTarget } from './targeting.js';
import { createPlayerMesh } from './graphics/player-mesh.js';
import { createArena, ARENA_RADIUS } from './graphics/arena.js';
import { spawnHitEffect, spawnHupTrail, spawnWindupRelease } from './graphics/effects.js';

// ── Constants ────────────────────────────────────────────────────────────────

const PLAYER_SPEED = 6;          // units per second
const ROLL_BASE_SPEED = 2.5;     // multiplier on top of PLAYER_SPEED
const HUP_ROLL_SPEED = 3.5;      // hup-chain peak speed multiplier
const HUP_ROLL_WINDOW_MS = 300;  // ms after hupDetected that roll counts as HUP
const HUP_CHAIN_WINDOW_MS = 1200; // ms between HUPs to count as chain
const HUP_CHAIN_MAX = 3;
const HUP_FATIGUE_MS = 2000;
const ROLL_DURATION_MS = 380;
const CAMERA_DISTANCE = 9;
const CAMERA_HEIGHT = 6;
const CAMERA_PITCH = -0.55; // radians, looking slightly down
const MOUSE_SENSITIVITY = 0.003;
const BOUNDARY_FRICTION = 0.3;  // speed fraction kept when hitting boundary

const PLAYER_COLORS = [0x3399ff, 0xff3344]; // [local, opponent] if playerIndex=0
const OPPONENT_INTERP_FACTOR = 0.25; // lerp speed for remote player position

// ── State ────────────────────────────────────────────────────────────────────

let renderer, scene, camera, cameraRig;
let localMesh, opponentMesh;
let arenaGroup;

const local = {
  position: new THREE.Vector3(2, 0, 0),
  yaw: 0,          // camera/player Y rotation in radians
  velocity: new THREE.Vector3(),
  hp: COMBAT.MAX_HP,
  isRolling: false,
  rollTimer: 0,
  rollDir: new THREE.Vector3(),
  isWindingUp: false,
  windupHeldMs: 0,
  windupCooldownLeft: 0,
  attackCooldownLeft: 0,
  hupChain: { count: 0, lastTime: 0 },
  hupFatigue: false,
  hupFatigueUntil: 0,
  lastHupDetectTime: 0, // timestamp of most recent hupDetected
};

const opponent = {
  position: new THREE.Vector3(-2, 0, 0),
  yaw: Math.PI,
  hp: COMBAT.MAX_HP,
  isWindingUp: false,
  connected: false,
};

let gamePhase = 'waiting'; // 'waiting' | 'playing' | 'gameover'
let playerIndex = 0;

// Systems (initialised in init())
let audio, input, network;

// ── Practice mode bot ────────────────────────────────────────────────────────
// Client-side only — no server connection needed in practice mode.
// Simple 4-state AI: patrol → chase → attack → retreat.

const BOT = {
  enabled: false,
  state: 'patrol', // 'patrol' | 'chase' | 'attack' | 'retreat'
  stateTimer: 0,          // ms remaining in timed state
  attackCooldown: 0,      // ms until bot can attack again
  patrolAngle: 0,         // current angle on patrol orbit
  PATROL_RADIUS: 4.5,
  PATROL_SPEED: 1.8,
  CHASE_SPEED: 3.8,
  RETREAT_SPEED: 4.5,
  CHASE_RANGE: 8,
  ATTACK_INTERVAL_MS: 2800,
  RETREAT_DURATION_MS: 700,
};

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Three.js renderer
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  onResize();
  window.addEventListener('resize', onResize);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111122);
  scene.fog = new THREE.Fog(0x111122, 20, 50);

  // Camera rig — do NOT set camera.position directly in game logic (WebXR compat)
  cameraRig = new THREE.Object3D();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.rotation.x = CAMERA_PITCH;
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
  cameraRig.add(camera);
  scene.add(cameraRig);

  // Arena
  const { scene: arena } = createArena();
  arenaGroup = arena;
  scene.add(arenaGroup);

  // Player meshes
  localMesh = createPlayerMesh({ color: PLAYER_COLORS[0] });
  opponentMesh = createPlayerMesh({ color: PLAYER_COLORS[1] });
  opponentMesh.visible = false;
  scene.add(localMesh, opponentMesh);

  // Systems
  input = new InputManager(renderer.domElement);
  input.init();

  audio = new AudioAnalyser();
  // Mic init is triggered by the "allow mic" button in the UI, not here

  network = new NetworkManager();
  bindNetworkEvents();
  network.connect();

  // Start render loop
  renderer.setAnimationLoop(gameLoop);

  showScreen('waiting-screen');
}

// ── Network event bindings ────────────────────────────────────────────────────

function bindNetworkEvents() {
  network.on('waiting', () => showScreen('waiting-screen'));

  network.on('joined', ({ playerIndex: idx }) => {
    playerIndex = idx;
    // Local = PLAYER_COLORS[idx], opponent = PLAYER_COLORS[1-idx]
    localMesh.setColor(PLAYER_COLORS[idx]);
    opponentMesh.setColor(PLAYER_COLORS[1 - idx]);
  });

  network.on('gameStart', () => {
    opponent.connected = true;
    opponentMesh.visible = true;
    local.hp = COMBAT.MAX_HP;
    opponent.hp = COMBAT.MAX_HP;
    gamePhase = 'playing';
    showScreen('hud');
    updateHud();
    showNotification('FIGHT!', 1500);
  });

  network.on('opponentUpdate', (data) => {
    // Smoothly interpolate opponent position in gameLoop
    opponent._targetPos = new THREE.Vector3(data.px, 0, data.pz);
    opponent.yaw = data.yaw;
    opponent.hp = data.hp;
    updateHud();
  });

  network.on('takeDamage', ({ damage }) => {
    local.hp = Math.max(0, local.hp - damage);
    updateHud();
    flashScreen('red');
    if (local.hp <= 0) endGame('lose');
  });

  network.on('opponentWindupStart', () => {
    opponent.isWindingUp = true;
    opponentMesh.setWindup(0.3);
  });

  network.on('opponentWindupCancel', () => {
    opponent.isWindingUp = false;
    opponentMesh.setWindup(0);
  });

  network.on('opponentDisconnected', () => {
    opponent.connected = false;
    opponentMesh.visible = false;
    if (gamePhase === 'playing') {
      showNotification('Opponent disconnected', 3000);
      gamePhase = 'waiting';
      showScreen('waiting-screen');
    }
  });
}

// ── Game loop ─────────────────────────────────────────────────────────────────

let lastTime = null;

function gameLoop(timestamp) {
  const dt = lastTime === null ? 0.016 : Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  audio.update();

  if (gamePhase === 'playing') {
    updateCamera(dt);
    updateMovement(dt);
    updateCombat(dt);
    if (BOT.enabled) {
      updateBot(dt);
    } else {
      updateOpponent(dt);
      syncNetwork();
    }
  }

  renderer.render(scene, camera);
  input.endFrame();
}

// ── Camera ────────────────────────────────────────────────────────────────────

function updateCamera(dt) {
  // Mouse delta rotates camera yaw
  local.yaw -= input.mouseDelta.x * MOUSE_SENSITIVITY;
  cameraRig.rotation.y = local.yaw;
  cameraRig.position.copy(local.position);
}

// ── Movement ──────────────────────────────────────────────────────────────────

function updateMovement(dt) {
  const now = performance.now();

  // Cooldown ticks
  if (local.windupCooldownLeft > 0) local.windupCooldownLeft -= dt * 1000;
  if (local.attackCooldownLeft > 0) local.attackCooldownLeft -= dt * 1000;
  if (local.hupFatigue && now > local.hupFatigueUntil) local.hupFatigue = false;

  // Roll timer
  if (local.isRolling) {
    local.rollTimer -= dt * 1000;
    if (local.rollTimer <= 0) {
      local.isRolling = false;
      localMesh.setRolling(false);
    }
  }

  // Track HUP detections from audio
  if (audio.hupDetected) {
    local.lastHupDetectTime = now;
  }

  // Roll input
  if (!local.isRolling && input.justPressed(ACTIONS.ROLL)) {
    const hupWindow = now - local.lastHupDetectTime < HUP_ROLL_WINDOW_MS;
    startRoll(hupWindow, now);
  }

  // Build move direction from input
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  cameraRig.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate();

  const moveDir = new THREE.Vector3();
  if (input.isPressed(ACTIONS.MOVE_FORWARD)) moveDir.add(forward);
  if (input.isPressed(ACTIONS.MOVE_BACKWARD)) moveDir.sub(forward);
  if (input.isPressed(ACTIONS.MOVE_LEFT)) moveDir.add(right);
  if (input.isPressed(ACTIONS.MOVE_RIGHT)) moveDir.sub(right);

  if (moveDir.lengthSq() > 0) moveDir.normalize();

  // Apply velocity
  if (local.isRolling) {
    local.velocity.copy(local.rollDir).multiplyScalar(local._rollSpeed * PLAYER_SPEED);
  } else {
    local.velocity.copy(moveDir).multiplyScalar(PLAYER_SPEED);
  }

  local.position.addScaledVector(local.velocity, dt);

  // Arena boundary
  const dist2D = Math.sqrt(local.position.x ** 2 + local.position.z ** 2);
  if (dist2D > ARENA_RADIUS - 0.5) {
    const norm = new THREE.Vector3(local.position.x, 0, local.position.z).normalize();
    local.position.x = norm.x * (ARENA_RADIUS - 0.5);
    local.position.z = norm.z * (ARENA_RADIUS - 0.5);
    if (local.isRolling) {
      local.velocity.multiplyScalar(BOUNDARY_FRICTION);
    }
  }
  local.position.y = 0;

  // Sync mesh
  localMesh.position.copy(local.position);
  localMesh.rotation.y = local.yaw;
  localMesh.setRolling(local.isRolling);

  // HUP trail effect
  if (local.isRolling && audio.hupDetected) {
    spawnHupTrail(scene, local.position);
  }
}

function startRoll(isHup, now) {
  // Determine movement direction for roll — use current velocity or camera forward
  const forward = new THREE.Vector3();
  cameraRig.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate();

  const dir = new THREE.Vector3();
  if (input.isPressed(ACTIONS.MOVE_FORWARD)) dir.add(forward);
  if (input.isPressed(ACTIONS.MOVE_BACKWARD)) dir.sub(forward);
  if (input.isPressed(ACTIONS.MOVE_LEFT)) dir.add(right);
  if (input.isPressed(ACTIONS.MOVE_RIGHT)) dir.sub(right);
  if (dir.lengthSq() < 0.01) dir.copy(forward); // default: roll forward

  dir.normalize();
  local.rollDir.copy(dir);
  local.isRolling = true;
  local.rollTimer = ROLL_DURATION_MS;

  if (isHup && !local.hupFatigue) {
    // Update HUP chain
    const timeSinceLastHup = now - local.hupChain.lastTime;
    if (timeSinceLastHup < HUP_CHAIN_WINDOW_MS) {
      local.hupChain.count = Math.min(local.hupChain.count + 1, HUP_CHAIN_MAX);
    } else {
      local.hupChain.count = 1;
    }
    local.hupChain.lastTime = now;

    // Speed multiplier scales with chain depth
    const chainFrac = local.hupChain.count / HUP_CHAIN_MAX; // 0.33 → 1.0
    local._rollSpeed = ROLL_BASE_SPEED + (HUP_ROLL_SPEED - ROLL_BASE_SPEED) * chainFrac;

    // Fatigue after max chain
    if (local.hupChain.count >= HUP_CHAIN_MAX) {
      local.hupFatigue = true;
      local.hupFatigueUntil = now + HUP_FATIGUE_MS;
      local.hupChain.count = 0;
    }

    showNotification(`HUP ×${local.hupChain.count}`, 600);
  } else {
    local._rollSpeed = ROLL_BASE_SPEED;
  }
}

// ── Combat ────────────────────────────────────────────────────────────────────

function updateCombat(dt) {
  // ── Windup (hold right mouse) ──────────────────────────────────────────────
  if (
    input.isPressed(ACTIONS.HEAVY_ATTACK) &&
    local.windupCooldownLeft <= 0 &&
    !local.isWindingUp &&
    !local.isRolling
  ) {
    local.isWindingUp = true;
    local.windupHeldMs = 0;
    network.sendWindupStart();
  }

  if (local.isWindingUp) {
    if (input.isPressed(ACTIONS.HEAVY_ATTACK)) {
      local.windupHeldMs += dt * 1000;
      const charge = windupCharge(local.windupHeldMs);
      localMesh.setWindup(charge);
      updateWindupBar(charge);
    } else {
      // Released — fire!
      releaseWindup();
    }
  }


  // ── Light attack (left mouse click) ───────────────────────────────────────
  if (
    input.justPressed(ACTIONS.LIGHT_ATTACK) &&
    local.attackCooldownLeft <= 0 &&
    !local.isWindingUp &&
    !local.isRolling
  ) {
    doLightAttack();
  }
}

function doLightAttack() {
  const target = getTarget();
  if (!target) return;

  local.attackCooldownLeft = COMBAT.LIGHT_ATTACK_COOLDOWN_MS;
  const damage = calculateDamage(audio.audioState, false);

  if (!BOT.enabled) network.sendAttackLanded({ damage, audioState: audio.audioState });
  spawnHitEffect(scene, opponent.position.clone(), damage);
  showDamageNumber(damage, false);

  // Check if we just KO'd the opponent (optimistic — server confirms)
  opponent.hp = Math.max(0, opponent.hp - damage);
  updateHud();
  if (opponent.hp <= 0) endGame('win');
}

function releaseWindup() {
  local.isWindingUp = false;
  localMesh.setWindup(0);
  updateWindupBar(0);
  network.sendWindupCancel();

  if (local.windupHeldMs < 150) return; // tap, not a real windup

  const target = getTarget();
  if (!target) {
    local.windupCooldownLeft = COMBAT.WINDUP_COOLDOWN_MS * 0.3; // partial cooldown for whiff
    return;
  }

  local.windupCooldownLeft = COMBAT.WINDUP_COOLDOWN_MS;
  const damage = calculateDamage(audio.audioState, true);

  if (!BOT.enabled) network.sendAttackLanded({ damage, audioState: audio.audioState, isWindup: true });
  spawnHitEffect(scene, opponent.position.clone(), damage);
  spawnWindupRelease(scene, local.position.clone());
  showDamageNumber(damage, true);

  opponent.hp = Math.max(0, opponent.hp - damage);
  updateHud();
  if (opponent.hp <= 0) endGame('win');
}

function getTarget() {
  if (!opponent.connected) return null;

  // Build facing vector from camera yaw
  const facing = new THREE.Vector3(
    -Math.sin(local.yaw),
    0,
    -Math.cos(local.yaw),
  );

  const result = findTarget(
    { x: local.position.x, z: local.position.z },
    { x: facing.x, z: facing.z },
    [{ id: 'opponent', position: { x: opponent.position.x, z: opponent.position.z } }],
  );

  return result;
}

// ── Opponent interpolation ────────────────────────────────────────────────────

function updateOpponent(dt) {
  if (!opponent.connected) return;

  if (opponent._targetPos) {
    opponent.position.lerp(opponent._targetPos, OPPONENT_INTERP_FACTOR);
  }
  opponentMesh.position.copy(opponent.position);
  opponentMesh.rotation.y = opponent.yaw;
}

// ── Network sync ──────────────────────────────────────────────────────────────

function syncNetwork() {
  network.sendPlayerUpdate({
    px: local.position.x,
    pz: local.position.z,
    yaw: local.yaw,
    hp: local.hp,
  });
}

// ── Practice mode ─────────────────────────────────────────────────────────────

export function startPracticeMode() {
  BOT.enabled = true;
  opponent.connected = true;
  opponent.hp = COMBAT.MAX_HP;
  opponent.position.set(-4, 0, -4);
  opponentMesh.visible = true;
  opponentMesh.setColor(0xee4422); // orange-red bot colour
  local.hp = COMBAT.MAX_HP;
  gamePhase = 'playing';
  showScreen('hud');
  updateHud();
  showNotification('PRACTICE MODE', 2000);
}

function updateBot(dt) {
  BOT.attackCooldown = Math.max(0, BOT.attackCooldown - dt * 1000);
  if (BOT.stateTimer > 0) BOT.stateTimer -= dt * 1000;

  const toPlayer = new THREE.Vector3(
    local.position.x - opponent.position.x,
    0,
    local.position.z - opponent.position.z,
  );
  const distToPlayer = toPlayer.length();

  // ── State transitions ──────────────────────────────────────────────────────
  if (BOT.state === 'patrol' && distToPlayer < BOT.CHASE_RANGE) {
    BOT.state = 'chase';
  }
  if (BOT.state === 'chase') {
    if (distToPlayer > BOT.CHASE_RANGE * 1.4) BOT.state = 'patrol';
    if (distToPlayer < COMBAT.ATTACK_RANGE && BOT.attackCooldown <= 0) {
      BOT.state = 'attack';
    }
  }
  if (BOT.state === 'retreat' && BOT.stateTimer <= 0) {
    BOT.state = 'chase';
  }

  // ── Attack ─────────────────────────────────────────────────────────────────
  if (BOT.state === 'attack') {
    const botAudio = {
      volume:           0.25 + Math.random() * 0.55,
      fightingSpirit:   1.0  + Math.random() * 0.6,
      ridiculousFactor: 1.0  + Math.random() * 0.3,
    };
    const botDamage = calculateDamage(botAudio, false);
    local.hp = Math.max(0, local.hp - botDamage);
    updateHud();
    flashScreen('red');
    spawnHitEffect(scene, local.position.clone(), botDamage);

    BOT.attackCooldown = BOT.ATTACK_INTERVAL_MS;
    BOT.stateTimer = BOT.RETREAT_DURATION_MS;
    BOT.state = 'retreat';

    if (local.hp <= 0) endGame('lose');
  }

  // ── Movement ───────────────────────────────────────────────────────────────
  const moveDir = new THREE.Vector3();

  if (BOT.state === 'patrol') {
    BOT.patrolAngle += dt * 0.45;
    const patrolTarget = new THREE.Vector3(
      Math.cos(BOT.patrolAngle) * BOT.PATROL_RADIUS,
      0,
      Math.sin(BOT.patrolAngle) * BOT.PATROL_RADIUS,
    );
    moveDir.copy(patrolTarget).sub(opponent.position).normalize();
    opponent.position.addScaledVector(moveDir, BOT.PATROL_SPEED * dt);
  } else if (BOT.state === 'chase') {
    moveDir.copy(toPlayer).normalize();
    opponent.position.addScaledVector(moveDir, BOT.CHASE_SPEED * dt);
  } else if (BOT.state === 'retreat') {
    moveDir.copy(toPlayer).normalize().negate();
    opponent.position.addScaledVector(moveDir, BOT.RETREAT_SPEED * dt);
  }

  // ── Arena boundary ─────────────────────────────────────────────────────────
  const d = Math.sqrt(opponent.position.x ** 2 + opponent.position.z ** 2);
  if (d > ARENA_RADIUS - 0.8) {
    const n = new THREE.Vector3(opponent.position.x, 0, opponent.position.z).normalize();
    opponent.position.x = n.x * (ARENA_RADIUS - 0.8);
    opponent.position.z = n.z * (ARENA_RADIUS - 0.8);
  }
  opponent.position.y = 0;

  // ── Face the player ────────────────────────────────────────────────────────
  if (distToPlayer > 0.1) {
    opponent.yaw = Math.atan2(toPlayer.x, toPlayer.z);
  }

  opponentMesh.position.copy(opponent.position);
  opponentMesh.rotation.y = opponent.yaw;
}

// ── Game state transitions ────────────────────────────────────────────────────

function endGame(result) {
  gamePhase = 'gameover';
  const screen = document.getElementById('gameover-screen');
  document.getElementById('gameover-title').textContent =
    result === 'win' ? 'VICTORY' : 'DEFEATED';
  showScreen('gameover-screen');
}

// ── HUD helpers ───────────────────────────────────────────────────────────────

function updateHud() {
  renderHearts('local-hearts', local.hp);
  renderHearts('opponent-hearts', opponent.hp);
}

function renderHearts(containerId, hp) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const hearts = hpToHearts(hp); // float
  const full = Math.floor(hearts);
  const partial = hearts - full;
  const total = COMBAT.HEARTS;

  let html = '';
  for (let i = 0; i < total; i++) {
    if (i < full) {
      html += '<span class="heart full">♥</span>';
    } else if (i === full && partial > 0.1) {
      const pct = Math.round(partial * 100);
      html += `<span class="heart partial" style="--fill:${pct}%">♥</span>`;
    } else {
      html += '<span class="heart empty">♥</span>';
    }
  }
  el.innerHTML = html;
}

function updateWindupBar(fraction) {
  const bar = document.getElementById('windup-bar');
  if (!bar) return;
  if (fraction > 0) {
    bar.style.display = 'block';
    bar.style.width = `${fraction * 100}%`;
    bar.style.background = fraction > 0.8 ? '#ff4400' : '#ffdd00';
  } else {
    bar.style.display = 'none';
  }
}

function showDamageNumber(damage, isWindup) {
  const el = document.getElementById('damage-display');
  if (!el) return;
  el.textContent = isWindup ? `💥 ${damage}!` : `${damage}`;
  el.className = isWindup ? 'damage-display windup' : 'damage-display';
  el.style.opacity = '1';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 800);
}

function showNotification(text, durationMs) {
  const el = document.getElementById('notification');
  if (!el) return;
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.style.opacity = '0'; }, durationMs);
}

function flashScreen(color) {
  const flash = document.getElementById('screen-flash');
  if (!flash) return;
  flash.style.background = color === 'red' ? 'rgba(255,0,0,0.25)' : 'rgba(255,255,255,0.25)';
  flash.style.opacity = '1';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { flash.style.opacity = '0'; }, 150);
}

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) {
    el.style.display = 'none';
  }
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

// ── Resize ────────────────────────────────────────────────────────────────────

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

// ── Mic button ───────────────────────────────────────────────────────────────

document.getElementById('allow-mic-btn')?.addEventListener('click', async () => {
  await audio.init();
  document.getElementById('allow-mic-btn').textContent = '🎤 Mic active';
  document.getElementById('allow-mic-btn').disabled = true;
  // Transition off the title screen to waiting (network connect already happened)
  showScreen('waiting-screen');
});

document.getElementById('play-again-btn')?.addEventListener('click', () => {
  location.reload();
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init().catch(console.error);
