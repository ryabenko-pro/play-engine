import type { Vec2 } from './math';
import type {
  Behaving,
  BodyShape,
  CharacterEntity,
  FiresProjectiles,
  HasBody,
  Named,
  Positioned,
  Tagged,
  Teamed,
  ViewMode,
} from './types';

/** Runtime state split into small pieces; systems (and brains) take only what they need. */

export interface Velocity {
  vx: number;
  vy: number;
}

export interface Contacts {
  grounded: boolean;
  /** -1 / 1 when pushed by a wall on that side this step. */
  hitWall: number;
  /** Wanted to move but barely moved. */
  blocked: boolean;
}

export interface Orientation {
  /** -1 left, 1 right (screen space). */
  facing: number;
  /** Last movement direction in world space (top-down aiming). */
  dir: Vec2;
}

export interface SpawnPoint {
  spawn: Vec2;
}

export interface Vitality {
  health: number;
  alive: boolean;
}

export interface BrainMemory {
  memory: Record<string, unknown>;
}

export interface EntityRef<E> {
  e: E;
}

export type BodyEntity = Positioned & HasBody;
export type AgentEntity = Positioned & HasBody & Behaving & Teamed & Named & Tagged & FiresProjectiles;

/** What an AI brain may read about the character it drives. */
export interface BrainBody extends EntityRef<AgentEntity>, Velocity, Contacts, Orientation, SpawnPoint, Vitality, BrainMemory {}

/** Anything with a team and position can be targeted. */
export interface Targetable extends EntityRef<Positioned & Teamed & Named & Tagged>, Vitality {}

// ---------------------------------------------------------------------------
// World services
// ---------------------------------------------------------------------------

export interface ViewInfo {
  readonly view: ViewMode;
}

export interface Clock {
  readonly time: number;
}

export interface TerrainQuery {
  /** Is there solid ground just ahead of the body's feet in direction `dir` (side view). */
  groundAhead(body: EntityRef<BodyEntity>, dir: number): boolean;
}

export interface TargetQuery {
  nearestTarget(from: Targetable, range: number, team?: string): Targetable | null;
  player(): Targetable | null;
}

export interface Logger {
  log(msg: string): void;
}

export type BrainWorld = ViewInfo & Clock & TerrainQuery & TargetQuery & Logger;

export function halfExtents(shape: BodyShape): Vec2 {
  return shape.kind === 'rect' ? { x: shape.w / 2, y: shape.h / 2 } : { x: shape.r, y: shape.r };
}

export class RtCharacter implements BrainBody, Targetable {
  vx = 0;
  vy = 0;
  grounded = false;
  hitWall = 0;
  blocked = false;
  facing = 1;
  dir: Vec2 = { x: 1, y: 0 };
  spawn: Vec2;
  health: number;
  alive = true;
  memory: Record<string, unknown> = {};

  coyote = 0;
  cooldown = 0;
  idleTime = 0;
  aiActive: boolean;
  anim: string;
  animTime = 0;
  hurt = 0;
  respawnIn = 0;

  constructor(public e: CharacterEntity) {
    this.spawn = { x: e.x, y: e.y };
    this.health = e.maxHealth;
    this.aiActive = e.control === 'npc';
    this.anim = e.animIdle;
  }

  get isPlayer(): boolean {
    return this.e.control === 'player';
  }
}
