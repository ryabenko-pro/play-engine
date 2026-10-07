import {
  createActorScene,
  createBlock,
  createImageAsset,
  createInstance,
  createLevelScene,
  createProjectileAsset,
  createSpriteAsset,
  createState,
} from '../engine/factory';
import type {
  ActorDef,
  ActorScene,
  BlockEntity,
  ImageAsset,
  InstanceEntity,
  LevelScene,
  Project,
  PropValues,
  ShapeDef,
  SpriteAsset,
} from '../engine/types';
import { createDefaultInteractions } from '../engine/interactions';
import { clone } from '../engine/util';
import { setBlocks } from './blocks/codegen';
import { crateBlocks, mineBlocks } from './demo-blocks';
import { GRUNT_SCRIPT, HERO_BIG_SCRIPT, HERO_SCRIPT, HERO_SMALL_SCRIPT, PILL_SCRIPT, WALKER_SCRIPT } from './demo-scripts';

interface Palette {
  body: string;
  dark: string;
  visor: string;
}

const FRAME = 32;
/** 0-1 idle · 2-5 run · 6 jump · 7 fall · 8-9 attack · 10 hurt · 11-12 dead */
const FRAMES = 13;

type Legs = [lx: number, ly: number, rx: number, ry: number];

interface FramePose {
  legs: Legs;
  bob?: number;
  arm?: boolean;
  flash?: boolean;
  tilt?: number;
}

const POSES: FramePose[] = [
  { legs: [10, 24, 18, 24] },
  { legs: [10, 24, 18, 24], bob: 1 },
  { legs: [8, 24, 20, 23] },
  { legs: [11, 23, 17, 24] },
  { legs: [14, 24, 14, 23] },
  { legs: [17, 24, 11, 23] },
  { legs: [9, 21, 19, 21] },
  { legs: [8, 25, 20, 25], bob: -1 },
  { legs: [10, 24, 18, 24], arm: true },
  { legs: [10, 24, 18, 24], arm: true, bob: 1 },
  { legs: [9, 24, 19, 24], flash: true },
  { legs: [10, 24, 18, 24], tilt: -0.7 },
  { legs: [10, 24, 18, 24], tilt: -Math.PI / 2 },
];

/** Draws a tiny pixel-art character sheet so the demo needs no external files. */
function characterSheet(pal: Palette): string {
  const cv = document.createElement('canvas');
  cv.width = FRAME * FRAMES;
  cv.height = FRAME;
  const ctx = cv.getContext('2d')!;
  POSES.forEach((pose, f) => {
    const ox = f * FRAME;
    const bob = pose.bob ?? 0;
    const [lx, ly, rx, ry] = pose.legs;
    ctx.save();
    if (pose.tilt) {
      // Pivot chosen so the fully lying body (frame 12) fits the frame: x 2..28, y 17..31.
      ctx.translate(ox + 19, 21);
      ctx.rotate(pose.tilt);
      ctx.translate(-(ox + 19), -21);
    }
    ctx.fillStyle = pal.dark;
    ctx.fillRect(ox + lx, ly, 4, 6);
    ctx.fillRect(ox + rx, ry, 4, 6);
    ctx.fillStyle = pose.flash ? '#ffffff' : pal.body;
    ctx.beginPath();
    ctx.roundRect(ox + 9, 4 + bob, 14, 21, 5);
    ctx.fill();
    ctx.fillStyle = pal.dark;
    ctx.fillRect(ox + 9, 18 + bob, 14, 2);
    ctx.fillStyle = pal.visor;
    ctx.fillRect(ox + 15, 9 + bob, 8, 5);
    ctx.fillStyle = '#111';
    if (pose.flash || pose.tilt) {
      ctx.fillRect(ox + 18, 10 + bob, 1, 1);
      ctx.fillRect(ox + 20, 12 + bob, 1, 1);
      ctx.fillRect(ox + 20, 10 + bob, 1, 1);
      ctx.fillRect(ox + 18, 12 + bob, 1, 1);
    } else {
      ctx.fillRect(ox + 19, 10 + bob, 2, 3);
    }
    if (pose.arm) {
      ctx.fillStyle = pal.dark;
      ctx.fillRect(ox + 20, 15 + bob, 10, 3);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(ox + 29, 14 + bob, 3, 5);
    }
    ctx.restore();
  });
  return cv.toDataURL('image/png');
}

