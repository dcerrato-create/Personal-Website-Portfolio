/* Crossy Road — David's Version
 * Static page, no build step: Three.js is loaded from a CDN in index.html.
 * World axes: +x is right, -z is forward. Row i sits at z = -i, column c at x = c.
 */
(() => {
'use strict';

if (typeof THREE === 'undefined') {
  document.getElementById('error').hidden = false;
  return;
}

// ---------- Tunables ----------
// Layout. setMode() widens these from the difficulty's `size`; the camera zoom stays the same.
let playHalf = 4;    // playable columns are -playHalf..playHalf
let worldHalf = 13;  // rows are drawn this wide so their ends stay off screen
let wrap = 17;       // vehicles and logs loop around past this x
const ROWS_AHEAD = 24;
const ROWS_BEHIND = 10;
const HOP_TIME = 0.14;        // seconds per hop
const HOP_HEIGHT = 0.45;
const PLAYER_HALF = 0.28;     // half-width of the chicken's hitbox
const EAGLE_GAP = 3;          // rows the camera can pull ahead before the eagle strikes
const TRAIN_SPEED = 26;
const BEST_KEY = 'crossy-davids-version-best';
const MODE_KEY = 'crossy-davids-version-mode';
const CHARACTER_KEY = 'crossy-davids-version-character';

// Difficulty multipliers. traffic/river/train/chase scale speeds (train also scales how often
// trains come, chase is the eagle or alien), trees scales how many trees block the grass rows.
// `colors` overrides the base palette, `light` sets the scene lighting.
const MODES = {
  normal: {
    label: 'Normal', face: 'happy', color: '#3fb24a', dark: '#22752b',
    traffic: 1, river: 1, train: 1, chase: 1, trees: 1,
    size: 1,              // playable width and camera view: 9 columns
    light: { sky: 0xffffff, ground: 0x6d8a5a, hemi: 0.6, sun: 0xffffff, sunIntensity: 0.75 },
  },
  hard: {
    label: 'Hard', face: 'angry', color: '#e8483b', dark: '#9e2a21',
    traffic: 1.5, river: 1.5, train: 1.5, chase: 1.5, trees: 1.5,
    size: 1.5,            // 13 columns
    vehicle: 'race',     // road traffic is race cars, with kerbs where the track meets other rows
    waterStreaks: true,  // foam streaks rush across rivers
    light: { sky: 0xffe2dc, ground: 0x2a0d0d, hemi: 0.45, sun: 0xffe6d8, sunIntensity: 0.62 },
    colors: {
      bg: 0x3a0f0f,
      grassA: 0xb3302a, grassB: 0xa02924,
      road: 0x26282e, stripe: 0xf2c230,
      water: 0x1f6fa8, foam: 0x9fd8ff,
      gravel: 0x4f4642, sleeper: 0x35241a, rail: 0x9ca3ad, signal: 0x1e1e24,
      trunk: 0x2a1c16, leaves: [0x3b1411, 0x4d1a15, 0x2b0f0d],
      log: 0x5a3822, logEnd: 0x8c6242,
      cars: [0xffd400, 0x00c2ff, 0xff6a00, 0xf5f5f5, 0x7cff3a, 0xff2d95],
      eagle: 0xc62828, eagleHead: 0xff5a4f,
    },
  },
  extreme: {
    label: 'Extreme', face: 'furious', color: '#8e3bd9', dark: '#56208c',
    traffic: 2, river: 2, train: 2, trees: 2,
    size: 2,              // 19 columns
    chase: 3,             // x2 like everything else, then 50% faster because the alien can be outrun
    vehicle: 'wasteland', // armoured apocalypse cars and war rigs
    lava: true,           // rivers are lava and the logs are metal blocks
    rocks: true,          // trees become rocks studded with glowing crystals
    waterStreaks: true,
    meteors: true,        // meteorites rain down on marked cells
    chaser: 'alien',      // an alien stalks the player instead of the eagle
    light: { sky: 0xe6d8ff, ground: 0x1a0610, hemi: 0.5, sun: 0xffe0cc, sunIntensity: 0.55 },
    colors: {
      bg: 0x1a0b24,
      grassA: 0x3b2350, grassB: 0x34204a,
      road: 0x1c1820, stripe: 0xff6a1a,
      lava: 0xff4d10, foam: 0xffb020, bubble: 0xffd84a,
      gravel: 0x2a2130, sleeper: 0x160f14, rail: 0x7c7f8a, signal: 0x0f0c12,
      leaves: [0x2a1d36, 0x24182f, 0x31213f], crystals: [0xff4fd8, 0xb34dff, 0x5ae0ff],
      cars: [0x7a4a2a, 0x5e5a4f, 0x6b3a2e, 0x4f5560, 0x8a6a3a],
      trains: [0x4a2f5e, 0x3a3440], trainCar: 0x2e2a36, glass: 0x3a0d12,
    },
    causes: { water: 'Melted in the lava', car: 'Run over by wasteland raiders' },
  },
};
let modeId = 'normal';
let mode = MODES.normal;

const BASE_COLORS = {
  bg: 0x9ad351,
  grassA: 0xa5e05b, grassB: 0x9ad351,
  road: 0x4a4e5c, stripe: 0xe9e9e9,
  water: 0x5ccfff,
  gravel: 0x8f857c, sleeper: 0x6b4a33, rail: 0xc2c6ce, signal: 0x3b3b44,
  trunk: 0x7a5230, leaves: [0x5fb13c, 0x6cc24a, 0x4f9e35],
  log: 0x8a5a36, logEnd: 0xc9955f,
  cars: [0xe8483b, 0xf6b93b, 0x3c8ce7, 0x9b59b6, 0x2ecc71, 0xff7eb3],
  cabin: 0xf4f4f4, glass: 0x2b3440, tire: 0x222222, headlight: 0xfff3b0,
  trains: [0xd63c3c, 0x3d6fd6], trainCar: 0xe8e3d6,
  white: 0xffffff, wing: 0xececec, red: 0xe63b2e, orange: 0xf5a524, black: 0x111111,
  eagle: 0x6b4a2e, eagleHead: 0xffffff,
  foam: 0xcfeeff, kerb: [0xe8e8e8, 0xd62828],
};
let C = BASE_COLORS; // active palette; setMode() swaps in a difficulty's colours

// ---------- Helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const difficulty = i => clamp(i / 180, 0, 1);
const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();

function approachAngle(cur, target, k) {
  const TAU = Math.PI * 2;
  const diff = ((target - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return cur + diff * k;
}

// Geometry and materials are shared between every block of the same size/colour.
const geoCache = new Map();
const matCache = new Map();
function boxGeometry(w, h, d) {
  const gk = `${w}|${h}|${d}`;
  let geo = geoCache.get(gk);
  if (!geo) { geo = new THREE.BoxGeometry(w, h, d); geoCache.set(gk, geo); }
  return geo;
}
function box(w, h, d, color, { cast = true, receive = false } = {}) {
  let mat = matCache.get(color);
  if (!mat) { mat = new THREE.MeshLambertMaterial({ color }); matCache.set(color, mat); }
  const mesh = new THREE.Mesh(boxGeometry(w, h, d), mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}
// Unlit block for things that glow (lava, fire, crystals, eyes).
const glowCache = new Map();
function glowBox(w, h, d, color) {
  let mat = glowCache.get(color);
  if (!mat) { mat = new THREE.MeshBasicMaterial({ color }); glowCache.set(color, mat); }
  return new THREE.Mesh(boxGeometry(w, h, d), mat);
}
function place(parent, obj, x, y, z) {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}

// ---------- Renderer, scene, camera, lights ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);

const world = new THREE.Group();
scene.add(world);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const CAM_OFFSET = new THREE.Vector3(1.8, 14, 8.5);
const focus = new THREE.Vector3();
let focusAhead = 2; // how many rows ahead of the chicken the camera centres; scales with screen height

const hemi = new THREE.HemisphereLight(0xffffff, 0x6d8a5a, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.75);
const SUN_OFFSET = new THREE.Vector3(-6, 16, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 50 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  let viewH = 9.5;
  let viewW = viewH * aspect;
  if (viewW < 9.8) { viewW = 9.8; viewH = viewW / aspect; } // keep Normal's 9 columns visible on phones
  camera.left = -viewW / 2;
  camera.right = viewW / 2;
  camera.top = viewH / 2;
  camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  focusAhead = viewH * 0.22;
}
window.addEventListener('resize', resize);
resize();

// ---------- Models (all built facing +x for vehicles, -z for animals) ----------
function makeChicken() {
  const g = new THREE.Group();
  place(g, box(0.56, 0.62, 0.56, C.white), 0, 0.46, 0.02);
  place(g, box(0.3, 0.2, 0.14, C.white), 0, 0.62, 0.33);
  place(g, box(0.08, 0.26, 0.32, C.wing), 0.32, 0.45, 0.05);
  place(g, box(0.08, 0.26, 0.32, C.wing), -0.32, 0.45, 0.05);
  place(g, box(0.12, 0.16, 0.26, C.red), 0, 0.85, -0.02);
  place(g, box(0.16, 0.12, 0.16, C.orange), 0, 0.62, -0.36);
  place(g, box(0.1, 0.12, 0.06, C.red), 0, 0.5, -0.31);
  place(g, box(0.04, 0.08, 0.08, C.black, { cast: false }), 0.285, 0.66, -0.12);
  place(g, box(0.04, 0.08, 0.08, C.black, { cast: false }), -0.285, 0.66, -0.12);
  place(g, box(0.08, 0.15, 0.08, C.orange), 0.13, 0.075, 0);
  place(g, box(0.08, 0.15, 0.08, C.orange), -0.13, 0.075, 0);
  return g;
}

// ---------- Honduran characters (same footprint and hitbox as the chicken) ----------
function makeLempira() {
  const g = new THREE.Group();
  const skin = 0xa8683a, hair = 0x1a1410, fur = 0xe8d9b5, leather = 0x6b3f22, gold = 0xd4a017, jade = 0x2ec4a0;
  const feathers = [0xe0242b, 0x1f6fe0, 0xffd21f, 0x2fa84f];
  for (const s of [-1, 1]) {
    place(g, box(0.13, 0.36, 0.15, skin), s * 0.09, 0.2, 0);             // legs
    place(g, box(0.15, 0.07, 0.17, fur), s * 0.09, 0.26, 0);             // knee wraps
    place(g, box(0.15, 0.06, 0.2, leather), s * 0.09, 0.03, -0.02);      // sandals
  }
  place(g, box(0.36, 0.2, 0.24, fur), 0, 0.44, 0);                       // fur loincloth
  place(g, box(0.18, 0.18, 0.04, leather), 0, 0.33, -0.13);              // front flap
  place(g, box(0.38, 0.05, 0.26, leather), 0, 0.53, 0);                  // belt
  place(g, box(0.34, 0.3, 0.2, skin), 0, 0.7, 0);                        // bare chest
  place(g, box(0.3, 0.04, 0.22, 0xf0e6cc, { cast: false }), 0, 0.82, -0.005); // bone necklace
  place(g, box(0.07, 0.07, 0.03, jade, { cast: false }), 0, 0.77, -0.11);     // jade pendant
  for (const s of [-1, 1]) {
    place(g, box(0.1, 0.32, 0.12, skin), s * 0.23, 0.68, 0);             // arms
    place(g, box(0.12, 0.08, 0.14, leather), s * 0.23, 0.58, 0);         // bracers
    place(g, box(0.12, 0.06, 0.14, gold), s * 0.23, 0.8, 0);             // arm bands
  }
  place(g, box(0.26, 0.26, 0.24, skin), 0, 0.99, 0);                     // head
  place(g, box(0.28, 0.1, 0.26, hair), 0, 1.1, 0.01);
  place(g, box(0.28, 0.4, 0.07, hair), 0, 0.9, 0.13);                    // long hair down the back
  for (const s of [-1, 1]) place(g, box(0.05, 0.05, 0.02, 0x111111, { cast: false }), s * 0.06, 1.01, -0.125);
  place(g, box(0.22, 0.035, 0.02, 0xc62828, { cast: false }), 0, 0.95, -0.125); // war paint
  place(g, box(0.3, 0.07, 0.28, gold), 0, 1.07, 0);                      // headband
  place(g, box(0.07, 0.07, 0.03, jade, { cast: false }), 0, 1.07, -0.15);
  for (let k = 0; k < 7; k++) {                                          // feather crown
    const x = (k - 3) * 0.055;
    const h = 0.34 - Math.abs(k - 3) * 0.05;
    place(g, box(0.05, h, 0.03, feathers[k % 4]), x, 1.1 + h / 2, 0.08).rotation.z = -x * 2.2;
  }
  place(g, box(0.035, 1.35, 0.035, 0x7a5230), 0.3, 0.72, -0.04);         // spear
  place(g, box(0.07, 0.16, 0.04, 0x2b2b33), 0.3, 1.47, -0.04);           // obsidian point
  place(g, box(0.05, 0.1, 0.03, 0xe0242b, { cast: false }), 0.33, 1.34, -0.04);
  return g;
}

function makeDeer() {
  const g = new THREE.Group();
  const coat = 0xa8703a, dark = 0x7a4f2a, cream = 0xf3ede2, white = 0xffffff, antler = 0xe0cfa2, hoof = 0x1e1712;
  place(g, box(0.36, 0.3, 0.7, coat), 0, 0.6, 0.06);                     // body
  place(g, box(0.3, 0.06, 0.5, cream), 0, 0.44, 0.06);                   // belly
  for (const x of [-0.12, 0.12]) for (const z of [-0.2, 0.32]) {
    place(g, box(0.08, 0.44, 0.08, dark), x, 0.22, z);
    place(g, box(0.09, 0.05, 0.09, hoof), x, 0.025, z);
  }
  place(g, box(0.18, 0.3, 0.18, coat), 0, 0.84, -0.26);                  // neck
  place(g, box(0.14, 0.12, 0.02, cream, { cast: false }), 0, 0.8, -0.355);
  place(g, box(0.22, 0.2, 0.28, coat), 0, 1.02, -0.38);                  // head
  place(g, box(0.14, 0.12, 0.14, 0xc49060), 0, 0.98, -0.58);             // snout
  place(g, box(0.145, 0.04, 0.1, white, { cast: false }), 0, 0.93, -0.58);
  place(g, box(0.08, 0.06, 0.03, hoof, { cast: false }), 0, 1.01, -0.655);
  for (const s of [-1, 1]) {
    place(g, box(0.03, 0.05, 0.05, 0x111111, { cast: false }), s * 0.115, 1.06, -0.43);
    place(g, box(0.06, 0.16, 0.1, coat), s * 0.15, 1.16, -0.3).rotation.z = -s * 0.6; // ears
    place(g, box(0.04, 0.16, 0.04, antler), s * 0.07, 1.19, -0.36);      // antlers
    place(g, box(0.2, 0.04, 0.04, antler), s * 0.16, 1.27, -0.36);
    place(g, box(0.04, 0.12, 0.04, antler), s * 0.13, 1.35, -0.36);
    place(g, box(0.04, 0.14, 0.04, antler), s * 0.24, 1.36, -0.36);
    place(g, box(0.04, 0.04, 0.12, antler), s * 0.26, 1.27, -0.44);
  }
  place(g, box(0.3, 0.22, 0.03, white, { cast: false }), 0, 0.58, 0.42); // white rump
  // The signature white tail, raised like a flag so the camera behind sees it.
  const tail = place(g, new THREE.Group(), 0, 0.7, 0.42);
  place(tail, box(0.16, 0.34, 0.05, coat), 0, 0.17, 0);
  place(tail, glowBox(0.24, 0.38, 0.1, white), 0, 0.19, 0.07);             // unlit, so it stays bright white
  place(tail, glowBox(0.18, 0.08, 0.08, white), 0, 0.4, 0.06);
  g.userData.tail = tail;
  return g;
}

function makeMacaw() {
  const g = new THREE.Group();
  const red = 0xe3262c, yellow = 0xffcc1a, green = 0x2fa84f, blue = 0x1e5fd6, ivory = 0xefe3c8;
  for (const s of [-1, 1]) place(g, box(0.08, 0.08, 0.12, 0x3a3a3a), s * 0.08, 0.04, -0.02);
  place(g, box(0.34, 0.42, 0.34, red), 0, 0.42, 0.02);                   // body
  place(g, box(0.3, 0.1, 0.06, blue), 0, 0.28, 0.2);                     // blue rump
  place(g, box(0.3, 0.28, 0.3, red), 0, 0.76, -0.04);                    // head
  for (const s of [-1, 1]) {
    place(g, box(0.02, 0.14, 0.16, 0xf5efe6, { cast: false }), s * 0.155, 0.75, -0.1); // bare white face
    place(g, box(0.025, 0.05, 0.05, 0x111111, { cast: false }), s * 0.168, 0.8, -0.1);
  }
  place(g, box(0.14, 0.12, 0.14, ivory), 0, 0.74, -0.25);                // upper beak
  place(g, box(0.08, 0.08, 0.07, ivory), 0, 0.67, -0.3);                 // hooked tip
  place(g, box(0.1, 0.06, 0.08, 0x222222), 0, 0.65, -0.21);              // lower beak
  // Folded wings: red shoulder, yellow band, green edge, blue flight feathers.
  const wings = [-1, 1].map(s => {
    const wing = place(g, new THREE.Group(), s * 0.19, 0.6, 0.02);
    wing.userData.side = s;
    place(wing, box(0.08, 0.14, 0.3, red), 0, -0.05, 0);
    place(wing, box(0.085, 0.1, 0.31, yellow), 0, -0.16, 0.01);
    place(wing, box(0.085, 0.05, 0.31, green), 0, -0.235, 0.01);
    place(wing, box(0.08, 0.16, 0.36, blue), 0, -0.34, 0.05);
    return wing;
  });
  const tail = place(g, new THREE.Group(), 0, 0.32, 0.16);               // long tail sweeping back
  tail.rotation.x = 0.55;
  place(tail, box(0.12, 0.04, 0.55, red), 0, 0, 0.27);
  place(tail, box(0.121, 0.041, 0.14, blue), 0, 0, 0.48);
  for (const s of [-1, 1]) place(tail, box(0.06, 0.035, 0.42, blue), s * 0.09, 0, 0.2);
  g.userData.wings = wings;
  return g;
}

// `bits` are the colours of the splash when the character is hit; `turn` angles the card portrait.
const CHARACTERS = {
  chicken: { name: 'The Chicken', desc: 'The Original Chicken', build: makeChicken, bits: [0xffffff, 0xffffff, 0xe63b2e] },
  lempira: { name: 'Indio Lempira', desc: 'Honduras Historic Warrior', build: makeLempira, bits: [0xa8683a, 0xe0242b, 0x1f6fe0, 0xd4a017] },
  deer: {
    name: 'White Tailed Deer', desc: 'Honduras National Mammal', build: makeDeer, bits: [0xa8703a, 0xffffff, 0xffffff],
    turn: Math.PI / 2 - 0.35, // side-rear view so the white tail shows
  },
  macaw: {
    name: 'Scarlet Macaw', desc: 'Honduras National Bird', build: makeMacaw, bits: [0xe3262c, 0xffcc1a, 0x1e5fd6, 0x2fa84f],
    turn: Math.PI + 1.1,      // turned so the long tail and wing colours show
  },
};

function makeCar() {
  const g = new THREE.Group();
  const color = pick(C.cars);
  place(g, box(1.5, 0.5, 0.85, color), 0, 0.4, 0);
  place(g, box(0.8, 0.42, 0.75, C.cabin), -0.1, 0.86, 0);
  place(g, box(0.82, 0.18, 0.77, C.glass, { cast: false }), -0.1, 0.9, 0);
  place(g, box(0.06, 0.12, 0.2, C.headlight, { cast: false }), 0.76, 0.45, 0.25);
  place(g, box(0.06, 0.12, 0.2, C.headlight, { cast: false }), 0.76, 0.45, -0.25);
  for (const x of [-0.45, 0.45]) for (const z of [-0.43, 0.43]) {
    place(g, box(0.3, 0.3, 0.12, C.tire, { cast: false }), x, 0.15, z);
  }
  return { mesh: g, len: 1.5 };
}

function makeTruck() {
  const g = new THREE.Group();
  const color = pick(C.cars);
  place(g, box(0.7, 0.8, 0.85, color), 0.95, 0.55, 0);
  place(g, box(0.72, 0.25, 0.87, C.glass, { cast: false }), 0.95, 0.8, 0);
  place(g, box(1.8, 1.05, 0.9, C.cabin), -0.35, 0.68, 0);
  for (const x of [-0.9, 0.1, 0.95]) for (const z of [-0.45, 0.45]) {
    place(g, box(0.32, 0.32, 0.12, C.tire, { cast: false }), x, 0.16, z);
  }
  return { mesh: g, len: 2.6 };
}

function makeRaceCar() {
  const g = new THREE.Group();
  const color = pick(C.cars);
  const accent = color === 0xf5f5f5 ? C.black : C.white;
  place(g, box(1.3, 0.28, 0.72, color), -0.1, 0.26, 0);                  // low body
  place(g, box(0.42, 0.18, 0.56, color), 0.64, 0.21, 0);                 // nose
  place(g, box(1.3, 0.02, 0.16, accent, { cast: false }), -0.1, 0.41, 0); // racing stripe
  place(g, box(0.55, 0.2, 0.46, C.glass), -0.12, 0.5, 0);                // cockpit
  place(g, box(0.28, 0.16, 0.02, accent, { cast: false }), 0.1, 0.27, 0.37);  // number panels
  place(g, box(0.28, 0.16, 0.02, accent, { cast: false }), 0.1, 0.27, -0.37);
  for (const z of [-0.26, 0.26]) place(g, box(0.06, 0.26, 0.06, C.tire), -0.72, 0.5, z);
  place(g, box(0.26, 0.06, 0.92, accent), -0.76, 0.64, 0);               // rear wing
  for (const x of [-0.52, 0.5]) for (const z of [-0.44, 0.44]) {
    place(g, box(0.36, 0.32, 0.16, C.tire, { cast: false }), x, 0.16, z); // open wheels
  }
  return { mesh: g, len: 1.7 };
}

function makeLog(len) {
  const g = new THREE.Group();
  place(g, box(len - 0.1, 0.3, 0.78, C.log, { receive: true }), 0, -0.13, 0);
  place(g, box(0.08, 0.26, 0.7, C.logEnd, { cast: false }), len / 2 - 0.07, -0.13, 0);
  place(g, box(0.08, 0.26, 0.7, C.logEnd, { cast: false }), -len / 2 + 0.07, -0.13, 0);
  return { mesh: g, len };
}

function makeTrain() {
  const g = new THREE.Group();
  const cars = randInt(3, 5);
  const unit = 3.1;
  const len = cars * unit;
  const engineColor = pick(C.trains);
  for (let k = 0; k < cars; k++) {
    const cx = -len / 2 + unit / 2 + k * unit;
    const color = k === cars - 1 ? engineColor : C.trainCar;
    place(g, box(2.9, 0.95, 0.9, color), cx, 0.62, 0);
    place(g, box(2.9, 0.1, 0.96, shade(color, 0.7)), cx, 1.14, 0);
    place(g, box(2.92, 0.22, 0.92, C.glass, { cast: false }), cx, 0.82, 0);
    place(g, box(0.5, 0.25, 0.95, C.tire, { cast: false }), cx - 0.9, 0.12, 0);
    place(g, box(0.5, 0.25, 0.95, C.tire, { cast: false }), cx + 0.9, 0.12, 0);
  }
  return { mesh: g, len: len - 0.2, x: 0 };
}

function makeEagle() {
  const g = new THREE.Group(); // faces +z, towards the camera
  place(g, box(0.5, 0.35, 0.9, C.eagle), 0, 0, 0);
  place(g, box(0.38, 0.32, 0.36, C.eagleHead), 0, 0.12, 0.55);
  place(g, box(0.14, 0.12, 0.2, C.orange), 0, 0.08, 0.8);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = place(g, new THREE.Group(), s * 0.25, 0.05, 0);
    place(pivot, box(1.1, 0.08, 0.55, shade(C.eagle, 0.85)), s * 0.55, 0, 0);
    wings.push(pivot);
  }
  g.userData.wings = wings;
  return g;
}

// ---------- Extreme mode models ----------
const WASTE = { metal: 0x3a3d44, bone: 0xd8d0bd, tire: 0x161616, fire: 0xff7a1a, eye: 0xff2a2a, cabin: 0x151318, hazard: 0xd4a017 };

function makeWastelandCar() {
  const g = new THREE.Group();
  const color = pick(C.cars);
  place(g, box(1.45, 0.45, 0.82, color), -0.05, 0.4, 0);
  place(g, box(0.5, 0.2, 0.84, shade(color, 0.7)), -0.4, 0.44, 0);  // mismatched armour panel
  place(g, box(0.6, 0.28, 0.66, WASTE.cabin), -0.1, 0.76, 0);
  for (const x of [-0.38, 0.18]) for (const z of [-0.3, 0.3]) {
    place(g, box(0.05, 0.36, 0.05, WASTE.metal), x, 0.8, z);        // roll cage
  }
  for (const z of [-0.3, 0.3]) place(g, box(0.62, 0.05, 0.05, WASTE.metal), -0.1, 0.98, z);
  place(g, box(0.14, 0.42, 0.92, WASTE.metal), 0.74, 0.36, 0);      // ram plate
  for (const z of [-0.3, 0, 0.3]) place(g, box(0.2, 0.07, 0.07, WASTE.bone), 0.9, 0.42, z);
  for (const z of [-0.24, 0.24]) place(g, glowBox(0.03, 0.06, 0.16, WASTE.eye), 0.82, 0.52, z);
  const flames = [];
  for (const z of [-0.22, 0.22]) {
    place(g, box(0.3, 0.09, 0.09, WASTE.metal), -0.82, 0.52, z);
    flames.push(place(g, glowBox(0.18, 0.1, 0.1, WASTE.fire), -1.02, 0.52, z));
  }
  for (const x of [-0.5, 0.45]) for (const z of [-0.45, 0.45]) {
    place(g, box(0.44, 0.44, 0.2, WASTE.tire, { cast: false }), x, 0.22, z);
  }
  g.userData.flames = flames;
  return { mesh: g, len: 1.8 };
}

function makeWarRig() {
  const g = new THREE.Group();
  const color = pick(C.cars);
  place(g, box(0.75, 0.72, 0.86, color), 1.0, 0.52, 0);             // cab
  place(g, box(0.5, 0.16, 0.88, WASTE.cabin), 1.05, 0.76, 0);
  place(g, box(0.14, 0.5, 0.94, WASTE.metal), 1.42, 0.4, 0);        // ram
  for (const z of [-0.32, 0, 0.32]) place(g, box(0.22, 0.07, 0.07, WASTE.bone), 1.58, 0.45, z);
  place(g, box(1.85, 0.78, 0.8, WASTE.metal), -0.4, 0.62, 0);       // fuel tank
  for (const x of [-0.9, 0.1]) place(g, box(0.14, 0.8, 0.82, WASTE.hazard), x, 0.62, 0);
  const flames = [];
  for (const z of [-0.2, 0.2]) {
    place(g, box(0.08, 0.5, 0.08, WASTE.metal), 0.66, 1.05, z);     // exhaust stacks
    flames.push(place(g, glowBox(0.1, 0.18, 0.1, WASTE.fire), 0.66, 1.38, z));
  }
  for (const x of [-1.0, -0.2, 1.0]) for (const z of [-0.45, 0.45]) {
    place(g, box(0.42, 0.42, 0.18, WASTE.tire, { cast: false }), x, 0.21, z);
  }
  g.userData.flames = flames;
  return { mesh: g, len: 2.8 };
}

function makeMetalBlock(len) {
  const g = new THREE.Group();
  place(g, box(len - 0.1, 0.3, 0.78, 0x6f7782, { receive: true }), 0, -0.13, 0);
  place(g, box(len - 0.3, 0.03, 0.6, 0x8e97a3, { cast: false, receive: true }), 0, 0.03, 0);
  for (const s of [-1, 1]) place(g, box(0.1, 0.32, 0.8, 0x3a3f47, { cast: false }), s * (len / 2 - 0.1), -0.12, 0);
  for (let k = 0; k < len; k++) for (const z of [-0.3, 0.3]) {
    place(g, box(0.06, 0.03, 0.06, 0x2f343b, { cast: false }), -len / 2 + 0.5 + k, 0.05, z); // rivets
  }
  place(g, glowBox(len - 0.1, 0.05, 0.8, WASTE.fire), 0, -0.29, 0); // red-hot underside at the lava line
  return { mesh: g, len };
}

function makeMeteor() {
  const g = new THREE.Group();
  place(g, box(0.7, 0.7, 0.7, 0x2b1d1a), 0, 0, 0);
  place(g, glowBox(0.3, 0.3, 0.74, WASTE.fire), 0.12, 0.1, 0);
  place(g, glowBox(0.74, 0.22, 0.28, 0xffc23a), 0, -0.14, 0.1);
  return g;
}

function makeAlien() {
  // Faces -z towards the chicken, so the camera mostly sees its back and the top of its head:
  // the glowing spine and crown of eyes are there so it reads as a monster from behind.
  const g = new THREE.Group();
  g.scale.setScalar(1.2);
  const skin = 0x46c45a;
  const dark = 0x2e8a3e;
  const spike = 0xff4fd8;
  place(g, box(1.5, 1.1, 1.0, skin), 0, 1.05, 0);
  place(g, box(1.1, 0.35, 0.8, dark), 0, 1.78, 0.05);
  place(g, box(1.0, 0.5, 0.04, 0x9be86a, { cast: false }), 0, 1.0, -0.51);
  place(g, glowBox(0.56, 0.44, 0.04, 0xfff35a), 0, 1.32, -0.52);         // big front eye
  const pupil = place(g, box(0.16, 0.34, 0.04, C.black, { cast: false }), 0, 1.32, -0.55);
  const mouth = place(g, new THREE.Group(), 0, 0.72, -0.52);
  place(mouth, box(0.9, 0.22, 0.04, 0x2a0a12, { cast: false }), 0, 0, 0);
  for (const x of [-0.3, -0.1, 0.1, 0.3]) place(mouth, box(0.1, 0.1, 0.04, C.white, { cast: false }), x, 0.06, -0.02);
  for (const x of [-0.3, 0, 0.3]) {
    place(g, glowBox(0.2, 0.12, 0.2, 0xfff35a), x, 2.0, -0.2);             // crown of eyes on top
    place(g, box(0.08, 0.04, 0.08, C.black, { cast: false }), x, 2.07, -0.24);
  }
  for (const z of [0.05, 0.3]) place(g, glowBox(0.14, 0.3, 0.14, spike), 0, 2.1, z); // head ridge
  for (const y of [1.45, 1.1, 0.75]) place(g, glowBox(0.18, 0.18, 0.3, spike), 0, y, 0.6); // spine
  for (const s of [-1, 1]) {
    place(g, box(0.06, 0.5, 0.06, dark), s * 0.5, 2.2, 0.2);               // antennae
    place(g, glowBox(0.16, 0.16, 0.16, spike), s * 0.5, 2.5, 0.2);
  }
  const arms = [-1, 1].map(s => {
    const arm = place(g, new THREE.Group(), s * 0.85, 1.3, 0);
    place(arm, box(0.26, 0.26, 0.9, skin), 0, 0, -0.4);
    for (const dx of [-0.08, 0.08]) place(arm, box(0.06, 0.06, 0.2, C.white, { cast: false }), dx, 0, -0.92);
    return arm;
  });
  const legs = [-0.5, -0.17, 0.17, 0.5].map(x => {
    const leg = place(g, new THREE.Group(), x, 0.55, 0);
    place(leg, box(0.22, 0.55, 0.22, dark), 0, -0.27, 0);
    return leg;
  });
  g.userData = { pupil, mouth, arms, legs };
  return g;
}

// ---------- Rows ----------
const rows = new Map();
let gen;       // row-type generator state, reset each run
let lastRow;   // highest row index built so far

function nextRowType(i) {
  if (i < 4) return 'grass';
  if (gen.runLeft <= 0) {
    if (gen.runType !== 'grass') {
      gen.runType = 'grass';
      gen.runLeft = Math.random() < 0.35 ? 2 : 1;
    } else {
      const d = difficulty(i);
      const r = Math.random();
      if (r < 0.5)       { gen.runType = 'road';  gen.runLeft = randInt(1, 2 + Math.round(d * 2)); }
      else if (r < 0.8)  { gen.runType = 'river'; gen.runLeft = randInt(1, 2 + Math.round(d)); }
      else               { gen.runType = 'rail';  gen.runLeft = randInt(1, 2); }
    }
  }
  gen.runLeft--;
  return gen.runType;
}

// A flat strip for the row: the playable middle is brighter than the edges.
function ground(row, color, top, glow = false) {
  const height = 0.6;
  const y = top - height / 2;
  const strip = (w, c) => (glow ? glowBox(w, height, 1, c) : box(w, height, 1, c, { cast: false, receive: true }));
  place(row.group, strip(playHalf * 2 + 1, color), 0, y, 0);
  const sideW = worldHalf - playHalf;
  const sx = playHalf + 0.5 + sideW / 2;
  const dark = shade(color, glow ? 0.6 : 0.8);
  place(row.group, strip(sideW, dark), sx, y, 0);
  place(row.group, strip(sideW, dark), -sx, y, 0);
}

function addTree(row, c) {
  const h = pick([0.7, 1.1, 1.5]);
  const t = new THREE.Group();
  if (mode.rocks) {
    place(t, box(0.84, h, 0.84, pick(C.leaves)), 0, h / 2, 0);
    if (Math.random() < 0.5) {
      place(t, glowBox(0.18, 0.34, 0.18, pick(C.crystals)), rand(-0.22, 0.22), h + 0.17, rand(-0.22, 0.22));
    }
  } else {
    place(t, box(0.32, 0.35, 0.32, C.trunk), 0, 0.175, 0);
    place(t, box(0.8, h, 0.8, pick(C.leaves)), 0, 0.35 + h / 2, 0);
  }
  place(row.group, t, c, 0, 0);
  if (Math.abs(c) <= playHalf) row.trees.add(c);
}

function buildGrass(row) {
  const i = row.index;
  ground(row, Math.abs(i) % 2 === 0 ? C.grassA : C.grassB, 0);
  const wall = i < 0;
  for (let c = playHalf + 1; c <= worldHalf; c++) {
    for (const s of [-1, 1]) if (wall || Math.random() < 0.4) addTree(row, s * c);
  }
  if (wall) {
    for (let c = -playHalf; c <= playHalf; c++) addTree(row, c);
    return;
  }
  // Trees never cover the columns between the last guaranteed-open column and the new one,
  // so a path through back-to-back grass rows always exists.
  const next = i < 2 ? 0 : clamp(gen.path + randInt(-2, 2), -playHalf, playHalf);
  const lo = Math.min(gen.path, next);
  const hi = Math.max(gen.path, next);
  gen.path = next;
  const chance = i < 4 ? 0.1 : lerp(0.15, 0.3, row.difficulty) * mode.trees;
  const maxTrees = Math.round(4 * mode.trees * mode.size);
  let count = 0;
  for (let c = -playHalf; c <= playHalf; c++) {
    if (c >= lo && c <= hi) continue;
    if (count < maxTrees && Math.random() < chance) { addTree(row, c); count++; }
  }
}

// Lay vehicles/logs around a loop so spacing stays constant when they wrap.
function fillLane(row, factory, gapMin, gapMax) {
  const items = [];
  let u = 0;
  for (;;) {
    const item = factory();
    if (items.length && u + item.len > wrap * 2) break;
    items.push({ ...item, u: u + item.len / 2 });
    u += item.len + rand(gapMin, gapMax);
  }
  row.loop = Math.max(u, wrap * 2);
  const shift = rand(0, row.loop);
  for (const it of items) {
    const x = ((it.u + shift) % row.loop) - row.loop / 2;
    it.mesh.rotation.y = row.dir > 0 ? 0 : Math.PI;
    place(row.group, it.mesh, x, 0, 0);
    row.movers.push({ mesh: it.mesh, len: it.len, x });
  }
}

function buildRoad(row, prev) {
  ground(row, C.road, -0.06);
  if (prev && prev.type === 'road') {
    for (let x = -worldHalf; x < worldHalf; x += 2) {
      place(row.group, box(0.8, 0.02, 0.08, C.stripe, { cast: false }), x + 0.5, -0.05, 0.5);
    }
  }
  const d = row.difficulty;
  row.dir = Math.random() < 0.5 ? 1 : -1;
  row.speed = lerp(1.6, 4.2, d) * rand(0.8, 1.2) * mode.traffic;
  const vehicles = {
    race: makeRaceCar,
    wasteland: () => (Math.random() < 0.3 ? makeWarRig() : makeWastelandCar()),
  };
  const vehicle = vehicles[mode.vehicle] || (() => (Math.random() < 0.3 ? makeTruck() : makeCar()));
  fillLane(row, vehicle, lerp(3.5, 2.2, d), lerp(7, 4.5, d));
}

function addKerb(row, z) {
  for (let x = -worldHalf; x <= worldHalf; x++) {
    place(row.group, box(1, 0.05, 0.12, C.kerb[(x + 100) % 2], { cast: false }), x, -0.035, z);
  }
}

function buildRiver(row, prev) {
  if (mode.lava) ground(row, C.lava, -0.3, true);
  else ground(row, C.water, -0.3);
  const d = row.difficulty;
  row.dir = prev && prev.type === 'river' ? -prev.dir : (Math.random() < 0.5 ? 1 : -1);
  row.speed = lerp(1.0, 2.2, d) * rand(0.85, 1.15) * mode.river;
  const float = mode.lava ? makeMetalBlock : makeLog;
  fillLane(row, () => float(randInt(2, d > 0.5 ? 3 : 4)), lerp(1.2, 2, d), lerp(2.6, 3.4, d));
  if (mode.waterStreaks) {
    row.streaks = [];
    for (let k = 0; k < 14; k++) {
      const x = rand(-wrap, wrap);
      const len = rand(0.5, 1.4);
      const streak = mode.lava ? glowBox(len, 0.02, 0.05, C.foam) : box(len, 0.02, 0.05, C.foam, { cast: false });
      place(row.group, streak, x, -0.29, rand(-0.38, 0.38));
      row.streaks.push({ mesh: streak, x });
    }
  }
  if (mode.lava) {
    row.bubbles = [];
    for (let k = 0; k < 5; k++) {
      const bubble = place(row.group, glowBox(0.16, 0.16, 0.16, C.bubble), rand(-playHalf - 5, playHalf + 5), -0.4, rand(-0.3, 0.3));
      row.bubbles.push({ mesh: bubble, phase: rand(0, Math.PI * 2), rate: rand(2, 4) });
    }
  }
}

function buildRail(row) {
  ground(row, C.gravel, -0.02);
  for (let x = -worldHalf; x <= worldHalf; x++) {
    place(row.group, box(0.22, 0.06, 0.9, C.sleeper, { cast: false, receive: true }), x, 0.01, 0);
  }
  for (const z of [-0.28, 0.28]) {
    place(row.group, box(worldHalf * 2 + 1, 0.08, 0.08, C.rail, { cast: false }), 0, 0.06, z);
  }
  // Warning signal on the left edge of the playable area.
  row.lamp = new THREE.MeshLambertMaterial({ color: 0x5a1a1a });
  const signal = place(row.group, new THREE.Group(), -(playHalf + 0.8), 0, 0.42);
  place(signal, box(0.1, 1.2, 0.1, C.signal), 0, 0.6, 0);
  place(signal, box(0.5, 0.26, 0.14, C.signal), 0, 1.2, 0);
  for (const x of [-0.13, 0.13]) {
    const lamp = new THREE.Mesh(boxGeometry(0.14, 0.14, 0.06), row.lamp);
    place(signal, lamp, x, 1.2, 0.08);
  }
  row.dir = Math.random() < 0.5 ? 1 : -1;
  row.train = makeTrain();
  row.train.mesh.visible = false;
  row.train.mesh.rotation.y = row.dir > 0 ? 0 : Math.PI;
  row.group.add(row.train.mesh);
  row.trainPhase = 'idle';
  row.trainTimer = rand(1.5, 5) / mode.train;
}

function addRow(i) {
  const type = i < 0 ? 'grass' : nextRowType(i);
  const row = {
    index: i, type, difficulty: difficulty(i),
    group: new THREE.Group(), trees: new Set(), movers: [],
    dir: 1, speed: 0, loop: 0,
  };
  row.group.position.z = -i;
  const prev = rows.get(i - 1);
  if (type === 'grass') buildGrass(row);
  else if (type === 'road') buildRoad(row, prev);
  else if (type === 'river') buildRiver(row, prev);
  else buildRail(row);
  if (mode.vehicle === 'race' && prev && (prev.type === 'road') !== (type === 'road')) {
    if (type === 'road') addKerb(row, 0.44);
    else addKerb(prev, -0.44);
  }
  world.add(row.group);
  rows.set(i, row);
  lastRow = i;
}

function removeRow(row) {
  world.remove(row.group);
  if (row.lamp) row.lamp.dispose();
  rows.delete(row.index);
}

function updateRow(row, dt) {
  if (row.type === 'road' || row.type === 'river') {
    const half = row.loop / 2;
    for (const m of row.movers) {
      m.x += row.dir * row.speed * dt;
      if (m.x > half) m.x -= row.loop;
      else if (m.x < -half) m.x += row.loop;
      m.mesh.position.x = m.x;
      const flames = m.mesh.userData.flames;
      if (flames) for (const f of flames) f.scale.setScalar(0.6 + Math.random() * 0.7);
    }
    if (row.streaks) {
      // Foam runs ahead of the logs so the current reads as fast.
      for (const s of row.streaks) {
        s.x += row.dir * row.speed * (mode.lava ? 1.4 : 2.2) * dt;
        if (s.x > wrap) s.x -= wrap * 2;
        else if (s.x < -wrap) s.x += wrap * 2;
        s.mesh.position.x = s.x;
      }
    }
    if (row.bubbles) {
      for (const b of row.bubbles) {
        b.phase += b.rate * dt;
        const pop = Math.max(0, Math.sin(b.phase));
        b.mesh.position.y = -0.4 + pop * 0.25;
        b.mesh.scale.setScalar(0.4 + pop * 0.8);
      }
    }
  } else if (row.type === 'rail') {
    const train = row.train;
    if (row.trainPhase === 'idle') {
      row.trainTimer -= dt;
      if (row.trainTimer <= 0) { row.trainPhase = 'warn'; row.trainTimer = 1.2; }
    } else if (row.trainPhase === 'warn') {
      row.trainTimer -= dt;
      if (row.trainTimer <= 0) {
        row.trainPhase = 'pass';
        train.x = -row.dir * (wrap + train.len / 2);
        train.mesh.visible = true;
        row.movers = [train];
      }
    } else {
      train.x += row.dir * TRAIN_SPEED * mode.train * dt;
      if (row.dir * train.x > wrap + train.len / 2) {
        row.trainPhase = 'idle';
        row.trainTimer = rand(3, 7) * lerp(1, 0.6, row.difficulty) / mode.train;
        train.mesh.visible = false;
        row.movers = [];
      }
    }
    train.mesh.position.x = train.x;
    const blinking = row.trainPhase !== 'idle' && Math.floor(performance.now() / 120) % 2 === 0;
    row.lamp.emissive.setHex(blinking ? 0xff2a2a : 0x000000);
  }
}

// ---------- Player ----------
const player = {
  mesh: makeChicken(),
  row: 0, x: 0, y: 0, z: 0,
  facing: 0,
  hop: null,       // { fromX, fromZ, fromY, toRow, toX, log, offset, t }
  log: null, logOffset: 0,
  maxRow: 0,
};
scene.add(player.mesh);

let eagle = makeEagle();
eagle.visible = false;
scene.add(eagle);

const alien = makeAlien();
alien.visible = false;
scene.add(alien);

function groundY(row) {
  if (!row) return 0;
  if (row.type === 'road') return -0.06;
  if (row.type === 'river') return 0.02;
  if (row.type === 'rail') return -0.02;
  return 0;
}

const FACING = { '0,1': 0, '0,-1': Math.PI, '-1,0': Math.PI / 2, '1,0': -Math.PI / 2 };

function tryMove(dx, dz) {
  player.facing = FACING[`${dx},${dz}`];
  const target = rows.get(player.row + dz);
  if (!target) return;

  let toX;
  let log = null;
  let offset = 0;

  if (target.type === 'river') {
    toX = player.x + dx;
    if (Math.abs(toX) > playHalf + 0.5) return;
    // Find the log that will be under the landing spot, and snap to one of its cells.
    for (const m of target.movers) {
      const landX = m.x + target.dir * target.speed * HOP_TIME;
      if (Math.abs(toX - landX) <= m.len / 2 + 0.15) {
        const edge = (m.len - 1) / 2;
        offset = clamp(Math.round(toX - landX + edge) - edge, -edge, edge);
        log = m;
        break;
      }
    }
  } else {
    toX = Math.round(player.x + dx);
    if (Math.abs(toX) > playHalf) return;
    if (target.trees.has(toX)) return;
  }

  player.hop = {
    fromX: player.x, fromZ: player.z, fromY: player.y,
    fromRow: player.row, toRow: target.index,
    toX, log, offset, t: 0,
  };
  player.log = null;
}

function stepHop(dt) {
  const h = player.hop;
  h.t = Math.min(1, h.t + dt / HOP_TIME);
  const tx = h.log ? h.log.x + h.offset : h.toX;
  player.x = lerp(h.fromX, tx, h.t);
  player.z = lerp(h.fromZ, -h.toRow, h.t);
  player.y = lerp(h.fromY, groundY(rows.get(h.toRow)), h.t) + Math.sin(Math.PI * h.t) * HOP_HEIGHT;
  const s = Math.sin(Math.PI * h.t);
  player.mesh.scale.set(1 - s * 0.08, 1 + s * 0.15, 1 - s * 0.08);
  if (h.t >= 1) land();
}

function land() {
  const h = player.hop;
  player.hop = null;
  player.row = h.toRow;
  player.z = -h.toRow;
  player.mesh.scale.set(1, 1, 1);
  const row = rows.get(player.row);

  if (player.row > player.maxRow) {
    player.maxRow = player.row;
    setScore(player.maxRow);
    ensureRows();
  }

  if (row.type === 'river') {
    if (h.log) {
      player.log = h.log;
      player.logOffset = h.offset;
      player.x = h.log.x + h.offset;
    } else {
      die('water');
      return;
    }
  }

  if (queued && state.phase === 'playing') {
    const [dx, dz] = queued;
    queued = null;
    tryMove(dx, dz);
  }
}

function currentHazardRow() {
  const h = player.hop;
  const idx = h ? (h.t < 0.5 ? h.fromRow : h.toRow) : player.row;
  return rows.get(idx);
}

function updatePlayer(dt) {
  if (state.phase === 'ready' || state.phase === 'playing') {
    if (player.hop) {
      stepHop(dt);
    } else if (player.log) {
      player.x = player.log.x + player.logOffset;
      if (Math.abs(player.x) > playHalf + 0.6) die('water');
    }
  }

  if (state.phase === 'playing') {
    const row = currentHazardRow();
    if (row && (row.type === 'road' || row.type === 'rail')) {
      for (const m of row.movers) {
        if (Math.abs(player.x - m.x) < m.len / 2 + PLAYER_HALF) {
          die(row.type === 'rail' ? 'train' : 'car');
          break;
        }
      }
    }
  }

  if (state.phase === 'playing') {
    const creep = lerp(0.55, 1.0, difficulty(player.maxRow)) * mode.chase;
    state.creepRow += creep * dt;
    // The eagle is never far away. The alien is not dragged along, so outrunning it leaves it behind.
    if (!mode.chaser) state.creepRow = Math.max(state.creepRow, player.row - 1);
    if (!player.hop && state.creepRow - player.row >= EAGLE_GAP) die(mode.chaser || 'eagle');
  }

  player.mesh.position.set(player.x, player.y, player.z);
  player.mesh.rotation.y = approachAngle(player.mesh.rotation.y, player.facing, Math.min(1, dt * 25));
}

// ---------- Death ----------
const CAUSES = {
  car: 'Squashed by traffic',
  train: 'Flattened by a train',
  water: 'Swept away by the river',
  eagle: 'Too slow! The eagle got you',
  alien: 'Too slow! The alien caught you',
  meteor: 'Crushed by a meteorite',
};

function die(kind) {
  if (state.phase !== 'playing') return;
  state.phase = 'dying';
  state.death = { kind, t: 0, px: player.x, pz: player.z };
  player.hop = null;
  player.log = null;
  queued = null;

  if (kind === 'car' || kind === 'train') {
    player.y = groundY(rows.get(Math.round(-player.z)));
    player.mesh.scale.set(1.35, 0.15, 1.35);
    burst(player.x, 0.4, player.z, character().bits, 14);
  } else if (kind === 'water') {
    if (mode.lava) burst(player.x, 0, player.z, [C.foam, C.bubble, 0x2a1a1a], 18, true);
    else burst(player.x, 0, player.z, [C.white, 0xbdefff], 16);
  } else if (kind === 'meteor') {
    player.mesh.visible = false;
    burst(player.x, 0.3, player.z, [...character().bits, 0x2a1a1a], 16);
  } else if (kind === 'alien') {
    state.death.ax = alien.position.x;
    state.death.az = alien.position.z;
  } else {
    eagle.visible = true;
  }
}

function updateDeath(dt) {
  if (state.phase !== 'dying') return;
  const d = state.death;
  d.t += dt;

  if (d.kind === 'water') {
    player.y -= dt * 1.8;
    if (d.t > 0.35) player.mesh.visible = false;
  } else if (d.kind === 'eagle') {
    const wings = eagle.userData.wings;
    const flap = Math.sin(d.t * 22) * 0.6;
    wings[0].rotation.z = -flap;
    wings[1].rotation.z = flap;
    if (d.t < 0.45) {
      const k = d.t / 0.45;
      eagle.position.set(d.px, lerp(4, 1.1, k), lerp(d.pz - 16, d.pz, k));
    } else {
      const k = (d.t - 0.45) / 0.9;
      const ey = lerp(1.1, 5, k);
      const ez = lerp(d.pz, d.pz + 18, k);
      eagle.position.set(d.px, ey, ez);
      player.y = ey - 1.1;
      player.z = ez;
      player.mesh.position.set(player.x, player.y, player.z);
    }
  }

  if (d.kind === 'alien') {
    // Lunge onto the chicken, then chew.
    const k = Math.min(1, d.t / 0.25);
    alien.position.x = lerp(d.ax, d.px, k);
    alien.position.z = lerp(d.az, d.pz + 0.5, k);
    alien.position.y = Math.sin(k * Math.PI) * 0.6;
    alien.scale.y += (1.2 - alien.scale.y) * k; // spring up out of the crouch
    if (d.t >= 0.25 && player.mesh.visible) {
      player.mesh.visible = false;
      burst(d.px, 0.5, d.pz, character().bits, 16);
      state.shake = 0.25;
    }
    const chew = d.t > 0.25 ? Math.abs(Math.sin((d.t - 0.25) * 14)) : 0;
    alien.userData.mouth.scale.y = 1 + chew * 2.5;
    alien.rotation.y = Math.PI * clamp((d.t - 0.25) / 0.25, 0, 1); // turn to show the camera its chewing face
  }

  const length = { eagle: 1.4, alien: 1.3 }[d.kind] || 0.9;
  if (d.t > length) gameOver();
}

// ---------- Particles ----------
const particles = [];
function burst(x, y, z, colors, n, glow = false) {
  for (let k = 0; k < n; k++) {
    const mesh = glow ? glowBox(0.12, 0.12, 0.12, pick(colors)) : box(0.12, 0.12, 0.12, pick(colors), { cast: false });
    place(scene, mesh, x, y + 0.2, z);
    particles.push({
      mesh,
      v: new THREE.Vector3(rand(-2.5, 2.5), rand(2.5, 5.5), rand(-2.5, 2.5)),
      life: rand(0.5, 0.9),
    });
  }
}
function updateParticles(dt) {
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k];
    p.life -= dt;
    p.v.y -= 16 * dt;
    p.mesh.position.addScaledVector(p.v, dt);
    p.mesh.rotation.x += dt * 6;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(k, 1);
    }
  }
}

// ---------- Extreme hazards: meteorites and the alien ----------
const meteors = [];
const scorches = [];
let meteorTimer = 0;

// A red marker pulses on the target cell while the meteorite falls, so every hit is telegraphed.
function spawnMeteor(row = player.row + randInt(-1, 6), x = randInt(-playHalf, playHalf)) {
  const target = rows.get(row);
  if (!target) return;
  const y = target.type === 'river' ? 0.06 : groundY(target) + 0.03;
  const marker = new THREE.Group();
  const fill = new THREE.Mesh(boxGeometry(0.9, 0.02, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xff2a4a, transparent: true, opacity: 0.35 }));
  marker.add(fill);
  for (const s of [-1, 1]) {
    place(marker, glowBox(0.94, 0.04, 0.07, 0xff3b5c), 0, 0.01, s * 0.44);
    place(marker, glowBox(0.07, 0.04, 0.94, 0xff3b5c), s * 0.44, 0.01, 0);
  }
  place(scene, marker, x, y, -row);
  const mesh = place(scene, makeMeteor(), x - 2, y + 8, -row - 3);
  meteors.push({ mesh, marker, fill, x, row, y, t: 0, dur: 1.2 });
}

