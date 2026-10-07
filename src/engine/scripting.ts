import { transform } from 'sucrase';
import type { Graphics } from './graphics';
import type { PathInfo } from './paths';
import type { PropValue, PropValues, ViewMode } from './types';

/*
 * The public API scripts are written against. Split into small interfaces;
 * `Actor` and `World` are just their unions.
 */

// ---------------------------------------------------------------------------
// Actor (the `self` of a script, and any other actor it looks at)
// ---------------------------------------------------------------------------

export interface ActorIdentity {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  /** What it is: the actor scene's kinds plus the active form's (see Interactions). */
  readonly kinds: readonly string[];
  /** Has this tag or kind? */
  is(tag: string): boolean;
}

export interface ActorTransform {
  x: number;
  y: number;
  readonly spawnX: number;
  readonly spawnY: number;
}

export interface ActorMotion {
  vx: number;
  vy: number;
  /** Set by moveAndSlide(): standing on something (side view). */
  readonly grounded: boolean;
  /** Set by moveAndSlide(): -1 / 1 when pushed by a wall on that side, else 0. */
  readonly hitWall: number;
  /** Moves by (vx, vy) · dt and slides along solid blocks. */
  moveAndSlide(): void;
}

export interface ActorPath {
  /**
   * One frame of following a path of the level (by name): first straight to its start, then
   * along it, at `speed` px/s. Call it every frame; returns true once the end is reached.
   * Sets vx / vy to the movement (so others can aim ahead) without moving by them.
   */
  followPath(name: string, speed: number): boolean;
  /** How far along its path the actor is (px; 0 while heading to the start). */
  readonly pathDistance: number;
}

export interface ActorLook {
  /** Fill colour when drawn without a sprite. */
  color: string;
  /** -1 left, 1 right: mirrors the sprite and the state collider offset. */
  facing: number;
  visible: boolean;
  /** Blink for a while (e.g. after a hit). */
  flash(seconds: number): void;
}

export interface ActorStates {
  readonly state: string;
  /** Seconds since the state was entered. */
  readonly stateTime: number;
  /** Switch state (animation + collider). Re-entering the current state does nothing. */
  setState(name: string): void;
  /** Seconds one pass of the current animation takes (Infinity if unknown). */
  readonly animationLength: number;
}

export interface ActorLife {
  health: number;
  readonly alive: boolean;
  /** Mark as dead. update() keeps running so the script can animate, respawn or destroy. */
  kill(): void;
  revive(): void;
  /** Remove from the level. */
  destroy(): void;
}

export interface ActorCombat {
  /** Fire a projectile asset (by name) from the actor. Returns false if it doesn't exist. */
  shoot(projectile: string, dirX: number, dirY: number): boolean;
  /** Fire at another actor, aiming where it will be (from its vx / vy) unless `aimAhead` is false. */
  shootAt(projectile: string, target: Actor | null, aimAhead?: boolean): boolean;
  /**
   * Hit this actor directly (touch attacks, traps). Runs its onHit hooks like a projectile would:
   * the active form's first, then its own. Returns false if ignored (immune, or no onHit).
   */
  damage(amount: number, from?: Actor | null): boolean;
}

export interface ActorForms {
  /** Active form: 'base' (the actor scene's own look) or one of the scene's forms. */
  readonly form: string;
  /** Seconds since the form was entered. */
  readonly formTime: number;
  /** Seconds until the form ends by itself and 'base' returns (Infinity if it doesn't). */
  readonly formLeft: number;
  /** Size factor of the active form (sprite and colliders). */
  readonly scale: number;
  /**
   * Switch to a form: its scene supplies the look, states, colliders and effects, its props
   * are laid over this actor's props and its hooks run on top of this script. With `seconds`
   * it switches back to 'base' by itself. Returns false for an unknown form.
   */
  setForm(name: string, seconds?: number): boolean;
}

export interface ActorStatuses {
  /** Active statuses (burning, wet…). */
  readonly statuses: readonly string[];
  hasStatus(name: string): boolean;
  /** Seconds until the status ends (0 when not active). */
  statusLeft(name: string): number;
  /** Adds (or renews) a status for `seconds`, default its own duration. False for an unknown status. */
  addStatus(name: string, seconds?: number): boolean;
  removeStatus(name: string): void;
}

export interface ActorGrid {
  /** Moving between grid cells (gridMove), until it arrives. */
  readonly moving: boolean;
  /**
   * Steps one cell of the level grid (dx, dy: -1, 0 or 1; not diagonal), taking `seconds`.
   * Pushes a chain of pushable actors if their total weight ≤ this actor's strength.
   * False (and no move) when blocked by walls, solid actors, a too heavy chain, or while moving.
   */
  gridMove(dx: number, dy: number, seconds?: number): boolean;
}

export interface ActorData {
  /** Exported props merged with instance overrides, then with the active form's props. */
  readonly props: Readonly<PropValues>;
  /** Free per-instance storage (module-level variables are shared by all instances!). */
  data: Record<string, unknown>;
}

export interface Actor
  extends ActorIdentity, ActorTransform, ActorMotion, ActorPath, ActorLook, ActorStates, ActorLife, ActorCombat, ActorForms, ActorStatuses, ActorGrid, ActorData {}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface InputApi {
  isDown(...codes: string[]): boolean;
  /** Went down since the previous frame. Codes are KeyboardEvent.code, e.g. 'KeyA', 'Space', 'ArrowLeft'. */
  pressed(...codes: string[]): boolean;
  /** Seconds since any key (or the touch joystick) was touched. */
  readonly idleTime: number;
  /**
   * Direction to move: the touch joystick (analog, length ≤ 1), or else arrows / WASD
   * (length 1, diagonals normalised). { x: 0, y: 0 } when idle.
   */
  readonly stick: { readonly x: number; readonly y: number };
  /** Mouse (or finger) position in world coordinates. */
  readonly mouse: { readonly x: number; readonly y: number };
  readonly mouseDown: boolean;
  /** The mouse was clicked (or the screen tapped) since the previous frame. */
  readonly clicked: boolean;
}

