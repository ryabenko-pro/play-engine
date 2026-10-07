import type { KindProps } from './interactions';

/*
 * Grid (Sokoban-style) movement: an actor steps one cell of the level grid at a time.
 * Walking into pushable actors pushes the whole chain one cell, if the chain's total
 * weight is within the mover's strength and the cell after it is free.
 * Cells lie between grid lines: cell (i, j) spans [i·g, (i+1)·g) and moves end at its centre.
 */

/** A move in progress, drawn as a slide between two cell centres. */
export interface GridTween {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  duration: number;
}

export interface GridActor {
  x: number;
  y: number;
  facing: number;
  readonly destroyed: boolean;
  readonly phys: KindProps;
  tween: GridTween | null;
}

export interface GridWorld<A extends GridActor> {
  readonly actors: readonly A[];
  readonly gridSize: number;
  /** A solid block covers this point. */
  wallAt(x: number, y: number): boolean;
}

export const DEFAULT_STEP_SECONDS = 0.15;

export class GridMotion<A extends GridActor> {
  constructor(private readonly world: GridWorld<A>) {}

  private get g(): number {
    return Math.max(1, this.world.gridSize);
  }

  /** The cell an actor is in, or is moving to. */
  cellOf(a: A): { i: number; j: number } {
    const x = a.tween ? a.tween.toX : a.x;
    const y = a.tween ? a.tween.toY : a.y;
    return { i: Math.floor(x / this.g), j: Math.floor(y / this.g) };
  }

  private center(i: number, j: number): { x: number; y: number } {
    return { x: (i + 0.5) * this.g, y: (j + 0.5) * this.g };
  }

  /** Actors taking up a cell: solid or pushable ones. */
  private occupants(i: number, j: number, except: A): A[] {
    return this.world.actors.filter((o) => {
      if (o === except || o.destroyed || !(o.phys.solid || o.phys.pushable)) return false;
      const c = this.cellOf(o);
      return c.i === i && c.j === j;
    });
  }

  move(a: A, dx: number, dy: number, seconds = DEFAULT_STEP_SECONDS): boolean {
    dx = Math.sign(dx);
    dy = Math.sign(dy);
    if (a.tween || (dx && dy) || (!dx && !dy)) return false;
    if (dx) a.facing = dx;
    const start = this.cellOf(a);
    const chain: A[] = [];
    let weight = 0;
    let { i, j } = { i: start.i + dx, j: start.j + dy };
    for (;;) {
      const c = this.center(i, j);
      if (this.world.wallAt(c.x, c.y)) return false;
      const here = this.occupants(i, j, a);
      if (!here.length) break;
      // Something solid that can't move, or is already moving, stops the whole push.
      if (here.some((o) => !o.phys.pushable || o.tween)) return false;
      weight += here.reduce((w, o) => w + o.phys.weight, 0);
      if (weight > a.phys.strength) return false;
      chain.push(...here);
      i += dx;
      j += dy;
    }
    for (const o of [a, ...chain]) {
      const c = this.cellOf(o);
      const to = this.center(c.i + dx, c.j + dy);
      o.tween = { fromX: o.x, fromY: o.y, toX: to.x, toY: to.y, t: 0, duration: Math.max(0.001, seconds) };
    }
    return true;
  }

  step(h: number): void {
    for (const a of this.world.actors) {
      const tw = a.tween;
      if (!tw) continue;
      tw.t += h;
      const k = Math.min(1, tw.t / tw.duration);
      a.x = tw.fromX + (tw.toX - tw.fromX) * k;
      a.y = tw.fromY + (tw.toY - tw.fromY) * k;
      if (k >= 1) a.tween = null;
    }
  }
}
