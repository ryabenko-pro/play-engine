/*
 * Procedural drawing for scripts: a small canvas-like API (paths, curves, circles,
 * rectangles, polygons, text; fills and strokes with colours or gradients; glow and
 * blend modes). Scripts get it in their draw hooks:
 *
 *   export function drawUnder(self, world, g) {}  // world space, origin at the actor, behind its sprite
 *   export function draw(self, world, g) {}       // same, in front of the sprite
 *   export function drawHud(self, world, g) {}    // screen pixels, over everything
 *
 * Draw hooks only draw: they run once per rendered frame, not per simulation step.
 */

export type ColorStop = readonly [offset: number, color: string];

/** A gradient made by g.linear() / g.radial(); usable wherever a colour is. */
export interface Gradient {
  readonly kind: 'linear' | 'radial';
  /** linear: x0 y0 x1 y1 · radial: x0 y0 r0 x1 y1 r1 */
  readonly coords: readonly number[];
  readonly stops: readonly ColorStop[];
}

export type Paint = string | Gradient;

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';

export interface Style {
  /** Fill paint. */
  fill?: Paint;
  /** Outline paint. */
  stroke?: Paint;
  /** Outline width (default 1). */
  width?: number;
  /** 0..1, multiplies the current opacity. */
  alpha?: number;
  /** Soft glow (blur radius in the same units as the shape). */
  glow?: number;
  /** Glow colour (default: the fill / stroke colour). */
  glowColor?: string;
  /** Dash pattern for outlines, e.g. [6, 4]. */
  dash?: number[];
  dashOffset?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  /** 'add' makes overlapping light brighter (auras, fire). */
  blend?: BlendMode;
}

export interface TextStyle extends Style {
  /** Font size (default 14). */
  size?: number;
  /** CSS font family (default system-ui). */
  font?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
}

export type Point = { x: number; y: number };

/** A colour, gradient, or full style. A bare paint means "fill with it". */
export type StyleArg = Paint | Style;

export interface Graphics {
  // --- Paths (like CanvasRenderingContext2D) --------------------------------
  beginPath(): Graphics;
  moveTo(x: number, y: number): Graphics;
  lineTo(x: number, y: number): Graphics;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): Graphics;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): Graphics;
  /** Angles in radians, clockwise from +x. */
  arc(x: number, y: number, r: number, start: number, end: number, counterclockwise?: boolean): Graphics;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): Graphics;
  ellipse(x: number, y: number, rx: number, ry: number, rotation?: number, start?: number, end?: number, counterclockwise?: boolean): Graphics;
  /** Top-left corner, like canvas. */
  rect(x: number, y: number, w: number, h: number): Graphics;
  roundRect(x: number, y: number, w: number, h: number, radius: number): Graphics;
  closePath(): Graphics;
  /** Fills the current path. A paint fills with it; a style also strokes if it has `stroke`. */
  fill(style?: StyleArg): Graphics;
  /** Strokes the current path. A paint strokes with it (`width` default 1). */
  stroke(style?: StyleArg, width?: number): Graphics;

  // --- Shapes (each one its own path) ---------------------------------------
  circle(x: number, y: number, r: number, style?: StyleArg): Graphics;
  /** Top-left corner, like canvas; `radius` rounds the corners. */
  rectangle(x: number, y: number, w: number, h: number, style?: StyleArg, radius?: number): Graphics;
  oval(x: number, y: number, rx: number, ry: number, style?: StyleArg): Graphics;
  line(x1: number, y1: number, x2: number, y2: number, style?: StyleArg): Graphics;
  /** Points as [{x, y}, …] or [x0, y0, x1, y1, …]. Closed unless `closed` is false (then only stroked). */
  polygon(points: readonly Point[] | readonly number[], style?: StyleArg, closed?: boolean): Graphics;
  /** Regular polygon with `sides` corners; with `inner` it becomes a star (inner radius). */
  regular(x: number, y: number, r: number, sides: number, style?: StyleArg, rotation?: number, inner?: number): Graphics;
  /** Smooth closed curve through the points (a blob, a wobbling aura…). */
  smooth(points: readonly Point[] | readonly number[], style?: StyleArg): Graphics;
  text(text: string, x: number, y: number, style?: string | TextStyle): Graphics;

  // --- State & transforms ----------------------------------------------------
  save(): Graphics;
  restore(): Graphics;
  translate(x: number, y: number): Graphics;
  /** Radians. */
  rotate(angle: number): Graphics;
  scale(x: number, y?: number): Graphics;
  /** Opacity for everything drawn after (multiplied with the style alpha; restored by restore()). */
  alpha(a: number): Graphics;

  // --- Paints & colours ------------------------------------------------------
  linear(x0: number, y0: number, x1: number, y1: number, stops: readonly ColorStop[]): Gradient;
  /** Radial gradient centred at (x, y), from radius `inner` (default 0) to `r`. */
  radial(x: number, y: number, r: number, stops: readonly ColorStop[], inner?: number): Gradient;
  /** Blend two colours (t = 0 → a, 1 → b). */
  mix(a: string, b: string, t: number): string;
  /** The colour with opacity `alpha`. */
  rgba(color: string, alpha: number): string;
  /** hsl(hue 0-360, saturation 0-1, lightness 0-1, alpha 0-1). */
  hsl(h: number, s: number, l: number, a?: number): string;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export type RGBA = [r: number, g: number, b: number, a: number];

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  transparent: '#00000000',
};

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() and a few names. */
export function parseColor(c: string): RGBA | null {
  const s = (NAMED[c.trim().toLowerCase()] ?? c).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (v.length < 3 || v.some(Number.isNaN)) return null;
    return [v[0], v[1], v[2], v[3] ?? 1];
  }
  m = /^hsla?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    if (v.length < 3 || v.some(Number.isNaN)) return null;
    const [r, g, b] = hslToRgb(v[0], v[1] / 100, v[2] / 100);
    return [r, g, b, v[3] ?? 1];
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