function sheetAssets(name: string, pal: Palette): [ImageAsset, SpriteAsset] {
  const img = createImageAsset(`${name}.png`, characterSheet(pal), FRAME * FRAMES, FRAME);
  const spr = createSpriteAsset(name, img);
  spr.frameW = FRAME;
  spr.frameH = FRAME;
  spr.originY = 17 / 32;
  spr.animations = [
    { name: 'idle', frames: '0-1', fps: 2.5, loop: true },
    { name: 'run', frames: '2-5', fps: 10, loop: true },
    { name: 'jump', frames: '6', fps: 1, loop: false },
    { name: 'fall', frames: '7', fps: 1, loop: false },
    { name: 'attack', frames: '8-9', fps: 8, loop: false },
    { name: 'hurt', frames: '10', fps: 1, loop: false },
    { name: 'dead', frames: '11-12', fps: 6, loop: false },
  ];
  return [img, spr];
}

/** A one-frame 32×32 sprite drawn on a canvas. */
function tileSprite(name: string, draw: (ctx: CanvasRenderingContext2D) => void): [ImageAsset, SpriteAsset] {
  const cv = document.createElement('canvas');
  cv.width = cv.height = FRAME;
  draw(cv.getContext('2d')!);
  const img = createImageAsset(`${name}.png`, cv.toDataURL('image/png'), FRAME, FRAME);
  const spr = createSpriteAsset(name, img);
  Object.assign(spr, { frameW: FRAME, frameH: FRAME, animations: [{ name: 'idle', frames: '0', fps: 1, loop: true }] });
  return [img, spr];
}

function drawCrate(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(1, 1, 30, 30);
  ctx.fillStyle = '#c08a4a';
  ctx.fillRect(4, 4, 24, 24);
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(4, 4);
  ctx.lineTo(28, 28);
  ctx.moveTo(28, 4);
  ctx.lineTo(4, 28);
  ctx.stroke();
}

