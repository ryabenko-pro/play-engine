import type { BlockArg, BlockNode, BlockProgram, BlockStack, PropValue } from '../../engine/types';
import { clone, uid } from '../../engine/util';
import { closeMenu, h, openMenu, type MenuItem } from '../ui';
import {
  CATEGORIES,
  KEY_OPTIONS,
  accepts,
  blockDef,
  categoryColor,
  paletteBlocks,
  textLines,
  type BlockDef,
  type MenuSource,
  type SlotSpec,
  type ValueType,
} from './catalog';
import { isNode } from './codegen';
import { modules } from '../modules';

/** Names the dropdowns offer, taken from the actor / project being edited. */
export interface MenuContext {
  states: readonly string[];
  forms: readonly string[];
  projectiles: readonly string[];
  statuses: readonly string[];
  elements: readonly string[];
  kinds: readonly string[];
  /** Actor scenes (spawn). */
  scenes: readonly string[];
  /** Paths and zones drawn in the project's levels. */
  paths: readonly string[];
  zones: readonly string[];
  /** Game variables declared by other actors (this program's own are in its vars). */
  globals: readonly string[];
}

export const EMPTY_MENUS: MenuContext = { states: [], forms: [], projectiles: [], statuses: [], elements: [], kinds: [], scenes: [], paths: [], zones: [], globals: [] };

/** Categories shown in the palette: optional modules' categories only when the module is on. */
const shownCategories = () => CATEGORIES.filter((c) => c.id !== 'interact' || modules.interactions);

/** Where a rendered block lives in the program. */
type Loc =
  | { kind: 'stmt'; list: BlockNode[]; index: number }
  | { kind: 'value'; owner: BlockNode; slot: string };

type Target =
  | { kind: 'insert'; list: BlockNode[]; index: number; x: number; y: number; w: number }
  | { kind: 'slot'; owner: BlockNode; slot: string; el: HTMLElement }
  | { kind: 'delete' };

interface Drag {
  blocks: BlockNode[];
  /** A single reporter / boolean (goes into slots) rather than statements. */
  value: ValueType | null;
  hat: boolean;
  cap: boolean;
  ghost: HTMLElement;
  offX: number;
  offY: number;
  target: Target | null;
  /** The pointer is outside the workspace: dropping there cancels the drag. */
  outside: boolean;
  /** Program before the drag, to cancel (Esc) and to detect a change. */
  before: string;
}

type Mode = 'canvas' | 'palette' | 'ghost';

const SLOT_RE = /\{(\w+)\}/g;
const isStatement = (d: BlockDef | undefined) => !!d && (d.shape === 'stack' || d.shape === 'c' || d.shape === 'cap' || d.shape === 'hat');
const SNAP = 26;

/** Fresh ids for a copied block tree. */
function reId(node: BlockNode): BlockNode {
  const n = clone(node);
  const walk = (b: BlockNode) => {
    b.id = uid('blk_');
    for (const v of Object.values(b.args)) if (isNode(v)) walk(v);
    for (const list of Object.values(b.stacks ?? {})) list.forEach(walk);
  };
  walk(n);
  return n;
}

/** Parses a typed literal: numbers and true / false keep their type. */
function parseValue(s: string): PropValue {
  const t = s.trim();
  if (t === 'true' || t === 'false') return t === 'true';
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : s;
}

/**
 * Scratch-like block editor: a palette of blocks by category and a canvas of
 * stacks. Blocks are dragged from the palette, snapped into stacks, C-block
 * mouths and slots, and dropped back on the palette to delete them.
 * Every finished edit is reported through `onChange` with the whole program.
 */
export class BlockWorkspace {
  readonly el: HTMLElement;
  private readonly cats: HTMLElement;
  private readonly palette: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly indicator: HTMLElement;

  private prog: BlockProgram = { vars: [], stacks: [] };
  private menus: MenuContext = EMPTY_MENUS;
  private locs = new Map<HTMLElement, Loc>();
  /** Block owning each rendered slot (drop targets for reporters). */
  private slotOwners = new WeakMap<HTMLElement, BlockNode>();
  private lists: Array<{ el: HTMLElement; list: BlockNode[]; top: boolean }> = [];
  private drag: Drag | null = null;

