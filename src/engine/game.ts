import type { AssetLookup, SpriteFrames } from './assets';
import { Camera, type Viewport } from './camera';
import { type DebugCounts, now } from './debug';
import { type Collider, collide, colliderBounds, pointInCollider, shapeCollider } from './collision';
import { createInstance } from './factory';
import { DEFAULT_STEP_SECONDS, GridMotion } from './grid';
import { CanvasGraphics } from './graphics';
import type { KeyPresses, KeyState, PointerState, StickState } from './input';
import { Chemistry, InteractionRules, type KindProps } from './interactions';
import { DEG2RAD, type Vec2, normalize, rotate } from './math';
import { type PathInfo, RtPath, RtZone, advance, nameMatches, worldPoints } from './paths';
import { BASE_FORM, expandLevel, findActorScene, findLevel, resolveInstance } from './prefabs';
import { depthOf, project } from './projection';
import { type ActorVisual, type Particle, type Renderer, characterOrderKey, entityOrderKey, inDrawOrder, wobble } from './renderer';
import { type ActorHost, type RtForm, RtActor, halfExtents } from './runtime';
import {
  type Actor,
  type CameraApi,
  type Hit,
  type HudApi,
  type InputApi,
  ScriptCache,
  type ScriptModule,
  type World,
} from './scripting';
import type { ActorEntity, ActorScene, BlockEntity, LevelScene, PathEntity, Project, ProjectileAsset, PropModifier, ViewMode, ZoneEntity } from './types';
import { clone } from './util';

const STEP = 1 / 60;
/** Spawning stops here, so a runaway spawner can't freeze the game. */
const MAX_ACTORS = 2000;

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
  owner: RtActor | null;
}

interface GameParticle extends Particle {
  vx: number;
  vy: number;
}

interface HudLine {
  text: string;
  x: number;
  y: number;
  color: string;
}

/** Floating text ("+5") in world space. */
interface PopText {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
}

/** Expanding ring of a blast. */
interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  color: string;
}

const POP_SECONDS = 0.9;
const RING_SECONDS = 0.3;

export interface GameOptions {
  zoom?: number;
  /** Initial camera centre (projected space); it stays there until a script follows something. */
  cameraAt?: { x: number; y: number };
  onLog?: (msg: string) => void;
  scripts?: ScriptCache;
  /** Without cameraAt: if no script follows an actor, the first render fits the whole level on screen. */
  fit?: boolean;
}

/**
 * Runs one level. The engine only provides mechanics (physics, projectiles, queries,
 * drawing); every decision is made by the actors' TypeScript modules.
 */
export class Game implements World, ActorHost {
  readonly scene: LevelScene;
  readonly view: ViewMode;
  readonly bottom: number;
  time = 0;

  readonly actors: RtActor[] = [];
  private statics: StaticBody[] = [];
  private projectiles: RtProjectile[] = [];
  private particles: GameParticle[] = [];
  private hudLines: HudLine[] = [];
  private pressed: ReadonlySet<string> = new Set();
  private idle = 0;
  private acc = 0;
  private dt = STEP;
  private followed: Actor | null = null;
  private readonly cam = new Camera();
  private failed = new Set<RtActor>();
  /** Accumulated since the last takeTimings() call. */
  private scriptMs = 0;
  private steps = 0;
  /** Nesting of script calls (a script may trigger hooks of another actor), timed once. */
  private callDepth = 0;
  private readonly rules: InteractionRules;
  private readonly chemistry: Chemistry<RtActor>;
  private readonly grid = new GridMotion<RtActor>(this);
  /** Screen size at the last render (hud.width / height). */
  private screenW = 0;
  private screenH = 0;
  private readonly project: Project;
  private readonly scripts: ScriptCache;
  private pathEnts: PathEntity[] = [];
  private zoneEnts: ZoneEntity[] = [];
  private paths: RtPath[] = [];
  private zones: RtZone[] = [];
  private pops: PopText[] = [];
  private rings: Ring[] = [];
  private watches: string[] = [];
  private clicked = false;
  private spawned = 0;
  private warned = new Set<string>();
  readonly vars: Record<string, unknown> = {};
  ended: 'won' | 'lost' | null = null;
  private endText = '';
  private fitPending: boolean;
  /** Set when the player asks to play again after the end (Enter / click); the host makes a new Game. */
  restartRequested = false;

