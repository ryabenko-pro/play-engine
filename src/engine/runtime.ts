import { type Collider, shapeCollider } from './collision';
import type { GridTween } from './grid';
import { type ActiveStatus, type KindProps, inflate } from './interactions';
import type { Vec2 } from './math';
import type { PathRun } from './paths';
import { BASE_FORM } from './prefabs';
import type { Actor, Hit, ScriptModule } from './scripting';
import { StateHolder } from './states';
import type { ActorDef, ActorEntity, BodyShape, PlacedBody, Positioned, PropModifier, PropValues, ViewMode } from './types';

/** A collider placed in the world. */
export interface WorldBody {
  shape: BodyShape;
  x: number;
  y: number;
}

export function halfExtents(shape: BodyShape): Vec2 {
  return shape.kind === 'rect' ? { x: shape.w / 2, y: shape.h / 2 } : { x: shape.r, y: shape.r };
}

/**
 * The collider actually used for a view. An actor scene is authored once; in
 * top-down / isometric levels its body becomes a round footprint on the ground plane.
 */
export function bodyShape(view: ViewMode, shape: BodyShape): BodyShape {
  if (view === 'side' || shape.kind === 'circle') return shape;
  return { kind: 'circle', r: shape.w / 2 };
}

export function scaleShape(shape: BodyShape, k: number): BodyShape {
  if (k === 1) return shape;
  return shape.kind === 'rect' ? { kind: 'rect', w: shape.w * k, h: shape.h * k } : { kind: 'circle', r: shape.r * k };
}

/**
 * Where an actor's collider is: the state's own body if it has one, else the base collider,
 * scaled around the actor position. Offsets only apply in side view (x mirrored with facing);
 * other views use a footprint.
 */
export function worldBody(view: ViewMode, pos: Positioned, base: BodyShape, override: PlacedBody | null, facing: number, scale = 1): WorldBody {
  if (!override) return { shape: bodyShape(view, scaleShape(base, scale)), x: pos.x, y: pos.y };
  if (view !== 'side') return { shape: bodyShape(view, scaleShape(override.shape, scale)), x: pos.x, y: pos.y };
  return {
    shape: scaleShape(override.shape, scale),
    x: pos.x + override.offsetX * scale * (facing < 0 ? -1 : 1),
    y: pos.y + override.offsetY * scale,
  };
}

/** A form of a runtime actor: the form scene's definition plus its compiled script. */
export interface RtForm {
  name: string;
  def: ActorDef;
  module: ScriptModule | null;
  /** The form script's exported props (laid over the container's). */
  props: PropValues;
}

/** One afterimage of the trail effect. */
export interface TrailFrame {
  x: number;
  y: number;
  facing: number;
  anim: string;
  animTime: number;
  body: WorldBody;
}

// ---------------------------------------------------------------------------
// Services the game provides to actors
// ---------------------------------------------------------------------------

export interface Mover {
  moveAndSlide(a: RtActor): void;
}

export interface Shooter {
  shoot(a: RtActor, projectile: string, dirX: number, dirY: number): boolean;
  shootAt(a: RtActor, projectile: string, target: Actor | null, aimAhead: boolean): boolean;
}

export interface PathMover {
  /** One frame along a path; true once at its end. */
  followPath(a: RtActor, name: string, speed: number): boolean;
}

export interface AnimationClock {
  animationLength(spriteId: string | null, animation: string): number;
}

export interface FormSwitcher {
  switchForm(a: RtActor, name: string, seconds: number): boolean;
}

export interface HitDealer {
  /** Runs the actor's onHit hooks; false if ignored. */
  hitActor(a: RtActor, hit: Hit): boolean;
}

export interface StatusHost {
  addStatus(a: RtActor, name: string, seconds?: number): boolean;
  removeStatus(a: RtActor, name: string): void;
  kindProps(kinds: readonly string[]): KindProps;
  statusModifiers(statuses: Iterable<string>): PropModifier[];
}

export interface GridMover {
  gridMove(a: RtActor, dx: number, dy: number, seconds?: number): boolean;
}

export type ActorHost = Mover & Shooter & PathMover & AnimationClock & FormSwitcher & HitDealer & StatusHost & GridMover & { readonly view: ViewMode };

/** Runtime actor. Implements the script API; engine internals stay outside `Actor`. */
export class RtActor implements Actor {
  vx = 0;
  vy = 0;
  grounded = false;
  hitWall = 0;
  facing = 1;
  color: string;
  visible = true;
  health = 0;
  alive = true;
  destroyed = false;
  data: Record<string, unknown> = {};
  flashTime = 0;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly tags: readonly string[];
  readonly stateHolder: StateHolder;
  /** Definition in use: the active form's, or the actor's own. */
  look: ActorDef;
  activeForm: RtForm | null = null;
  formTime = 0;
  formLeft = Infinity;
  trail: TrailFrame[] = [];
  readonly activeStatuses = new Map<string, ActiveStatus>();
  /** Physical properties from the kinds (solid, pushable, weight, strength, emissions). */
  phys: KindProps;
  tween: GridTween | null = null;
  pathRun: PathRun | null = null;
  private merged: Readonly<PropValues>;
  private kindList: readonly string[] = [];

