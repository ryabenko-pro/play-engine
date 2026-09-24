import type { AssetLookup, ImageProvider, SpriteFrames } from './assets';
import type { Camera, Viewport } from './camera';
import { DEG2RAD, type Vec2, rotate } from './math';
import { depthOf, project, unproject } from './projection';
import type {
  AnimationSet,
  Colored,
  Controllable,
  Entity,
  Extruded,
  HasBody,
  Mortal,
  Positioned,
  ProjectileAsset,
  ProjectileEntity,
  Rotatable,
  Shaped,
  Solid,
  SpriteVisual,
  Textured,
  ViewMode,
} from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Runtime-only look of a character; the editor draws without it. */
export interface CharacterVisual {
  facing: number;
  anim: string;
  animTime: number;
  health: number;
  aiActive: boolean;
  hurt: number;
}

export interface Particle extends Positioned {
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface OrderKey {
  layer: number;
  depth: number;
}

export type RenderAssets = AssetLookup & ImageProvider & SpriteFrames;

type DrawableBlock = Positioned & Rotatable & Shaped & Colored & Solid & Extruded & Textured;
type DrawableCharacter = Positioned & HasBody & Colored & SpriteVisual & AnimationSet & Mortal & Pick<Controllable, 'control'>;

const CIRCLE_SEGMENTS = 32;

/** World-space outline of a block: rect corners, circle polygon, or line end points. */
export function shapeOutline(b: Positioned & Rotatable & Shaped): Vec2[] {
  const s = b.shape;
  if (s.kind === 'line') return [{ x: b.x, y: b.y }, { x: b.x + s.x2, y: b.y + s.y2 }];
  if (s.kind === 'circle') {
    const pts: Vec2[] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push({ x: b.x + Math.cos(a) * s.r, y: b.y + Math.sin(a) * s.r });
    }
    return pts;
  }
  const hw = s.w / 2;
  const hh = s.h / 2;
  const rad = b.rotation * DEG2RAD;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const r = rotate(p, rad);
    return { x: r.x + b.x, y: r.y + b.y };
  });
}

function blockCenter(b: Positioned & Shaped): Vec2 {
  return b.shape.kind === 'line' ? { x: b.x + b.shape.x2 / 2, y: b.y + b.shape.y2 / 2 } : { x: b.x, y: b.y };
}

export function entityOrderKey(view: ViewMode, e: Entity): OrderKey {
  if (view === 'side') return { layer: e.type === 'block' ? 0 : e.type === 'character' ? 1 : 2, depth: 0 };
  if (e.type === 'block') {
    const flat = e.height <= 0 && e.shape.kind !== 'line';
    return { layer: flat ? 0 : 1, depth: depthOf(view, blockCenter(e)) };
  }
  return { layer: 1, depth: depthOf(view, e) };
}

/** Stable sort by layer, then depth. */
export function inDrawOrder<T>(items: readonly T[], key: (t: T) => OrderKey): T[] {
  return items
    .map((t, i) => ({ t, i, k: key(t) }))
    .sort((a, b) => a.k.layer - b.k.layer || a.k.depth - b.k.depth || a.i - b.i)
    .map((x) => x.t);
}