  readonly input: InputApi;
  readonly camera: CameraApi;
  readonly hud: HudApi;

  constructor(
    project: Project,
    sceneId: string,
    private readonly assets: AssetLookup & SpriteFrames,
    private readonly keys: KeyState & KeyPresses & Partial<StickState> & Partial<PointerState>,
    private readonly opts: GameOptions = {},
  ) {
    const level = findLevel(project, sceneId) ?? project.scenes.find((s): s is LevelScene => s.kind === 'level');
    if (!level) throw new Error('Project has no level scene to play');
    this.project = project;
    this.scene = clone(level);
    this.view = this.scene.view;
    this.cam.zoom = opts.zoom ?? 1;
    if (opts.cameraAt) Object.assign(this.cam, opts.cameraAt);
    this.fitPending = !!opts.fit && !opts.cameraAt;

    const game = this;
    this.input = {
      isDown: (...codes) => keys.isDown(...codes),
      pressed: (...codes) => codes.some((c) => this.pressed.has(c)),
      get idleTime() {
        return game.idle;
      },
      get stick() {
        return game.stick();
      },
      get mouse() {
        return game.mouse();
      },
      get mouseDown() {
        return !!keys.pointer?.().down;
      },
      get clicked() {
        return game.clicked;
      },
    };
    this.camera = {
      follow: (a) => (this.followed = a),
      get zoom() {
        return game.cam.zoom;
      },
      set zoom(z: number) {
        game.cam.zoom = Math.max(0.1, Math.min(8, z));
      },
    };
    this.hud = {
      text: (text, x, y, color = '#ffffff') => this.hudLines.push({ text, x, y, color }),
      get width() {
        return game.screenW;
      },
      get height() {
        return game.screenH;
      },
      watch: (name) => {
        if (!this.watches.includes(name)) this.watches.push(name);
      },
    };

    this.rules = new InteractionRules(project.interactions);
    this.scripts = opts.scripts ?? new ScriptCache();
    // Rooms, buildings…: nested levels become part of this one.
    const entities = expandLevel(project, this.scene, (m) => this.log(m)).map((x) => x.e);
    for (const e of entities) {
      if (e.type === 'block') this.statics.push({ e, col: shapeCollider(e.shape, e.x, e.y, e.rotation) });
      else if (e.type === 'path') {
        this.pathEnts.push(e);
        if (e.points.length) this.paths.push(new RtPath(e.name, worldPoints(e)));
      } else if (e.type === 'zone') {
        this.zoneEnts.push(e);
        this.zones.push(new RtZone(e.name, worldPoints(e)));
      } else if (e.type === 'instance') {
        const a = resolveInstance(project, e);
        if (!a) {
          this.log(`${e.name}: missing actor scene`);
          continue;
        }
        this.actors.push(this.makeActor(a));
      }
    }
    for (const e of entities) {
      if (e.type !== 'projectile') continue;
      const asset = this.assets.get(e.projectileId, 'projectile');
      if (asset) this.spawnProjectile(asset, e.x, e.y, rotate({ x: 1, y: 0 }, e.rotation * DEG2RAD), null);
    }
    this.bottom = this.statics.length ? Math.max(...this.statics.map((s) => colliderBounds(s.col).maxY)) + 800 : 5000;
    this.chemistry = new Chemistry(this.rules, this.statics.map((s) => s.e), {
      actors: this.actors,
      hitActor: (a, hit) => this.hitActor(a, hit),
      burst: (x, y, color, count) => this.burst(x, y, color, count),
      statusChanged: (a, status, added) => this.statusChanged(a, status, added),
    });

    for (const a of this.actors) this.call(a, 'init', () => a.module?.init?.(a, this));
    for (const a of this.actors) this.startForm(a);
    this.updateCamera(1, true);
  }

