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

  private row(label: string, control: HTMLElement, hint?: string): void {
    control.setAttribute('data-key', this.key(label));
    this.el.append(h('label', { class: 'row', title: hint ?? '' }, h('span', {}, label), control));
  }

  num(label: string, value: number, onCommit: (v: number) => void, opts: { step?: number; min?: number; max?: number; hint?: string } = {}): void {
    const input = h('input', { type: 'number', value: fmt(value), step: String(opts.step ?? 1) });
    input.addEventListener('change', () => {
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      if (opts.min !== undefined) v = Math.max(opts.min, v);
      if (opts.max !== undefined) v = Math.min(opts.max, v);
      onCommit(v);
    });
    this.row(label, input, opts.hint);
  }

  text(label: string, value: string, onCommit: (v: string) => void, hint?: string): void {
    const input = h('input', { type: 'text', value });
    input.addEventListener('change', () => onCommit(input.value));
    this.row(label, input, hint);
  }

  color(label: string, value: string, onCommit: (v: string) => void): void {
    const input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888' });
    input.addEventListener('change', () => onCommit(input.value));
    this.row(label, input);
  }

  check(label: string, value: boolean, onCommit: (v: boolean) => void, hint?: string): void {
    const input = h('input', { type: 'checkbox', checked: value });
    input.addEventListener('change', () => onCommit(input.checked));
    this.row(label, input, hint);
  }

  select(label: string, value: string, options: Options, onCommit: (v: string) => void, hint?: string): void {
    const sel = h('select', {}, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    sel.addEventListener('change', () => onCommit(sel.value));
    this.row(label, sel, hint);
  }

  area(label: string, value: string, onCommit: (v: string) => void, rows = 10): void {
    const ta = h('textarea', { rows, spellcheck: false, value });
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

export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