export function rgbaString([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return a >= 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${Math.max(0, Math.round(a * 1000) / 1000)})`;
}

export function toHex(c: string): string | null {
  const v = parseColor(c);
  if (!v) return null;
  const h = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(v[0])}${h(v[1])}${h(v[2])}`;
}

export function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  t = Math.max(0, Math.min(1, t));
  if (!ca || !cb) return t < 0.5 ? a : b;
  return rgbaString(ca.map((v, i) => v + (cb[i] - v) * t) as RGBA);
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return c ? rgbaString([c[0], c[1], c[2], c[3] * alpha]) : color;
}

export function hslColor(h: number, s: number, l: number, a = 1): string {
  const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, s, l);
  return rgbaString([r, g, b, a]);
}

// ---------------------------------------------------------------------------
// Canvas implementation
// ---------------------------------------------------------------------------

const BLEND: Record<BlendMode, GlobalCompositeOperation> = { normal: 'source-over', add: 'lighter', multiply: 'multiply', screen: 'screen' };

const isGradient = (v: unknown): v is Gradient => typeof v === 'object' && v !== null && 'stops' in v && 'coords' in v;

function toStyle(s: StyleArg | undefined, as: 'fill' | 'stroke'): Style {
  if (s === undefined) return { [as]: '#ffffff' };
  if (typeof s === 'string' || isGradient(s)) return { [as]: s };
  return s.fill === undefined && s.stroke === undefined ? { ...s, [as]: '#ffffff' } : s;
}

