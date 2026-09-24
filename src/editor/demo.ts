import {
  createBlock,
  createCharacter,
  createImageAsset,
  createProjectileAsset,
  createScene,
  createSpriteAsset,
} from '../engine/factory';
import type { BlockEntity, CharacterEntity, ImageAsset, Project, ShapeDef, SpriteAsset } from '../engine/types';

interface Palette {
  body: string;
  dark: string;
  visor: string;
}

const FRAME = 32;
const FRAMES = 7; // 0-1 idle, 2-5 run, 6 jump

/** Draws a tiny pixel-art character sheet so the demo needs no external files. */
function characterSheet(pal: Palette): string {
  const cv = document.createElement('canvas');
  cv.width = FRAME * FRAMES;
  cv.height = FRAME;
  const ctx = cv.getContext('2d')!;
  const legs: Array<[number, number, number, number]> = [
    [10, 24, 18, 24], // idle 0
    [10, 24, 18, 24], // idle 1
    [8, 24, 20, 23],
    [11, 23, 17, 24],
    [14, 24, 14, 23],
    [17, 24, 11, 23],
    [9, 21, 19, 21], // jump
  ];
  for (let f = 0; f < FRAMES; f++) {
    const ox = f * FRAME;
    const bob = f === 1 ? 1 : 0;
    const [lx, ly, rx, ry] = legs[f];
    ctx.fillStyle = pal.dark;
    ctx.fillRect(ox + lx, ly, 4, 6);
    ctx.fillRect(ox + rx, ry, 4, 6);
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    ctx.roundRect(ox + 9, 4 + bob, 14, 21, 5);
    ctx.fill();
    ctx.fillStyle = pal.dark;
    ctx.fillRect(ox + 9, 18 + bob, 14, 2);
    ctx.fillStyle = pal.visor;
    ctx.fillRect(ox + 15, 9 + bob, 8, 5);
    ctx.fillStyle = '#111';
    ctx.fillRect(ox + 19, 10 + bob, 2, 3);
  }
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
  ];
  return [img, spr];
}

function block(shape: ShapeDef, x: number, y: number, props: Partial<BlockEntity> = {}): BlockEntity {
  return Object.assign(createBlock(shape, x, y), props);
}

function character(control: 'player' | 'npc', x: number, y: number, props: Partial<CharacterEntity>): CharacterEntity {
  return Object.assign(createCharacter(control, x, y), props);
}

export function createDemoProject(): Project {
  const [heroImg, hero] = sheetAssets('Hero', { body: '#4da3ff', dark: '#1f4e80', visor: '#d8f3ff' });
  const [enemyImg, enemy] = sheetAssets('Grunt', { body: '#ff6b5a', dark: '#7a2a22', visor: '#ffe0a8' });
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

  // --- Side-view platformer ---------------------------------------------------
  const side = createScene('Platformer', 'side');
  side.entities.push(
    block({ kind: 'rect', w: 1600, h: 80 }, 480, 360, { name: 'Ground', color: '#4a5a4c' }),
    block({ kind: 'rect', w: 40, h: 520 }, -340, 100, { name: 'Left wall' }),
    block({ kind: 'rect', w: 160, h: 20 }, 300, 220, { name: 'Platform A', color: '#8a6d4b' }),
    block({ kind: 'rect', w: 140, h: 20 }, 600, 140, { name: 'Platform B', color: '#8a6d4b' }),
    block({ kind: 'line', x2: 140, y2: 0, thickness: 6 }, 40, 210, { name: 'Ledge (line)', color: '#c9b37e' }),
    block({ kind: 'circle', r: 30 }, 460, 305, { name: 'Boulder', color: '#7d7f86' }),
    block({ kind: 'rect', w: 260, h: 20 }, 900, 290, { name: 'Slope', rotation: -20, color: '#6b7d5a' }),
    block({ kind: 'rect', w: 300, h: 80 }, 1170, 280, { name: 'Plateau', color: '#4a5a4c' }),
    character('player', 100, 280, {
      name: 'Hero',
      spriteId: hero.id,
      projectileId: bolt.id,
      idleTakeover: 5,
      behavior: 'wander',
      behaviorRange: 250,
    }),
    character('npc', 300, 180, { name: 'Patroller', spriteId: enemy.id, behavior: 'patrol', behaviorRange: 60, speed: 80 }),
    character('npc', 800, 200, {
      name: 'Gunner',
      spriteId: enemy.id,
      behavior: 'chase',
      behaviorRange: 320,
      projectileId: grenade.id,
      fireCooldown: 1.6,
    }),
    character('npc', 1150, 200, {
      name: 'Scripted',
      team: 'neutral',
      color: '#8be38b',
      collider: { kind: 'circle', r: 16 },
      behavior: 'script',
      projectileId: bolt.id,
      fireCooldown: 1,
    }),
  );

  // --- Isometric arena -------------------------------------------------------------
  const iso = createScene('Arena', 'isometric');
  const wall = { color: '#7a8699', height: 32 };
  const isoChar = { collider: { kind: 'circle', r: 12 } as const, spriteOffsetY: -22 };
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
    character('player', 0, 0, {
      name: 'Hero',
      spriteId: hero.id,
      projectileId: bolt.id,
      idleTakeover: 6,
      behavior: 'wander',
      behaviorRange: 200,
      ...isoChar,
    }),
    character('npc', 220, -220, { name: 'Hunter', spriteId: enemy.id, behavior: 'chase', behaviorRange: 260, projectileId: bolt.id, fireCooldown: 1.5, speed: 90, ...isoChar }),
    character('npc', -220, 240, { name: 'Brute', spriteId: enemy.id, behavior: 'chase', behaviorRange: 220, speed: 120, ...isoChar }),
    character('npc', -220, -220, { name: 'Wanderer', team: 'neutral', color: '#8be38b', behavior: 'wander', behaviorRange: 100, ...isoChar }),
  );

  return {
    version: 1,
    name: 'Demo',
    assets: [heroImg, hero, enemyImg, enemy, bolt, grenade],
    scenes: [side, iso],
    mainSceneId: side.id,
  };
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
