import type { AssetLookup } from './assets';
import { makeBrain, type Brain } from './behaviors';
import { Camera, type Viewport } from './camera';
import { type Collider, collide, colliderBounds, pointInCollider, shapeCollider } from './collision';
import { keyboardIntent, type KeyActivity, type KeyState } from './input';
import { emptyIntent, type Intent } from './intent';
import { DEG2RAD, clamp, normalize, rotate } from './math';
import { depthOf, project } from './projection';
import { type Particle, type Renderer, entityOrderKey, inDrawOrder } from './renderer';
import {
  type BodyEntity,
  type BrainWorld,
  type EntityRef,
  RtCharacter,
  type Targetable,
  halfExtents,
} from './runtime';
import type { BlockEntity, Project, ProjectileAsset, Scene, ViewMode } from './types';
import { clone } from './util';

const STEP = 1 / 60;

interface StaticBody {
  e: BlockEntity;
  col: Collider;
}

interface RtProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  bounces: number;
  alive: boolean;
  asset: ProjectileAsset;
  owner: RtCharacter | null;
  team: string;
}

interface GameParticle extends Particle {
  vx: number;
  vy: number;
}

export interface GameOptions {
  zoom?: number;
  onLog?: (msg: string) => void;
}

/** Runs one scene. Holds no reference to the editor; the same class powers the standalone player. */
export class Game implements BrainWorld {
  readonly scene: Scene;
  readonly view: ViewMode;
  readonly camera = new Camera();
  time = 0;

  private statics: StaticBody[] = [];
  readonly chars: RtCharacter[] = [];
  private brains = new Map<RtCharacter, Brain | null>();
  private projectiles: RtProjectile[] = [];
  private particles: GameParticle[] = [];
  private killY = Infinity;
  private acc = 0;
  private keyTapped = false;

  constructor(
    project: Project,
    sceneId: string,
    private readonly assets: AssetLookup,
    private readonly keys: KeyState & KeyActivity,
    private readonly opts: GameOptions = {},
  ) {
    this.scene = clone(project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0]);
    this.view = this.scene.view;
    this.camera.zoom = opts.zoom ?? 1;

