import { type Vec2, distToSegment, pointInPolygon } from './math';
import type { PathEntity, ZoneEntity } from './types';

/*
 * Map geometry for scripts: paths (roads enemies follow) and zones (named areas such as
 * "where towers may be built"). Both are drawn in the level editor and found by name.
 */

/** A path of the running level, in world coordinates. */
export interface PathInfo {
  readonly name: string;
  readonly points: readonly Vec2[];
  /** Total length in px. */
  readonly length: number;
}

/** World-space points of a path or zone entity (its points are relative to its position). */
export function worldPoints(e: PathEntity | ZoneEntity): Vec2[] {
  return e.points.map((p) => ({ x: e.x + p.x, y: e.y + p.y }));
}

/**
 * Does an entity name answer to `wanted`? Exact, or the last part of a nested name
 * ("Outpost/Road" answers to "Road") so maps placed in other levels keep working.
 */
export function nameMatches(name: string, wanted: string): boolean {
  return name === wanted || name.endsWith(`/${wanted}`);
}

export class RtPath implements PathInfo {
  readonly points: readonly Vec2[];
  readonly length: number;
  /** Distance from the start to each point. */
  private readonly cum: number[];

  constructor(
    readonly name: string,
    points: readonly Vec2[],
  ) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    this.length = this.cum[this.cum.length - 1] ?? 0;
  }

  /** The point `d` px along the path (clamped to its ends). */
  pointAt(d: number): Vec2 {
    const pts = this.points;
    if (pts.length < 2 || d <= 0) return { ...pts[0] };
    if (d >= this.length) return { ...pts[pts.length - 1] };
    let i = 1;
    while (this.cum[i] < d) i++;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (d - this.cum[i - 1]) / seg;
    const a = pts[i - 1];
    const b = pts[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}

export class RtZone {
  constructor(
    readonly name: string,
    readonly points: readonly Vec2[],
  ) {}

  contains(p: Vec2): boolean {
    return this.points.length >= 3 && pointInPolygon(p, this.points);
  }
}

/** Distance from a point to a polyline (open) or polygon outline (closed). */
export function distToOutline(p: Vec2, pts: readonly Vec2[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  if (n === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  for (let i = 1; i < n; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  if (closed && n > 2) best = Math.min(best, distToSegment(p, pts[n - 1], pts[0]));
  return best;
}

/** Fewer points along a freehand stroke, keeping its shape within `tolerance` px (Ramer–Douglas–Peucker). */
export function simplify(pts: readonly Vec2[], tolerance: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let farD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = true;
    stack.push([a, far], [far, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

/** Progress of an actor following a path: first straight to its start, then along it. */
export interface PathRun {
  path: string;
  /** Still heading to the start of the path. */
  approaching: boolean;
  /** Distance travelled along the path. */
  d: number;
  done: boolean;
}

/**
 * Moves `pos` one step of `step` px for a path run. Returns the new position; `run`
 * is updated (approach → along → done).
 */
export function advance(run: PathRun, path: RtPath, pos: Vec2, step: number): Vec2 {
  let left = Math.max(0, step);
  let at = { x: pos.x, y: pos.y };
  if (run.approaching) {
    const start = path.points[0];
    const d = Math.hypot(start.x - at.x, start.y - at.y);
    if (d > left) return { x: at.x + ((start.x - at.x) / d) * left, y: at.y + ((start.y - at.y) / d) * left };
    left -= d;
    at = { x: start.x, y: start.y };
    run.approaching = false;
  }
  run.d = Math.min(path.length, run.d + left);
  if (run.d >= path.length) run.done = true;
  return path.length > 0 ? path.pointAt(run.d) : at;
}