function removeMeteor(m) {
  scene.remove(m.mesh, m.marker);
  m.fill.material.dispose();
}

function impact(m) {
  burst(m.x, m.y, -m.row, [0xff7a1a, 0xffc23a, 0x2a1a1a], 18, true);
  state.shake = Math.max(state.shake, 0.15);
  if (rows.get(m.row)?.type !== 'river') {
    const scorch = place(scene, box(0.8, 0.02, 0.8, 0x120a10, { cast: false }), m.x, m.y - 0.01, -m.row);
    scorches.push({ mesh: scorch, life: 1.6 });
  }
  const row = currentHazardRow();
  if (state.phase === 'playing' && row && row.index === m.row && Math.abs(player.x - m.x) < 0.65) die('meteor');
}

function updateMeteors(dt) {
  if (mode.meteors && ['characters', 'menu', 'ready', 'playing'].includes(state.phase)) {
    // More meteorites the further you get: the gap shrinks to under half, and doubles start appearing.
    // The fall (and its warning marker) stays 1.2s so every hit is still telegraphed.
    const d = difficulty(player.maxRow);
    meteorTimer -= dt;
    if (meteorTimer <= 0) {
      spawnMeteor();
      if (Math.random() < lerp(0, 0.35, d)) spawnMeteor();
      meteorTimer = rand(0.7, 1.9) * lerp(1, 0.45, d);
    }
  }
  for (let k = meteors.length - 1; k >= 0; k--) {
    const m = meteors[k];
    m.t += dt;
    const p = Math.min(1, m.t / m.dur);
    const fall = p * p;
    m.mesh.position.set(lerp(m.x - 2, m.x, fall), lerp(m.y + 8, m.y + 0.35, fall), lerp(-m.row - 3, -m.row, fall));
    m.mesh.rotation.x += dt * 5;
    m.mesh.rotation.z += dt * 3;
    m.fill.material.opacity = 0.2 + 0.45 * Math.abs(Math.sin(m.t * 9));
    const pulse = 0.85 + 0.15 * Math.abs(Math.sin(m.t * 9));
    m.marker.scale.set(pulse, 1, pulse);
    if (Math.random() < 0.5) {
      const at = m.mesh.position;
      burst(at.x, at.y - 0.2, at.z, [0xff7a1a, 0xffc23a], 1, true);
    }
    if (p >= 1) {
      impact(m);
      removeMeteor(m);
      meteors.splice(k, 1);
    }
  }
  for (let k = scorches.length - 1; k >= 0; k--) {
    scorches[k].life -= dt;
    if (scorches[k].life <= 0) {
      scene.remove(scorches[k].mesh);
      scorches.splice(k, 1);
    }
  }
}

