/**
 * graphics/effects.js — one-shot visual feedback effects
 *
 * All effects are fire-and-forget: call the function, pass the scene,
 * the effect cleans itself up automatically.
 *
 * Exported functions:
 *   spawnHitEffect(scene, position, damage)  — damage number + flash
 *   spawnHupTrail(scene, position)           — brief speed trail on HUP roll
 *   spawnWindupRelease(scene, position)      — shockwave ring on windup release
 *
 * TODO: Replace with particle systems or sprite sheets for more visual polish.
 *   All functions have the same signature so they're drop-in replaceable.
 */

import * as THREE from 'three';

const _clock = { now: () => performance.now() };

/** Flash ring at hit position, fades out over 300ms */
export function spawnHitEffect(scene, position, damage) {
  const size = 0.3 + Math.min(damage / 150, 1) * 0.8; // scale with damage
  const geo = new THREE.RingGeometry(size * 0.5, size, 12);
  const mat = new THREE.MeshBasicMaterial({
    color: damage > 100 ? 0xff4400 : 0xffcc00,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  ring.position.y = 0.5;
  scene.add(ring);

  const start = _clock.now();
  const duration = 300;

  function tick() {
    const t = (_clock.now() - start) / duration;
    if (t >= 1) { scene.remove(ring); geo.dispose(); mat.dispose(); return; }
    mat.opacity = 1 - t;
    ring.scale.setScalar(1 + t * 1.5);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/** Brief cyan streak at position, fades over 200ms */
export function spawnHupTrail(scene, position) {
  const geo = new THREE.SphereGeometry(0.25, 6, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc,
    transparent: true,
    opacity: 0.7,
  });
  const orb = new THREE.Mesh(geo, mat);
  orb.position.copy(position);
  orb.position.y = 0.8;
  scene.add(orb);

  const start = _clock.now();
  const duration = 200;

  function tick() {
    const t = (_clock.now() - start) / duration;
    if (t >= 1) { scene.remove(orb); geo.dispose(); mat.dispose(); return; }
    mat.opacity = 0.7 * (1 - t);
    orb.scale.setScalar(1 + t * 0.5);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/** Expanding shockwave ring on windup release */
export function spawnWindupRelease(scene, position) {
  const geo = new THREE.RingGeometry(0.1, 0.5, 20);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffdd00,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  ring.position.y = 0.05;
  scene.add(ring);

  const start = _clock.now();
  const duration = 500;

  function tick() {
    const t = (_clock.now() - start) / duration;
    if (t >= 1) { scene.remove(ring); geo.dispose(); mat.dispose(); return; }
    mat.opacity = 1 - t;
    ring.scale.setScalar(1 + t * 5);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