  private makeActor(a: ActorEntity): RtActor {
    const module = this.compile(this.scripts, a.name, a.script);
    return new RtActor(a, { ...this.scripts.props(a.script), ...a.props }, module, this.formsOf(this.project, this.scripts, a), this);
  }

  private startForm(a: RtActor): void {
    if (a.e.form && a.e.form !== BASE_FORM && !a.setForm(a.e.form)) this.log(`${a.name}: unknown form "${a.e.form}"`);
  }

  /** Logs a message once per game (for mistakes repeated every frame). */
  private warnOnce(msg: string): void {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    this.log(msg);
  }

  private compile(scripts: ScriptCache, label: string, source: string): ScriptModule | null {
    const compiled = scripts.get(source);
    if (!compiled.ok) this.log(`[${label}] script error: ${compiled.error}`);
    return compiled.ok ? compiled.module : null;
  }

  /** The forms of an actor, each resolved from its scene (the form scene's own forms are ignored). */
  private formsOf(project: Project, scripts: ScriptCache, a: ActorEntity): Map<string, RtForm> {
    const forms = new Map<string, RtForm>();
    for (const ref of a.forms) {
      const scene = findActorScene(project, ref.sceneId);
      if (!scene) {
        this.log(`${a.name}: form "${ref.name}" has no scene`);
        continue;
      }
      const def = clone(scene.actor);
      forms.set(ref.name, {
        name: ref.name,
        def,
        module: this.compile(scripts, `${a.name}:${ref.name}`, def.script),
        props: scripts.props(def.script),
      });
    }
    return forms;
  }

  // ---------------------------------------------------------------------------
  // World API
  // ---------------------------------------------------------------------------

  get gravity(): number {
    return this.scene.gravity;
  }

  get gridSize(): number {
    return this.scene.gridSize;
  }

  emit(element: string, x: number, y: number, radius: number): void {
    this.chemistry.emit(element, x, y, radius);
  }

  popText(text: string, x: number, y: number, color = '#ffffff'): void {
    this.pops.push({ text, x, y, color, life: POP_SECONDS });
  }

  path(name: string): PathInfo | null {
    return this.findPath(name);
  }

  private findPath(name: string): RtPath | null {
    return this.paths.find((p) => p.name === name) ?? this.paths.find((p) => nameMatches(p.name, name)) ?? null;
  }

  inZone(x: number, y: number, zone: string): boolean {
    return this.zones.some((z) => nameMatches(z.name, zone) && z.contains({ x, y }));
  }

  spawn(sceneName: string, x: number, y: number): Actor | null {
    const scene = this.project.scenes.find((s): s is ActorScene => s.kind === 'actor' && s.name === sceneName);
    if (!scene) {
      this.warnOnce(`spawn: there is no actor scene named "${sceneName}"`);
      return null;
    }
    if (this.actors.length >= MAX_ACTORS) {
      this.warnOnce(`spawn: too many actors (${MAX_ACTORS}), "${sceneName}" not spawned`);
      return null;
    }
    const inst = createInstance(scene, x, y);
    inst.id = `${scene.id}#${++this.spawned}`;
    const e = resolveInstance(this.project, inst)!;
    const a = this.makeActor(e);
    this.actors.push(a);
    this.call(a, 'init', () => a.module?.init?.(a, this));
    this.startForm(a);
    return a;
  }

  endGame(won: boolean, message?: string): void {
    if (this.ended) return;
    this.ended = won ? 'won' : 'lost';
    this.endText = message ?? (won ? 'You win!' : 'Game over');
  }

  /** The pointer in world coordinates (through the camera of the last render). */
  private mouse(): Vec2 {
    const p = this.keys.pointer?.();
    if (!p) return { x: 0, y: 0 };
    return this.cam.screenToWorld(this.view, p, { width: this.screenW, height: this.screenH });
  }