// The alien runs on the same chase clock as the eagle (creepRow) and strikes when it reaches the chicken.
function updateAlien(dt, time) {
  alien.visible = mode.chaser === 'alien';
  if (!alien.visible) return;
  if (['characters', 'menu', 'ready', 'playing'].includes(state.phase)) {
    // Drawn a little behind its catch line and crouching as it closes in, so it never hides the chicken.
    alien.position.z = -(state.creepRow - EAGLE_GAP - 0.6) + 0.6;
    alien.position.x = lerp(alien.position.x, player.x, 1 - Math.exp(-dt * 3));
    alien.position.y = Math.abs(Math.sin(time * 4)) * 0.12;
    const gap = -player.z + alien.position.z;
    const crouch = clamp((3 - gap) / 1.8, 0, 1);
    alien.scale.set(1.2, 1.2 * (1 - 0.5 * crouch), 1.2);
  }
  const u = alien.userData;
  const menace = clamp((state.creepRow - player.row + 1) / (EAGLE_GAP + 1), 0, 1);
  u.arms.forEach((arm, k) => { arm.rotation.x = -0.2 + menace * 0.7 + Math.sin(time * 7 + k * Math.PI) * 0.2; });
  u.legs.forEach((leg, k) => { leg.rotation.x = Math.sin(time * 10 + k * 1.7) * 0.35; });
  u.pupil.position.x = clamp((player.x - alien.position.x) * 0.1, -0.16, 0.16);
}