  constructor(private readonly onChange: (prog: BlockProgram) => void) {
    this.cats = h('div', { class: 'bw-cats' });
    this.palette = h('div', { class: 'bw-palette' });
    this.canvas = h('div', { class: 'bw-canvas' });
    this.scroll = h('div', { class: 'bw-scroll' }, this.canvas);
    this.indicator = h('div', { class: 'bw-insert', hidden: true });
    this.el = h('div', { class: 'bw' }, this.cats, this.palette, this.scroll, this.indicator);

    for (const c of shownCategories()) {
      this.cats.append(
        h('button', { class: 'bw-cat', title: c.label, onClick: () => this.showCategory(c.id) }, h('span', { class: 'dot', style: { background: c.color } }), c.label),
      );
    }
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
  }

  /** Shows a program (the workspace edits this object and reports copies). */
  load(prog: BlockProgram, menus: MenuContext): void {
    this.prog = prog;
    this.menus = menus;
    this.renderPalette();
    this.render();
  }

  private commit(): void {
    this.render();
    this.onChange(clone(this.prog));
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.locs.clear();
    this.lists = [];
    this.canvas.replaceChildren();
    for (const stack of this.prog.stacks) {
      const top = h('div', { class: 'bw-top', style: { left: `${stack.x}px`, top: `${stack.y}px` } });
      top.append(this.renderList(stack.blocks, 'canvas', true));
      this.canvas.append(top);
    }
    // Room to drop new stacks beyond the furthest one.
    let w = 0;
    let hgt = 0;
    for (const top of this.canvas.children as HTMLCollectionOf<HTMLElement>) {
      w = Math.max(w, top.offsetLeft + top.offsetWidth);
      hgt = Math.max(hgt, top.offsetTop + top.offsetHeight);
    }
    this.canvas.style.width = `${w + 400}px`;
    this.canvas.style.height = `${hgt + 400}px`;
  }

  private renderList(list: BlockNode[], mode: Mode, top = false): HTMLElement {
    const el = h('div', { class: 'blk-stack' });
    list.forEach((node, index) => {
      const b = this.renderBlock(node, mode);
      if (mode === 'canvas') this.locs.set(b, { kind: 'stmt', list, index });
      el.append(b);
    });
    if (mode === 'canvas') this.lists.push({ el, list, top });
    return el;
  }

  private renderBlock(node: BlockNode, mode: Mode): HTMLElement {
    const def = blockDef(node.op);
    if (!def) return h('div', { class: 'blk blk-stack-shape blk-unknown' }, `unknown block ${node.op}`);
    const el = h('div', { class: `blk blk-${def.shape}`, title: def.hint ?? '' });
    el.style.setProperty('--c', categoryColor(def.category));
    textLines(def).forEach((line, i) => {
      el.append(this.renderRow(node, def, line, mode));
      const mouth = def.mouths?.[i];
      if (def.shape === 'c' && mouth) {
        node.stacks ??= {};
        const list = (node.stacks[mouth] ??= []);
        el.append(h('div', { class: 'blk-mouth' }, this.renderList(list, mode)));
      }
    });
    if (def.shape === 'c') el.append(h('div', { class: 'blk-foot' }));
    return el;
  }

  private renderRow(node: BlockNode, def: BlockDef, line: string, mode: Mode): HTMLElement {
    const row = h('div', { class: 'blk-row' });
    let last = 0;
    for (const m of line.matchAll(SLOT_RE)) {
      const label = line.slice(last, m.index).trim();
      if (label) row.append(h('span', { class: 'blk-label' }, label));
      const spec = def.slots?.[m[1]];
      if (spec) row.append(this.renderSlot(node, m[1], spec, mode));
      last = m.index! + m[0].length;
    }
    const tail = line.slice(last).trim();
    if (tail) row.append(h('span', { class: 'blk-label' }, tail));
    return row;
  }