    for (const e of this.scene.entities) {
      if (e.type === 'block') this.statics.push({ e, col: shapeCollider(e.shape, e.x, e.y, e.rotation) });
      else if (e.type === 'character') this.chars.push(new RtCharacter(e));
    }
    for (const c of this.chars) this.brains.set(c, makeBrain(c, this));
    for (const e of this.scene.entities) {
      if (e.type !== 'projectile') continue;
      const asset = this.assets.get(e.projectileId, 'projectile');
      if (asset) this.spawnProjectile(asset, e.x, e.y, rotate({ x: 1, y: 0 }, e.rotation * DEG2RAD), null, e.team);
    }
    if (this.view === 'side' && this.statics.length) {
      this.killY = Math.max(...this.statics.map((s) => colliderBounds(s.col).maxY)) + 800;
    }
    this.updateCamera(1, true);
  }

  // ---------------------------------------------------------------------------
  // BrainWorld
  // ---------------------------------------------------------------------------

  log(msg: string): void {
    this.opts.onLog?.(msg);
  }

  groundAhead(body: EntityRef<BodyEntity>, dir: number): boolean {
    const h = halfExtents(body.e.collider);
    const probe = { x: body.e.x + dir * (h.x + 14), y: body.e.y + h.y + 6 };
    return this.statics.some((s) => s.e.solid && pointInCollider(probe, s.col));
  }

  nearestTarget(from: Targetable, range: number, team?: string): Targetable | null {
    let best: Targetable | null = null;
    let bestD = range;
    for (const c of this.chars) {
      if (c === from || !c.alive) continue;
      if (team !== undefined ? c.e.team !== team : c.e.team === from.e.team) continue;
      const d = Math.hypot(c.e.x - from.e.x, c.e.y - from.e.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  player(): RtCharacter | null {
    return this.chars.find((c) => c.isPlayer && c.alive) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  /** Advance by real elapsed time using a fixed step. */
  frame(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.updateCamera(dt);
  }

  step(h: number): void {
    this.time += h;
    this.keyTapped = this.keys.consumeActivity();
    for (const c of this.chars) {
      if (!c.alive) {
        if (c.isPlayer && (c.respawnIn -= h) <= 0) this.respawn(c);
        continue;
      }
      const intent = this.intentFor(c, h);
      this.moveCharacter(c, intent, h);
      this.shoot(c, intent, h);
      this.animate(c, h);
      if (c.e.y > this.killY) this.kill(c);
    }
    this.updateProjectiles(h);
    this.updateParticles(h);
  }

  private intentFor(c: RtCharacter, h: number): Intent {
    if (c.isPlayer) {
      const k = keyboardIntent(this.keys, this.view);
      if (k.active || this.keyTapped) {
        c.idleTime = 0;
        if (c.aiActive) this.log(`${c.e.name}: control returned to player`);
        c.aiActive = false;
        return k.intent;
      }
      c.idleTime += h;
      if (!c.aiActive && c.e.idleTakeover > 0 && c.idleTime >= c.e.idleTakeover) {
        c.aiActive = true;
        this.log(`${c.e.name}: idle for ${c.e.idleTakeover}s, AI (${c.e.behavior}) took control`);
      }
      if (!c.aiActive) return emptyIntent();
    }
    return this.brains.get(c)?.(h) ?? emptyIntent();
  }

  private moveCharacter(c: RtCharacter, intent: Intent, h: number): void {
    const e = c.e;
    const side = this.view === 'side';
    const x0 = e.x;
    const y0 = e.y;
    let wantMove: number;

    if (side) {
      const target = clamp(intent.moveX, -1, 1) * e.speed;
      c.vx += (target - c.vx) * Math.min(1, (c.grounded ? 14 : 7) * h);
      c.coyote = c.grounded ? 0.1 : c.coyote - h;
      if (intent.jump && c.coyote > 0 && c.vy >= -1) {
        c.vy = -e.jumpSpeed;
        c.coyote = 0;
      }
      c.vy = Math.min(c.vy + this.scene.gravity * h, 1600);
      if (Math.abs(intent.moveX) > 0.1) c.facing = Math.sign(intent.moveX);
      else if (Math.abs(intent.aimX) > 0.1) c.facing = Math.sign(intent.aimX);
      wantMove = Math.abs(intent.moveX);
    } else {
      let d = { x: intent.moveX, y: intent.moveY };
      if (Math.hypot(d.x, d.y) > 1) d = normalize(d);
      c.vx += (d.x * e.speed - c.vx) * Math.min(1, 18 * h);
      c.vy += (d.y * e.speed - c.vy) * Math.min(1, 18 * h);
      wantMove = Math.hypot(d.x, d.y);
      const look = wantMove > 0.1 ? d : { x: intent.aimX, y: intent.aimY };
      if (Math.hypot(look.x, look.y) > 0.1) {
        if (wantMove > 0.1) c.dir = normalize(d);
        const s = project(this.view, look);
        if (Math.abs(s.x) > 0.05) c.facing = Math.sign(s.x);
      }
    }

    const requested = (side ? Math.abs(c.vx) : Math.hypot(c.vx, c.vy)) * h;
    e.x += c.vx * h;
    e.y += c.vy * h;
    c.grounded = false;
    c.hitWall = 0;

    for (let iter = 0; iter < 4; iter++) {
      let any = false;
      for (const s of this.statics) {
        if (!s.e.solid) continue;
        const m = collide(shapeCollider(e.collider, e.x, e.y), s.col);
        if (!m) continue;
        any = true;
        if (side && m.ny < -0.6) {
          // Floor or walkable slope: push straight up so we don't slide down slopes.
          e.y -= m.depth / -m.ny;
          if (c.vy > 0) c.vy = 0;
          c.grounded = true;
        } else {
          e.x += m.nx * m.depth;
          e.y += m.ny * m.depth;
          const vn = c.vx * m.nx + c.vy * m.ny;
          if (vn < 0) {
            c.vx -= vn * m.nx;
            c.vy -= vn * m.ny;
          }
          if (Math.abs(m.nx) > 0.7) c.hitWall = m.nx > 0 ? -1 : 1;
        }
      }
      if (!any) break;
    }

    const moved = side ? Math.abs(e.x - x0) : Math.hypot(e.x - x0, e.y - y0);
    c.blocked = wantMove > 0.5 && requested > 0.5 && moved < requested * 0.3;
  }

  private shoot(c: RtCharacter, intent: Intent, h: number): void {
    c.cooldown -= h;
    if (!intent.shoot || c.cooldown > 0) return;
    const asset = this.assets.get(c.e.projectileId, 'projectile');
    if (!asset) return;
    let aim = { x: intent.aimX, y: intent.aimY };
    if (Math.hypot(aim.x, aim.y) < 0.1) aim = this.view === 'side' ? { x: c.facing, y: 0 } : c.dir;
    aim = normalize(aim);
    const ext = halfExtents(c.e.collider);
    const off = Math.max(ext.x, ext.y * (this.view === 'side' ? 0 : 1)) + asset.radius + 2;
    this.spawnProjectile(asset, c.e.x + aim.x * off, c.e.y + aim.y * off, aim, c, c.e.team);
    c.cooldown = c.e.fireCooldown;
  }

  private animate(c: RtCharacter, h: number): void {
    const e = c.e;
    const moving = this.view === 'side' ? Math.abs(c.vx) > 20 : Math.hypot(c.vx, c.vy) > 20;
    const anim = this.view === 'side' && !c.grounded ? e.animJump : moving ? e.animRun : e.animIdle;
    if (anim !== c.anim) {
      c.anim = anim;
      c.animTime = 0;
    } else c.animTime += h;
    c.hurt = Math.max(0, c.hurt - h);
  }

  spawnProjectile(asset: ProjectileAsset, x: number, y: number, dir: { x: number; y: number }, owner: RtCharacter | null, team: string): void {
    this.projectiles.push({
      x,
      y,
      vx: dir.x * asset.speed,
      vy: dir.y * asset.speed,
      life: asset.lifetime,
      bounces: asset.bounces,
      alive: true,
      asset,
      owner,
      team,
    });
  }

  private updateProjectiles(h: number): void {
    for (const p of this.projectiles) {
      p.life -= h;
      if (p.life <= 0) p.alive = false;
      const n = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * h) / Math.max(2, p.asset.radius)));
      const sh = h / n;
      for (let i = 0; i < n && p.alive; i++) {
        if (this.view === 'side') p.vy += this.scene.gravity * p.asset.gravityScale * sh;
        p.x += p.vx * sh;
        p.y += p.vy * sh;
        const col: Collider = { type: 'circle', c: { x: p.x, y: p.y }, r: p.asset.radius };
        for (const s of this.statics) {
          if (!s.e.solid) continue;
          const m = collide(col, s.col);
          if (!m) continue;
          if (p.bounces > 0) {
            p.bounces--;
            p.x += m.nx * m.depth;
            p.y += m.ny * m.depth;
            const vn = p.vx * m.nx + p.vy * m.ny;
            p.vx -= 2 * vn * m.nx;
            p.vy -= 2 * vn * m.ny;
          } else {
            p.alive = false;
            this.burst(p.x, p.y, p.asset.color, 6);
          }
          break;
        }
        if (!p.alive) break;
        for (const c of this.chars) {
          if (!c.alive || c === p.owner || (p.team && c.e.team === p.team)) continue;
          if (!collide(col, shapeCollider(c.e.collider, c.e.x, c.e.y))) continue;
          this.damage(c, p.asset.damage, Math.sign(p.vx));
          p.alive = false;
          this.burst(p.x, p.y, p.asset.color, 8);
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private damage(c: RtCharacter, amount: number, dirX: number): void {
    c.health -= amount;
    c.hurt = 0.4;
    c.vx += dirX * 180;
    if (this.view === 'side') c.vy -= 160;
    if (c.health <= 0) this.kill(c);
  }

  private kill(c: RtCharacter): void {
    if (!c.alive) return;
    c.alive = false;
    c.health = 0;
    this.burst(c.e.x, c.e.y, c.e.color, 24);
    this.log(`${c.e.name} was defeated`);
    if (c.isPlayer) c.respawnIn = 1.5;
  }

  private respawn(c: RtCharacter): void {
    Object.assign(c, { alive: true, health: c.e.maxHealth, vx: 0, vy: 0, hurt: 0.8, idleTime: 0 });
    c.e.x = c.spawn.x;
    c.e.y = c.spawn.y;
  }

  private burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      const max = 0.3 + Math.random() * 0.4;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: max, max, color, size: 2 + Math.random() * 3 });
    }
  }

  private updateParticles(h: number): void {
    for (const p of this.particles) {
      p.life -= h;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private updateCamera(dt: number, snap = false): void {
    const target = this.player() ?? this.chars.find((c) => c.isPlayer) ?? this.chars[0];
    if (!target) return;
    const p = project(this.view, target.e);
    const k = snap ? 1 : Math.min(1, dt * 6);
    this.camera.x += (p.x - this.camera.x) * k;
    this.camera.y += (p.y - this.camera.y) * k;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(r: Renderer, vp: Viewport, dpr: number): void {
    r.view = this.view;
    r.begin(vp, dpr, this.camera, this.scene.background);

    type Item = { key: { layer: number; depth: number }; draw: () => void };
    const items: Item[] = [];
    for (const s of this.statics) items.push({ key: entityOrderKey(this.view, s.e), draw: () => r.drawBlock(s.e) });
    for (const c of this.chars) {
      if (!c.alive) continue;
      items.push({ key: entityOrderKey(this.view, c.e), draw: () => r.drawCharacter(c.e, c) });
    }
    for (const p of this.projectiles) {
      items.push({
        key: { layer: this.view === 'side' ? 2 : 1, depth: depthOf(this.view, p) },
        draw: () => r.drawProjectile(p, { x: p.vx, y: p.vy }, p.asset, this.time),
      });
    }
    for (const it of inDrawOrder(items, (i) => i.key)) it.draw();
    r.drawParticles(this.particles);

    this.drawHud(r, vp, dpr);
  }

  private drawHud(r: Renderer, vp: Viewport, dpr: number): void {
    const ctx = r.ctx;
    r.screen(dpr);
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const pl = this.chars.find((c) => c.isPlayer);
    if (pl) {
      ctx.fillStyle = '#ff6b7a';
      ctx.fillText('♥'.repeat(Math.max(0, Math.ceil(pl.health))) || (pl.alive ? '' : 'respawning…'), 12, 22);
      if (pl.aiActive) {
        ctx.fillStyle = '#ffd166';
        ctx.fillText('AI in control – press any key to take over', 12, 42);
      } else if (pl.e.idleTakeover > 0 && pl.idleTime > 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`idle ${pl.idleTime.toFixed(1)} / ${pl.e.idleTakeover}s`, 12, 42);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const hint =
      this.view === 'side' ? '←→ / A D move · Space / W jump · J / X shoot' : 'Arrows / WASD move · J / X shoot';
    ctx.fillText(hint, 12, vp.height - 12);
  }
}

