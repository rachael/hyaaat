/**
 * graphics/arena.js — arena environment factory
 *
 * SWAP THIS FILE to change the arena look. Game logic only calls createArena()
 * and uses ARENA_RADIUS constant for boundary checks. Nothing else.
 *
 * Returns { scene: THREE.Group, ARENA_RADIUS: number }
 *
 * TODO: Replace placeholder geometry with real environment assets.
 *   Keep ARENA_RADIUS in sync with whatever the actual playable floor size is.
 */

import * as THREE from 'three';

export const ARENA_RADIUS = 12; // playable floor radius in Three.js units

export function createArena() {
  const group = new THREE.Group();

  // ── Floor ──────────────────────────────────────────────────────────────────
  const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS, 48);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ── Grid overlay (gives scale reference, easy to remove) ──────────────────
  const gridHelper = new THREE.GridHelper(ARENA_RADIUS * 2, 12, 0x444466, 0x333355);
  gridHelper.position.y = 0.01;
  group.add(gridHelper);

  // ── Low boundary wall ──────────────────────────────────────────────────────
  const wallSegments = 24;
  const wallHeight = 0.5;
  const wallGeo = new THREE.CylinderGeometry(
    ARENA_RADIUS + 0.1,
    ARENA_RADIUS + 0.1,
    wallHeight,
    wallSegments,
    1,
    true, // open-ended cylinder = just the wall
  );
  const wallMat = new THREE.MeshLambertMaterial({
    color: 0x334455,
    side: THREE.BackSide, // render inside face so it's visible from inside
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = wallHeight / 2;
  group.add(wall);

  // ── Lighting ───────────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0x404060, 0.8);
  group.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 12, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 60;
  dirLight.shadow.camera.left = -ARENA_RADIUS * 1.5;
  dirLight.shadow.camera.right = ARENA_RADIUS * 1.5;
  dirLight.shadow.camera.top = ARENA_RADIUS * 1.5;
  dirLight.shadow.camera.bottom = -ARENA_RADIUS * 1.5;
  group.add(dirLight);

  // Subtle fill from below to reduce harsh shadow on players
  const fillLight = new THREE.HemisphereLight(0x8899bb, 0x221133, 0.4);
  group.add(fillLight);

  return { scene: group, ARENA_RADIUS };
}
