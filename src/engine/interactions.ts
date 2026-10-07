import { type Collider, collide, shapeCollider } from './collision';
import type { Hit } from './scripting';
import type { BlockEntity, Emission, Interactions, KindDef, PropModifier, Reaction, ShapeDef, StatusDef } from './types';

/*
 * The interaction ("chemistry") system: kinds say what things are, elements are what
 * they give off, statuses are timed conditions and reactions are the rules between
 * them. Everything here is driven by the project's Interactions data; actors take
 * part through their kinds and react in scripts via onStatus / onHit (hit.element).
 */

/** Emissions count when the source is at most this far away, so resting side by side is touching. */
export const TOUCH = 4;

/** Physical properties an actor gets from its kinds. */
export interface KindProps {
  solid: boolean;
  pushable: boolean;
  weight: number;
  strength: number;
  emits: readonly Emission[];
}

const NO_PROPS: KindProps = { solid: false, pushable: false, weight: 0, strength: 0, emits: [] };

export const EMPTY_INTERACTIONS: Interactions = { elements: [], kinds: [], statuses: [], reactions: [] };

/** Indexed, read-only view of a project's Interactions. */
export class InteractionRules {
  readonly kinds: ReadonlyMap<string, KindDef>;
  readonly statuses: ReadonlyMap<string, StatusDef>;
  readonly reactions: readonly Reaction[];

  constructor(data: Interactions = EMPTY_INTERACTIONS) {
    this.kinds = new Map(data.kinds.map((k) => [k.name, k]));
    this.statuses = new Map(data.statuses.map((s) => [s.name, s]));
    this.reactions = data.reactions;
  }

  /** Solid / pushable if any kind is; the largest weight and strength; all emissions. */
  kindProps(kinds: readonly string[]): KindProps {
    const defs = kinds.map((k) => this.kinds.get(k)).filter((k): k is KindDef => !!k);
    if (!defs.length) return NO_PROPS;
    return {
      solid: defs.some((k) => k.solid),
      pushable: defs.some((k) => k.pushable),
      weight: Math.max(...defs.map((k) => k.weight)),
      strength: Math.max(...defs.map((k) => k.strength)),
      emits: defs.flatMap((k) => k.emits),
    };
  }

  modifiers(statuses: Iterable<string>): PropModifier[] {
    return [...statuses].flatMap((s) => this.statuses.get(s)?.modifiers ?? []);
  }
}

/** A shape grown by `m` on every side (reach of an emission). */
export function inflate(shape: ShapeDef, m: number): ShapeDef {
  if (m === 0) return shape;
  if (shape.kind === 'rect') return { kind: 'rect', w: shape.w + 2 * m, h: shape.h + 2 * m };
  if (shape.kind === 'circle') return { kind: 'circle', r: shape.r + m };
  return { ...shape, thickness: shape.thickness + 2 * m };
}

/** Runtime status of one actor. */
export interface ActiveStatus {
  left: number;
  /** Time towards the next damage tick. */
  tick: number;
}

/** What the chemistry needs from an actor (RtActor implements it). */
export interface ChemActor {
  readonly x: number;
  readonly y: number;
  readonly destroyed: boolean;
  readonly kinds: readonly string[];
  readonly phys: KindProps;
  readonly activeStatuses: Map<string, ActiveStatus>;
  refreshProps(): void;
  /** Collider grown by `m` (reach). */
  reach(m: number): Collider;
}

export interface ChemistryHost<A extends ChemActor> {
  readonly actors: readonly A[];
  hitActor(a: A, hit: Hit): boolean;
  burst(x: number, y: number, color: string, count?: number): void;
  /** Runs the actor's onStatus hooks. */
  statusChanged(a: A, status: string, added: boolean): void;
}

interface Source {
  col: Collider;
  element: string;
  /** The actor giving it off (null for zones), which never reaches itself. */
  owner: unknown;
}

/** Applies statuses, emissions and reactions every step. */
export class Chemistry<A extends ChemActor> {
  private readonly zones: Source[] = [];

  constructor(
    readonly rules: InteractionRules,
    blocks: readonly BlockEntity[],
    private readonly host: ChemistryHost<A>,
  ) {
    for (const b of blocks) {
      for (const e of rules.kindProps(b.kinds ?? []).emits) {
        this.zones.push({ col: shapeCollider(inflate(b.shape, e.radius + TOUCH), b.x, b.y, b.rotation), element: e.element, owner: null });
      }
    }
  }

  addStatus(a: A, name: string, seconds?: number): boolean {
    const def = this.rules.statuses.get(name);
    if (!def) return false;
    const dur = seconds !== undefined && seconds > 0 ? seconds : def.duration;
    const cur = a.activeStatuses.get(name);
    if (cur) {
      cur.left = Math.max(cur.left, dur);
      return true;
    }
    a.activeStatuses.set(name, { left: dur, tick: 0 });
    a.refreshProps();
    this.host.statusChanged(a, name, true);
    return true;
  }

  removeStatus(a: A, name: string): void {
    if (!a.activeStatuses.delete(name)) return;
    a.refreshProps();
    this.host.statusChanged(a, name, false);
  }

