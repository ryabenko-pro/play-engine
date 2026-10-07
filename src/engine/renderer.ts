import type { AssetLookup, ImageProvider, SpriteFrames } from './assets';
import type { Camera, Viewport } from './camera';
import { type WorldBody, halfExtents } from './runtime';
import { DEG2RAD, type Vec2, rotate } from './math';
import { depthOf, project, unproject } from './projection';
import type {
  Colored,
  Entity,
  Extruded,
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

/** How an actor looks this frame. */
export interface ActorVisual {
  facing: number;
  anim: string;
  animTime: number;
  /** Blink time left. */
  flash: number;
  /** Fill colour for sprite-less actors. */
  color: string;
  /** Current collider in the world (drawn when there is no sprite). */
  body: WorldBody;
  /** Squash (> 0: wider and flatter) or stretch (< 0) around the feet. */
  squash?: number;
  /** Opacity, e.g. for trail afterimages. */
  alpha?: number;
}

/** Squash amount of the wobble effect at a time; `seed` desynchronizes actors. */
export function wobble(amount: number, time: number, seed = 0): number {
  return amount ? amount * Math.sin(time * 11 + seed * 0.37) : 0;
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
type DrawableActor = Positioned & SpriteVisual;

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

export function characterOrderKey(view: ViewMode, p: Positioned): OrderKey {
  return { layer: 1, depth: depthOf(view, p) };
}

/** Zones lie on the ground, paths on top of them; both under everything standing there. */
const MAP_LAYER = { zone: 0.4, path: 0.5 } as const;

export function entityOrderKey(view: ViewMode, e: Entity): OrderKey {
  if (e.type === 'zone' || e.type === 'path') return { layer: MAP_LAYER[e.type], depth: 0 };
  if (view === 'side') return { layer: e.type === 'block' ? 0 : e.type === 'instance' ? 1 : 2, depth: 0 };
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

  /** A path (road) through world points: a dark edge and a coloured band of `width` px. */
  drawPath(pts: readonly Vec2[], width: number, color: string, alpha = 1): void {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    const line = () => {
      ctx.beginPath();
      pts.forEach((w, i) => {
        const p = this.P(w);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
    };
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const w = Math.max(1 / this.zoom, width);
    line();
    ctx.strokeStyle = shade(color, 0.65);
    ctx.lineWidth = w + 3 / this.zoom;
    ctx.stroke();
    line();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.restore();
  }

  /** A zone: a translucent area with a dashed outline. */
  drawZone(pts: readonly Vec2[], color: string, alpha = 1): void {
    if (pts.length < 3) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= alpha;
    this.polygon(pts.map((p) => this.P(p)));
    ctx.globalAlpha *= 0.3;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha /= 0.3;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.stroke();
    ctx.restore();
  }

  drawActor(e: DrawableActor, st: ActorVisual): Box {
    const ctx = this.ctx;
    const p = this.P(e);
    const ext = halfExtents(st.body.shape);
    ctx.save();
    ctx.globalAlpha = st.alpha ?? 1;
    if (st.flash > 0 && Math.floor(st.flash * 20) % 2 === 0) ctx.globalAlpha *= 0.4;
    if (st.squash) {
      // Deform around the feet: the bottom of the collider (side), the ground point otherwise.
      const feet = this.view === 'side' ? this.P({ x: st.body.x, y: st.body.y + ext.y }) : p;
      ctx.translate(feet.x, feet.y);
      ctx.scale(1 + st.squash, 1 - st.squash);
      ctx.translate(-feet.x, -feet.y);
    }

    const sprite = this.assets.get(e.spriteId, 'sprite');
    const fr = sprite ? this.assets.frameRect(sprite, this.assets.frameAt(sprite, st.anim, st.animTime)) : null;
    let box: Box;
    if (sprite && fr) {
      if (this.view !== 'side') {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, ext.x * 1.2, ext.x * (this.view === 'isometric' ? 0.6 : 0.9), 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();
      }
      const dw = fr.sw * e.spriteScale;
      const dh = fr.sh * e.spriteScale;
      const dx = p.x - sprite.originX * dw;
      // In isometric view the position is the ground point, so the sprite stands on it.
      const anchorY = this.view === 'isometric' ? dh : sprite.originY * dh;
      const dy = p.y - anchorY + e.spriteOffsetY;
      ctx.imageSmoothingEnabled = false;
      if (st.facing < 0) {
        ctx.translate(p.x * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, dw, dh);
      box = { x: st.facing < 0 ? 2 * p.x - dx - dw : dx, y: dy, w: dw, h: dh };
    } else {
      box = this.drawBodyShape(st.body, st.color);
    }
    ctx.restore();
    return box;
  }

  /** Actors without a sprite are drawn as their current collider, in their current colour. */
  private drawBodyShape(b: WorldBody, color: string): Box {
    const ctx = this.ctx;
    const pts = shapeOutline({ x: b.x, y: b.y, rotation: 0, shape: b.shape }).map((q) => this.P(q));
    this.polygon(pts);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = shade(color, 0.6);
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.stroke();
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
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
