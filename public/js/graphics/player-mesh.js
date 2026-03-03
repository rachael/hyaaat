/**
 * graphics/player-mesh.js — player visual factory
 *
 * SWAP THIS FILE to change player visuals. The rest of the game only calls
 * createPlayerMesh() and then moves/rotates the returned Object3D. No game
 * logic depends on the internals of the mesh.
 *
 * Returns a THREE.Group with:
 *   .setColor(hexColor)   — tint the mesh (called on spawn, not every frame)
 *   .setWindup(fraction)  — 0–1, charge aura intensity
 *   .setRolling(bool)     — toggle roll pose
 *
 * Visual style: N64/OOT low-poly humanoid. See CLAUDE.md §Graphics aesthetic
 * for the full aesthetic spec and do/don't list.
 *
 * Structure (all measurements in Three.js units, y=0 is ground):
 *   torso    BoxGeometry — center of mass
 *   head     SphereGeometry(8,6) — slightly large, chibi ratio
 *   leftArm  BoxGeometry — shoulder-hung
 *   rightArm BoxGeometry
 *   leftLeg  BoxGeometry
 *   rightLeg BoxGeometry
 *   nose     BoxGeometry — direction indicator nub on face
 *   aura     TorusGeometry — windup charge ring, normally invisible
 */

import * as THREE from 'three';

// ── Toon gradient map ────────────────────────────────────────────────────────
// 2-tone: dark shadow band + bright lit band. NearestFilter = hard edge.
// Built once at module load, shared across all player materials.
function makeToonGradient() {
  // RGBA: [shadow pixel, lit pixel]
  const data = new Uint8Array([72, 72, 80, 255,  255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
const GRADIENT_MAP = makeToonGradient();

// ── Proportions ──────────────────────────────────────────────────────────────
// Slightly chibi — head bigger relative to body than realism, like OOT.
const HEAD_R   = 0.30;
const TORSO_W  = 0.52;
const TORSO_H  = 0.60;
const TORSO_D  = 0.28;
const TORSO_Y  = 0.60;   // bottom of torso above ground
const ARM_W    = 0.14;
const ARM_H    = 0.44;
const ARM_D    = 0.14;
const LEG_W    = 0.17;
const LEG_H    = 0.56;
const LEG_D    = 0.17;

function toon(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT_MAP });
}

export function createPlayerMesh(options = {}) {
  const group = new THREE.Group();

  const bodyMat = toon(options.color ?? 0x4488ff);
  const skinMat = toon(0xf0c090);  // fixed skin color
  const noseMat = toon(0xcc8866);

  // ── Torso ──────────────────────────────────────────────────────────────────
  const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D), bodyMat);
  torso.position.y = TORSO_Y + TORSO_H / 2;
  torso.castShadow = true;

  // ── Head — 8×6 sphere segments gives OOT-style faceted look ───────────────
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 8, 6), skinMat);
  head.position.y = TORSO_Y + TORSO_H + HEAD_R * 1.05;
  head.castShadow = true;

  // ── Arms ───────────────────────────────────────────────────────────────────
  const armGeo = new THREE.BoxGeometry(ARM_W, ARM_H, ARM_D);
  const armY   = TORSO_Y + TORSO_H - ARM_H / 2 - 0.04;
  const armX   = TORSO_W / 2 + ARM_W / 2 + 0.01;

  const leftArm  = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.set(-armX, armY, 0);
  leftArm.castShadow = true;

  const rightArm = new THREE.Mesh(armGeo, bodyMat);
  rightArm.position.set(armX, armY, 0);
  rightArm.castShadow = true;

  // ── Legs ───────────────────────────────────────────────────────────────────
  const legGeo = new THREE.BoxGeometry(LEG_W, LEG_H, LEG_D);
  const legY   = LEG_H / 2;

  const leftLeg  = new THREE.Mesh(legGeo, bodyMat);
  leftLeg.position.set(-TORSO_W / 4, legY, 0);
  leftLeg.castShadow = true;

  const rightLeg = new THREE.Mesh(legGeo, bodyMat);
  rightLeg.position.set(TORSO_W / 4, legY, 0);
  rightLeg.castShadow = true;

  // ── Nose nub — direction indicator on face ─────────────────────────────────
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.10), noseMat);
  nose.position.set(0, head.position.y, HEAD_R + 0.04);

  // ── Windup aura ────────────────────────────────────────────────────────────
  const auraMat = new THREE.MeshBasicMaterial({
    color: 0xffdd00,
    transparent: true,
    opacity: 0,
  });
  const aura = new THREE.Mesh(new THREE.TorusGeometry(TORSO_W * 0.8, 0.05, 8, 24), auraMat);
  aura.rotation.x = Math.PI / 2;
  aura.position.y = TORSO_Y + TORSO_H * 0.5;

  group.add(torso, head, leftArm, rightArm, leftLeg, rightLeg, nose, aura);

  // Refs for animation methods
  group.userData._torso    = torso;
  group.userData._head     = head;
  group.userData._leftLeg  = leftLeg;
  group.userData._rightLeg = rightLeg;
  group.userData._auraMat  = auraMat;
  group.userData._aura     = aura;
  group.userData._bodyMat  = bodyMat;

  // ── API ────────────────────────────────────────────────────────────────────

  group.setColor = (hex) => {
    bodyMat.color.setHex(hex);
  };

  group.setWindup = (fraction) => {
    auraMat.opacity = fraction * 0.85;
    aura.scale.setScalar(1 + fraction * 0.3);
  };

  group.setRolling = (isRolling) => {
    // Tuck: lean torso forward, compress legs up
    torso.rotation.x  = isRolling ? 0.6 : 0;
    head.position.y   = isRolling
      ? TORSO_Y + TORSO_H + HEAD_R * 0.5
      : TORSO_Y + TORSO_H + HEAD_R * 1.05;
    leftLeg.rotation.x  = isRolling ? -0.5 : 0;
    rightLeg.rotation.x = isRolling ? -0.5 : 0;
  };

  return group;
}
