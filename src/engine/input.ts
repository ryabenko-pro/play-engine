import { emptyIntent, type Intent } from './intent';
import { normalize } from './math';
import { unproject } from './projection';
import type { ViewMode } from './types';

export interface KeyState {
  isDown(...codes: string[]): boolean;
}

/** Latches key presses so a tap shorter than one simulation step is not lost. */
export interface KeyActivity {
  /** True if any key went down since the previous call. */
  consumeActivity(): boolean;
}

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export class Input implements KeyState, KeyActivity {
  private keys = new Set<string>();
  private activity = false;
  private target: Window | null = null;

  private onDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    this.keys.add(e.code);
    this.activity = true;
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
  };
  private onUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onBlur = (): void => this.keys.clear();

  attach(target: Window = window): void {
    if (this.target) return;
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.keys.clear();
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  consumeActivity(): boolean {
    const a = this.activity;
    this.activity = false;
    return a;
  }

  /** Programmatic key control (tests, touch controls). */
  press(code: string): void {
    this.keys.add(code);
    this.activity = true;
  }

  release(code: string): void {
    this.keys.delete(code);
  }
}

export interface KeyboardReading {
  intent: Intent;
  /** True if the player touched any control this frame. */
  active: boolean;
}

export function keyboardIntent(keys: KeyState, view: ViewMode): KeyboardReading {
  const intent = emptyIntent();
  const mx = (keys.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (keys.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
  const my = (keys.isDown('ArrowDown', 'KeyS') ? 1 : 0) - (keys.isDown('ArrowUp', 'KeyW') ? 1 : 0);
  intent.shoot = keys.isDown('KeyJ', 'KeyX', 'KeyK');
  if (view === 'side') {
    intent.moveX = mx;
    intent.jump = keys.isDown('Space') || my < 0;
  } else {
    // In isometric view "up" on screen is diagonal in world space.
    const d = normalize(unproject(view, { x: mx, y: my }));
    intent.moveX = d.x;
    intent.moveY = d.y;
  }
  return { intent, active: mx !== 0 || my !== 0 || intent.jump || intent.shoot };
}
