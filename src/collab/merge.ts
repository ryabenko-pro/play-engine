import { setBlocks } from '../editor/blocks/codegen';
import type { Project } from '../engine/types';
import { mergeText } from './diff3';

/**
 * Three-way merge of whole projects: what changed between `base` and `mine` is laid over
 * `theirs` (the shared version, which moved on since `base`).
 *
 * Lists of things with ids (scenes, entities, assets, blocks) are matched by id, lists of
 * named things (states, forms, variables, kinds…) by name, so two people editing different
 * entities, or different fields of the same one, never clash. Scripts merge by lines.
 * A conflict is the same value changed differently on both sides (or deleted on one side and
 * changed on the other). It is reported and, until a choice is given, `theirs` wins.
 */

export type Choice = 'mine' | 'theirs';

export interface Conflict {
  /** Stable address of the value, e.g. `scenes[as_1].actor.color`; the key for a choice. */
  path: string;
  /** For people: "Yellow › color". */
  label: string;
  /** undefined = deleted (or never there). */
  base: unknown;
  mine: unknown;
  theirs: unknown;
}

export interface MergeResult {
  project: Project;
  conflicts: Conflict[];
}

const MISSING = undefined;

export function mergeProjects(base: Project, mine: Project, theirs: Project, choices: Record<string, Choice> = {}): MergeResult {
  const conflicts: Conflict[] = [];
  const ctx: Ctx = { choices, conflicts };
  const project = mergeValue(base, mine, theirs, { path: '', label: [] }, ctx) as Project;
  // A block actor's script is generated: build it from the merged blocks, never merge it.
  for (const scene of project.scenes) {
    if (scene.kind !== 'actor' || !scene.actor.blocks) continue;
    setBlocks(scene, scene.actor.blocks);
    const scriptPath = `scenes[${scene.id}].actor.script`;
    const i = conflicts.findIndex((c) => c.path === scriptPath);
    if (i >= 0) conflicts.splice(i, 1);
  }
  return { project, conflicts: conflicts.filter((c) => !(c.path in choices)) };
}

interface Ctx {
  choices: Record<string, Choice>;
  conflicts: Conflict[];
}

interface At {
  path: string;
  label: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function conflict(b: unknown, m: unknown, t: unknown, at: At, ctx: Ctx): unknown {
  ctx.conflicts.push({ path: at.path, label: at.label.join(' › ') || 'project', base: b, mine: m, theirs: t });
  return ctx.choices[at.path] === 'mine' ? m : t;
}

function mergeValue(b: unknown, m: unknown, t: unknown, at: At, ctx: Ctx): unknown {
  if (same(m, t) || same(t, b)) return m;
  if (same(m, b)) return t;
  if (isObject(m) && isObject(t)) return mergeObject(isObject(b) ? b : {}, m, t, at, ctx);
  if (Array.isArray(m) && Array.isArray(t)) return mergeArray(Array.isArray(b) ? b : [], m, t, at, ctx);
  if (typeof m === 'string' && typeof t === 'string' && (m.includes('\n') || t.includes('\n'))) {
    const text = mergeText(typeof b === 'string' ? b : '', m, t);
    if (text !== null) return text;
  }
  return conflict(b, m, t, at, ctx);
}

function mergeObject(b: Record<string, unknown>, m: Record<string, unknown>, t: Record<string, unknown>, at: At, ctx: Ctx) {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
    const label = k === 'actor' ? at.label : [...at.label, k];
    const v = mergeValue(b[k], m[k], t[k], { path: `${at.path}${at.path ? '.' : ''}${k}`, label }, ctx);
    if (v !== MISSING) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

type KeyOf = (item: unknown) => string;

/** How items of these lists are recognised across versions, or null to treat the list as one value. */
function keyFor(items: unknown[]): KeyOf | null {
  if (!items.length) return null;
  const unique = (key: KeyOf) => new Set(items.map(key)).size === items.length;
  if (items.every((i) => typeof i === 'string')) return unique((i) => i as string) ? (i) => i as string : null;
  if (!items.every(isObject)) return null;
  const objects = items as Record<string, unknown>[];
  if (objects.every((o) => typeof o.id === 'string')) return (i) => (i as { id: string }).id;
  // Within one version names are unique (states, forms, variables, kinds…).
  if (objects.every((o) => typeof o.name === 'string')) return (i) => (i as { name: string }).name;
  // A block stack: known by its first block.
  const first = (o: Record<string, unknown>) => (Array.isArray(o.blocks) && isObject(o.blocks[0]) && typeof o.blocks[0].id === 'string' ? o.blocks[0].id : null);
  if (objects.every((o) => first(o) !== null)) return (i) => first(i as Record<string, unknown>)!;
  return null;
}

function mergeArray(b: unknown[], m: unknown[], t: unknown[], at: At, ctx: Ctx): unknown[] {
  const key = keyFor([...b, ...m, ...t]);
  // Every version must have unique keys, or matching by key would lose items.
  if (!key || ![b, m, t].every((list) => new Set(list.map(key)).size === list.length)) return conflict(b, m, t, at, ctx) as unknown[];

  const bm = new Map(b.map((i) => [key(i), i]));
  const mm = new Map(m.map((i) => [key(i), i]));
  const tm = new Map(t.map((i) => [key(i), i]));
  const merged = new Map<string, unknown>();
  for (const k of new Set([...tm.keys(), ...mm.keys(), ...bm.keys()])) {
    const item = tm.get(k) ?? mm.get(k) ?? bm.get(k);
    const name = isObject(item) && typeof item.name === 'string' ? item.name : typeof item === 'string' ? item : k;
    const v = mergeValue(bm.get(k), mm.get(k), tm.get(k), { path: `${at.path}[${k}]`, label: [...at.label.slice(0, -1), name] }, ctx);
    if (v !== MISSING) merged.set(k, v);
  }
  return mergeOrder(b.map(key), m.map(key), t.map(key), merged);
}

/** Their order (or mine, if only I reordered), with items only I added placed after their neighbour in my list. */
function mergeOrder(b: string[], m: string[], t: string[], items: Map<string, unknown>): unknown[] {
  const [lead, other] = same(t, b) ? [m, t] : [t, m];
  const order = lead.filter((k) => items.has(k));
  for (let i = 0; i < other.length; i++) {
    const k = other[i];
    if (!items.has(k) || order.includes(k)) continue;
    const before = other.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, k);
  }
  for (const k of items.keys()) if (!order.includes(k)) order.push(k);
  return order.map((k) => items.get(k));
}
