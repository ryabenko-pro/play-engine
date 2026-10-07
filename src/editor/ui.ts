type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/** Tiny DOM builder: h('div', { class: 'x', onClick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('data-')) el.setAttribute(k, String(v));
    else if (k in el) (el as unknown as Props)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export type Options = ReadonlyArray<readonly [value: string, label: string]>;

/** Optional decorations of a form row. */
export interface RowExtras {
  hint?: string;
  /** When set, the row is shown as overridden with a ↺ button that calls this. */
  reset?: () => void;
}

export interface NumberLimits {
  step?: number;
  min?: number;
  max?: number;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * A titled group of labeled property rows. Every control carries a stable
 * `data-key` so focus can be restored when the inspector re-renders.
 */
export class Form {
  readonly el: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly title: string,
  ) {
    this.el = h('section', { class: 'form' }, h('h3', {}, title));
    parent.append(this.el);
  }

  private key(label: string): string {
    return `${this.title}/${label}`;
  }

  private row(label: string, control: HTMLElement, x: RowExtras = {}): void {
    control.setAttribute('data-key', this.key(label));
    const reset = x.reset
      ? h('button', { class: 'reset', title: 'Revert to the character scene value', onClick: (e: Event) => (e.preventDefault(), x.reset!()) }, '↺')
      : null;
    this.el.append(
      h('label', { class: `row ${x.reset ? 'overridden' : ''}`, title: x.hint ?? '' }, h('span', {}, label), h('div', { class: 'control' }, control, reset)),
    );
  }

  num(label: string, value: number, onCommit: (v: number) => void, x: RowExtras & NumberLimits = {}): void {
    const input = h('input', { type: 'number', value: fmt(value), step: String(x.step ?? 1) });
    input.addEventListener('change', () => {
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      if (x.min !== undefined) v = Math.max(x.min, v);
      if (x.max !== undefined) v = Math.min(x.max, v);
      onCommit(v);
    });
    this.row(label, input, x);
  }

  text(label: string, value: string, onCommit: (v: string) => void, x: RowExtras = {}): void {
    const input = h('input', { type: 'text', value });
    input.addEventListener('change', () => onCommit(input.value));
    this.row(label, input, x);
  }

  color(label: string, value: string, onCommit: (v: string) => void, x: RowExtras = {}): void {
    const input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888' });
    input.addEventListener('change', () => onCommit(input.value));
    this.row(label, input, x);
  }

  check(label: string, value: boolean, onCommit: (v: boolean) => void, x: RowExtras = {}): void {
    const input = h('input', { type: 'checkbox', checked: value });
    input.addEventListener('change', () => onCommit(input.checked));
    this.row(label, input, x);
  }

  select(label: string, value: string, options: Options, onCommit: (v: string) => void, x: RowExtras = {}): void {
    const sel = h('select', {}, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    sel.addEventListener('change', () => onCommit(sel.value));
    this.row(label, sel, x);
  }

  area(label: string, value: string, onCommit: (v: string) => void, rows = 10, placeholder = ''): void {
    const ta = h('textarea', { rows, spellcheck: false, value, placeholder });
    ta.setAttribute('data-key', this.key(label));
    ta.addEventListener('change', () => onCommit(ta.value));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      }
    });
    this.el.append(h('div', { class: 'area-label' }, label), ta);
  }

  /** Toggleable chips: pick any of `options` (name + colour). */
  chips(label: string, options: ReadonlyArray<{ name: string; color: string }>, selected: readonly string[], onCommit: (v: string[]) => void, x: RowExtras = {}): void {
    const box = h('div', { class: 'chips' });
    for (const o of options) {
      const on = selected.includes(o.name);
      const chip = h('button', { class: `chip ${on ? 'on' : ''}` }, o.name);
      chip.style.setProperty('--chip', o.color);
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        onCommit(on ? selected.filter((s) => s !== o.name) : [...selected, o.name]);
      });
      box.append(chip);
    }
    // Kinds that no longer exist stay visible so they can be removed.
    for (const name of selected.filter((s) => !options.some((o) => o.name === s))) {
      box.append(h('button', { class: 'chip on missing', title: 'Not defined in Interactions', onClick: (e: Event) => (e.preventDefault(), onCommit(selected.filter((s) => s !== name))) }, `${name} ✕`));
    }
    if (!options.length && !selected.length) box.append(h('span', { class: 'muted' }, 'none defined'));
    this.row(label, box, x);
  }

  note(text: string): void {
    this.el.append(h('p', { class: 'note' }, text));
  }

  buttons(...btns: Array<[label: string, onClick: () => void, cls?: string]>): void {
    this.el.append(h('div', { class: 'buttons' }, ...btns.map(([l, fn, cls]) => h('button', { class: cls ?? '', onClick: fn }, l))));
  }

  custom(node: Node): void {
    this.el.append(node);
  }
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

export function download(filename: string, data: string | Uint8Array<ArrayBuffer>, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type MenuItem = [label: string, onPick: () => void, hint?: string];

let openPopup: HTMLElement | null = null;

export function closeMenu(): void {
  openPopup?.remove();
  openPopup = null;
}

/** A small popup menu at a screen position; closes on pick or on a click elsewhere. */
export function openMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeMenu();
  const el = h('div', { class: 'popup-menu', style: { left: `${x}px`, top: `${y}px` } },
    ...items.map(([label, fn, hint]) => h('button', { title: hint ?? '', onClick: () => (closeMenu(), fn()) }, label)),
  );
  document.body.append(el);
  // Keep it on screen (a menu opened from the right end of the toolbar).
  const r = el.getBoundingClientRect();
  if (r.right > innerWidth - 4) el.style.left = `${Math.max(4, innerWidth - 4 - r.width)}px`;
  if (r.bottom > innerHeight - 4) el.style.top = `${Math.max(4, innerHeight - 4 - r.height)}px`;
  openPopup = el;
  const away = (e: PointerEvent) => {
    if (el.contains(e.target as Node)) return;
    window.removeEventListener('pointerdown', away, true);
    if (openPopup === el) closeMenu();
  };
  window.addEventListener('pointerdown', away, true);
}

export type ModalButton = [label: string, onClick: () => void, kind?: 'primary' | 'plain'];

/**
 * A centred dialog over a dimmed editor. Esc or a click outside cancels (calls onCancel). Returns close.
 * A button is [label, onClick, kind] or a ready-made element (one the caller enables later).
 */
export function openModal(
  title: string,
  body: Child[],
  buttons: ReadonlyArray<ModalButton | HTMLButtonElement>,
  onCancel?: () => void,
  opts: { wide?: boolean } = {},
): () => void {
  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const cancel = () => (close(), onCancel?.());
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    cancel();
  };
  const dialog = h('div', { class: `modal ${opts.wide ? 'wide' : ''}`, role: 'dialog' },
    h('h2', {}, title),
    h('div', { class: 'modal-body' }, ...body),
    h('div', { class: 'modal-buttons' }, ...buttons.map((b) => (b instanceof HTMLElement ? b : h('button', { class: b[2] === 'primary' ? 'primary' : '', onClick: b[1] }, b[0])))),
  );
  const backdrop = h('div', { class: 'modal-backdrop', onPointerdown: (e: PointerEvent) => e.target === backdrop && cancel() }, dialog);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey, true);
  (dialog.querySelector('input, textarea, button.primary') as HTMLElement | null)?.focus();
  return close;
}
