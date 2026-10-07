import { createDefaultInteractions } from '../../engine/interactions';
import type { Emission, Interactions, KindDef, Project, PropModifier, Reaction, StatusDef } from '../../engine/types';
import { clone } from '../../engine/util';
import type { Observable, PlayState, ProjectReader, ProjectWriter } from '../store';
import { h } from '../ui';

export type InteractionsStore = Observable & ProjectReader & ProjectWriter & PlayState;

export interface InteractionsPanel {
  toggle(): void;
  readonly open: boolean;
}

// ---------------------------------------------------------------------------
// Text formats of the compact columns
// ---------------------------------------------------------------------------

/** "fire, heat 40" ↔ [{fire, 0}, {heat, 40}] */
export const formatEmits = (e: readonly Emission[]) => e.map((x) => (x.radius ? `${x.element} ${x.radius}` : x.element)).join(', ');
export function parseEmits(s: string): Emission[] {
  return s
    .split(',')
    .map((p) => p.trim().split(/\s+/))
    .filter(([el]) => !!el)
    .map(([element, r]) => ({ element, radius: Math.max(0, Number(r) || 0) }));
}

/** "speed ×0.5, jumpSpeed ×0.8" ↔ [{speed, 0.5}, {jumpSpeed, 0.8}] (x or * work too) */
export const formatModifiers = (m: readonly PropModifier[]) => m.map((x) => `${x.prop} ×${x.factor}`).join(', ');
export function parseModifiers(s: string): PropModifier[] {
  return [...s.matchAll(/([A-Za-z_$][\w$]*)\s*[×x*]\s*(-?[\d.]+)/g)].map((m) => ({ prop: m[1], factor: Number(m[2]) })).filter((m) => Number.isFinite(m.factor));
}

// ---------------------------------------------------------------------------
// Renames keep every reference in the project in sync
// ---------------------------------------------------------------------------

export function renameKind(p: Project, from: string, to: string): void {
  const swap = (list?: string[]) => list?.map((k) => (k === from ? to : k));
  for (const s of p.scenes) {
    if (s.kind === 'actor') s.actor.kinds = swap(s.actor.kinds);
    else for (const e of s.entities) if (e.type === 'block') e.kinds = swap(e.kinds);
  }
  const it = p.interactions!;
  for (const k of it.kinds) if (k.name === from) k.name = to;
  for (const r of it.reactions) if (r.target === from) r.target = to;
}

export function removeKind(p: Project, name: string): void {
  const drop = (list?: string[]) => list?.filter((k) => k !== name);
  for (const s of p.scenes) {
    if (s.kind === 'actor') s.actor.kinds = drop(s.actor.kinds);
    else for (const e of s.entities) if (e.type === 'block') e.kinds = drop(e.kinds);
  }
  const it = p.interactions!;
  it.kinds = it.kinds.filter((k) => k.name !== name);
  it.reactions = it.reactions.filter((r) => r.target !== name);
}

export function renameStatus(it: Interactions, from: string, to: string): void {
  for (const s of it.statuses) if (s.name === from) s.name = to;
  for (const r of it.reactions) {
    if (r.target === from) r.target = to;
    if (r.add === from) r.add = to;
    if (r.remove === from) r.remove = to;
  }
}

export function removeStatus(it: Interactions, name: string): void {
  it.statuses = it.statuses.filter((s) => s.name !== name);
  it.reactions = it.reactions.filter((r) => r.target !== name);
  for (const r of it.reactions) {
    if (r.add === name) r.add = '';
    if (r.remove === name) r.remove = '';
  }
}