  constructor(
    readonly e: ActorEntity,
    /** Script defaults merged with instance overrides. */
    readonly baseProps: Readonly<PropValues>,
    readonly module: ScriptModule | null,
    readonly forms: ReadonlyMap<string, RtForm>,
    private readonly host: ActorHost,
  ) {
    this.spawnX = e.x;
    this.spawnY = e.y;
    this.color = e.color;
    this.look = e;
    this.merged = baseProps;
    this.tags = e.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    this.stateHolder = new StateHolder(e);
    this.phys = host.kindProps([]);
    this.updateKinds();
  }

  get kinds(): readonly string[] {
    return this.kindList;
  }

  /** Own kinds plus the active form's. */
  private updateKinds(): void {
    this.kindList = [...new Set([...(this.e.kinds ?? []), ...(this.activeForm?.def.kinds ?? [])])];
    this.phys = this.host.kindProps(this.kindList);
  }

  /** Props: script defaults ← instance ← active form, then multiplied by status modifiers. */
  refreshProps(): void {
    const merged: PropValues = this.activeForm ? { ...this.baseProps, ...this.activeForm.props } : { ...this.baseProps };
    for (const m of this.host.statusModifiers(this.activeStatuses.keys())) {
      const v = merged[m.prop];
      if (typeof v === 'number') merged[m.prop] = v * m.factor;
    }
    this.merged = merged;
  }

  get statuses(): readonly string[] {
    return [...this.activeStatuses.keys()];
  }
  hasStatus(name: string): boolean {
    return this.activeStatuses.has(name);
  }
  statusLeft(name: string): number {
    return Math.max(0, this.activeStatuses.get(name)?.left ?? 0);
  }
  addStatus(name: string, seconds?: number): boolean {
    return this.host.addStatus(this, name, seconds);
  }
  removeStatus(name: string): void {
    this.host.removeStatus(this, name);
  }

  get moving(): boolean {
    return !!this.tween;
  }
  gridMove(dx: number, dy: number, seconds?: number): boolean {
    return this.host.gridMove(this, dx, dy, seconds);
  }

  /** The collider grown by `m` on every side (how far an emission reaches). */
  reach(m: number): Collider {
    const b = this.worldBody();
    return shapeCollider(inflate(b.shape, m), b.x, b.y);
  }

  get props(): Readonly<PropValues> {
    return this.merged;
  }

  get id(): string {
    return this.e.id;
  }
  get name(): string {
    return this.e.name;
  }
  get x(): number {
    return this.e.x;
  }
  set x(v: number) {
    this.e.x = v;
  }
  get y(): number {
    return this.e.y;
  }
  set y(v: number) {
    this.e.y = v;
  }

  is(tag: string): boolean {
    return this.tags.includes(tag) || this.kindList.includes(tag);
  }

  moveAndSlide(): void {
    this.host.moveAndSlide(this);
  }

  followPath(name: string, speed: number): boolean {
    return this.host.followPath(this, name, speed);
  }
  get pathDistance(): number {
    return this.pathRun?.d ?? 0;
  }

  flash(seconds: number): void {
    this.flashTime = Math.max(this.flashTime, seconds);
  }

  get state(): string {
    return this.stateHolder.name;
  }
  get stateTime(): number {
    return this.stateHolder.time;
  }
  get animationLength(): number {
    return this.host.animationLength(this.look.spriteId, this.stateHolder.animation);
  }
  setState(name: string): void {
    if (!this.stateHolder.set(name)) throw new Error(`setState: unknown state "${name}"`);
  }

  kill(): void {
    this.alive = false;
  }
  revive(): void {
    this.alive = true;
  }
  destroy(): void {
    this.destroyed = true;
  }

  shoot(projectile: string, dirX: number, dirY: number): boolean {
    return this.host.shoot(this, projectile, dirX, dirY);
  }
  shootAt(projectile: string, target: Actor | null, aimAhead = true): boolean {
    return this.host.shootAt(this, projectile, target, aimAhead);
  }

  damage(amount: number, from: Actor | null = null): boolean {
    return this.host.hitActor(this, { damage: amount, from, x: from?.x ?? this.x, y: from?.y ?? this.y });
  }

  get form(): string {
    return this.activeForm?.name ?? BASE_FORM;
  }
  get scale(): number {
    return this.look.scale;
  }
  setForm(name: string, seconds?: number): boolean {
    return this.host.switchForm(this, name, seconds !== undefined && seconds > 0 ? seconds : Infinity);
  }

  /** Data side of a form switch (the host runs hooks and fixes the position). */
  applyForm(form: RtForm | null, seconds: number): void {
    this.activeForm = form;
    this.look = form?.def ?? this.e;
    this.formTime = 0;
    this.formLeft = seconds;
    this.refreshProps();
    this.updateKinds();
    this.stateHolder.retarget(this.look);
    this.color = this.look.color;
    this.trail = [];
  }

  worldBody(): WorldBody {
    return worldBody(this.host.view, this.e, this.look.collider, this.stateHolder.body, this.facing, this.look.scale);
  }
}