export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export class Renderer {
  view: ViewMode = 'side';
  zoom = 1;
  private patterns = new WeakMap<HTMLImageElement, CanvasPattern>();

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly assets: RenderAssets,
  ) {}

  P(p: Positioned): Vec2 {
    return project(this.view, p);
  }

  /** Clears and sets up the camera transform (drawing happens in projected space). */
  begin(vp: Viewport, dpr: number, cam: Camera, background: string): void {
    const ctx = this.ctx;
    this.zoom = cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, vp.width, vp.height);
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, dpr * (vp.width / 2 - cam.x * cam.zoom), dpr * (vp.height / 2 - cam.y * cam.zoom));
  }

  /** Switch to screen-pixel space (for HUD). */
  screen(dpr: number): void {
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawGrid(size: number, cam: Camera, vp: Viewport): void {
    if (size <= 0) return;
    const ctx = this.ctx;
    const corners = [
      { x: 0, y: 0 },
      { x: vp.width, y: 0 },
      { x: 0, y: vp.height },
      { x: vp.width, y: vp.height },
    ].map((s) => unproject(this.view, cam.toProjected(s, vp)));
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));
    let step = size;
    while ((maxX - minX) / step > 160 || (maxY - minY) / step > 160) step *= 2;

    const line = (a: Vec2, b: Vec2) => {
      const pa = this.P(a);
      const pb = this.P(b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    };
    ctx.lineWidth = 1 / this.zoom;
    ctx.beginPath();
    for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) if (x !== 0) line({ x, y: minY }, { x, y: maxY });
    for (let y = Math.floor(minY / step) * step; y <= maxY; y += step) if (y !== 0) line({ x: minX, y }, { x: maxX, y });
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();

    ctx.beginPath();
    line({ x: minX, y: 0 }, { x: maxX, y: 0 });
    ctx.strokeStyle = 'rgba(255,110,110,0.35)';
    ctx.stroke();
    ctx.beginPath();
    line({ x: 0, y: minY }, { x: 0, y: maxY });
    ctx.strokeStyle = 'rgba(120,220,120,0.35)';
    ctx.stroke();
  }

  private polygon(pts: Vec2[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  private fillFor(b: Colored & Textured): string | CanvasPattern {
    const img = this.assets.image(b.textureId);
    if (!img) return b.color;
    let p = this.patterns.get(img);
    if (!p) {
      p = this.ctx.createPattern(img, 'repeat') ?? undefined;
      if (p) this.patterns.set(img, p);
    }
    return p ?? b.color;
  }

  drawBlock(b: DrawableBlock, ghost = false): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = (ghost ? 0.5 : 1) * (b.solid ? 1 : 0.55);
    const hgt = this.view === 'isometric' ? Math.max(0, b.height) : 0;
    const up = (p: Vec2): Vec2 => ({ x: p.x, y: p.y - hgt });

    if (b.shape.kind === 'line') {
      const [a, c] = shapeOutline(b).map((p) => this.P(p));
      if (hgt > 0) {
        this.polygon([a, c, up(c), up(a)]);
        ctx.fillStyle = shade(b.color, 0.7);
        ctx.fill();
      }
      ctx.strokeStyle = b.color;
      ctx.lineWidth = Math.max(1 / this.zoom, b.shape.thickness);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(up(a).x, up(a).y);
      ctx.lineTo(up(c).x, up(c).y);
      ctx.stroke();
    } else {
      const world = shapeOutline(b);
      const base = world.map((p) => this.P(p));
      if (hgt > 0) {
        const n = world.length;
        for (let i = 0; i < n; i++) {
          const w0 = world[i];
          const w1 = world[(i + 1) % n];
          // Outward normal for our clockwise (y-down) winding; faces toward +x+y face the viewer.
          const nx = w1.y - w0.y;
          const ny = -(w1.x - w0.x);
          if (nx + ny <= 0) continue;
          const len = Math.hypot(nx, ny) || 1;
          const p0 = base[i];
          const p1 = base[(i + 1) % n];
          this.polygon([p0, p1, up(p1), up(p0)]);
          ctx.fillStyle = shade(b.color, 0.7 + (0.15 * (ny - nx)) / len);
          ctx.fill();
        }
      }
      const top = base.map(up);
      this.polygon(top);
      ctx.fillStyle = this.fillFor(b);
      ctx.fill();
      ctx.strokeStyle = shade(b.color, 1.35);
      ctx.lineWidth = 1 / this.zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCharacter(e: DrawableCharacter, st?: CharacterVisual): Box {
    const ctx = this.ctx;
    const p = this.P(e);
    const facing = st?.facing ?? 1;
    const size = e.collider.kind === 'rect' ? e.collider.w : e.collider.r * 2;
    ctx.save();
    if (st && st.hurt > 0 && Math.floor(st.hurt * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    if (this.view !== 'side') {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, size * 0.6, size * (this.view === 'isometric' ? 0.3 : 0.45), 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
    }

    let box: Box;
    const sprite = this.assets.get(e.spriteId, 'sprite');
    const fr = sprite ? this.assets.frameRect(sprite, this.assets.frameAt(sprite, st?.anim ?? e.animIdle, st?.animTime ?? 0)) : null;
    if (sprite && fr) {
      const dw = fr.sw * e.spriteScale;
      const dh = fr.sh * e.spriteScale;
      const dx = p.x - sprite.originX * dw;
      const dy = p.y - sprite.originY * dh + e.spriteOffsetY;
      ctx.imageSmoothingEnabled = false;
      if (facing < 0) {
        ctx.translate(p.x * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, dw, dh);
      box = { x: facing < 0 ? 2 * p.x - dx - dw : dx, y: dy, w: dw, h: dh };
    } else {
      box = this.drawCharacterShape(e, p, facing, size);
    }
    ctx.restore();

    if (st && st.health > 0 && st.health < e.maxHealth) {
      const w = Math.max(24, box.w);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(box.x + box.w / 2 - w / 2, box.y - 8, w, 4);
      ctx.fillStyle = '#6ee07a';
      ctx.fillRect(box.x + box.w / 2 - w / 2, box.y - 8, (w * st.health) / e.maxHealth, 4);
    }
    if (st?.aiActive && e.control === 'player') {
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('AI', box.x + box.w / 2, box.y - 12);
    }
    return box;
  }

  /** Fallback look for characters without a sprite. */
  private drawCharacterShape(e: DrawableCharacter, p: Vec2, facing: number, size: number): Box {
    const ctx = this.ctx;
    let box: Box;
    if (this.view === 'isometric') {
      const h = size * 1.8;
      box = { x: p.x - size / 2, y: p.y - h, w: size, h };
    } else if (e.collider.kind === 'rect') {
      box = { x: p.x - e.collider.w / 2, y: p.y - e.collider.h / 2, w: e.collider.w, h: e.collider.h };
    } else {
      box = { x: p.x - e.collider.r, y: p.y - e.collider.r, w: size, h: size };
    }
    ctx.beginPath();
    if (this.view !== 'isometric' && e.collider.kind === 'circle') ctx.arc(p.x, p.y, e.collider.r, 0, Math.PI * 2);
    else ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(6, box.w / 3));
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.strokeStyle = shade(e.color, 0.6);
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2 + facing * box.w * 0.22, box.y + box.h * 0.3, Math.max(2, box.w * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    return box;
  }

  drawProjectile(pos: Positioned, vel: Positioned, asset: ProjectileAsset | undefined, time: number): Box {
    const ctx = this.ctx;
    const iso = this.view === 'isometric';
    const base = this.P(pos);
    const p = iso ? { x: base.x, y: base.y - 18 } : base;
    const sd = this.P(vel);
    const angle = Math.atan2(sd.y, sd.x);
    const r = asset?.radius ?? 5;
    if (iso) {
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, r, r / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
    }
    const sprite = this.assets.get(asset?.spriteId, 'sprite');
    const fr = sprite ? this.assets.frameRect(sprite, this.assets.frameAt(sprite, '', time)) : null;
    if (sprite && fr) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, -fr.sw * sprite.originX, -fr.sh * sprite.originY, fr.sw, fr.sh);
      ctx.restore();
      return { x: p.x - fr.sw / 2, y: p.y - fr.sh / 2, w: fr.sw, h: fr.sh };
    }
    const color = asset?.color ?? '#ffd166';
    ctx.save();
    ctx.globalAlpha *= 0.25;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
  }

  /** Editor view of a placed projectile: the projectile plus a direction arrow. */
  drawProjectileEntity(e: ProjectileEntity): Box {
    const dir = rotate({ x: 1, y: 0 }, e.rotation * DEG2RAD);
    const box = this.drawProjectile(e, dir, this.assets.get(e.projectileId, 'projectile'), 0);
    const ctx = this.ctx;
    const a = this.P(e);
    const b = this.P({ x: e.x + dir.x * 36, y: e.y + dir.y * 36 });
    const lift = this.view === 'isometric' ? 18 : 0;
    ctx.save();
    ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
    ctx.strokeStyle = 'rgba(255,209,102,0.8)';
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - lift);
    ctx.lineTo(b.x, b.y - lift);
    ctx.stroke();
    ctx.restore();
    return box;
  }

  drawParticles(list: readonly Particle[]): void {
    const ctx = this.ctx;
    for (const pt of list) {
      const p = this.P(pt);
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(p.x - pt.size / 2, p.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }
}
