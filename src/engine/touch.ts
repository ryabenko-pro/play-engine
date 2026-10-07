import type { Input } from './input';
import type { TouchButton, TouchLayout } from './types';

/*
 * On-screen controls for phones and tablets: a floating joystick (it appears where the
 * thumb lands on the left half of the screen) and action buttons at the bottom right.
 * They only feed an Input — the joystick sets input.stick (and, by default, holds the
 * arrow keys), buttons hold keys — so scripts don't know whether a keyboard or a
 * touch screen is used.
 */

export interface Vec {
  x: number;
  y: number;
}

/**
 * Joystick vector for a thumb `dx, dy` away from the stick centre: length 0 inside the
 * dead zone, then growing to 1 at `radius` (and staying 1 beyond it).
 */
export function stickVector(dx: number, dy: number, radius: number, deadZone = 0.15): Vec {
  const d = Math.hypot(dx, dy);
  if (!d || radius <= 0) return { x: 0, y: 0 };
  const len = Math.min(1, d / radius);
  if (len <= deadZone) return { x: 0, y: 0 };
  const k = (len - deadZone) / (1 - deadZone) / d;
  return { x: dx * k, y: dy * k };
}

/** Arrow keys a stick vector holds: each axis past `threshold`. */
export function stickArrows(v: Vec, threshold = 0.4): string[] {
  const keys: string[] = [];
  if (v.x < -threshold) keys.push('ArrowLeft');
  if (v.x > threshold) keys.push('ArrowRight');
  if (v.y < -threshold) keys.push('ArrowUp');
  if (v.y > threshold) keys.push('ArrowDown');
  return keys;
}

export interface ButtonPlace {
  button: TouchButton;
  label: string;
  x: number;
  y: number;
  r: number;
}

/** Sizes in CSS px for a screen of w × h. */
export function touchMetrics(w: number, h: number): { stickR: number; buttonR: number; margin: number } {
  const short = Math.min(w, h);
  const stickR = Math.max(44, Math.min(80, short * 0.13));
  return { stickR, buttonR: Math.max(28, Math.min(46, short * 0.075)), margin: Math.max(16, short * 0.04) };
}

/** Button positions: the first at the bottom-right corner, the others in an arc around it. */
export function placeButtons(buttons: readonly TouchButton[], w: number, h: number): ButtonPlace[] {
  const { buttonR, margin } = touchMetrics(w, h);
  const ax = w - margin - buttonR;
  const ay = h - margin - buttonR;
  const small = buttonR * 0.78;
  const n = buttons.length - 1;
  const dist = buttonR + small + 12;
  return buttons.map((button, i) => {
    const label = button.label ?? String.fromCharCode(65 + i);
    if (i === 0) return { button, label, x: ax, y: ay, r: buttonR };
    // Spread from left (180°) to up (270°); a single extra button sits diagonally.
    const t = n === 1 ? 0.5 : (i - 1) / (n - 1);
    const a = Math.PI * (1 + 0.5 * t);
    return { button, label, x: ax + Math.cos(a) * dist, y: ay + Math.sin(a) * dist, r: small };
  });
}

interface StickTouch {
  id: number;
  /** Centre (where the thumb landed, kept on screen). */
  cx: number;
  cy: number;
  x: number;
  y: number;
}

export const DEFAULT_TOUCH: Required<TouchLayout> = { show: 'auto', stick: true, arrows: true, buttons: [{ key: 'Space', label: 'A' }] };

export class TouchControls {
  readonly layout: Required<TouchLayout>;
  private el: HTMLElement | null = null;
  private stickTouch: StickTouch | null = null;
  /** Pointer id → key held by that pointer. */
  private held = new Map<number, string>();
  private arrows: string[] = [];
  private touched = false;
  private width = 0;
  private height = 0;

  constructor(
    private readonly input: Input,
    layout: TouchLayout = {},
  ) {
    this.layout = { ...DEFAULT_TOUCH, ...layout, buttons: layout.buttons ?? DEFAULT_TOUCH.buttons };
  }

  /** Shown now? 'auto' shows them on touch screens, or as soon as the screen is touched. */
  get visible(): boolean {
    if (this.layout.show === 'never') return false;
    if (this.layout.show === 'always') return true;
    return this.touched || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  }