function drawBoulder(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#5f646d';
  ctx.beginPath();
  ctx.arc(16, 17, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a8f99';
  ctx.beginPath();
  ctx.arc(13, 13, 10, 0, Math.PI * 2);
  ctx.fill();
}

function block(shape: ShapeDef, x: number, y: number, props: Partial<BlockEntity> = {}): BlockEntity {
  return Object.assign(createBlock(shape, x, y), props);
}

function actorScene(name: string, script: string, def: Partial<ActorDef> = {}): ActorScene {
  const s = createActorScene(name);
  Object.assign(s.actor, { script }, def);
  return s;
}

/** Lying-down collider matching the last 'dead' frame at sprite scale 1.5; bottom stays at the feet. */
function lieDownWhenDead(scene: ActorScene): void {
  const dead = scene.actor.states.find((s) => s.name === 'dead');
  if (dead) dead.body = { shape: { kind: 'rect', w: 38, h: 20 }, offsetX: -2, offsetY: 9 };
}

/** A form of `container`: a copy of its look (sprite, states, colliders) with its own script. */
function formScene(container: ActorScene, form: string, script: string, def: Partial<ActorDef>): ActorScene {
  const s = actorScene(`${container.name} · ${form[0].toUpperCase()}${form.slice(1)}`, script, {
    ...clone({ collider: container.actor.collider, states: container.actor.states, initialState: container.actor.initialState }),
    spriteId: container.actor.spriteId,
    spriteScale: container.actor.spriteScale,
    color: container.actor.color,
    ...def,
  });
  container.actor.forms.push({ name: form, sceneId: s.id });
  return s;
}

function place(scene: ActorScene | LevelScene, x: number, y: number, name = scene.name, props: PropValues = {}): InstanceEntity {
  return Object.assign(createInstance(scene, x, y), { name, props });
}

export function createDemoProject(): Project {
  const [heroImg, heroSprite] = sheetAssets('Hero', { body: '#4da3ff', dark: '#1f4e80', visor: '#d8f3ff' });
  const [gruntImg, gruntSprite] = sheetAssets('Grunt', { body: '#ff6b5a', dark: '#7a2a22', visor: '#ffe0a8' });
  const [bigImg, bigSprite] = sheetAssets('Hero Big', { body: '#ffb347', dark: '#8a5a1a', visor: '#fff2c8' });
  const bolt = Object.assign(createProjectileAsset('Bolt'), { color: '#ffd166' });
  const grenade = Object.assign(createProjectileAsset('Grenade'), {
    color: '#9bff7a',
    radius: 6,
    speed: 420,
    gravityScale: 1,
    bounces: 2,
    lifetime: 2.5,
    damage: 2,
  });

  // --- Actor scenes: all behaviour is in their TypeScript (the Mine's is built from blocks) ---
  const hero = actorScene('Hero', HERO_SCRIPT, { tags: 'player', spriteId: heroSprite.id, color: '#4da3ff' });
  const grunt = actorScene('Grunt', GRUNT_SCRIPT, { tags: 'enemy', spriteId: gruntSprite.id, color: '#ff6b5a' });
  lieDownWhenDead(hero);
  lieDownWhenDead(grunt);
  const mine = setBlocks(
    actorScene('Mine', '', {
      tags: 'hazard',
      color: '#5c6b7a',
      collider: { kind: 'circle', r: 14 },
      initialState: 'idle',
      states: [createState('idle', '')],
    }),
    mineBlocks(),
  );
  const pill = actorScene('Pill', PILL_SCRIPT, {
    tags: 'pickup',
    color: '#4dd0ff',
    collider: { kind: 'circle', r: 9 },
    wobble: 0.08,
    initialState: 'idle',
    states: [createState('idle', '')],
  });

  // --- Hero forms: the Hero is the container (controls, lives); pills switch its form ---
  const heroSmall = formScene(hero, 'small', HERO_SMALL_SCRIPT, { scale: 0.6, trail: 6 });
  const heroBig = formScene(hero, 'big', HERO_BIG_SCRIPT, { scale: 1.6, wobble: 0.05, spriteId: bigSprite.id, color: '#ffb347' });

  // --- Rooms → building: levels placed in levels ------------------------------------
  const backdrop = (color: string) => block({ kind: 'rect', w: 400, h: 150 }, 200, -75, { name: 'Backdrop', color, solid: false });
  const floor = () => block({ kind: 'rect', w: 400, h: 20 }, 200, 10, { name: 'Floor', color: '#4a5a4c' });
  const guardRoom = createLevelScene('Room · Guard post', 'side');
  guardRoom.entities.push(
    backdrop('#2a3040'),
    floor(),
    block({ kind: 'rect', w: 120, h: 14 }, 150, -80, { name: 'Shelf', color: '#8a6d4b' }),
    block({ kind: 'rect', w: 40, h: 40 }, 340, -20, { name: 'Crate', color: '#8a6d4b' }),
    place(grunt, 120, -19, 'Guard', { patrolRange: 90 }),
  );
  const lab = createLevelScene('Room · Lab', 'side');
  lab.entities.push(
    backdrop('#233636'),
    floor(),
    block({ kind: 'rect', w: 100, h: 14 }, 230, -85, { name: 'Shelf', color: '#8a6d4b' }),
    place(pill, 90, -16, 'Grow pill', { form: 'big', color: '#ffb347' }),
    place(mine, 300, -14, 'Mine'),
  );
  const outpost = createLevelScene('Building · Outpost', 'side');
  outpost.entities.push(
    place(guardRoom, 0, 0, 'Guard post'),
    place(lab, 400, 0, 'Lab'),
    block({ kind: 'rect', w: 820, h: 20 }, 400, -160, { name: 'Roof', color: '#6b5a4a' }),
    block({ kind: 'rect', w: 20, h: 180 }, 810, -80, { name: 'Back wall', color: '#5a6b7d' }),
  );

  // --- Side-view platformer -------------------------------------------------------
  const side = createLevelScene('Platformer', 'side');
  side.entities.push(
    block({ kind: 'rect', w: 1600, h: 80 }, 480, 360, { name: 'Ground', color: '#4a5a4c' }),
    block({ kind: 'rect', w: 40, h: 520 }, -340, 100, { name: 'Left wall' }),
    block({ kind: 'rect', w: 160, h: 20 }, 300, 220, { name: 'Platform A', color: '#8a6d4b' }),
    block({ kind: 'rect', w: 140, h: 20 }, 600, 140, { name: 'Platform B', color: '#8a6d4b' }),
    block({ kind: 'line', x2: 140, y2: 0, thickness: 6 }, 40, 210, { name: 'Ledge (line)', color: '#c9b37e' }),
    block({ kind: 'circle', r: 30 }, 460, 305, { name: 'Boulder', color: '#7d7f86' }),
    block({ kind: 'rect', w: 260, h: 20 }, 900, 290, { name: 'Slope', rotation: -20, color: '#6b7d5a' }),
    block({ kind: 'rect', w: 300, h: 80 }, 1170, 280, { name: 'Plateau', color: '#4a5a4c' }),
    place(hero, 100, 280),
    place(grunt, 300, 180, 'Patroller'),
    place(grunt, 800, 200, 'Gunner', { sight: 320, projectile: 'Grenade', fireCooldown: 1.6, speed: 110 }),
    place(mine, 560, 306, 'Mine'),
    place(mine, 1120, 226, 'Mine 2'),
    place(pill, 200, 304, 'Shrink pill'),
    block({ kind: 'rect', w: 1020, h: 80 }, 1790, 360, { name: 'Ground 2', color: '#4a5a4c' }),
    block({ kind: 'rect', w: 40, h: 520 }, 2320, 100, { name: 'Right wall' }),
    place(outpost, 1400, 320, 'Outpost'),
  );

  // --- Isometric arena: the same actor scenes, a different view ----------------
  const iso = createLevelScene('Arena', 'isometric');
  const wall = { color: '#7a8699', height: 32 };
  iso.entities.push(
    block({ kind: 'rect', w: 640, h: 640 }, 0, 0, { name: 'Floor', color: '#3b4a3f', solid: false }),
    block({ kind: 'rect', w: 680, h: 20 }, 0, -330, { name: 'Wall N', ...wall }),
    block({ kind: 'rect', w: 680, h: 20 }, 0, 330, { name: 'Wall S', ...wall }),
    block({ kind: 'rect', w: 20, h: 640 }, -330, 0, { name: 'Wall W', ...wall }),
    block({ kind: 'rect', w: 20, h: 640 }, 330, 0, { name: 'Wall E', ...wall }),
    block({ kind: 'circle', r: 24 }, -120, -120, { name: 'Pillar', color: '#a58f6f', height: 56 }),
    block({ kind: 'circle', r: 24 }, 140, 120, { name: 'Pillar', color: '#a58f6f', height: 56 }),
    block({ kind: 'rect', w: 96, h: 40 }, -140, 150, { name: 'Crate', color: '#8a6d4b', height: 20 }),
    block({ kind: 'line', x2: 160, y2: 0, thickness: 4 }, 40, -150, { name: 'Fence', color: '#c9b37e', height: 14 }),
    place(hero, 0, 0, 'Hero', { aiAfterIdle: 6 }),
    place(grunt, 220, -220, 'Hunter', { sight: 260, projectile: 'Bolt', speed: 90 }),
    place(grunt, -220, 240, 'Brute', { sight: 220, speed: 120 }),
    place(grunt, -220, -220, 'Wanderer', { patrolRange: 100, team: 'neutral' }),
    place(mine, 120, -40, 'Mine'),
    place(mine, -60, 220, 'Mine 2'),
    place(pill, 90, 70, 'Shrink pill'),
    place(pill, -90, -80, 'Grow pill', { form: 'big', color: '#ffb347' }),
  );

  // --- Elements playground: kinds, statuses, reactions and grid pushing ------------
  const [crateImg, crateSprite] = tileSprite('Crate', drawCrate);
  const [boulderImg, boulderSprite] = tileSprite('Boulder', drawBoulder);
  const tile = (name: string, sprite: SpriteAsset, kinds: string[]) =>
    actorScene(name, '', {
      kinds,
      color: '#c08a4a',
      spriteId: sprite.id,
      spriteScale: 1,
      collider: { kind: 'rect', w: 30, h: 30 },
      initialState: 'idle',
      states: [createState('idle', 'idle')],
    });
  const walker = actorScene('Walker', WALKER_SCRIPT, { kinds: ['creature'], tags: 'player', spriteId: heroSprite.id, spriteScale: 1.2, color: '#4da3ff', collider: { kind: 'rect', w: 24, h: 24 } });
  const crate = setBlocks(tile('Crate', crateSprite, ['crate', 'wood']), crateBlocks());
  const boulder = tile('Boulder', boulderSprite, ['boulder']);
  previewTopDown(walker, crate, boulder);
  const elements = elementsLevel(walker, crate, boulder);

  return {
    version: 4,
    name: 'Demo',
    assets: [heroImg, heroSprite, gruntImg, gruntSprite, bigImg, bigSprite, bolt, grenade, crateImg, crateSprite, boulderImg, boulderSprite],
    scenes: [side, iso, elements, outpost, guardRoom, lab, hero, heroSmall, heroBig, grunt, mine, pill, walker, crate, boulder],
    mainSceneId: side.id,
    interactions: createDefaultInteractions(),
  };
}

function previewTopDown(...scenes: ActorScene[]): void {
  for (const s of scenes) s.previewView = 'topdown';
}

/**
 * Top-down grid level (cells of 32 px) showing the interaction rules: zones give off
 * fire, water, cold and heat; crates and a boulder can be pushed.
 */
function elementsLevel(walker: ActorScene, crate: ActorScene, boulder: ActorScene): LevelScene {
  const G = 32;
  const level = createLevelScene('Elements', 'topdown');
  level.gridSize = G;
  level.background = '#20262b';
  /** A block covering cells i0..i1 × j0..j1. */
  const cells = (i0: number, j0: number, i1: number, j1: number, props: Partial<BlockEntity>) =>
    block({ kind: 'rect', w: (i1 - i0 + 1) * G, h: (j1 - j0 + 1) * G }, ((i0 + i1 + 1) / 2) * G, ((j0 + j1 + 1) / 2) * G, props);
  const at = (scene: ActorScene, i: number, j: number, name = scene.name) => place(scene, (i + 0.5) * G, (j + 0.5) * G, name);
  const wall = { name: 'Wall', color: '#5a6270', kinds: ['stone'] };
  const zone = (name: string, color: string, kind: string) => ({ name, color, solid: false, kinds: [kind] });
  level.entities.push(
    cells(0, 0, 21, 15, { name: 'Ground', color: '#2c3530', solid: false }),
    cells(0, 0, 21, 0, wall),
    cells(0, 15, 21, 15, wall),
    cells(0, 1, 0, 14, wall),
    cells(21, 1, 21, 14, wall),
    cells(9, 5, 9, 8, wall),
    cells(15, 2, 17, 4, zone('Fire pit', '#b5421c', 'fire')),
    cells(14, 9, 18, 12, zone('Pond', '#1f5a9e', 'water')),
    cells(2, 11, 6, 13, zone('Snowfield', '#b9d3e6', 'snow')),
    cells(9, 11, 12, 13, zone('Hot sand', '#b58a3a', 'hot')),
    at(walker, 3, 6),
    // Three in a row: too heavy together; push from the side to split them.
    at(crate, 5, 3, 'Crate 1'),
    at(crate, 6, 3, 'Crate 2'),
    at(crate, 7, 3, 'Crate 3'),
    // Two in a row: pushable together.
    at(crate, 5, 8, 'Crate 4'),
    at(crate, 6, 8, 'Crate 5'),
    // Push both towards the fire pit: the first catches fire, then its neighbour.
    at(crate, 12, 3, 'Crate 6'),
    at(crate, 13, 3, 'Crate 7'),
    at(boulder, 12, 7, 'Boulder'),
  );
  return level;
}

/** Reads an image file into an ImageAsset (data-URL, so the project stays self-contained). */
export function readImageFile(file: File): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => resolve(createImageAsset(file.name, src, img.naturalWidth, img.naturalHeight));
      img.onerror = () => reject(new Error(`Not an image: ${file.name}`));
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
