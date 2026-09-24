import { transform } from 'sucrase';
import type { Intent } from './intent';
import type { ViewMode } from './types';

/**
 * Public API visible to user scripts. Kept deliberately small and split so each
 * piece can evolve independently.
 */
export interface ScriptPosition {
  readonly x: number;
  readonly y: number;
}

export interface ScriptMotion {
  readonly vx: number;
  readonly vy: number;
  readonly grounded: boolean;
  /** -1 / 1 when touching a wall on that side, 0 otherwise. */
  readonly hitWall: number;
  readonly facing: number;
}

export interface ScriptIdentity {
  readonly name: string;
  readonly team: string;
  readonly tags: readonly string[];
}

export interface ScriptVitals {
  readonly health: number;
}

export interface ScriptHome {
  readonly spawnX: number;
  readonly spawnY: number;
}

export interface ScriptSelf extends ScriptPosition, ScriptMotion, ScriptIdentity, ScriptVitals, ScriptHome {}

export interface ScriptTarget extends ScriptPosition, ScriptIdentity {
  readonly distance: number;
}

export interface ScriptClock {
  readonly time: number;
}

export interface ScriptViewInfo {
  readonly view: ViewMode;
}

export interface ScriptQueries {
  /** Nearest living character of another team (or of `team`, if given). */
  nearest(team?: string): ScriptTarget | null;
  player(): ScriptTarget | null;
}

export interface ScriptLogger {
  log(...args: unknown[]): void;
}

export interface ScriptWorld extends ScriptClock, ScriptViewInfo, ScriptQueries, ScriptLogger {}

export type ScriptIntent = Intent;
export type ScriptMemory = Record<string, unknown>;

export type ScriptFn = (self: ScriptSelf, world: ScriptWorld, intent: ScriptIntent, dt: number, memory: ScriptMemory) => void;

/** Compiles a TypeScript function body into a callable. Throws on syntax errors. */
export function compileScript(source: string): ScriptFn {
  const wrapped =
    'function __brain(self: ScriptSelf, world: ScriptWorld, intent: ScriptIntent, dt: number, memory: ScriptMemory) {\n' +
    '"use strict";\n' +
    source +
    '\n}';
  const js = transform(wrapped, { transforms: ['typescript'] }).code;
  return new Function(`${js}\nreturn __brain;`)() as ScriptFn;
}