  attach(el: HTMLElement): void {
    if (this.el || this.layout.show === 'never') return;
    this.el = el;
    // No scrolling, pinch-zoom, text selection or long-press menus on the game.
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    (el.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.el = null;
    this.releaseAll();
  }

  private onContextMenu = (e: Event): void => e.preventDefault();

  private local(e: PointerEvent): Vec {
    const r = this.el!.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.touched = true;
    if (!this.visible) return;
    e.preventDefault();
    const p = this.local(e);
    const hitButton = placeButtons(this.layout.buttons, this.width, this.height).find((b) => Math.hypot(p.x - b.x, p.y - b.y) <= b.r * 1.25);
    if (hitButton) {
      this.held.set(e.pointerId, hitButton.button.key);
      this.input.press(hitButton.button.key);
    } else if (this.layout.stick && !this.stickTouch && p.x < this.width / 2) {
      const { stickR, margin } = touchMetrics(this.width, this.height);
      const lo = stickR + margin * 0.5;
      this.stickTouch = {
        id: e.pointerId,
        cx: Math.max(lo, Math.min(this.width / 2 - stickR, p.x)),
        cy: Math.max(lo, Math.min(this.height - lo, p.y)),
        x: p.x,
        y: p.y,
      };
      this.updateStick();
    } else return;
    try {
      // Keep getting moves when the thumb slides off the canvas edge.
      this.el!.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer is already gone (or synthetic); nothing to capture.
    }
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.stickTouch;
    if (!s || e.pointerId !== s.id) return;
    e.preventDefault();
    const p = this.local(e);
    s.x = p.x;
    s.y = p.y;
    this.updateStick();
  };

  private onUp = (e: PointerEvent): void => {
    if (this.stickTouch?.id === e.pointerId) {
      this.stickTouch = null;
      this.updateStick();
    }
    const key = this.held.get(e.pointerId);
    if (key !== undefined) {
      this.held.delete(e.pointerId);
      if (![...this.held.values()].includes(key)) this.input.release(key);
    }
  };

  private updateStick(): void {
    const s = this.stickTouch;
    const { stickR } = touchMetrics(this.width, this.height);
    const v = s ? stickVector(s.x - s.cx, s.y - s.cy, stickR) : { x: 0, y: 0 };
    this.input.setStick(v.x, v.y);
    if (!this.layout.arrows) return;
    const next = stickArrows(v);
    for (const k of this.arrows) if (!next.includes(k)) this.input.release(k);
    for (const k of next) if (!this.arrows.includes(k)) this.input.press(k);
    this.arrows = next;
  }

  private releaseAll(): void {
    this.stickTouch = null;
    this.input.setStick(0, 0);
    for (const k of [...this.arrows, ...this.held.values()]) this.input.release(k);
    this.arrows = [];
    this.held.clear();
  }

  /** Draws the controls in screen space (CSS px); call after the game has rendered. */
  draw(ctx: CanvasRenderingContext2D, dpr: number, w: number, h: number): void {
    this.width = w;
    this.height = h;
    if (!this.visible) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { stickR, margin } = touchMetrics(w, h);
    if (this.layout.stick) {
      const s = this.stickTouch;
      // Resting: a faint stick where the thumb usually is.
      const cx = s?.cx ?? margin + stickR;
      const cy = s?.cy ?? h - margin - stickR;
      const v = this.input.stick();
      ctx.globalAlpha = s ? 0.9 : 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, stickR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      // Knob: where the thumb is, limited to the ring.
      const dx = s ? s.x - cx : 0;
      const dy = s ? s.y - cy : 0;
      const k = Math.min(1, stickR / (Math.hypot(dx, dy) || 1));
      const kx = cx + dx * k;
      const ky = cy + dy * k;
      ctx.beginPath();
      ctx.arc(kx, ky, stickR * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = Math.hypot(v.x, v.y) > 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)';
      ctx.fill();
    }
    const down = new Set(this.held.values());
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of placeButtons(this.layout.buttons, w, h)) {
      const pressed = down.has(b.button.key);
      ctx.globalAlpha = pressed ? 0.9 : 0.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (pressed ? 0.94 : 1), 0, Math.PI * 2);
      ctx.fillStyle = b.button.color ?? 'rgba(255,255,255,0.18)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(b.r * 0.7)}px system-ui, sans-serif`;
      ctx.fillText(b.label, b.x, b.y + 1);
    }
    ctx.restore();
  }
}
