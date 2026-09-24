import type { Vec2 } from './math';
import type { Positioned, ViewMode } from './types';

/**
 * World space is always a flat 2D plane. Side and top-down views draw it as-is;
 * isometric view projects the plane to a 2:1 diamond.
 */
export function project(view: ViewMode, p: Positioned): Vec2 {
  return view === 'isometric' ? { x: p.x - p.y, y: (p.x + p.y) / 2 } : { x: p.x, y: p.y };
}

export function unproject(view: ViewMode, s: Positioned): Vec2 {
  return view === 'isometric' ? { x: s.y + s.x / 2, y: s.y - s.x / 2 } : { x: s.x, y: s.y };
}

/** Painter's-algorithm depth: larger is drawn later (closer to the viewer). */
export function depthOf(view: ViewMode, p: Positioned): number {
  if (view === 'isometric') return p.x + p.y;
  if (view === 'topdown') return p.y;
  return 0;
}
