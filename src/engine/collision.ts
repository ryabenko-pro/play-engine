import { DEG2RAD, type Vec2, dot, distToSegment, normalize, pointInPolygon, rotate } from './math';
import type { ShapeDef } from './types';

export interface PolyCollider {
  type: 'poly';
  /** Convex polygon (or a 2-point segment). */
  pts: Vec2[];
}

export interface CircleCollider {
  type: 'circle';
  c: Vec2;
  r: number;
}

export type Collider = PolyCollider | CircleCollider;

/** Minimum translation: move A by (nx, ny) * depth to separate it from B. */
export interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function shapeCollider(shape: ShapeDef, x: number, y: number, rotationDeg = 0): Collider {
  switch (shape.kind) {
    case 'circle':
      return { type: 'circle', c: { x, y }, r: shape.r };
    case 'line': {
      const a = { x, y };
      const b = { x: x + shape.x2, y: y + shape.y2 };
      const t = shape.thickness / 2;
      if (t < 0.5) return { type: 'poly', pts: [a, b] };
      const n = normalize({ x: -(b.y - a.y), y: b.x - a.x });
      return {
        type: 'poly',
        pts: [
          { x: a.x + n.x * t, y: a.y + n.y * t },
          { x: b.x + n.x * t, y: b.y + n.y * t },
          { x: b.x - n.x * t, y: b.y - n.y * t },
          { x: a.x - n.x * t, y: a.y - n.y * t },
        ],
      };
    }
    case 'rect': {
      const hw = shape.w / 2;
      const hh = shape.h / 2;
      const rad = rotationDeg * DEG2RAD;
      const corners = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ];
      return {
        type: 'poly',
        pts: corners.map((p) => {
          const r = rotate(p, rad);
          return { x: r.x + x, y: r.y + y };
        }),
      };
    }
  }
}

function edgeAxes(pts: Vec2[], out: Vec2[]): void {
  const n = pts.length;
  const count = n === 2 ? 1 : n;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ax = normalize({ x: -(b.y - a.y), y: b.x - a.x });
    if (ax.x || ax.y) out.push(ax);
  }
}

function projectOn(c: Collider, ax: Vec2): [number, number] {
  if (c.type === 'circle') {
    const d = dot(c.c, ax);
    return [d - c.r, d + c.r];
  }
  let min = Infinity;
  let max = -Infinity;
  for (const p of c.pts) {
    const d = dot(p, ax);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

function closestVertex(pts: Vec2[], p: Vec2): Vec2 {
  let best = pts[0];
  let bestD = Infinity;
  for (const v of pts) {
    const d = (v.x - p.x) ** 2 + (v.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Separating Axis Test between convex polygons / circles. */
export function collide(a: Collider, b: Collider): Contact | null {
  if (a.type === 'circle' && b.type === 'circle') {
    const dx = a.c.x - b.c.x;
    const dy = a.c.y - b.c.y;
    const d = Math.hypot(dx, dy);
    const r = a.r + b.r;
    if (d >= r) return null;
    return d > 1e-9 ? { nx: dx / d, ny: dy / d, depth: r - d } : { nx: 0, ny: -1, depth: r };
  }

  const axes: Vec2[] = [];
  if (a.type === 'poly') edgeAxes(a.pts, axes);
  if (b.type === 'poly') edgeAxes(b.pts, axes);
  if (a.type === 'circle' && b.type === 'poly') axes.push(normalize({ x: a.c.x - closestVertex(b.pts, a.c).x, y: a.c.y - closestVertex(b.pts, a.c).y }));
  if (b.type === 'circle' && a.type === 'poly') axes.push(normalize({ x: b.c.x - closestVertex(a.pts, b.c).x, y: b.c.y - closestVertex(a.pts, b.c).y }));

  let best = Infinity;
  let nx = 0;
  let ny = 0;
  for (const ax of axes) {
    if (!ax.x && !ax.y) continue;
    const [amin, amax] = projectOn(a, ax);
    const [bmin, bmax] = projectOn(b, ax);
    const pushNeg = amax - bmin; // move A along -axis
    const pushPos = bmax - amin; // move A along +axis
    if (pushNeg <= 0 || pushPos <= 0) return null;
    if (pushNeg < best) {
      best = pushNeg;
      nx = -ax.x;
      ny = -ax.y;
    }
    if (pushPos < best) {
      best = pushPos;
      nx = ax.x;
      ny = ax.y;
    }
  }
  return best === Infinity ? null : { nx, ny, depth: best };
}

export function pointInCollider(p: Vec2, c: Collider, tolerance = 0): boolean {
  if (c.type === 'circle') return Math.hypot(p.x - c.c.x, p.y - c.c.y) <= c.r + tolerance;
  if (c.pts.length >= 3 && pointInPolygon(p, c.pts)) return true;
  if (tolerance <= 0 && c.pts.length >= 3) return false;
  const n = c.pts.length;
  for (let i = 0; i < (n === 2 ? 1 : n); i++) {
    if (distToSegment(p, c.pts[i], c.pts[(i + 1) % n]) <= Math.max(tolerance, 0.5)) return true;
  }
  return false;
}

export function colliderBounds(c: Collider): Bounds {
  if (c.type === 'circle') return { minX: c.c.x - c.r, minY: c.c.y - c.r, maxX: c.c.x + c.r, maxY: c.c.y + c.r };
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of c.pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}