function flatPoints(points: readonly Point[] | readonly number[]): Point[] {
  if (!points.length || typeof points[0] !== 'number') return points as Point[];
  const n = points as readonly number[];
  const out: Point[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
  return out;
}

/** Graphics drawing straight onto a 2D context (in whatever transform it has). */
export class CanvasGraphics implements Graphics {
  private depth = 0;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  /**
   * Runs `fn` with the origin moved to (x, y). Saves left open by the script are
   * closed, so one script can't leak transforms or opacity into the next.
   */
  run(x: number, y: number, fn: (g: Graphics) => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    const depth = this.depth;
    try {
      fn(this);
    } finally {
      while (this.depth > depth) this.restore();
      ctx.restore();
    }
  }

  // Paths ---------------------------------------------------------------------

  beginPath(): this {
    this.ctx.beginPath();
    return this;
  }
  moveTo(x: number, y: number): this {
    this.ctx.moveTo(x, y);
    return this;
  }
  lineTo(x: number, y: number): this {
    this.ctx.lineTo(x, y);
    return this;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): this {
    this.ctx.quadraticCurveTo(cx, cy, x, y);
    return this;
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    return this;
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): this {
    this.ctx.arc(x, y, Math.max(0, r), start, end, ccw);
    return this;
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this {
    this.ctx.arcTo(x1, y1, x2, y2, Math.max(0, r));
    return this;
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation = 0, start = 0, end = Math.PI * 2, ccw = false): this {
    this.ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rotation, start, end, ccw);
    return this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    this.ctx.rect(x, y, w, h);
    return this;
  }
  roundRect(x: number, y: number, w: number, h: number, radius: number): this {
    const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
    const ctx = this.ctx;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    return this;
  }
  closePath(): this {
    this.ctx.closePath();
    return this;
  }

  fill(style?: StyleArg): this {
    this.paint(toStyle(style, 'fill'));
    return this;
  }

  stroke(style?: StyleArg, width?: number): this {
    const s = toStyle(style, 'stroke');
    this.paint(s.fill !== undefined && s.stroke === undefined ? { ...s, stroke: s.fill, fill: undefined, width: width ?? s.width } : width !== undefined ? { ...s, width } : s, true);
    return this;
  }

  /** Fills and/or strokes the current path with a style. */
  private paint(s: Style, strokeOnly = false): void {
    const ctx = this.ctx;
    ctx.save();
    if (s.alpha !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, s.alpha));
    if (s.blend) ctx.globalCompositeOperation = BLEND[s.blend] ?? 'source-over';
    if (s.glow) {
      // shadowBlur ignores the transform: scale it so glow is in drawing units.
      const m = ctx.getTransform();
      ctx.shadowBlur = s.glow * Math.hypot(m.a, m.b);
      const base = s.glowColor ?? (typeof s.fill === 'string' ? s.fill : typeof s.stroke === 'string' ? s.stroke : '#ffffff');
      ctx.shadowColor = base;
    }
    if (s.fill !== undefined && !strokeOnly) {
      ctx.fillStyle = this.toPaint(s.fill);
      ctx.fill();
    }
    if (s.stroke !== undefined) {
      ctx.strokeStyle = this.toPaint(s.stroke);
      ctx.lineWidth = s.width ?? 1;
      ctx.lineCap = s.cap ?? 'butt';
      ctx.lineJoin = s.join ?? 'miter';
      if (s.dash) {
        ctx.setLineDash(s.dash);
        ctx.lineDashOffset = s.dashOffset ?? 0;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private toPaint(p: Paint): string | CanvasGradient {
    if (typeof p === 'string') return p;
    const c = p.coords;
    const g = p.kind === 'linear' ? this.ctx.createLinearGradient(c[0], c[1], c[2], c[3]) : this.ctx.createRadialGradient(c[0], c[1], Math.max(0, c[2]), c[3], c[4], Math.max(0, c[5]));
    for (const [o, col] of p.stops) {
      try {
        g.addColorStop(Math.max(0, Math.min(1, o)), col);
      } catch {
        // An invalid colour shouldn't stop the frame.
      }
    }
    return g;
  }

  // Shapes --------------------------------------------------------------------

  circle(x: number, y: number, r: number, style?: StyleArg): this {
    return this.beginPath().arc(x, y, r, 0, Math.PI * 2).shape(style);
  }
  rectangle(x: number, y: number, w: number, h: number, style?: StyleArg, radius = 0): this {
    this.beginPath();
    if (radius > 0) this.roundRect(x, y, w, h, radius);
    else this.rect(x, y, w, h);
    return this.shape(style);
  }
  oval(x: number, y: number, rx: number, ry: number, style?: StyleArg): this {
    return this.beginPath().ellipse(x, y, rx, ry).shape(style);
  }
  line(x1: number, y1: number, x2: number, y2: number, style?: StyleArg): this {
    return this.beginPath().moveTo(x1, y1).lineTo(x2, y2).stroke(style);
  }
  polygon(points: readonly Point[] | readonly number[], style?: StyleArg, closed = true): this {
    const pts = flatPoints(points);
    this.beginPath();
    pts.forEach((p, i) => (i ? this.ctx.lineTo(p.x, p.y) : this.ctx.moveTo(p.x, p.y)));
    if (!closed) return this.stroke(style);
    this.closePath();
    return this.shape(style);
  }
  regular(x: number, y: number, r: number, sides: number, style?: StyleArg, rotation = -Math.PI / 2, inner?: number): this {
    const n = Math.max(3, Math.round(sides));
    const pts: Point[] = [];
    const count = inner !== undefined ? n * 2 : n;
    for (let i = 0; i < count; i++) {
      const a = rotation + (i / count) * Math.PI * 2;
      const rr = inner !== undefined && i % 2 ? inner : r;
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    return this.polygon(pts, style);
  }
  smooth(points: readonly Point[] | readonly number[], style?: StyleArg): this {
    const pts = flatPoints(points);
    const n = pts.length;
    if (n < 3) return this.polygon(pts, style);
    // Quadratic curves through the midpoints, using the points as control points.
    const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = mid(pts[n - 1], pts[0]);
    this.beginPath().moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      this.ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
    }
    return this.closePath().shape(style);
  }
  text(text: string, x: number, y: number, style?: string | TextStyle): this {
    const s: TextStyle = typeof style === 'string' ? { fill: style } : style ?? {};
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${s.bold ? 'bold ' : ''}${s.size ?? 14}px ${s.font ?? 'system-ui, sans-serif'}`;
    ctx.textAlign = s.align ?? 'left';
    ctx.textBaseline = s.baseline ?? 'alphabetic';
    if (s.alpha !== undefined) ctx.globalAlpha *= s.alpha;
    if (s.blend) ctx.globalCompositeOperation = BLEND[s.blend];
    if (s.glow) {
      const m = ctx.getTransform();
      ctx.shadowBlur = s.glow * Math.hypot(m.a, m.b);
      ctx.shadowColor = s.glowColor ?? (typeof s.fill === 'string' ? s.fill : '#ffffff');
    }
    if (s.stroke !== undefined) {
      ctx.strokeStyle = this.toPaint(s.stroke);
      ctx.lineWidth = s.width ?? 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    if (s.fill !== undefined || s.stroke === undefined) {
      ctx.fillStyle = this.toPaint(s.fill ?? '#ffffff');
      ctx.fillText(text, x, y);
    }
    ctx.restore();
    return this;
  }

  /** Paints a shape just built: fill by default, plus stroke if the style has one. */
  private shape(style?: StyleArg): this {
    const s = toStyle(style, 'fill');
    this.paint(s);
    return this;
  }

  // State ---------------------------------------------------------------------

  save(): this {
    this.ctx.save();
    this.depth++;
    return this;
  }
  restore(): this {
    if (this.depth > 0) {
      this.ctx.restore();
      this.depth--;
    }
    return this;
  }
  translate(x: number, y: number): this {
    this.ctx.translate(x, y);
    return this;
  }
  rotate(angle: number): this {
    this.ctx.rotate(angle);
    return this;
  }
  scale(x: number, y = x): this {
    this.ctx.scale(x, y);
    return this;
  }
  alpha(a: number): this {
    this.ctx.globalAlpha *= Math.max(0, Math.min(1, a));
    return this;
  }

  // Paints --------------------------------------------------------------------

  linear(x0: number, y0: number, x1: number, y1: number, stops: readonly ColorStop[]): Gradient {
    return { kind: 'linear', coords: [x0, y0, x1, y1], stops };
  }
  radial(x: number, y: number, r: number, stops: readonly ColorStop[], inner = 0): Gradient {
    return { kind: 'radial', coords: [x, y, inner, x, y, r], stops };
  }
  mix(a: string, b: string, t: number): string {
    return mixColors(a, b, t);
  }
  rgba(color: string, alpha: number): string {
    return withAlpha(color, alpha);
  }
  hsl(h: number, s: number, l: number, a = 1): string {
    return hslColor(h, s, l, a);
  }
}