function pulseLava(time) {
  const mat = glowCache.get(C.lava);
  if (mat) mat.color.setHex(C.lava).multiplyScalar(0.85 + 0.15 * Math.sin(time * 2.5));
}

// ---------- Camera ----------
function updateCamera(dt) {
  if (state.phase === 'ready' || state.phase === 'playing') {
    // With the alien, the camera leads less so the monster creeping up behind stays in view.
    const targetRow = Math.max(-player.z, state.creepRow - (mode.chaser === 'alien' ? 1.5 : 0));
    state.focusRow = lerp(state.focusRow, targetRow, 1 - Math.exp(-dt * 5));
    // Drift partway towards the chicken, but keep it well inside the screen edge (the tilted view eats into this).
    const margin = Math.max(0, camera.right - 2.5);
    const targetX = clamp(player.x * 0.6, player.x - margin, player.x + margin);
    state.focusX = lerp(state.focusX, targetX, 1 - Math.exp(-dt * 4));
  }
  focus.set(state.focusX, 0, -state.focusRow - focusAhead);
  camera.position.copy(focus).add(CAM_OFFSET);
  camera.lookAt(focus);
  if (state.shake > 0) {
    camera.position.x += rand(-1, 1) * state.shake;
    camera.position.y += rand(-1, 1) * state.shake;
    state.shake = Math.max(0, state.shake - dt * 0.9);
  }
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);
}