  private renderSlot(node: BlockNode, name: string, spec: SlotSpec, mode: Mode): HTMLElement {
    const v = node.args[name];
    let el: HTMLElement;
    if (isNode(v)) {
      const inner = this.renderBlock(v, mode);
      if (mode === 'canvas') this.locs.set(inner, { kind: 'value', owner: node, slot: name });
      el = h('span', { class: 'slot filled' }, inner);
    } else {
      const raw = String(v ?? spec.value ?? '');
      const set = (val: BlockArg) => {
        node.args[name] = val;
        this.commit();
      };
      const live = mode === 'canvas';
      switch (spec.kind) {
        case 'bool':
          el = h('span', { class: 'slot slot-bool' });
          break;
        case 'actor':
          el = h('span', { class: 'slot slot-actor' }, 'actor');
          break;
        case 'color': {
          const input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#888888', tabIndex: live ? 0 : -1 });
          input.addEventListener('change', () => set(input.value));
          el = h('span', { class: 'slot slot-color' }, input);
          break;
        }
        case 'menu': {
          const opts = this.menuOptions(spec.menu!, raw);
          const sel = h('select', { tabIndex: live ? 0 : -1 }, ...opts.map(([val, label]) => h('option', { value: val, selected: val === raw }, label)));
          sel.addEventListener('change', () => set(sel.value));
          el = h('span', { class: 'slot slot-menu' }, sel);
          break;
        }
        default: {
          const input = h('input', { type: 'text', value: raw, spellcheck: false, tabIndex: live ? 0 : -1 });
          const fit = () => (input.style.width = `calc(${Math.max(1, input.value.length)}ch + 14px)`);
          fit();
          input.addEventListener('input', fit);
          input.addEventListener('change', () => {
            if (spec.kind !== 'num') return set(input.value);
            const n = Number(input.value);
            set(input.value.trim() !== '' && Number.isFinite(n) ? n : 0);
          });
          input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
          el = h('span', { class: `slot slot-${spec.kind}` }, input);
        }
      }
    }
    el.dataset.slot = name;
    el.dataset.kind = spec.kind;
    if (mode === 'canvas') this.slotOwners.set(el, node);
    return el;
  }

  private menuOptions(src: MenuSource, current: string): ReadonlyArray<readonly [string, string]> {
    const names = (xs: readonly string[]) => xs.map((x) => [x, x] as const);
    const vars = (prop: boolean) => this.prog.vars.filter((v) => v.prop === prop && !v.global).map((v) => v.name);
    const opts =
      src === 'key' ? KEY_OPTIONS
      : src === 'state' ? names(this.menus.states)
      : src === 'form' ? names(['base', ...this.menus.forms])
      : src === 'projectile' ? names(this.menus.projectiles)
      : src === 'status' ? names(this.menus.statuses)
      : src === 'element' ? names(this.menus.elements)
      : src === 'kind' ? names(this.menus.kinds)
      : src === 'var' ? names(vars(false))
      : src === 'prop' ? names(vars(true))
      : src === 'global' ? names(this.globals())
      : src === 'scene' ? names(this.menus.scenes)
      : src === 'path' ? names(this.menus.paths)
      : src === 'zone' ? names(this.menus.zones)
      : src;
    // Keep a value that no longer exists visible instead of silently changing it.
    return opts.some(([v]) => v === current) || current === '' ? opts : [...opts, [current, `${current} (missing)`] as const];
  }

  /** Game variables: this program's own, then the other actors'. */
  private globals(): string[] {
    return [...new Set([...this.prog.vars.filter((v) => v.global).map((v) => v.name), ...this.menus.globals])];
  }

  // -------------------------------------------------------------------------
  // Palette
  // -------------------------------------------------------------------------

  private newNode(def: BlockDef, args: Record<string, BlockArg> = {}): BlockNode {
    const node: BlockNode = { id: uid('blk_'), op: def.op, args: { ...args } };
    for (const [name, spec] of Object.entries(def.slots ?? {})) {
      if (spec.kind === 'menu' && !spec.value && node.args[name] === undefined) {
        const first = this.menuOptions(spec.menu!, '')[0];
        if (first) node.args[name] = first[0];
      }
    }
    return node;
  }

