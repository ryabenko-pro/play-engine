import type { Vec2 } from './math';
import { unproject } from './projection';
import type { Positioned, ViewMode } from './types';

export interface Viewport {
  width: number;
  height: number;
}

/** Camera position lives in projected (screen-plane) space. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  /** Screen pixel -> projected-space point. */
  toProjected(s: Positioned, vp: Viewport): Vec2 {
    return { x: (s.x - vp.width / 2) / this.zoom + this.x, y: (s.y - vp.height / 2) / this.zoom + this.y };
  }

  /** Projected-space point -> screen pixel. */
  toScreen(p: Positioned, vp: Viewport): Vec2 {
    return { x: (p.x - this.x) * this.zoom + vp.width / 2, y: (p.y - this.y) * this.zoom + vp.height / 2 };
  }

  screenToWorld(view: ViewMode, s: Positioned, vp: Viewport): Vec2 {
    return unproject(view, this.toProjected(s, vp));
  }

  /** Fit a projected-space box into the viewport. */
  fit(minX: number, minY: number, maxX: number, maxY: number, vp: Viewport, padding = 60): void {
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    this.x = (minX + maxX) / 2;
    this.y = (minY + maxY) / 2;
    this.zoom = Math.max(0.1, Math.min(4, Math.min((vp.width - padding * 2) / w, (vp.height - padding * 2) / h)));
  }
}