  /** The touch joystick if it is pushed, else arrows / WASD as a unit vector. */
  private stick(): { x: number; y: number } {
    const analog = this.keys.stick?.();
    if (analog && (analog.x || analog.y)) return analog;
    const k = this.keys;
    const x = (k.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (k.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    const y = (k.isDown('ArrowDown', 'KeyS') ? 1 : 0) - (k.isDown('ArrowUp', 'KeyW') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  /** A solid block covers the point (grid movement). */
  wallAt(x: number, y: number): boolean {
    return this.statics.some((s) => s.e.solid && pointInCollider({ x, y }, s.col));
  }

  log(...args: unknown[]): void {
    this.opts.onLog?.(args.map(String).join(' '));
  }

  find(tag: string): Actor | null {
    return this.actors.find((a) => a.alive && !a.destroyed && a.is(tag)) ?? null;
  }

  all(tag?: string): Actor[] {
    return this.actors.filter((a) => !a.destroyed && (tag === undefined || a.is(tag)));
  }

  nearest(from: Actor, tag?: string): Actor | null {
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const a of this.actors) {
      if (a === from || !a.alive || a.destroyed || (tag !== undefined && !a.is(tag))) continue;
      const d = this.distance(from, a);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  distance(a: Actor, b: Actor): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  overlaps(a: Actor, b: Actor): boolean {
    return !!collide(this.colliderOf(a), this.colliderOf(b));
  }

  groundAhead(actor: Actor, dir: number): boolean {
    const b = this.rt(actor).worldBody();
    const h = halfExtents(b.shape);
    const probe = { x: b.x + dir * (h.x + 14), y: b.y + h.y + 6 };
    return this.statics.some((s) => s.e.solid && pointInCollider(probe, s.col));
  }

  burst(x: number, y: number, color: string, count = 16): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      const max = 0.3 + Math.random() * 0.4;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: max, max, color, size: 2 + Math.random() * 3 });
    }
  }

  private rt(a: Actor): RtActor {
    return a as RtActor;
  }

  private colliderOf(a: Actor): Collider {
    const b = this.rt(a).worldBody();
    return shapeCollider(b.shape, b.x, b.y);
  }

  // ---------------------------------------------------------------------------
  // ActorHost: mechanics offered to actors
  // ---------------------------------------------------------------------------

  moveAndSlide(a: RtActor): void {
    const side = this.view === 'side';
    a.x += a.vx * this.dt;
    a.y += a.vy * this.dt;
    a.grounded = false;
    a.hitWall = 0;
    // Solid blocks, plus actors whose kinds make them solid (crates, boulders…).
    const obstacles = [
      ...this.statics.filter((s) => s.e.solid).map((s) => s.col),
      ...this.actors.filter((o) => o !== a && !o.destroyed && o.phys.solid).map((o) => this.colliderOf(o)),
    ];
    for (let iter = 0; iter < 4; iter++) {
      let any = false;
      for (const col of obstacles) {
        const m = collide(this.colliderOf(a), col);
        if (!m) continue;
        any = true;
        if (side && m.ny < -0.6) {
          // Floor or walkable slope: push straight up so standing still doesn't slide.
          a.y -= m.depth / -m.ny;
          if (a.vy > 0) a.vy = 0;
          a.grounded = true;
        } else {
          a.x += m.nx * m.depth;
          a.y += m.ny * m.depth;
          const vn = a.vx * m.nx + a.vy * m.ny;
          if (vn < 0) {
            a.vx -= vn * m.nx;
            a.vy -= vn * m.ny;
          }
          if (Math.abs(m.nx) > 0.7) a.hitWall = m.nx > 0 ? -1 : 1;
        }
      }
      if (!any) break;
    }
  }

  followPath(a: RtActor, name: string, speed: number): boolean {
    const path = this.findPath(name);
    if (!path || !path.points.length) {
      this.warnOnce(`${a.name}: there is no path named "${name}"`);
      return false;
    }
    if (a.pathRun?.path !== name) a.pathRun = { path: name, approaching: true, d: 0, done: false };
    const run = a.pathRun;
    if (run.done) {
      a.vx = a.vy = 0;
      return true;
    }
    const to = advance(run, path, a, (Number(speed) || 0) * this.dt);
    a.vx = (to.x - a.x) / this.dt;
    a.vy = (to.y - a.y) / this.dt;
    if (Math.abs(to.x - a.x) > 0.01) a.facing = to.x > a.x ? 1 : -1;
    a.x = to.x;
    a.y = to.y;
    return run.done;
  }

  shootAt(a: RtActor, projectile: string, target: Actor | null, aimAhead: boolean): boolean {
    if (!target || target === a) return false;
    let dx = target.x - a.x;
    let dy = target.y - a.y;
    const asset = this.assets.list('projectile').find((p) => p.name === projectile);
    if (aimAhead && asset && asset.speed > 0) {
      // Where the target will be when the projectile gets there: |d + v·t| = speed·t.
      const { vx, vy } = target;
      const qa = vx * vx + vy * vy - asset.speed * asset.speed;
      const qb = 2 * (dx * vx + dy * vy);
      const qc = dx * dx + dy * dy;
      let t = -1;
      if (Math.abs(qa) < 1e-6) t = qb < 0 ? -qc / qb : -1;
      else {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) {
          const r = Math.sqrt(disc);
          const t1 = (-qb - r) / (2 * qa);
          const t2 = (-qb + r) / (2 * qa);
          t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
        }
      }
      if (t > 0 && t < 5) {
        dx += vx * t;
        dy += vy * t;
      }
    }
    return this.shoot(a, projectile, dx, dy);
  }

