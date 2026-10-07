import { createImageAsset, createSpriteAsset } from '../../engine/factory';
import type { ImageAsset, SpriteAnim, SpriteAsset } from '../../engine/types';

/*
 * Pixel art for Tanks, drawn on canvases at startup so the game ships as a single
 * project with no external files. Without a DOM (tests) the images are empty.
 */

type Ctx = CanvasRenderingContext2D;

function paint(w: number, h: number, draw: (ctx: Ctx) => void): string {
  if (typeof document === 'undefined') return '';
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  return cv.toDataURL('image/png');
}

function sheet(name: string, frameW: number, frameH: number, frames: number, draw: (ctx: Ctx, f: number) => void, animations: SpriteAnim[]): [ImageAsset, SpriteAsset] {
  const src = paint(frameW * frames, frameH, (ctx) => {
    for (let f = 0; f < frames; f++) {
      ctx.save();
      ctx.translate(f * frameW, 0);
      ctx.beginPath();
      ctx.rect(0, 0, frameW, frameH);
      ctx.clip();
      draw(ctx, f);
      ctx.restore();
    }
  });
  const img = createImageAsset(`${name}.png`, src, frameW * frames, frameH);
  const spr = createSpriteAsset(name, img);
  Object.assign(spr, { frameW, frameH, originX: 0.5, originY: 0.5, animations });
  return [img, spr];
}

const anim = (name: string, frames: string, fps = 1, loop = true): SpriteAnim => ({ name, frames, fps, loop });

// ---------------------------------------------------------------------------
// Tanks: 0-7 four directions × two track frames, 8-11 spawn star, 12-14 explosion
// ---------------------------------------------------------------------------

export interface TankPalette {
  body: string;
  dark: string;
  light: string;
}

export const DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
const TANK = 32;