  private paletteItem(def: BlockDef, args: Record<string, BlockArg> = {}): HTMLElement {
    const sample = this.newNode(def, args);
    const el = this.renderBlock(sample, 'palette');
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      this.startDrag([reId(sample)], e, r.left, r.top);
    });
    return h('div', { class: 'bw-pal-item' }, el);
  }

  private renderPalette(): void {
    const scroll = this.palette.scrollTop;
    this.palette.replaceChildren();
    for (const c of shownCategories()) {
      const section = h('div', { class: 'bw-section', 'data-cat': c.id }, h('div', { class: 'bw-section-title' }, c.label));
      if (c.id === 'variables') this.variablesSection(section);
      for (const def of paletteBlocks(c.id)) {
        if (def.module && !modules[def.module]) continue;
        if (def.slots?.v?.menu === 'var' && !this.prog.vars.some((v) => !v.prop && !v.global)) continue;
        if (def.slots?.v?.menu === 'global' && !this.globals().length) continue;
        section.append(this.paletteItem(def));
      }
      this.palette.append(section);
    }
    this.palette.scrollTop = scroll;
  }

  private variablesSection(section: HTMLElement): void {
    section.append(
      h('div', { class: 'bw-var-buttons' },
        h('button', {
          class: 'small',
          title: 'A value scripts can change: for this actor only, or for the whole game (shared by every actor, like money or lives)',
          onClick: (e: MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu(r.left, r.bottom + 2, [
              ['For this actor only', () => this.addVar('local'), 'Every actor has its own (self.data)'],
              ['For the whole game', () => this.addVar('global'), 'One value shared by every actor: money, lives, score… (world.vars)'],
            ]);
          },
        }, '+ Variable ▾'),
        h('button', { class: 'small', title: 'Read-only value each instance can override in the level (exported props); forms can override it too', onClick: () => this.addVar('prop') }, '+ Prop'),
      ),
    );
    for (const v of this.prog.vars) {
      const def = blockDef(v.prop ? 'var.prop' : v.global ? 'var.global' : 'var.get')!;
      const value = h('input', { type: 'text', class: 'bw-var-value', value: String(v.value), title: v.prop ? 'Default value (instances can override it)' : 'Value when the game starts' });
      value.addEventListener('change', () => {
        v.value = parseValue(value.value);
        this.commit();
      });
      const remove = h('button', { class: 'small', title: `Delete ${v.name}` }, '×');
      remove.addEventListener('click', () => {
        this.prog.vars = this.prog.vars.filter((x) => x !== v);
        this.renderPalette();
        this.commit();
      });
      const show = v.global
        ? h('input', { type: 'checkbox', class: 'bw-var-show', checked: !!v.show, title: 'Show it on the screen while playing' })
        : null;
      show?.addEventListener('change', () => {
        v.show = show.checked;
        this.commit();
      });
      const kind = v.prop ? 'prop' : v.global ? 'game' : '';
      section.append(h('div', { class: 'bw-var' }, this.paletteItem(def, { v: v.name }), h('span', { class: 'bw-var-kind' }, kind), show, value, remove));
    }
    // Game variables made by other actors can be used here too.
    for (const name of this.menus.globals.filter((g) => !this.prog.vars.some((v) => v.name === g))) {
      section.append(
        h('div', { class: 'bw-var', title: 'A game variable made by another actor' }, this.paletteItem(blockDef('var.global')!, { v: name }), h('span', { class: 'bw-var-kind' }, 'game')),
      );
    }
  }

  private addVar(kind: 'local' | 'global' | 'prop'): void {
    const ask = { local: 'New variable name (this actor only):', global: 'New game variable name (shared by every actor, e.g. money):', prop: 'New prop name (tunable per instance):' };
    const name = prompt(ask[kind])?.trim();
    if (!name) return;
    if (this.prog.vars.some((v) => v.name === name)) return void alert(`"${name}" already exists.`);
    this.prog.vars.push(kind === 'global' ? { name, value: 0, prop: false, global: true, show: true } : { name, value: 0, prop: kind === 'prop' });
    this.renderPalette();
    this.commit();
  }

  private showCategory(id: string): void {
    const section = this.palette.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (section) this.palette.scrollTop = section.offsetTop - this.palette.offsetTop;
  }

  // -------------------------------------------------------------------------
  // Dragging
  // -------------------------------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.drag) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, select, button')) return;
    const blk = t.closest<HTMLElement>('.blk');
    if (blk && this.canvas.contains(blk)) {
      e.preventDefault();
      this.pendingDrag(e, blk);
    } else if (this.scroll.contains(t)) {
      e.preventDefault();
      this.pan(e);
    }
  }

  /** Starts dragging once the pointer moves a little (a plain click does nothing). */
  private pendingDrag(down: PointerEvent, blk: HTMLElement): void {
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 4) return;
      stop();
      const loc = this.locs.get(blk);
      if (!loc) return;
      const r = blk.getBoundingClientRect();
      const before = JSON.stringify(this.prog);
      const blocks = this.detach(loc);
      this.startDrag(blocks, down, r.left, r.top, before);
      this.moveDrag(e);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  /** Takes a block out of the program: a statement brings the blocks below it along. */
  private detach(loc: Loc): BlockNode[] {
    if (loc.kind === 'value') {
      const node = loc.owner.args[loc.slot] as BlockNode;
      delete loc.owner.args[loc.slot];
      return [node];
    }
    const taken = loc.list.splice(loc.index);
    this.prog.stacks = this.prog.stacks.filter((s) => s.blocks.length);
    return taken;
  }

  private startDrag(blocks: BlockNode[], e: PointerEvent, left: number, top: number, before = JSON.stringify(this.prog)): void {
    closeMenu();
    const first = blockDef(blocks[0].op);
    const last = blockDef(blocks[blocks.length - 1].op);
    const ghost = h('div', { class: 'bw-ghost' }, isStatement(first) ? this.renderList(blocks, 'ghost') : this.renderBlock(blocks[0], 'ghost'));
    document.body.append(ghost);
    this.drag = {
      blocks,
      value: isStatement(first) ? null : (first?.output ?? 'text'),
      hat: first?.shape === 'hat',
      cap: last?.shape === 'cap',
      ghost,
      offX: e.clientX - left,
      offY: e.clientY - top,
      target: null,
      outside: false,
      before,
    };
    this.render();
    this.moveDrag(e);

    const move = (ev: PointerEvent) => this.moveDrag(ev);
    const up = (ev: PointerEvent) => {
      done();
      this.moveDrag(ev);
      this.drop();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      done();
      this.cancelDrag();
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
  }

  private moveDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    d.ghost.style.left = `${e.clientX - d.offX}px`;
    d.ghost.style.top = `${e.clientY - d.offY}px`;
    this.canvas.querySelector('.slot.drop')?.classList.remove('drop');
    this.indicator.hidden = true;
    this.el.classList.remove('deleting');
    d.target = this.findTarget(e);
    const t = d.target;
    if (t?.kind === 'slot') t.el.classList.add('drop');
    else if (t?.kind === 'delete') this.el.classList.add('deleting');
    else if (t?.kind === 'insert') {
      const host = this.el.getBoundingClientRect();
      Object.assign(this.indicator.style, { left: `${t.x - host.left}px`, top: `${t.y - host.top - 2}px`, width: `${t.w}px` });
      this.indicator.hidden = false;
    }
  }

  private findTarget(e: PointerEvent): Target | null {
    const d = this.drag!;
    const over = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    if (over(this.palette) || over(this.cats)) return { kind: 'delete' };
    d.outside = !over(this.scroll);
    if (d.outside) return null;

    if (d.value) {
      // The innermost compatible slot under the pointer.
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (!(el instanceof HTMLElement) || !this.canvas.contains(el) || !el.dataset.slot) continue;
        const owner = this.slotOwners.get(el);
        if (owner && accepts(el.dataset.kind as SlotSpec['kind'], d.value)) return { kind: 'slot', owner, slot: el.dataset.slot, el };
      }
      return null;
    }
    // Statements: the nearest gap between blocks (or an empty mouth) to the ghost's top-left corner.
    const g = d.ghost.getBoundingClientRect();
    let best: Target | null = null;
    let bestD = SNAP;
    for (const { el, list, top } of this.lists) {
      if (list.length && !isStatement(blockDef(list[0].op))) continue;
      const r = el.getBoundingClientRect();
      const kids = [...el.children] as HTMLElement[];
      for (let i = 0; i <= list.length; i++) {
        const prev = blockDef(list[i - 1]?.op ?? '');
        const next = blockDef(list[i]?.op ?? '');
        // A hat can only go on top of a stack that has none.
        if (d.hat && !(top && i === 0)) continue;
        if (prev?.shape === 'cap') continue;
        if (next && (next.shape === 'hat' || d.cap)) continue;
        // Above a top-level stack: the ghost's bottom meets the stack's top.
        const prepend = top && i === 0;
        const y = i < kids.length ? kids[i].getBoundingClientRect().top : kids.length ? kids[kids.length - 1].getBoundingClientRect().bottom : r.top;
        const dist = Math.hypot(g.left - r.left, (prepend ? g.bottom : g.top) - y);
        if (dist < bestD) {
          bestD = dist;
          best = { kind: 'insert', list, index: i, x: r.left, y, w: Math.max(60, Math.min(g.width, 200)) };
        }
      }
    }
    return best;
  }

  private drop(): void {
    const d = this.drag!;
    if (d.outside) return this.cancelDrag();
    const t = d.target;
    const g = d.ghost.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    this.endDrag();
    if (t?.kind === 'slot') t.owner.args[t.slot] = d.blocks[0];
    else if (t?.kind === 'insert') {
      t.list.splice(t.index, 0, ...d.blocks);
      // Blocks added above a stack: the stack stays where it was, the new blocks go on top.
      const stack = t.index === 0 ? this.prog.stacks.find((s) => s.blocks === t.list) : undefined;
      if (stack) stack.y = Math.max(0, stack.y - Math.round(g.height));
    } else if (t?.kind !== 'delete') {
      this.prog.stacks.push({ x: Math.max(0, Math.round(g.left - c.left)), y: Math.max(0, Math.round(g.top - c.top)), blocks: d.blocks });
    }
    if (JSON.stringify(this.prog) !== d.before) this.commit();
    else this.render();
  }

  private cancelDrag(): void {
    const d = this.drag!;
    this.endDrag();
    this.prog = Object.assign(this.prog, JSON.parse(d.before) as BlockProgram);
    this.render();
  }

  private endDrag(): void {
    this.drag?.ghost.remove();
    this.drag = null;
    this.indicator.hidden = true;
    this.el.classList.remove('deleting');
    this.canvas.querySelector('.slot.drop')?.classList.remove('drop');
  }

  /** Drag the empty canvas to scroll it. */
  private pan(down: PointerEvent): void {
    const sx = this.scroll.scrollLeft;
    const sy = this.scroll.scrollTop;
    const move = (e: PointerEvent) => {
      this.scroll.scrollLeft = sx - (e.clientX - down.clientX);
      this.scroll.scrollTop = sy - (e.clientY - down.clientY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.scroll.classList.remove('panning');
    };
    this.scroll.classList.add('panning');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // -------------------------------------------------------------------------
  // Context menu
  // -------------------------------------------------------------------------

  private onContextMenu(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (!this.scroll.contains(t) || t.closest('input, select')) return;
    e.preventDefault();
    const blk = t.closest<HTMLElement>('.blk');
    const loc = blk ? this.locs.get(blk) : undefined;
    const c = this.canvas.getBoundingClientRect();
    const at = { x: Math.round(e.clientX - c.left), y: Math.round(e.clientY - c.top) };
    const items: MenuItem[] = [];
    if (loc) {
      items.push(['Duplicate', () => this.duplicate(loc, at)]);
      items.push([loc.kind === 'stmt' ? 'Delete block' : 'Remove', () => this.remove(loc)]);
    } else {
      items.push(['Clean up blocks', () => this.cleanUp()]);
    }
    openMenu(e.clientX, e.clientY, items);
  }

  /** Copies the block (with the blocks below it) to a new stack next to the pointer. */
  private duplicate(loc: Loc, at: { x: number; y: number }): void {
    const blocks = loc.kind === 'value' ? [loc.owner.args[loc.slot] as BlockNode] : loc.list.slice(loc.index);
    this.prog.stacks.push({ x: at.x + 16, y: at.y + 16, blocks: blocks.map(reId) });
    this.commit();
  }

  /** Deletes one block; the blocks below a statement move up. */
  private remove(loc: Loc): void {
    if (loc.kind === 'value') delete loc.owner.args[loc.slot];
    else loc.list.splice(loc.index, 1);
    this.prog.stacks = this.prog.stacks.filter((s) => s.blocks.length);
    this.commit();
  }

  /** Lines the stacks up in one column, top to bottom. */
  private cleanUp(): void {
    const heights = new Map<BlockStack, number>();
    [...this.canvas.children].forEach((el, i) => heights.set(this.prog.stacks[i], (el as HTMLElement).offsetHeight));
    let y = 24;
    for (const s of [...this.prog.stacks].sort((a, b) => a.y - b.y || a.x - b.x)) {
      s.x = 24;
      s.y = y;
      y += (heights.get(s) ?? 40) + 28;
    }
    this.commit();
  }
}