  shoot(a: RtActor, projectile: string, dirX: number, dirY: number): boolean {
    const asset = this.assets.list('projectile').find((p) => p.name === projectile);
    if (!asset) return false;
    const dir = normalize({ x: dirX, y: dirY });
    if (!dir.x && !dir.y) return false;
    const b = a.worldBody();
    const ext = halfExtents(b.shape);
    const off = Math.max(ext.x, this.view === 'side' ? 0 : ext.y) + asset.radius + 2;
    this.spawnProjectile(asset, b.x + dir.x * off, b.y + dir.y * off, dir, a);
    return true;
  }

  switchForm(a: RtActor, name: string, seconds: number): boolean {
    const form = name === BASE_FORM ? null : a.forms.get(name);
    if (form === undefined) return false;
    if (form === a.activeForm) {
      a.formLeft = seconds; // taking the same pill again renews it
      return true;
    }
    // Keep the feet where they are, so growing doesn't sink into the floor.
    const feet = (b = a.worldBody()) => b.y + halfExtents(b.shape).y;
    const before = feet();
    a.applyForm(form, seconds);
    if (this.view === 'side') a.y += before - feet();
    const init = form?.module?.init;
    if (init) this.call(a, `${name}.init`, () => init(a, this));
    return true;
  }

  hitActor(a: RtActor, hit: Hit): boolean {
    if (a.destroyed) return false;
    const hooks = [a.activeForm?.module?.onHit, a.module?.onHit].filter((f) => !!f);
    if (!hooks.length) return false;
    for (const onHit of hooks) if (this.call(a, 'onHit', () => onHit(a, this, hit)) === false) return false;
    return true;
  }

  addStatus(a: RtActor, name: string, seconds?: number): boolean {
    return this.chemistry.addStatus(a, name, seconds);
  }

  removeStatus(a: RtActor, name: string): void {
    this.chemistry.removeStatus(a, name);
  }

  kindProps(kinds: readonly string[]): KindProps {
    return this.rules.kindProps(kinds);
  }

  statusModifiers(statuses: Iterable<string>): PropModifier[] {
    return this.rules.modifiers(statuses);
  }

  gridMove(a: RtActor, dx: number, dy: number, seconds = DEFAULT_STEP_SECONDS): boolean {
    return this.grid.move(a, dx, dy, seconds);
  }