  step(h: number): void {
    const actors = this.host.actors.filter((a) => !a.destroyed);
    for (const a of actors) this.tickStatuses(a, h);

    // Everything reaching every actor is collected first, so fire spreads one step at a time.
    const sources = [...this.zones];
    for (const a of actors) {
      const emits = [...a.phys.emits, ...[...a.activeStatuses.keys()].flatMap((s) => this.rules.statuses.get(s)?.emits ?? [])];
      for (const e of emits) sources.push({ col: a.reach(e.radius + TOUCH), element: e.element, owner: a });
    }
    if (!sources.length) return;
    const reached = actors.map((a) => {
      const col = a.reach(0);
      const els = new Set<string>();
      for (const s of sources) if (s.owner !== a && !els.has(s.element) && collide(s.col, col)) els.add(s.element);
      return els;
    });
    actors.forEach((a, i) => {
      for (const el of reached[i]) this.react(a, el);
    });
  }

  /** An element given off once, e.g. an explosion (world.emit). */
  emit(element: string, x: number, y: number, radius: number): void {
    const col: Collider = { type: 'circle', c: { x, y }, r: Math.max(0, radius) };
    for (const a of this.host.actors.filter((a) => !a.destroyed && collide(col, a.reach(0)))) this.react(a, element);
  }

  /** Runs the reactions to `element` reaching `a`, in order, until one says stop. */
  react(a: A, element: string): void {
    for (const r of this.rules.reactions) {
      if (r.element !== element || !this.matches(a, r.target)) continue;
      let changed = false;
      if (r.remove && a.activeStatuses.has(r.remove)) {
        this.removeStatus(a, r.remove);
        changed = true;
      }
      if (r.add && !a.activeStatuses.has(r.add)) changed = this.addStatus(a, r.add);
      else if (r.add) this.addStatus(a, r.add); // renew
      // Particles only when something changed, not every step spent in a zone.
      if (r.burst && changed) this.host.burst(a.x, a.y, r.burst, 12);
      if (r.stop) break;
    }
  }

  private matches(a: A, target: string): boolean {
    return target === 'any' || a.kinds.includes(target) || a.activeStatuses.has(target);
  }

  private tickStatuses(a: A, h: number): void {
    for (const [name, st] of [...a.activeStatuses]) {
      const def = this.rules.statuses.get(name);
      st.left -= h;
      if (def && def.damage > 0 && def.interval > 0) {
        st.tick += h;
        while (st.tick >= def.interval && !a.destroyed) {
          st.tick -= def.interval;
          this.host.hitActor(a, { damage: def.damage, from: null, x: a.x, y: a.y, element: def.element || undefined });
        }
      }
      // A few particles in the status colour while it lasts.
      if (def && Math.random() < h * 6) this.host.burst(a.x, a.y, def.color, 1);
      if (st.left <= 0) this.removeStatus(a, name);
    }
  }
}

// ---------------------------------------------------------------------------
// Default library: fire, water, cold and heat.
// ---------------------------------------------------------------------------

const kind = (name: string, color: string, p: Partial<KindDef> = {}): KindDef => ({
  name,
  color,
  solid: false,
  pushable: false,
  weight: 0,
  strength: 0,
  emits: [],
  ...p,
});

const status = (name: string, color: string, duration: number, p: Partial<StatusDef> = {}): StatusDef => ({
  name,
  color,
  duration,
  damage: 0,
  interval: 1,
  element: '',
  emits: [],
  modifiers: [],
  ...p,
});

const rule = (element: string, target: string, p: Partial<Reaction>): Reaction => ({ element, target, add: '', remove: '', burst: '', stop: false, ...p });

const STEAM = '#d7e0ea';

/** A starting library every new project gets; edit it in the Interactions panel. */
export function createDefaultInteractions(): Interactions {
  return {
    elements: ['fire', 'water', 'cold', 'heat'],
    kinds: [
      kind('creature', '#e0a36b', { strength: 2 }),
      kind('wood', '#a0703c'),
      kind('crate', '#c08a4a', { solid: true, pushable: true, weight: 1 }),
      kind('boulder', '#8a8f99', { solid: true, pushable: true, weight: 2 }),
      kind('stone', '#6b717c', { solid: true }),
      kind('fire', '#ff7a2e', { emits: [{ element: 'fire', radius: 0 }] }),
      kind('water', '#3d8bff', { emits: [{ element: 'water', radius: 0 }] }),
      kind('snow', '#cfe8ff', { emits: [{ element: 'cold', radius: 0 }] }),
      kind('hot', '#e0b040', { emits: [{ element: 'heat', radius: 0 }] }),
    ],
    statuses: [
      status('burning', '#ff7a2e', 4, { damage: 1, interval: 1, element: 'fire', emits: [{ element: 'fire', radius: 0 }] }),
      status('wet', '#4da3ff', 5),
      status('chilled', '#9fd8ff', 3, { modifiers: [{ prop: 'speed', factor: 0.5 }] }),
      status('exhausted', '#d9a441', 4, { modifiers: [{ prop: 'speed', factor: 0.7 }, { prop: 'jumpSpeed', factor: 0.8 }] }),
    ],
    reactions: [
      rule('fire', 'wet', { stop: true }), // wet things don't catch fire
      rule('fire', 'creature', { add: 'burning', burst: '#ff7a2e' }),
      rule('fire', 'wood', { add: 'burning', burst: '#ff7a2e' }),
      rule('water', 'burning', { remove: 'burning', burst: STEAM }),
      rule('water', 'any', { add: 'wet' }),
      rule('cold', 'burning', { remove: 'burning', burst: STEAM }),
      rule('cold', 'any', { add: 'chilled' }),
      rule('heat', 'wet', { remove: 'wet', burst: STEAM }),
      rule('heat', 'any', { add: 'exhausted' }),
    ],
  };
}