// ---------- Game state, HUD, input ----------
const $ = id => document.getElementById(id);
const hud = {
  score: $('score'), best: $('best'), pill: $('mode-pill'),
  title: $('title'), modes: $('modes'), ready: $('ready'),
  chars: $('characters'), charGrid: $('char-grid'),
  over: $('gameover'), cause: $('cause'), final: $('final'),
};

// Normal keeps the original key so high scores from before difficulties existed carry over.
const bestKey = id => (id === 'normal' ? BEST_KEY : `${BEST_KEY}-${id}`);
function loadBest(id) {
  try { return parseInt(localStorage.getItem(bestKey(id)), 10) || 0; } catch { return 0; }
}
function saveBest(id, v) {
  try { localStorage.setItem(bestKey(id), String(v)); } catch { /* storage unavailable */ }
}
function loadModeId() {
  try { const id = localStorage.getItem(MODE_KEY); return MODES[id] ? id : 'normal'; } catch { return 'normal'; }
}

// phase: characters -> menu -> ready (world built, waiting for first hop) -> playing -> dying -> over
const state = { phase: 'menu', score: 0, best: 0, creepRow: 0, focusRow: 0, focusX: 0, death: null, overAt: 0, shake: 0 };
let queued = null;
let selectedId = 'normal';