  /** Runs onStatus hooks: the active form's, then the actor's own. */
  private statusChanged(a: RtActor, status: string, added: boolean): void {
    for (const [label, mod] of [[`${a.form}.onStatus`, a.activeForm?.module], ['onStatus', a.module]] as const) {
      const fn = mod?.onStatus;
      if (fn && !a.destroyed) this.call(a, label, () => fn(a, this, status, added));
    }
  }

  animationLength(spriteId: string | null, animation: string): number {
    const sprite = this.assets.get(spriteId, 'sprite');
    return sprite ? this.assets.animDuration(sprite, animation) : Infinity;
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

  /** Script time and fixed steps since the previous call (for the debug overlay). */
  takeTimings(): { scriptMs: number; steps: number } {
    const t = { scriptMs: this.scriptMs, steps: this.steps };
    this.scriptMs = 0;
    this.steps = 0;
    return t;
  }

  counts(): DebugCounts {
    return { actors: this.actors.length, projectiles: this.projectiles.length, particles: this.particles.length };
  }

  step(h: number): void {
    this.steps++;
    this.dt = h;
    this.pressed = this.keys.consumePressed();
    this.clicked = (this.keys.consumeClicks?.() ?? 0) > 0;
    if (this.ended) {
      // Frozen: only the effects finish; Enter or a click asks for a new game.
      if (this.pressed.has('Enter') || this.pressed.has('Space') || this.clicked) this.restartRequested = true;
      this.updateParticles(h);
      return;
    }
    this.time += h;
    this.idle = this.pressed.size || this.clicked || this.keys.anyDown() ? 0 : this.idle + h;
    this.hudLines = [];
    this.grid.step(h);
    for (const a of this.actors) {
      if (a.destroyed) continue;
      a.stateHolder.tick(h);
      a.flashTime = Math.max(0, a.flashTime - h);
      a.formTime += h;
      a.formLeft -= h;
      if (a.formLeft <= 0) this.switchForm(a, BASE_FORM, Infinity);
      const update = a.module?.update;
      if (update) this.call(a, 'update', () => update(a, this, h));
      const formUpdate = a.activeForm?.module?.update;
      if (formUpdate && !a.destroyed) this.call(a, `${a.form}.update`, () => formUpdate(a, this, h));
      this.recordTrail(a);
    }
    this.chemistry.step(h);
    this.updateProjectiles(h);
    this.updateParticles(h);
    for (let i = this.actors.length - 1; i >= 0; i--) if (this.actors[i].destroyed) this.actors.splice(i, 1);
  }

  /**
   * Runs a script hook; a throwing actor is logged once and its script stops.
   * Draw hooks are not timed: they belong to rendering, not to the simulation.
   */
  private call(a: RtActor, hook: string, fn: () => unknown, timed = true): unknown {
    if (this.failed.has(a)) return undefined;
    const t0 = now();
    if (timed) this.callDepth++;
    try {
      return fn();
    } catch (err) {
      this.failed.add(a);
      this.log(`[${a.name}] ${hook}() error: ${(err as Error).message} (script stopped)`);
      return undefined;
    } finally {
      if (timed && --this.callDepth === 0) this.scriptMs += now() - t0;
    }
  }

  /** Runs a draw hook of the actor and of its active form (in that order), origin at (x, y). */
  private drawHook(g: CanvasGraphics, a: RtActor, hook: 'drawUnder' | 'draw' | 'drawHud', x: number, y: number): void {
    for (const [label, mod] of [[hook, a.module], [`${a.form}.${hook}`, a.activeForm?.module]] as const) {
      const fn = mod?.[hook];
      if (fn) this.call(a, label, () => g.run(x, y, (gg) => fn(a, this, gg)), false);
    }
  }

  /** Afterimages for the trail effect: a snapshot every few steps while moving. */
  private recordTrail(a: RtActor): void {
    const n = Math.round(a.look.trail);
    if (n <= 0 || !a.visible) {
      if (a.trail.length) a.trail = [];
      return;
    }
    if (Math.round(this.time / this.dt) % 3) return;
    const last = a.trail[a.trail.length - 1];
    if (last && Math.hypot(last.x - a.x, last.y - a.y) < 2) {
      a.trail.shift(); // standing still: the trail catches up
      return;
    }
    const st = a.stateHolder;
    a.trail.push({ x: a.x, y: a.y, facing: a.facing, anim: st.animation, animTime: st.time, body: a.worldBody() });
    while (a.trail.length > n) a.trail.shift();
  }

  spawnProjectile(asset: ProjectileAsset, x: number, y: number, dir: { x: number; y: number }, owner: RtActor | null): void {
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
            this.blast(p, null);
          }
          break;
        }
        if (!p.alive) break;
        for (const a of this.actors) {
          if (a === p.owner || a.destroyed) continue;
          if (!collide(col, this.colliderOf(a))) continue;
          const hit: Hit = { damage: p.asset.damage, from: p.owner, x: p.x, y: p.y };
          if (!this.hitActor(a, hit)) continue;
          p.alive = false;
          this.burst(p.x, p.y, p.asset.color, 8);
          this.blast(p, a);
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  /** Splash damage of a projectile that hit something: every other actor within its blast radius. */
  private blast(p: RtProjectile, direct: RtActor | null): void {
    const r = p.asset.blast ?? 0;
    if (r <= 0) return;
    const area: Collider = { type: 'circle', c: { x: p.x, y: p.y }, r };
    for (const a of this.actors.slice()) {
      if (a === p.owner || a === direct || a.destroyed) continue;
      if (collide(area, this.colliderOf(a))) this.hitActor(a, { damage: p.asset.damage, from: p.owner, x: p.x, y: p.y });
    }
    this.rings.push({ x: p.x, y: p.y, r, life: RING_SECONDS, color: p.asset.color });
  }

  private updateParticles(h: number): void {
    for (const t of this.pops) {
      t.life -= h;
      t.y -= (28 / POP_SECONDS) * h;
    }
    this.pops = this.pops.filter((t) => t.life > 0);
    for (const r of this.rings) r.life -= h;
    this.rings = this.rings.filter((r) => r.life > 0);
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
    const t = this.followed;
    if (!t) return;
    const p = project(this.view, t);
    const k = snap ? 1 : Math.min(1, dt * 6);
    this.cam.x += (p.x - this.cam.x) * k;
    this.cam.y += (p.y - this.cam.y) * k;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Camera on the whole level: blocks, paths, zones and actors. */
  private fitLevel(vp: Viewport): void {
    const pts: Vec2[] = [];
    for (const s of this.statics) {
      const b = colliderBounds(s.col);
      pts.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY });
    }
    for (const e of [...this.pathEnts, ...this.zoneEnts]) pts.push(...worldPoints(e));
    for (const a of this.actors) if (a.visible) pts.push(a);
    if (!pts.length) return;
    const sp = pts.map((p) => project(this.view, p));
    const xs = sp.map((p) => p.x);
    const ys = sp.map((p) => p.y);
    this.cam.fit(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), vp, 40);
  }

  render(r: Renderer, vp: Viewport, dpr: number): void {
    if (this.fitPending && vp.width > 0) {
      this.fitPending = false;
      if (!this.followed) this.fitLevel(vp);
    }
    r.view = this.view;
    r.begin(vp, dpr, this.cam, this.scene.background);
    this.screenW = vp.width;
    this.screenH = vp.height;
    const g = new CanvasGraphics(r.ctx);

    type Item = { key: { layer: number; depth: number }; draw: () => void };
    const items: Item[] = [];
    for (const s of this.statics) items.push({ key: entityOrderKey(this.view, s.e), draw: () => r.drawBlock(s.e) });
    for (const z of this.zoneEnts) if (z.visible) items.push({ key: entityOrderKey(this.view, z), draw: () => r.drawZone(worldPoints(z), z.color) });
    for (const p of this.pathEnts) if (p.visible) items.push({ key: entityOrderKey(this.view, p), draw: () => r.drawPath(worldPoints(p), p.width, p.color) });
    for (const a of this.actors) {
      if (!a.visible) continue;
      const look = a.look;
      const drawn = { x: a.x, y: a.y, spriteId: look.spriteId, spriteScale: look.spriteScale * look.scale, spriteOffsetY: look.spriteOffsetY * look.scale };
      const visual: ActorVisual = {
        facing: a.facing,
        anim: a.stateHolder.animation,
        animTime: a.stateHolder.time,
        flash: a.flashTime,
        color: a.color,
        body: a.worldBody(),
        squash: wobble(look.wobble, this.time, a.spawnX),
      };
      const key = characterOrderKey(this.view, a);
      a.trail.forEach((t, i) => {
        const ghost: ActorVisual = { ...t, flash: 0, color: a.color, alpha: (0.45 * (i + 1)) / (a.trail.length + 1) };
        items.push({ key: { ...key, depth: key.depth - 0.001 }, draw: () => r.drawActor({ ...drawn, x: t.x, y: t.y }, ghost) });
      });
      items.push({
        key,
        draw: () => {
          const at = r.P(a);
          this.drawHook(g, a, 'drawUnder', at.x, at.y);
          r.drawActor(drawn, visual);
          this.drawHook(g, a, 'draw', at.x, at.y);
        },
      });
    }
    for (const p of this.projectiles) {
      items.push({
        key: { layer: this.view === 'side' ? 2 : 1, depth: depthOf(this.view, p) },
        draw: () => r.drawProjectile(p, { x: p.vx, y: p.vy }, p.asset, this.time),
      });
    }
    for (const it of inDrawOrder(items, (i) => i.key)) it.draw();
    r.drawParticles(this.particles);
    this.drawEffects(r);

    const ctx = r.ctx;
    r.screen(dpr);
    // Script HUD drawing first, so hud.text() stays readable on top of bars.
    for (const a of this.actors) if (!a.destroyed) this.drawHook(g, a, 'drawHud', 0, 0);
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (const l of this.hudLines) {
      ctx.fillStyle = l.color;
      // Negative y counts from the bottom of the screen.
      ctx.fillText(l.text, l.x, l.y < 0 ? vp.height + l.y : l.y);
    }
    this.drawWatches(ctx);
    if (this.ended) this.drawBanner(ctx, vp);
  }

  /** Blast rings and floating texts (world space). */
  private drawEffects(r: Renderer): void {
    const ctx = r.ctx;
    ctx.save();
    for (const ring of this.rings) {
      const t = 1 - ring.life / RING_SECONDS;
      const c = r.P(ring);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 3 / r.zoom;
      ctx.beginPath();
      if (this.view === 'isometric') ctx.ellipse(c.x, c.y, ring.r * t * 1.41, ring.r * t * 0.71, 0, 0, Math.PI * 2);
      else ctx.arc(c.x, c.y, ring.r * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `bold ${Math.round(13 / Math.max(0.5, r.zoom) * 10) / 10}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const t of this.pops) {
      const c = r.P(t);
      ctx.globalAlpha = Math.min(1, (t.life / POP_SECONDS) * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(t.text, c.x + 1 / r.zoom, c.y + 1 / r.zoom);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, c.x, c.y);
    }
    ctx.restore();
  }

  /** Game variables shown with hud.watch(), top-left. */
  private drawWatches(ctx: CanvasRenderingContext2D): void {
    if (!this.watches.length) return;
    ctx.save();
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = 12;
    for (const name of this.watches) {
      const v = this.vars[name];
      const text = `${name}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : String(v ?? 0)}`;
      const w = ctx.measureText(text).width + 20;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(10, y, w, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, 20, y + 13);
      y += 32;
    }
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(Math.min(64, vp.width / 10))}px system-ui, sans-serif`;
    ctx.fillStyle = this.ended === 'won' ? '#7ee787' : '#ff6b6b';
    ctx.fillText(this.endText, vp.width / 2, vp.height / 2 - 16);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#ddd';
    ctx.fillText('Press Enter or click to play again', vp.width / 2, vp.height / 2 + 32);
    ctx.restore();
  }
}