export interface CameraApi {
  follow(actor: Actor | null): void;
  zoom: number;
}

export interface HudApi {
  /** Screen-space text for this frame. */
  text(text: string, x: number, y: number, color?: string): void;
  /** Screen size in CSS px (for drawHud layouts). */
  readonly width: number;
  readonly height: number;
  /** Keeps showing the game variable world.vars[name] in the top-left corner. */
  watch(name: string): void;
}

export interface WorldInfo {
  readonly time: number;
  readonly view: ViewMode;
  /** The level's gravity setting (px/s²); apply it yourself. */
  readonly gravity: number;
  /** A y below every block: falling past it means out of the world. */
  readonly bottom: number;
  /** Cell size of the level grid (gridMove). */
  readonly gridSize: number;
}

export interface WorldQueries {
  /** First living actor with the tag. */
  find(tag: string): Actor | null;
  all(tag?: string): Actor[];
  nearest(from: Actor, tag?: string): Actor | null;
  distance(a: Actor, b: Actor): number;
  /** Do the two actors' current colliders touch? */
  overlaps(a: Actor, b: Actor): boolean;
  /** Is there solid ground just ahead of the actor's feet (side view)? */
  groundAhead(actor: Actor, dir: number): boolean;
  /** A path drawn in the level, by name (null if there is none). */
  path(name: string): PathInfo | null;
  /** Is the point inside a zone of that name? */
  inZone(x: number, y: number, zone: string): boolean;
}

export interface WorldGame {
  /** Game variables, shared by every actor (money, lives…); fresh for every game. */
  readonly vars: Record<string, unknown>;
  /**
   * Adds an actor scene (by name) to the level at (x, y). It starts like a placed one
   * (its init runs now). Returns it, or null if there is no actor scene of that name.
   */
  spawn(scene: string, x: number, y: number): Actor | null;
  /** Ends the game: everything stops and a banner shows the result. Enter or a click plays again. */
  endGame(won: boolean, message?: string): void;
  readonly ended: 'won' | 'lost' | null;
}

export interface WorldEffects {
  burst(x: number, y: number, color: string, count?: number): void;
  /** Gives off an element once (an explosion, a splash): reactions run for every actor within `radius`. */
  emit(element: string, x: number, y: number, radius: number): void;
  /** Text that floats up from a point of the world and fades ("+5"). */
  popText(text: string, x: number, y: number, color?: string): void;
  log(...args: unknown[]): void;
}

export interface World extends WorldInfo, WorldQueries, WorldEffects, WorldGame {
  readonly input: InputApi;
  readonly camera: CameraApi;
  readonly hud: HudApi;
}

/** Passed to onHit when a projectile touches the actor, or on actor.damage(). */
export interface Hit {
  damage: number;
  /** Who fired / dealt it (null for projectiles placed in the level). */
  from: Actor | null;
  x: number;
  y: number;
  /** Set for damage from a status (burning: 'fire'), so onHit can resist elements. */
  element?: string;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/**
 * An actor scene's script. As a form, the same hooks run on top of the container's:
 * `init` on every switch into the form, `update` after the container's, `onHit` before it.
 */
export interface ScriptModule {
  props?: PropValues;
  init?(self: Actor, world: World): void;
  update?(self: Actor, world: World, dt: number): void;
  /** Return false to let the projectile pass through. Without onHit, projectiles ignore the actor. */
  onHit?(self: Actor, world: World, hit: Hit): boolean | void;
  /** A status was added (added = true) or ended / was removed. */
  onStatus?(self: Actor, world: World, status: string, added: boolean): void;
  /** Draws behind the actor's sprite: world units, origin at the actor (an aura, a shadow). */
  drawUnder?(self: Actor, world: World, g: Graphics): void;
  /** Draws in front of the actor's sprite: world units, origin at the actor (a health bar, a shield). */
  draw?(self: Actor, world: World, g: Graphics): void;
  /** Draws over everything in screen px, also while invisible (HUD, bars, scores). */
  drawHud?(self: Actor, world: World, g: Graphics): void;
}

/** Compiles a TypeScript module (types are stripped, not checked). Throws on syntax errors. */
export function compileModule(source: string): ScriptModule {
  const js = transform(source, { transforms: ['typescript', 'imports'] }).code;
  const exports: Record<string, unknown> = {};
  new Function('exports', 'module', js)(exports, { exports });
  return exports as ScriptModule;
}

export type CompileResult = { ok: true; module: ScriptModule } | { ok: false; error: string };

/** Compiles each distinct source once. */
export class ScriptCache {
  private cache = new Map<string, CompileResult>();

  get(source: string): CompileResult {
    let r = this.cache.get(source);
    if (!r) {
      try {
        r = { ok: true, module: compileModule(source) };
      } catch (err) {
        r = { ok: false, error: (err as Error).message };
      }
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(source, r);
    }
    return r;
  }

  /** Default values of the module's exported props (empty if it doesn't compile). */
  props(source: string): PropValues {
    const r = this.get(source);
    const props = r.ok ? r.module.props : undefined;
    if (!props || typeof props !== 'object') return {};
    return Object.fromEntries(Object.entries(props).filter(([, v]) => isPropValue(v)));
  }
}

export const isPropValue = (v: unknown): v is PropValue => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
