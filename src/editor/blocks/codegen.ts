import type { ActorScene, BlockArg, BlockNode, BlockProgram, PropValue } from '../../engine/types';
import { uid } from '../../engine/util';
import { blockDef, type BlockDef, type Gen, type SlotSpec, type Trigger } from './catalog';

/*
 * Blocks → TypeScript. Each hat's stack becomes a generator function (a "thread");
 * a small runtime appended to the module starts threads from init / update / onHit
 * and resumes each one once per frame, so `wait` and loops behave like Scratch.
 * The output is an ordinary actor script: the engine doesn't know about blocks.
 */

export interface CodegenOptions {
  /** Unique per actor scene, so a form's threads don't mix with its container's. */
  key: string;
  /** Shown in the header comment. */
  name?: string;
}

export const isNode = (a: BlockArg | undefined): a is BlockNode => typeof a === 'object' && a !== null;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const key = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));
const lit = (v: PropValue) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const indent = (code: string) =>
  code
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => `  ${l}`)
    .join('\n');

/** Per-script state while generating: unique locals and the "each actor" loop variable. */
class Scope {
  private n = 0;
  eachActor = 'null';

  local(base: string): string {
    return `${base}${++this.n}`;
  }
}

/** Is the expression safe to use without parentheses (name, literal, call, member chain)? */
export function atomic(code: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && !/[\w$.?]/.test(c)) return false;
  }
  return code !== '';
}

const wrap = (code: string) => (atomic(code) ? code : `(${code})`);

function slotLiteral(node: BlockNode, name: string, spec: SlotSpec): string {
  const v = node.args[name];
  if (v === undefined || isNode(v)) return String(spec.value ?? '');
  return String(v);
}

function slotCode(node: BlockNode, name: string, spec: SlotSpec, scope: Scope): string {
  const v = node.args[name];
  if (isNode(v)) {
    const code = expr(v, scope);
    return spec.kind === 'num' && blockDef(v.op)?.output !== 'num' ? `Number(${code})` : wrap(code);
  }
  const raw = slotLiteral(node, name, spec);
  switch (spec.kind) {
    case 'num': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return '0';
      return n < 0 ? `(${n})` : String(n);
    }
    case 'bool':
      return 'false';
    case 'actor':
      return 'null';
    default:
      return JSON.stringify(raw);
  }
}

function gen(node: BlockNode, def: BlockDef, scope: Scope): Gen {
  const spec = (name: string): SlotSpec => def.slots?.[name] ?? { kind: 'text' };
  return {
    arg: (name) => slotCode(node, name, spec(name), scope),
    bare: (name) => {
      const v = node.args[name];
      return isNode(v) && spec(name).kind !== 'num' ? expr(v, scope) : slotCode(node, name, spec(name), scope);
    },
    literal: (name) => slotLiteral(node, name, spec(name)),
    mouth: (name) => indent(stackCode(node.stacks?.[name] ?? [], scope)),
    local: (base) => scope.local(base),
    get eachActor() {
      return scope.eachActor;
    },
    withEachActor(name, fn) {
      const outer = scope.eachActor;
      scope.eachActor = name;
      try {
        return fn();
      } finally {
        scope.eachActor = outer;
      }
    },
  };
}

function expr(node: BlockNode, scope: Scope): string {
  const def = blockDef(node.op);
  if (!def?.gen) return 'undefined';
  return def.gen(gen(node, def, scope));
}

function stackCode(blocks: readonly BlockNode[], scope: Scope): string {
  const out: string[] = [];
  for (const node of blocks) {
    const def = blockDef(node.op);
    if (!def) out.push(`// unknown block '${node.op}'`);
    else if (def.gen && (def.shape === 'stack' || def.shape === 'c' || def.shape === 'cap')) out.push(def.gen(gen(node, def, scope)));
  }
  return out.join('\n');
}

const HAT_COMMENT: Record<Trigger['kind'], (t: Trigger) => string> = {
  start: () => 'when I start',
  key: (t) => `when ${(t as { key: string }).key} is pressed`,
  when: () => 'when the condition becomes true',
  hit: () => 'when I get hit',
  timer: (t) => {
    const m = t as { every: string; from: string; to: string };
    return `every ${m.every} s while ${m.from} ≤ game time < ${m.to}`;
  },
  click: () => 'when the mouse is clicked',
  status: (t) => {
    const s = t as { status: string; added: boolean };
    return s.added ? `when I start ${s.status}` : `when I stop ${s.status}`;
  },
};