function setScore(v) {
  state.score = v;
  hud.score.textContent = v;
  if (v > state.best) {
    state.best = v;
    hud.best.textContent = `TOP ${v}`;
  }
}

function ensureRows() {
  while (lastRow < player.maxRow + ROWS_AHEAD) addRow(lastRow + 1);
  const minKeep = player.row - ROWS_BEHIND;
  for (const row of [...rows.values()]) if (row.index < minKeep) removeRow(row);
}

function gameOver() {
  state.phase = 'over';
  state.overAt = performance.now();
  saveBest(modeId, state.best);
  hud.cause.textContent = (mode.causes && mode.causes[state.death.kind]) || CAUSES[state.death.kind];
  hud.final.textContent = state.score;
  hud.over.hidden = false;
}

function reset() {
  for (const row of [...rows.values()]) removeRow(row);
  for (const p of particles) scene.remove(p.mesh);
  particles.length = 0;

  gen = { runType: 'grass', runLeft: 0, path: 0 };
  lastRow = -ROWS_BEHIND - 1;
  while (lastRow < ROWS_AHEAD) addRow(lastRow + 1);

  Object.assign(player, { row: 0, x: 0, y: 0, z: 0, facing: 0, hop: null, log: null, logOffset: 0, maxRow: 0 });
  player.mesh.visible = true;
  player.mesh.scale.set(1, 1, 1);
  player.mesh.rotation.set(0, 0, 0);
  eagle.visible = false;
  for (const m of meteors) removeMeteor(m);
  meteors.length = 0;
  for (const s of scorches) scene.remove(s.mesh);
  scorches.length = 0;
  meteorTimer = 1.2;
  alien.position.set(0, 0, EAGLE_GAP + 1);
  alien.userData.mouth.scale.y = 1;
  alien.rotation.y = 0;
  alien.scale.setScalar(1.2);

  Object.assign(state, { phase: 'ready', creepRow: 0, focusRow: 0, focusX: 0, death: null, shake: 0 });
  queued = null;
  setScore(0);
  hud.best.textContent = `TOP ${state.best}`;
  hud.pill.hidden = false;
  hud.over.hidden = true;
  hud.title.hidden = true;
  hud.chars.hidden = true;
  hud.ready.hidden = false;
}