export function renameElement(it: Interactions, from: string, to: string): void {
  it.elements = it.elements.map((e) => (e === from ? to : e));
  const emits = (list: Emission[]) => list.forEach((e) => e.element === from && (e.element = to));
  for (const k of it.kinds) emits(k.emits);
  for (const s of it.statuses) {
    emits(s.emits);
    if (s.element === from) s.element = to;
  }
  for (const r of it.reactions) if (r.element === from) r.element = to;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Project-wide Interactions editor, over the viewport: elements, kinds, statuses
 * and the reaction rules. Every edit is one undoable step.
 */
export function mountInteractions(host: HTMLElement, store: InteractionsStore): InteractionsPanel {
  const body = h('div', { class: 'ix-body' });
  const root = h(
    'div',
    { class: 'interactions', hidden: true },
    h('div', { class: 'se-header' },
      h('span', { class: 'scene-kind' }, '⚗ Interactions'),
      h('span', { class: 'muted' }, 'What things are, what they give off, and what happens when they meet'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'small', title: 'Replace everything below with the default fire / water / cold / heat library', onClick: () => resetDefaults() }, 'Reset to defaults'),
      h('button', { class: 'small', title: 'Close (Esc)', onClick: () => panel.toggle() }, '✕'),
    ),
    body,
  );
  host.append(root);

  const data = (): Interactions => store.project.interactions ?? { elements: [], kinds: [], statuses: [], reactions: [] };

  /** Commits a change to a copy of the interactions (and, for renames, the whole project). */
  const change = (fn: (it: Interactions, p: Project) => void) =>
    store.commit((p) => {
      const it = clone(data());
      p.interactions = it;
      fn(it, p);
    });

  const resetDefaults = () => {
    if (confirm('Replace all kinds, statuses and reactions with the default library? (Undo brings them back)')) change((_, p) => (p.interactions = createDefaultInteractions()));
  };

  // Controls ---------------------------------------------------------------

  const key = (k: string) => ({ 'data-key': k });
  const text = (k: string, value: string, onCommit: (v: string) => void, cls = '', placeholder = '') => {
    const i = h('input', { type: 'text', value, class: cls, placeholder, spellcheck: false, ...key(k) });
    i.addEventListener('change', () => onCommit(i.value.trim()));
    return i;
  };
  const num = (k: string, value: number, onCommit: (v: number) => void, step = 1) => {
    const i = h('input', { type: 'number', value: String(value), step: String(step), min: '0', class: 'num', ...key(k) });
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (Number.isFinite(v)) onCommit(Math.max(0, v));
    });
    return i;
  };
  const check = (k: string, value: boolean, onCommit: (v: boolean) => void) => {
    const i = h('input', { type: 'checkbox', checked: value, ...key(k) });
    i.addEventListener('change', () => onCommit(i.checked));
    return i;
  };
  const color = (k: string, value: string, onCommit: (v: string) => void) => {
    const i = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888', ...key(k) });
    i.addEventListener('change', () => onCommit(i.value));
    return i;
  };
  const select = (k: string, value: string, options: ReadonlyArray<readonly [string, string]>, onCommit: (v: string) => void) => {
    const all = options.some(([v]) => v === value) ? options : [...options, [value, `${value} (missing)`] as const];
    const s = h('select', key(k), ...all.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    s.addEventListener('change', () => onCommit(s.value));
    return s;
  };
  const del = (title: string, fn: () => void) => h('button', { class: 'small', title, onClick: fn }, '✕');
  const uniqueName = (taken: string[], base: string) => {
    let n = 1;
    while (taken.includes(`${base}${n}`)) n++;
    return `${base}${n}`;
  };
  const rename = (taken: string[], from: string, to: string, apply: () => void) => {
    if (!to || to === from) return render();
    if (taken.includes(to)) {
      alert(`"${to}" already exists.`);
      return render();
    }
    apply();
  };

  const table = (cols: string[], rows: HTMLElement[][], cls: string) =>
    h('table', { class: `ix-table ${cls}` },
      h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', {}, c)))),
      h('tbody', {}, ...rows.map((cells) => h('tr', {}, ...cells.map((c) => h('td', {}, c))))),
    );

  const section = (title: string, hint: string, content: HTMLElement, add?: [string, () => void]) =>
    h('section', { class: 'ix-section' },
      h('div', { class: 'ix-title' }, h('h3', {}, title), h('span', { class: 'muted' }, hint), h('span', { class: 'spacer' }),
        add ? h('button', { class: 'small', onClick: add[1] }, add[0]) : null),
      content,
    );

  // Sections -----------------------------------------------------------------

  function elementsSection(it: Interactions): HTMLElement {
    const chips = h('div', { class: 'ix-elements' },
      ...it.elements.map((el, i) =>
        h('span', { class: 'ix-element' },
          text(`el/${i}`, el, (v) => rename(it.elements, el, v, () => change((x) => renameElement(x, el, v))), 'ix-name'),
          del(`Delete "${el}" (kinds and statuses stop giving it off)`, () =>
            change((x) => {
              x.elements = x.elements.filter((e) => e !== el);
              for (const k of x.kinds) k.emits = k.emits.filter((e) => e.element !== el);
              for (const s of x.statuses) s.emits = s.emits.filter((e) => e.element !== el);
              x.reactions = x.reactions.filter((r) => r.element !== el);
            }),
          ),
        ),
      ),
    );
    return section('Elements', 'What things give off: fire, water, cold…', chips, ['+ Element', () => change((x) => x.elements.push(uniqueName(x.elements, 'element')))]);
  }

  function kindsSection(it: Interactions): HTMLElement {
    const upd = (name: string, fn: (k: KindDef) => void) => change((x) => fn(x.kinds.find((k) => k.name === name)!));
    const names = it.kinds.map((k) => k.name);
    const rows = it.kinds.map((k, i) => [
      text(`k/${i}/name`, k.name, (v) => rename(names, k.name, v, () => change((_, p) => renameKind(p, k.name, v))), 'ix-name'),
      color(`k/${i}/color`, k.color, (v) => upd(k.name, (x) => (x.color = v))),
      check(`k/${i}/solid`, k.solid, (v) => upd(k.name, (x) => (x.solid = v))),
      check(`k/${i}/push`, k.pushable, (v) => upd(k.name, (x) => (x.pushable = v))),
      num(`k/${i}/weight`, k.weight, (v) => upd(k.name, (x) => (x.weight = v))),
      num(`k/${i}/strength`, k.strength, (v) => upd(k.name, (x) => (x.strength = v))),
      text(`k/${i}/emits`, formatEmits(k.emits), (v) => upd(k.name, (x) => (x.emits = parseEmits(v))), 'ix-wide', 'e.g. fire, heat 40'),
      del(`Delete kind "${k.name}" (removed from every actor and block)`, () => change((_, p) => removeKind(p, k.name))),
    ]);
    return section(
      'Kinds',
      'What things are. Pick them in the actor / block inspector. Weight vs strength decides grid pushes; "Gives off" is element [radius px].',
      table(['Name', 'Colour', 'Solid', 'Pushable', 'Weight', 'Strength', 'Gives off', ''], rows, 'kinds'),
      ['+ Kind', () => change((x) => x.kinds.push({ name: uniqueName(x.kinds.map((k) => k.name), 'kind'), color: '#8a93a3', solid: false, pushable: false, weight: 1, strength: 0, emits: [] }))],
    );
  }

  function statusesSection(it: Interactions): HTMLElement {
    const upd = (name: string, fn: (s: StatusDef) => void) => change((x) => fn(x.statuses.find((s) => s.name === name)!));
    const names = it.statuses.map((s) => s.name);
    const elements = [['', '—'] as const, ...it.elements.map((e) => [e, e] as const)];
    const rows = it.statuses.map((s, i) => [
      text(`s/${i}/name`, s.name, (v) => rename(names, s.name, v, () => change((x) => renameStatus(x, s.name, v))), 'ix-name'),
      color(`s/${i}/color`, s.color, (v) => upd(s.name, (x) => (x.color = v))),
      num(`s/${i}/dur`, s.duration, (v) => upd(s.name, (x) => (x.duration = v)), 0.5),
      num(`s/${i}/dmg`, s.damage, (v) => upd(s.name, (x) => (x.damage = v))),
      num(`s/${i}/every`, s.interval, (v) => upd(s.name, (x) => (x.interval = v)), 0.25),
      select(`s/${i}/el`, s.element, elements, (v) => upd(s.name, (x) => (x.element = v))),
      text(`s/${i}/emits`, formatEmits(s.emits), (v) => upd(s.name, (x) => (x.emits = parseEmits(v))), 'ix-wide', 'e.g. fire'),
      text(`s/${i}/mods`, formatModifiers(s.modifiers), (v) => upd(s.name, (x) => (x.modifiers = parseModifiers(v))), 'ix-wide', 'e.g. speed ×0.5'),
      del(`Delete status "${s.name}"`, () => change((x) => removeStatus(x, s.name))),
    ]);
    return section(
      'Statuses',
      'Timed conditions. Damage goes through onHit (hit.element); "Modifies" multiplies the actor\'s props while active.',
      table(['Name', 'Colour', 'Lasts s', 'Damage', 'Every s', 'Damage element', 'Gives off', 'Modifies props', ''], rows, 'statuses'),
      ['+ Status', () => change((x) => x.statuses.push({ name: uniqueName(x.statuses.map((s) => s.name), 'status'), color: '#8a93a3', duration: 3, damage: 0, interval: 1, element: '', emits: [], modifiers: [] }))],
    );
  }

  function reactionsSection(it: Interactions): HTMLElement {
    const upd = (i: number, fn: (r: Reaction) => void) => change((x) => fn(x.reactions[i]));
    const move = (i: number, d: number) =>
      change((x) => {
        const [r] = x.reactions.splice(i, 1);
        x.reactions.splice(Math.max(0, Math.min(x.reactions.length, i + d)), 0, r);
      });
    const elements = it.elements.map((e) => [e, e] as const);
    const statuses = it.statuses.map((s) => [s.name, s.name] as const);
    const targets = [['any', 'anything'] as const, ...it.kinds.map((k) => [k.name, `${k.name} (kind)`] as const), ...statuses.map(([n]) => [n, `${n} (status)`] as const)];
    const none = [['', '—'] as const, ...statuses];
    const rows = it.reactions.map((r, i) => {
      const burstOn = check(`r/${i}/burstOn`, !!r.burst, (v) => upd(i, (x) => (x.burst = v ? '#ffffff' : '')));
      return [
        h('span', { class: 'muted' }, String(i + 1)),
        select(`r/${i}/el`, r.element, elements, (v) => upd(i, (x) => (x.element = v))),
        select(`r/${i}/target`, r.target, targets, (v) => upd(i, (x) => (x.target = v))),
        select(`r/${i}/add`, r.add, none, (v) => upd(i, (x) => (x.add = v))),
        select(`r/${i}/remove`, r.remove, none, (v) => upd(i, (x) => (x.remove = v))),
        h('span', { class: 'ix-burst' }, burstOn, r.burst ? color(`r/${i}/burst`, r.burst, (v) => upd(i, (x) => (x.burst = v))) : null),
        check(`r/${i}/stop`, r.stop, (v) => upd(i, (x) => (x.stop = v))),
        h('span', { class: 'ix-row-actions' },
          h('button', { class: 'small', title: 'Earlier', disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
          h('button', { class: 'small', title: 'Later', disabled: i === it.reactions.length - 1, onClick: () => move(i, 1) }, '↓'),
          del('Delete reaction', () => change((x) => x.reactions.splice(i, 1))),
        ),
      ];
    });
    return section(
      'Reactions',
      'Checked in order whenever an element reaches an actor. "Stop" skips the later rules for that element (wet → fire does nothing).',
      table(['#', 'When element…', '…reaches', 'Add status', 'Remove status', 'Particles', 'Stop', ''], rows, 'reactions'),
      ['+ Reaction', () => change((x) => x.reactions.push({ element: x.elements[0] ?? '', target: 'any', add: '', remove: '', burst: '', stop: false }))],
    );
  }

  function render(): void {
    if (root.hidden) return;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && root.contains(active) ? active.getAttribute('data-key') : null;
    const scroll = body.scrollTop;
    const it = data();
    body.replaceChildren(elementsSection(it), kindsSection(it), statusesSection(it), reactionsSection(it));
    body.scrollTop = scroll;
    if (focusKey) body.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  const panel: InteractionsPanel = {
    get open() {
      return !root.hidden;
    },
    toggle() {
      root.hidden = !root.hidden;
      render();
    },
  };

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') panel.toggle();
  });
  store.subscribe((reason) => {
    if (reason === 'play' && store.playing && !root.hidden) panel.toggle();
    if (reason === 'change') render();
  });
  return panel;
}