/** Tank facing up, centred in a 32 × 32 frame; `tread` shifts the track pattern. */
function drawTank(ctx: Ctx, pal: TankPalette, tread: number): void {
  for (const x of [4, 22]) {
    ctx.fillStyle = pal.dark;
    ctx.fillRect(x, 4, 6, 24);
    ctx.fillStyle = pal.body;
    for (let y = 4 + tread * 2; y < 28; y += 4) ctx.fillRect(x, y, 6, 2);
  }
  ctx.fillStyle = pal.body;
  ctx.fillRect(9, 8, 14, 18);
  ctx.fillStyle = pal.light;
  ctx.fillRect(9, 8, 14, 2);
  ctx.fillRect(9, 8, 2, 18);
  ctx.fillStyle = pal.dark;
  ctx.fillRect(21, 10, 2, 16);
  ctx.beginPath();
  ctx.arc(16, 18, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = pal.light;
  ctx.fill();
  ctx.fillStyle = pal.dark;
  ctx.fillRect(14.5, 1, 3, 15);
  ctx.fillStyle = pal.light;
  ctx.fillRect(15, 1, 1, 13);
}

function drawShield(ctx: Ctx, phase: number): void {
  ctx.save();
  ctx.strokeStyle = phase ? '#bff4ff' : '#ffffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.lineDashOffset = phase * 3;
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSpawnStar(ctx: Ctx, size: number): void {
  ctx.save();
  ctx.translate(16, 16);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.22, 0);
    ctx.lineTo(-size * 0.22, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#7fe6ff';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawExplosion(ctx: Ctx, stage: number): void {
  const blobs: Array<[number, number, number]> = [
    [16, 16, 7 + stage * 4],
    [10, 11, 4 + stage * 2],
    [23, 12, 4 + stage * 2],
    [12, 23, 3 + stage * 2],
    [22, 22, 4 + stage * 2],
  ];
  for (const [color, k] of [['#b3261e', 1], ['#ff8c1a', 0.72], ['#ffe066', 0.4]] as const) {
    ctx.fillStyle = color;
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Animations shared by every tank sheet; the state names match (see project.ts). */
const TANK_ANIMS: SpriteAnim[] = [
  ...DIRECTIONS.flatMap((d, i) => [anim(d, String(i * 2)), anim(`${d}-move`, `${i * 2}-${i * 2 + 1}`, 14)]),
  anim('spawn', '8-11, 10, 9', 14),
  anim('explode', '12-14', 8, false),
];

export function tankSheet(name: string, pal: TankPalette, shield = false): [ImageAsset, SpriteAsset] {
  return sheet(name, TANK, TANK, 15, (ctx, f) => {
    if (f < 8) {
      ctx.translate(16, 16);
      ctx.rotate((Math.floor(f / 2) * Math.PI) / 2);
      ctx.translate(-16, -16);
      drawTank(ctx, pal, f % 2);
      if (shield) drawShield(ctx, f % 2);
    } else if (f < 12) {
      drawSpawnStar(ctx, [6, 10, 14, 11][f - 8]);
    } else {
      drawExplosion(ctx, f - 12);
    }
  }, TANK_ANIMS);
}

// ---------------------------------------------------------------------------
// Terrain (16 × 16 cells)
// ---------------------------------------------------------------------------

export function brickSheet(): [ImageAsset, SpriteAsset] {
  return sheet('Brick', 16, 16, 1, (ctx) => {
    ctx.fillStyle = '#6b2a12';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#b5532a';
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let x = -8 + off; x < 16; x += 8) ctx.fillRect(x + 1, row * 4, 6, 3);
    }
    ctx.fillStyle = '#d98a5f';
    for (let row = 0; row < 4; row++) ctx.fillRect(row % 2 ? 5 : 1, row * 4, 2, 1);
  }, [anim('idle', '0')]);
}

export function steelSheet(): [ImageAsset, SpriteAsset] {
  return sheet('Steel', 16, 16, 1, (ctx) => {
    ctx.fillStyle = '#7d8590';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#e6ebf0';
    ctx.fillRect(0, 0, 16, 2);
    ctx.fillRect(0, 0, 2, 16);
    ctx.fillStyle = '#3f454d';
    ctx.fillRect(0, 14, 16, 2);
    ctx.fillRect(14, 0, 2, 16);
    ctx.fillStyle = '#c4cad2';
    ctx.fillRect(5, 5, 6, 6);
  }, [anim('idle', '0')]);
}

export function waterSheet(): [ImageAsset, SpriteAsset] {
  return sheet('Water', 16, 16, 2, (ctx, f) => {
    ctx.fillStyle = '#1f4fb8';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#7fb2ff';
    for (let y = 2; y < 16; y += 5) {
      const s = (y + f * 4) % 8;
      ctx.fillRect(s, y, 4, 1);
      ctx.fillRect((s + 8) % 16, y + 1, 3, 1);
    }
  }, [anim('idle', '0-1', 2)]);
}

// ---------------------------------------------------------------------------
// Base (32 × 32): 0 eagle, 1 ruins
// ---------------------------------------------------------------------------

export function baseSheet(): [ImageAsset, SpriteAsset] {
  return sheet('Base', 32, 32, 2, (ctx, f) => {
    if (f === 0) {
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath();
      // Wings, body and head of a stylised eagle.
      ctx.moveTo(3, 9);
      ctx.lineTo(12, 14);
      ctx.lineTo(13, 6);
      ctx.lineTo(16, 3);
      ctx.lineTo(19, 6);
      ctx.lineTo(20, 14);
      ctx.lineTo(29, 9);
      ctx.lineTo(26, 20);
      ctx.lineTo(20, 22);
      ctx.lineTo(22, 29);
      ctx.lineTo(10, 29);
      ctx.lineTo(12, 22);
      ctx.lineTo(6, 20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#5a6068';
      ctx.fillRect(14, 12, 4, 10);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(15, 5, 2, 2);
    } else {
      ctx.fillStyle = '#4a4f57';
      ctx.fillRect(4, 20, 24, 9);
      ctx.fillStyle = '#6b7079';
      ctx.fillRect(7, 15, 8, 6);
      ctx.fillRect(18, 17, 7, 4);
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(15, 3, 2, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(17, 3, 9, 6);
    }
  }, [anim('idle', '0'), anim('dead', '1')]);
}

// ---------------------------------------------------------------------------
// Bonuses (16 × 16)
// ---------------------------------------------------------------------------

export const BONUS_KINDS = ['helmet', 'star', 'grenade', 'tank', 'clock'] as const;

export function bonusSheet(player: TankPalette): [ImageAsset, SpriteAsset] {
  return sheet('Bonus', 16, 16, BONUS_KINDS.length, (ctx, f) => {
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(0.5, 0.5, 15, 15);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    const kind = BONUS_KINDS[f];
    ctx.beginPath();
    if (kind === 'helmet') {
      ctx.arc(8, 10, 5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(2, 10, 12, 2);
    } else if (kind === 'star') {
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 ? 2.4 : 6;
        ctx.lineTo(8 + Math.cos(a) * r, 8.5 + Math.sin(a) * r);
      }
      ctx.fillStyle = '#ffd166';
      ctx.fill();
    } else if (kind === 'grenade') {
      ctx.arc(8, 9.5, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#6fbf5a';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(7, 2, 2, 3);
      ctx.fillRect(9, 2, 3, 1);
    } else if (kind === 'tank') {
      ctx.fillStyle = player.body;
      ctx.fillRect(3, 6, 10, 7);
      ctx.fillStyle = player.light;
      ctx.fillRect(6, 4, 4, 4);
      ctx.fillRect(9, 5, 5, 1.5);
    } else {
      ctx.arc(8, 8.5, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(7.5, 5, 1, 4);
      ctx.fillRect(7.5, 8, 3, 1);
    }
  }, BONUS_KINDS.map((k, i) => anim(k, String(i))));
}

// ---------------------------------------------------------------------------
// Banner (big centred messages)
// ---------------------------------------------------------------------------

export const BANNERS = ['over', 'clear', 'paused'] as const;
const BANNER_TEXT: Record<(typeof BANNERS)[number], [string, string]> = {
  over: ['GAME OVER', '#ff5a4d'],
  clear: ['STAGE CLEAR', '#ffd166'],
  paused: ['PAUSED', '#ffffff'],
};

export function bannerSheet(): [ImageAsset, SpriteAsset] {
  const w = 240;
  const h = 44;
  return sheet('Banner', w, h, BANNERS.length, (ctx, f) => {
    const [text, color] = BANNER_TEXT[BANNERS[f]];
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 28px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(text, w / 2 + 2, h / 2 + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  }, BANNERS.map((b, i) => anim(b, String(i))));
}