// ---------- Difficulty menu ----------
function setMode(id) {
  modeId = id;
  mode = MODES[id];
  C = mode.colors ? { ...BASE_COLORS, ...mode.colors } : BASE_COLORS;
  playHalf = Math.round((9 * mode.size - 1) / 2);
  worldHalf = 9 + playHalf; // enough to cover the camera sliding sideways after the chicken
  wrap = worldHalf + 4;
  const L = mode.light;
  hemi.color.setHex(L.sky);
  hemi.groundColor.setHex(L.ground);
  hemi.intensity = L.hemi;
  sun.color.setHex(L.sun);
  sun.intensity = L.sunIntensity;
  scene.background.setHex(C.bg);
  document.body.dataset.mode = id;
  // The eagle takes its colours from the palette, so rebuild it.
  scene.remove(eagle);
  eagle = makeEagle();
  eagle.visible = false;
  scene.add(eagle);
  state.best = loadBest(id);
  hud.pill.textContent = mode.label;
  document.body.style.setProperty('--mode', mode.color);
  document.body.style.setProperty('--mode-dark', mode.dark);
  try { localStorage.setItem(MODE_KEY, id); } catch { /* storage unavailable */ }
}

// Pixel faces on a 16x16 grid, as [x, y, w, h] rectangles.
const FACES = {
  happy: [[4, 5, 2, 3], [10, 5, 2, 3], [3, 10, 1, 1], [4, 11, 1, 1], [5, 12, 6, 1], [11, 11, 1, 1], [12, 10, 1, 1]],
  angry: [[3, 3, 1, 1], [4, 4, 1, 1], [5, 5, 1, 1], [12, 3, 1, 1], [11, 4, 1, 1], [10, 5, 1, 1],
    [4, 7, 2, 2], [10, 7, 2, 2], [5, 11, 6, 1], [4, 12, 1, 1], [11, 12, 1, 1]],
  // steep thick brows, slit eyes, gritted teeth
  furious: [[2, 2, 1, 2], [3, 3, 1, 2], [4, 4, 1, 2], [5, 5, 1, 2], [6, 6, 1, 1],
    [13, 2, 1, 2], [12, 3, 1, 2], [11, 4, 1, 2], [10, 5, 1, 2], [9, 6, 1, 1],
    [3, 8, 3, 1], [10, 8, 3, 1],
    [4, 10, 8, 1], [4, 13, 8, 1], [3, 11, 1, 2], [12, 11, 1, 2], [6, 11, 1, 2], [9, 11, 1, 2]],
};
function faceSvg(name) {
  const rects = FACES[name].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('');
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">`
    + `<g fill="rgba(0,0,0,.25)" transform="translate(0 1)">${rects}</g><g fill="#fff">${rects}</g></svg>`;
}