/** Helpers the generated code may call; only those used are emitted. */
const HELPERS: Record<string, string> = {
  others: `/** Living actors other than self having any of the comma-separated tags (all when empty). */
function others(self: Actor, world: World, tags: string): Actor[] {
  const list = tags.split(',').map((s) => s.trim()).filter(Boolean);
  return world.all().filter((a) => a !== self && a.alive && (!list.length || list.some((tag) => a.is(tag))));
}`,
  touching: `function touching(self: Actor, world: World, a: Actor | null): boolean {
  return !!a && a !== self && world.overlaps(self, a);
}`,
  distanceTo: `function distanceTo(self: Actor, world: World, a: Actor | null): number {
  return a ? world.distance(self, a) : Infinity;
}`,
  headToward: `function headToward(self: Actor, world: World, a: Actor | null, speed: number) {
  if (!a) return;
  const dx = a.x - self.x, dy = a.y - self.y;
  if (world.view === 'side') {
    self.vx = Math.abs(dx) > 2 ? Math.sign(dx) * speed : 0;
    if (dx) self.facing = Math.sign(dx);
    return;
  }
  const len = Math.hypot(dx, dy);
  self.vx = len > 2 ? (dx / len) * speed : 0;
  self.vy = len > 2 ? (dy / len) * speed : 0;
}`,
  compare: `/** Numbers compare as numbers, anything else as case-insensitive text (like Scratch). */
function compare(a: unknown, b: unknown): number {
  const x = Number(a), y = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  const s = String(a).toLowerCase(), u = String(b).toLowerCase();
  return s < u ? -1 : s > u ? 1 : 0;
}`,
  random: `/** Whole numbers when both ends are whole (like Scratch). */
function random(a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (Number.isInteger(a) && Number.isInteger(b)) return lo + Math.floor(Math.random() * (hi - lo + 1));
  return lo + Math.random() * (hi - lo);
}`,
  mod: `function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}`,
  nearestWithin: `/** The closest living actor (not self) having any of the tags, within r px; null if none. */
function nearestWithin(self: Actor, world: World, tags: string, r: number): Actor | null {
  let best: Actor | null = null, bestD = r;
  for (const a of others(self, world, tags)) {
    const d = world.distance(self, a);
    if (d <= bestD) { best = a; bestD = d; }
  }
  return best;
}`,
  nearMouse: `function nearMouse(self: Actor, world: World, tags: string, r: number): boolean {
  const m = world.input.mouse;
  return others(self, world, tags).some((a) => Math.hypot(a.x - m.x, a.y - m.y) < r);
}`,
  spawnAt: `/** Spawns here, at the mouse, or in the middle of the grid cell under the mouse. */
function spawnAt(self: Actor, world: World, scene: string, where: string): Actor | null {
  const m = world.input.mouse, g = world.gridSize || 1;
  if (where === 'mouse') return world.spawn(scene, m.x, m.y);
  if (where === 'grid') return world.spawn(scene, (Math.floor(m.x / g) + 0.5) * g, (Math.floor(m.y / g) + 0.5) * g);
  return world.spawn(scene, self.x, self.y);
}`,
  popUp: `function popUp(self: Actor, world: World, text: string, where: string, color: string) {
  const m = world.input.mouse;
  if (where === 'mouse') world.popText(text, m.x, m.y - 12, color);
  else world.popText(text, self.x, self.y - 14, color);
}`,
  moveWithKeys: `function moveWithKeys(self: Actor, world: World, speed: number) {
  const s = world.input.stick;
  self.vx = s.x * speed;
  if (world.view !== 'side') self.vy = s.y * speed;
  if (s.x) self.facing = Math.sign(s.x);
  self.moveAndSlide();
}`,
  stayInZone: `/** Back to the last place inside the zone when outside it. */
function stayInZone(self: Actor, world: World, zone: string) {
  const key = '__inside:' + zone;
  if (world.inZone(self.x, self.y, zone)) self.data[key] = { x: self.x, y: self.y };
  else {
    const p = self.data[key] as { x: number; y: number } | undefined;
    if (p) { self.x = p.x; self.y = p.y; }
  }
}`,
};

