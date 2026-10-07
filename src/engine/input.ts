export interface KeyState {
  isDown(...codes: string[]): boolean;
  anyDown(): boolean;
}

/** An analog stick: x, y in -1..1, length ≤ 1 (0, 0 when released). */
export interface StickState {
  stick(): { x: number; y: number };
}

/** Latches key presses so a tap shorter than one simulation step is not lost. */
export interface KeyPresses {
  /** Keys that went down since the previous call. */
  consumePressed(): ReadonlySet<string>;
}

/** A mouse or finger over the game canvas. */
export interface PointerState {
  /** Position in canvas CSS px; `down` while a button / finger is pressed. */
  pointer(): { x: number; y: number; down: boolean };
  /** Presses since the previous call. */
  consumeClicks(): number;
}

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export class Input implements KeyState, KeyPresses, StickState, PointerState {
  private keys = new Set<string>();
  private analog = { x: 0, y: 0 };
  private pressed = new Set<string>();
  private target: Window | null = null;
  private ptr = { x: 0, y: 0, down: false };
  private clicks = 0;
  private surface: HTMLElement | null = null;

  private local(e: PointerEvent): void {
    const r = this.surface!.getBoundingClientRect();
    this.ptr.x = e.clientX - r.left;
    this.ptr.y = e.clientY - r.top;
  }
  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.local(e);
    this.ptr.down = true;
    this.clicks++;
  };
  private onPointerMove = (e: PointerEvent): void => this.local(e);
  private onPointerUp = (e: PointerEvent): void => {
    this.local(e);
    this.ptr.down = false;
  };

  private onDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
  };
  private onUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onBlur = (): void => {
    this.keys.clear();
    this.analog = { x: 0, y: 0 };
  };

  attach(target: Window = window): void {
    if (this.target) return;
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Follows the mouse / touches over `el` (the game canvas). */
  attachPointer(el: HTMLElement): void {
    if (this.surface) return;
    this.surface = el;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  detach(): void {
    if (this.surface) {
      this.surface.removeEventListener('pointerdown', this.onPointerDown);
      this.surface.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      this.surface = null;
      this.ptr.down = false;
      this.clicks = 0;
    }
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.keys.clear();
    this.pressed.clear();
    this.analog = { x: 0, y: 0 };
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  anyDown(): boolean {
    return this.keys.size > 0 || this.analog.x !== 0 || this.analog.y !== 0;
  }

  stick(): { x: number; y: number } {
    return this.analog;
  }

  /** Set by touch controls (or tests). */
  setStick(x: number, y: number): void {
    this.analog = { x, y };
  }

  pointer(): { x: number; y: number; down: boolean } {
    return this.ptr;
  }

  consumeClicks(): number {
    const n = this.clicks;
    this.clicks = 0;
    return n;
  }

  /** Programmatic pointer (tests): move to (x, y) in canvas px, optionally clicking there. */
  setPointer(x: number, y: number, click = false): void {
    this.ptr.x = x;
    this.ptr.y = y;
    if (click) this.clicks++;
  }

  consumePressed(): ReadonlySet<string> {
    const p = this.pressed;
    this.pressed = new Set();
    return p;
  }

  /** Programmatic key control (tests, touch controls). */
  press(code: string): void {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }

  release(code: string): void {
    this.keys.delete(code);
  }
}