const modeIds = Object.keys(MODES);
const modeButtons = modeIds.map(id => {
  const m = MODES[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mode';
  b.dataset.face = m.face;
  b.setAttribute('role', 'radio');
  b.style.setProperty('--c', m.color);
  b.style.setProperty('--c-dark', m.dark);
  b.innerHTML = `${faceSvg(m.face)}<span>${m.label}</span>`;
  b.addEventListener('pointerenter', () => selectMode(id));
  b.addEventListener('focus', () => selectMode(id));
  b.addEventListener('click', () => startRun(id));
  hud.modes.appendChild(b);
  return b;
});

function selectMode(id) {
  selectedId = id;
  modeButtons.forEach((b, k) => {
    const on = modeIds[k] === id;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
  hud.best.textContent = `TOP ${loadBest(id)}`;
  // Show the chosen difficulty's world behind the menu.
  if (state.phase === 'menu' && id !== modeId) {
    setMode(id);
    showMenu();
  }
}

function showMenu() {
  reset();
  state.phase = 'menu';
  hud.ready.hidden = true;
  hud.pill.hidden = true;
  hud.title.hidden = false;
  selectMode(modeId);
}

function startRun(id) {
  setMode(id);
  reset();
}

// ---------- Character select ----------
let characterId = 'chicken';
const characterIds = Object.keys(CHARACTERS);
const character = () => CHARACTERS[characterId];

function loadCharacterId() {
  try { const id = localStorage.getItem(CHARACTER_KEY); return CHARACTERS[id] ? id : 'chicken'; } catch { return 'chicken'; }
}

function setCharacter(id) {
  characterId = id;
  const old = player.mesh;
  player.mesh = CHARACTERS[id].build();
  player.mesh.position.copy(old.position);
  player.mesh.rotation.copy(old.rotation);
  player.mesh.visible = old.visible;
  scene.remove(old);
  scene.add(player.mesh);
  try { localStorage.setItem(CHARACTER_KEY, id); } catch { /* storage unavailable */ }
}

// Render each character once, three-quarter view, into a picture for its card.
function renderPortraits() {
  const out = {};
  try {
    const size = 256;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight(0xffffff, 0x7a8fa6, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(2, 5, 4);
    s.add(key);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    for (const id of characterIds) {
      const model = CHARACTERS[id].build();
      model.rotation.y = CHARACTERS[id].turn ?? Math.PI + 0.6;
      s.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const half = Math.max(...bounds.getSize(new THREE.Vector3()).toArray()) * 0.6;
      Object.assign(cam, { left: -half, right: half, top: half, bottom: -half });
      cam.updateProjectionMatrix();
      cam.position.set(center.x + 2, center.y + 1.6, center.z + 5);
      cam.lookAt(center);
      r.render(s, cam);
      out[id] = r.domElement.toDataURL('image/png');
      s.remove(model);
    }
    r.dispose();
    r.forceContextLoss();
  } catch { /* cards fall back to name and description only */ }
  return out;
}

const portraits = renderPortraits();
const characterButtons = characterIds.map(id => {
  const ch = CHARACTERS[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'char';
  b.setAttribute('role', 'radio');
  const art = portraits[id] ? `<img src="${portraits[id]}" alt="">` : '';
  b.innerHTML = `<span class="char-art">${art}</span><span class="char-name">${ch.name}</span><span class="char-desc">${ch.desc}</span>`;
  b.addEventListener('pointerenter', () => selectCharacter(id));
  b.addEventListener('focus', () => selectCharacter(id));
  b.addEventListener('click', () => { selectCharacter(id); showMenu(); });
  hud.charGrid.appendChild(b);
  return b;
});

// Highlighting a card also swaps the character standing in the world behind the menu.
function selectCharacter(id) {
  characterButtons.forEach((b, k) => {
    const on = characterIds[k] === id;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
  if (id !== characterId) setCharacter(id);
}

function showCharacters() {
  reset();
  state.phase = 'characters';
  hud.ready.hidden = true;
  hud.pill.hidden = true;
  hud.chars.hidden = false;
  selectCharacter(characterId);
}

// Deer wags its white tail (harder mid-hop); the macaw opens its wings as it hops.
function animateCharacter(time) {
  const u = player.mesh.userData;
  const hop = player.hop ? Math.sin(Math.PI * player.hop.t) : 0;
  if (u.tail) u.tail.rotation.z = Math.sin(time * (hop ? 30 : 9)) * (0.22 + hop * 0.25);
  if (u.wings) for (const w of u.wings) w.rotation.z = w.userData.side * hop * 1.1;
}

function input(dx, dz) {
  if (state.phase === 'menu' || state.phase === 'characters') return;
  if (state.phase === 'over') {
    if (performance.now() - state.overAt > 400) reset();
    return;
  }
  if (state.phase === 'ready') {
    state.phase = 'playing';
    hud.ready.hidden = true;
  }
  if (state.phase !== 'playing') return;
  if (player.hop) queued = [dx, dz]; // buffer one move so quick taps don't get lost
  else tryMove(dx, dz);
}

const KEYS = {
  ArrowUp: [0, 1], KeyW: [0, 1],
  ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

window.addEventListener('keydown', e => {
  const dir = KEYS[e.code];
  const confirm = e.code === 'Space' || e.code === 'Enter';
  if (dir || confirm) e.preventDefault();
  if (e.repeat) return;

  if (state.phase === 'characters') {
    if (dir && dir[0]) {
      const k = characterIds.indexOf(characterId);
      selectCharacter(characterIds[(k + dir[0] + characterIds.length) % characterIds.length]);
    } else if (confirm || (dir && dir[1] === 1)) {
      showMenu();
    }
    return;
  }

  if (state.phase === 'menu') {
    if (e.code === 'Escape') {
      showCharacters();
      return;
    }
    if (dir && dir[0]) {
      const k = modeIds.indexOf(selectedId);
      selectMode(modeIds[(k + dir[0] + modeIds.length) % modeIds.length]);
    } else if (confirm || (dir && dir[1] === 1)) {
      startRun(selectedId);
    }
    return;
  }

  const canLeaveOver = state.phase === 'over' && performance.now() - state.overAt > 400;
  if (e.code === 'Escape') {
    if (canLeaveOver) showMenu();
    return;
  }
  if (confirm) {
    if (canLeaveOver) reset();
    return;
  }
  if (dir) input(dir[0], dir[1]);
});

let touchStart = null;
window.addEventListener('touchstart', e => {
  if (e.target.closest('button, a')) return;
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
window.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) input(0, 1);      // tap = hop forward
  else if (Math.abs(dx) > Math.abs(dy)) input(Math.sign(dx), 0);
  else input(0, dy < 0 ? 1 : -1);
});

$('again').addEventListener('click', reset);
$('menu').addEventListener('click', showMenu);
$('to-characters').addEventListener('click', showCharacters);

if (window.matchMedia('(pointer: coarse)').matches) {
  $('char-hint').textContent = 'Tap a character to continue';
  $('menu-hint').textContent = 'Tap a difficulty to play';
  hud.ready.textContent = 'Tap to hop · swipe to move';
  $('over-hint').textContent = 'or tap anywhere to play again';
}

// Test hook: open the page with ?debug to inspect game state from the browser console.
if (new URLSearchParams(location.search).has('debug')) {
  window.crossy = {
    player, rows, state, startRun, getMode: () => modeId, camera,
    meteors, spawnMeteor, alien, isEagleVisible: () => eagle.visible,
    setCharacter, getCharacter: () => characterId, showCharacters, portraits,
  };
}

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  for (const row of rows.values()) updateRow(row, dt);
  updatePlayer(dt);
  updateDeath(dt);
  updateAlien(dt, now / 1000);
  updateMeteors(dt);
  updateParticles(dt);
  updateCamera(dt);
  animateCharacter(now / 1000);
  if (mode.lava) pulseLava(now / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setMode(loadModeId());
setCharacter(loadCharacterId());
showCharacters();
requestAnimationFrame(frame);
})();