/** Hooks added when a block that needs them is used. */
const RANGE_DRAW = `
// "show range circle": drawn under the actor.
export function drawUnder(self: Actor, world: World, g: Graphics) {
  const r = Number(self.data.__range) || 0;
  if (r > 0) g.circle(0, 0, r, { fill: g.rgba(self.color, 0.08), stroke: g.rgba(self.color, 0.45), width: 1.5 });
}`;

const RUNTIME = `// ---------------------------------------------------------------------------
// Block runtime: every "when …" script is a thread, resumed once per frame.
// ---------------------------------------------------------------------------

type Thread = { run: Generator<void, void, void>; script: Script; hit: Hit | null; ignore: boolean; done: boolean };
type Script = (self: Actor, world: World, t: Thread) => Generator<void, void, void>;
type Hats = { threads: Thread[]; was: boolean[]; timers: number[] };

/** Length of the current frame (seconds). */
let DT = 1 / 60;
const NO_THREAD = { hit: null, ignore: false } as unknown as Thread;

function hats(self: Actor): Hats {
  return (self.data[KEY] ??= { threads: [], was: [], timers: [] }) as Hats;
}

/** Starts a script and runs it up to its first wait (or its end). */
function start(self: Actor, world: World, script: Script, hit: Hit | null = null): Thread {
  const t = { script, hit, ignore: false, done: false } as Thread;
  t.run = script(self, world, t);
  hats(self).threads.push(t);
  resume(t);
  return t;
}

function resume(t: Thread) {
  if (!t.done && t.run.next().done) t.done = true;
}

function stepThreads(self: Actor) {
  const h = hats(self);
  for (const t of h.threads.slice()) resume(t);
  h.threads = h.threads.filter((t) => !t.done);
}

function running(self: Actor, script: Script): boolean {
  return hats(self).threads.some((t) => t.script === script && !t.done);
}

function stopAll(self: Actor) {
  for (const t of hats(self).threads) t.done = true;
}

function* wait(world: World, seconds: number) {
  const end = world.time + seconds;
  while (world.time < end) yield;
}`;

/** Compiles a block program into an actor script module (TypeScript source). */
export function generateScript(prog: BlockProgram, opts: CodegenOptions): string {
  const out: string[] = [
    `// Generated from blocks${opts.name ? ` (${opts.name})` : ''}. Edit the blocks, or use "Convert to code"`,
    '// to keep working on this as TypeScript.',
    '',
  ];

  const props = prog.vars.filter((v) => v.prop);
  const vars = prog.vars.filter((v) => !v.prop);
  out.push(props.length ? `export const props = {\n${props.map((v) => `  ${key(v.name)}: ${lit(v.value)},`).join('\n')}\n};` : 'export const props = {};');
  out.push('', `const KEY = ${JSON.stringify(`__blocks:${opts.key}`)};`);

  const starts: string[] = [];
  const keys: Array<[string, string]> = [];
  const whens: Array<[string, string]> = [];
  const hits: string[] = [];
  const statuses: Array<[string, boolean, string]> = [];
  const timers: Array<[Extract<Trigger, { kind: 'timer' }>, string]> = [];
  const clicks: string[] = [];

  let n = 0;
  for (const stack of prog.stacks) {
    const [hat, ...body] = stack.blocks;
    const def = hat && blockDef(hat.op);
    if (!def || def.shape !== 'hat' || !def.trigger) continue;
    const name = `script${++n}`;
    const scope = new Scope();
    const trigger = def.trigger(gen(hat, def, scope));
    out.push('', `// ${HAT_COMMENT[trigger.kind](trigger)}`, `function* ${name}(self: Actor, world: World, t: Thread) {`);
    const code = indent(stackCode(body, scope));
    if (code) out.push(code);
    out.push('}');
    if (trigger.kind === 'start') starts.push(name);
    else if (trigger.kind === 'key') keys.push([trigger.key, name]);
    else if (trigger.kind === 'when') whens.push([trigger.cond, name]);
    else if (trigger.kind === 'status') statuses.push([trigger.status, trigger.added, name]);
    else if (trigger.kind === 'timer') timers.push([trigger, name]);
    else if (trigger.kind === 'click') clicks.push(name);
    else hits.push(name);
  }

  // init: variables, then the "when I start" scripts. Game variables keep the value they
  // already have (another actor, or an earlier spawn, may have set them).
  out.push('', 'export function init(self: Actor, world: World) {');
  for (const v of vars) {
    const k = JSON.stringify(v.name);
    if (!v.global) out.push(`  self.data[${k}] = ${lit(v.value)};`);
    else {
      out.push(`  world.vars[${k}] ??= ${lit(v.value)};`);
      if (v.show) out.push(`  world.hud.watch(${k});`);
    }
  }
  out.push(`  self.data[KEY] = { threads: [], was: [${whens.map(() => 'false').join(', ')}], timers: [] };`);
  for (const s of starts) out.push(`  start(self, world, ${s});`);
  out.push('}');

  // update: resume running threads, then start triggered ones (they run their first step now).
  out.push('', 'export function update(self: Actor, world: World, dt: number) {', '  DT = dt;', '  stepThreads(self);');
  for (const [k, s] of keys) out.push(`  if (world.input.pressed(${JSON.stringify(k)}) && !running(self, ${s})) start(self, world, ${s});`);
  for (const s of clicks) out.push(`  if (world.input.clicked && !running(self, ${s})) start(self, world, ${s});`);
  if (timers.length) {
    // Each timer remembers when it fires next; one that starts late (a spawned actor) fires now, then keeps the rhythm.
    out.push('  const tm = hats(self).timers;');
    timers.forEach(([t, s], i) => {
      out.push(
        `  {`,
        `    const from = ${t.from}, to = ${t.to}, every = Math.max(0.05, Number(${t.every}) || 0);`,
        `    tm[${i}] ??= from;`,
        `    if (world.time >= tm[${i}] && world.time < to) {`,
        `      tm[${i}] += every;`,
        `      if (tm[${i}] <= world.time) tm[${i}] = world.time + every;`,
        `      start(self, world, ${s});`,
        `    }`,
        `  }`,
      );
    });
  }
  if (whens.length) {
    out.push('  const was = hats(self).was;', '  const t = NO_THREAD;');
    whens.forEach(([cond, s], i) => {
      out.push(`  const now${i} = !!(${cond});`, `  if (now${i} && !was[${i}]) start(self, world, ${s});`, `  was[${i}] = now${i};`);
    });
  }
  out.push('}');

  // onHit only exists with a "when I get hit" script: without one, projectiles ignore the actor.
  if (hits.length) {
    out.push('', 'export function onHit(self: Actor, world: World, hit: Hit) {', '  let ignored = false;');
    for (const s of hits) out.push(`  if (start(self, world, ${s}, hit).ignore) ignored = true;`);
    out.push('  if (ignored) return false;', '}');
  }

  if (statuses.length) {
    out.push('', 'export function onStatus(self: Actor, world: World, status: string, added: boolean) {');
    for (const [st, added, s] of statuses) out.push(`  if (status === ${JSON.stringify(st)} && ${added ? 'added' : '!added'}) start(self, world, ${s});`);
    out.push('}');
  }

  if (out.some((l) => l.includes('self.data.__range'))) out.push(RANGE_DRAW);

  const body = out.join('\n');
  // Helpers used by the code, and the helpers those use.
  const uses = (code: string, name: string) => new RegExp(`\\b${name}\\(`).test(code);
  const used = new Set(Object.keys(HELPERS).filter((name) => uses(body, name)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const name of Object.keys(HELPERS)) {
      if (!used.has(name) && [...used].some((u) => uses(HELPERS[u], name))) {
        used.add(name);
        grew = true;
      }
    }
  }
  const helpers = Object.entries(HELPERS).filter(([name]) => used.has(name));
  return [body, '', RUNTIME, ...helpers.map(([, code]) => `\n${code}`), ''].join('\n');
}

/** A fresh, empty program: one "when game starts" hat to build on. */
export function emptyProgram(): BlockProgram {
  return { vars: [], stacks: [{ x: 40, y: 40, blocks: [{ id: uid('blk_'), op: 'events.start', args: {} }] }] };
}

/** Makes the scene a block actor with this program; its script is generated from the blocks. */
export function setBlocks(scene: ActorScene, prog: BlockProgram = emptyProgram()): ActorScene {
  scene.actor.blocks = prog;
  scene.actor.script = generateScript(prog, { key: scene.id });
  return scene;
}
