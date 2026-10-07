/*
 * Every block the editor offers: its look (shape, category, text with {slots}),
 * its slots, and the TypeScript it compiles to. Adding a block = adding an entry.
 */

export type Shape =
  /** Starts a script ("when … "). */
  | 'hat'
  /** A statement; snaps above and below. */
  | 'stack'
  /** Wraps statements in one or more mouths (if / repeat / forever). */
  | 'c'
  /** A statement nothing can follow (stop). */
  | 'cap'
  /** A rounded value. */
  | 'reporter'
  /** A hexagonal true / false. */
  | 'boolean';

/** What a reporter produces; slots only accept compatible reporters. */
export type ValueType = 'num' | 'text' | 'bool' | 'actor';

/** Dropdown contents: fixed, or taken from the actor / project being edited. */
export type MenuSource =
  | 'key'
  | 'state'
  | 'form'
  | 'projectile'
  | 'var'
  | 'prop'
  | 'global'
  | 'status'
  | 'element'
  | 'kind'
  /** Actor scenes of the project (spawn). */
  | 'scene'
  /** Paths / zones drawn in the project's levels. */
  | 'path'
  | 'zone'
  | ReadonlyArray<readonly [value: string, label: string]>;

export interface SlotSpec {
  kind: 'num' | 'text' | 'color' | 'bool' | 'actor' | 'menu';
  /** Initial literal. */
  value?: string | number;
  menu?: MenuSource;
}

export type CategoryId = 'events' | 'motion' | 'looks' | 'actions' | 'game' | 'interact' | 'control' | 'sensing' | 'operators' | 'variables';

export const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string; color: string }> = [
  { id: 'events', label: 'Events', color: '#ffbf00' },
  { id: 'motion', label: 'Motion', color: '#4c97ff' },
  { id: 'looks', label: 'Looks', color: '#9966ff' },
  { id: 'actions', label: 'Actions', color: '#e6567a' },
  { id: 'game', label: 'Game', color: '#0fbd8c' },
  { id: 'interact', label: 'Interact', color: '#e0773a' },
  { id: 'control', label: 'Control', color: '#ffab19' },
  { id: 'sensing', label: 'Sensing', color: '#5cb1d6' },
  { id: 'operators', label: 'Operators', color: '#59c059' },
  { id: 'variables', label: 'Variables', color: '#ff8c1a' },
];

/** When a hat's script starts. */
export type Trigger =
  | { kind: 'start' }
  | { kind: 'key'; key: string }
  | { kind: 'when'; cond: string }
  | { kind: 'hit' }
  /** Every `every` seconds while from ≤ game time < to (code expressions). */
  | { kind: 'timer'; every: string; from: string; to: string }
  | { kind: 'click' }
  | { kind: 'status'; status: string; added: boolean };

/** What a block's code generator can ask for. */
export interface Gen {
  /** Code of a slot: the literal, or the plugged reporter's expression. */
  arg(name: string): string;
  /** Like arg(), without protective parentheses (for code already inside parentheses). */
  bare(name: string): string;
  /** Raw literal of a slot (for menus that must be known at compile time). */
  literal(name: string): string;
  /** Code of a mouth, already indented one level. */
  mouth(name: string): string;
  /** A fresh local variable name. */
  local(base: string): string;
  /** Variable of the innermost "for each actor" loop around this block ('null' outside one). */
  readonly eachActor: string;
  /** Runs `fn` with `name` as the "each actor" variable of the code it generates. */
  withEachActor<T>(name: string, fn: () => T): T;
}

export interface BlockDef {
  op: string;
  category: CategoryId;
  shape: Shape;
  /** Block text with {slot} placeholders. C-blocks: one line per mouth ('if {c} then', 'else'). */
  text: string | readonly string[];
  slots?: Record<string, SlotSpec>;
  /** C-blocks: mouth names, one per text line. */
  mouths?: readonly string[];
  /** Reporters: the value type. */
  output?: ValueType;
  /** Statement / expression code. */
  gen?: (g: Gen) => string;
  /** Hats: what starts them. */
  trigger?: (g: Gen) => Trigger;
  /** Shown as a tooltip. */
  hint?: string;
  /** Belongs to an optional editor module: hidden from the palette while it is off. */
  module?: 'interactions';
}

const num = (value = 0): SlotSpec => ({ kind: 'num', value });
const text = (value = ''): SlotSpec => ({ kind: 'text', value });
const color = (value = '#ff5a4d'): SlotSpec => ({ kind: 'color', value });
const bool: SlotSpec = { kind: 'bool' };
const actor: SlotSpec = { kind: 'actor' };
const menu = (m: MenuSource, value = ''): SlotSpec => ({ kind: 'menu', menu: m, value });

/** `obj.name` when `key` is a string literal naming an identifier, else `obj[key]`. */
const member = (obj: string, key: string, optional = false) => {
  const m = /^"([A-Za-z_$][\w$]*)"$/.exec(key);
  return m ? `${obj}${optional ? '?.' : '.'}${m[1]}` : `${obj}${optional ? '?.' : ''}[${key}]`;
};

/** Text of a value; string literals are used as they are. */
const str = (code: string) => (/^"(?:[^"\\]|\\.)*"$/.test(code) ? code : `String(${code})`);

/** Loops yield once per pass, so a forever loop runs one pass per frame (like Scratch). */
const loop = (head: string, body: string) => `${head} {\n${body}\n  yield;\n}`;

const PROPS_OF: ReadonlyArray<readonly [string, string]> = [
  ['x', 'x'],
  ['y', 'y'],
  ['vx', 'velocity x'],
  ['vy', 'velocity y'],
  ['health', 'health'],
  ['facing', 'facing'],
  ['name', 'name'],
  ['state', 'state'],
  ['form', 'form'],
  ['color', 'color'],
];

const DIRECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['1,0', 'right'],
  ['-1,0', 'left'],
  ['0,-1', 'up'],
  ['0,1', 'down'],
];

const SPAWN_WHERE: ReadonlyArray<readonly [string, string]> = [
  ['here', 'here'],
  ['mouse', 'at the mouse'],
  ['grid', 'at the mouse, on the grid'],
];

const POP_WHERE: ReadonlyArray<readonly [string, string]> = [
  ['here', 'here'],
  ['mouse', 'at the mouse'],
];

const MATH: ReadonlyArray<readonly [string, string]> = [
  ['abs', 'abs'],
  ['round', 'round'],
  ['floor', 'floor'],
  ['ceil', 'ceiling'],
  ['sqrt', 'sqrt'],
  ['sign', 'sign'],
  ['sin', 'sin'],
  ['cos', 'cos'],
];

const DEFS: BlockDef[] = [
  // Events ------------------------------------------------------------------
  { op: 'events.start', category: 'events', shape: 'hat', text: 'when I start', trigger: () => ({ kind: 'start' }), hint: 'Runs when the level starts, or when I am spawned (for a form: every time the form becomes active).' },
  {
    op: 'events.timer', category: 'events', shape: 'hat', text: 'every {n} seconds, from second {a} to {b}', slots: { n: num(2), a: num(0), b: num(60) },
    trigger: (g) => ({ kind: 'timer', every: g.arg('n'), from: g.arg('a'), to: g.arg('b') }),
    hint: 'A timer: while the game time is between the two seconds, runs the blocks below every few seconds (the first time right at the start). Stack several for waves that get harder.',
  },
  { op: 'events.at', category: 'events', shape: 'hat', text: 'when game time reaches {t} seconds', slots: { t: num(180) }, trigger: (g) => ({ kind: 'when', cond: `world.time >= ${g.arg('t')}` }), hint: 'Once, when the game has been running that long.' },
  { op: 'events.click', category: 'events', shape: 'hat', text: 'when the mouse is clicked', trigger: () => ({ kind: 'click' }), hint: 'A click (or a tap) anywhere on the game. Use "mouse x / y" or "mouse in zone" to see where.' },
  { op: 'events.key', category: 'events', shape: 'hat', text: 'when {key} key pressed', slots: { key: menu('key', 'Space') }, trigger: (g) => ({ kind: 'key', key: g.literal('key') }), hint: 'Does not restart while the script is still running.' },
  { op: 'events.when', category: 'events', shape: 'hat', text: 'when {c} becomes true', slots: { c: bool }, trigger: (g) => ({ kind: 'when', cond: g.bare('c') }), hint: 'Checked every frame; starts each time the condition turns from false to true.' },
  { op: 'events.status', category: 'events', shape: 'hat', text: 'when I start {s}', slots: { s: menu('status', 'burning') }, trigger: (g) => ({ kind: 'status', status: g.literal('s'), added: true }), module: 'interactions', hint: 'A status was added (by a reaction, a script or a block).' },
  { op: 'events.statusEnd', category: 'events', shape: 'hat', text: 'when I stop {s}', slots: { s: menu('status', 'burning') }, trigger: (g) => ({ kind: 'status', status: g.literal('s'), added: false }), module: 'interactions', hint: 'A status ran out or was removed.' },
  { op: 'events.hit', category: 'events', shape: 'hat', text: 'when I get hit', trigger: () => ({ kind: 'hit' }), hint: 'By a projectile or damage(). Without this hat, projectiles ignore the actor.' },

  // Motion ------------------------------------------------------------------
  { op: 'motion.move', category: 'motion', shape: 'stack', text: 'move {n} steps', slots: { n: num(10) }, gen: (g) => `self.x += self.facing * ${g.arg('n')};`, hint: 'Teleports along facing (no collisions). For physics use velocity + move & slide.' },
  { op: 'motion.changeX', category: 'motion', shape: 'stack', text: 'change x by {n}', slots: { n: num(10) }, gen: (g) => `self.x += ${g.arg('n')};` },
  { op: 'motion.changeY', category: 'motion', shape: 'stack', text: 'change y by {n}', slots: { n: num(10) }, gen: (g) => `self.y += ${g.arg('n')};` },
  { op: 'motion.goto', category: 'motion', shape: 'stack', text: 'go to x: {x} y: {y}', slots: { x: num(0), y: num(0) }, gen: (g) => `self.x = ${g.arg('x')};\nself.y = ${g.arg('y')};` },
  { op: 'motion.gotoActor', category: 'motion', shape: 'stack', text: 'go to {a}', slots: { a: actor }, gen: (g) => `{ const a = ${g.arg('a')}; if (a) { self.x = a.x; self.y = a.y; } }` },
  { op: 'motion.setVx', category: 'motion', shape: 'stack', text: 'set velocity x to {n}', slots: { n: num(100) }, gen: (g) => `self.vx = ${g.arg('n')};` },
  { op: 'motion.setVy', category: 'motion', shape: 'stack', text: 'set velocity y to {n}', slots: { n: num(0) }, gen: (g) => `self.vy = ${g.arg('n')};` },
  { op: 'motion.changeVx', category: 'motion', shape: 'stack', text: 'change velocity x by {n}', slots: { n: num(10) }, gen: (g) => `self.vx += ${g.arg('n')};` },
  { op: 'motion.changeVy', category: 'motion', shape: 'stack', text: 'change velocity y by {n}', slots: { n: num(10) }, gen: (g) => `self.vy += ${g.arg('n')};` },
  { op: 'motion.toward', category: 'motion', shape: 'stack', text: 'head toward {a} at speed {n}', slots: { a: actor, n: num(100) }, gen: (g) => `headToward(self, world, ${g.arg('a')}, ${g.arg('n')});`, hint: 'Sets the velocity; top-down levels move in both axes, side view only in x.' },
  { op: 'motion.slide', category: 'motion', shape: 'stack', text: 'move & slide', gen: () => 'self.moveAndSlide();', hint: 'Moves by the velocity for one frame, sliding along solid blocks.' },
  { op: 'motion.gravity', category: 'motion', shape: 'stack', text: 'fall with gravity', gen: () => 'if (world.view === \'side\') self.vy = Math.min(self.vy + world.gravity * DT, 1600);', hint: 'Adds one frame of the level gravity to velocity y (side view only).' },
  { op: 'motion.jump', category: 'motion', shape: 'stack', text: 'jump with speed {n}', slots: { n: num(600) }, gen: (g) => `if (self.grounded) self.vy = -(${g.arg('n')});`, hint: 'Only when standing on something.' },
  { op: 'motion.face', category: 'motion', shape: 'stack', text: 'face {dir}', slots: { dir: menu([['1', 'right'], ['-1', 'left']], '1') }, gen: (g) => `self.facing = ${Number(g.literal('dir')) < 0 ? -1 : 1};` },
  { op: 'motion.turn', category: 'motion', shape: 'stack', text: 'turn around', gen: () => 'self.facing = -self.facing;' },
  {
    op: 'motion.followPath', category: 'motion', shape: 'stack', text: 'follow path {p} at speed {n}', slots: { p: menu('path'), n: num(60) },
    gen: (g) => `while (!self.followPath(${g.arg('p')}, ${g.arg('n')})) yield;`,
    hint: 'Goes straight to the start of the path, then along it, and waits until the end. The speed is read every frame (px per second).',
  },
  {
    op: 'motion.arrows', category: 'motion', shape: 'stack', text: 'move with arrow keys at speed {n}', slots: { n: num(150) },
    gen: (g) => `moveWithKeys(self, world, ${g.arg('n')});`,
    hint: 'One frame of walking with the arrow keys / WASD (or the touch joystick), sliding along walls. Put it in a forever loop.',
  },
  { op: 'motion.stayInZone', category: 'motion', shape: 'stack', text: 'stay inside zone {z}', slots: { z: menu('zone') }, gen: (g) => `stayInZone(self, world, ${g.arg('z')});`, hint: 'After moving: if I left the zone, go back to where I was last inside it.' },
  { op: 'motion.x', category: 'motion', shape: 'reporter', output: 'num', text: 'x position', gen: () => 'self.x' },
  { op: 'motion.y', category: 'motion', shape: 'reporter', output: 'num', text: 'y position', gen: () => 'self.y' },
  { op: 'motion.vx', category: 'motion', shape: 'reporter', output: 'num', text: 'velocity x', gen: () => 'self.vx' },
  { op: 'motion.vy', category: 'motion', shape: 'reporter', output: 'num', text: 'velocity y', gen: () => 'self.vy' },
  { op: 'motion.facing', category: 'motion', shape: 'reporter', output: 'num', text: 'facing', gen: () => 'self.facing' },
  { op: 'motion.spawnX', category: 'motion', shape: 'reporter', output: 'num', text: 'spawn x', gen: () => 'self.spawnX' },
  { op: 'motion.spawnY', category: 'motion', shape: 'reporter', output: 'num', text: 'spawn y', gen: () => 'self.spawnY' },
  { op: 'motion.pathDistance', category: 'motion', shape: 'reporter', output: 'num', text: 'distance along path', gen: () => 'self.pathDistance', hint: 'How far I have walked along my path (0 while still going to its start).' },
  { op: 'motion.grounded', category: 'motion', shape: 'boolean', output: 'bool', text: 'on the ground?', gen: () => 'self.grounded' },
  { op: 'motion.wall', category: 'motion', shape: 'boolean', output: 'bool', text: 'against a wall?', gen: () => 'self.hitWall !== 0' },
  { op: 'motion.groundAhead', category: 'motion', shape: 'boolean', output: 'bool', text: 'ground ahead?', gen: () => 'world.groundAhead(self, self.facing)', hint: 'Solid ground just ahead of the feet, in the facing direction (side view).' },

  // Looks -------------------------------------------------------------------
  { op: 'looks.state', category: 'looks', shape: 'stack', text: 'switch to state {s}', slots: { s: menu('state') }, gen: (g) => `self.setState(${g.arg('s')});` },
  { op: 'looks.form', category: 'looks', shape: 'stack', text: 'switch to form {f}', slots: { f: menu('form', 'base') }, gen: (g) => `self.setForm(${g.arg('f')});` },
  { op: 'looks.formFor', category: 'looks', shape: 'stack', text: 'switch to form {f} for {s} seconds', slots: { f: menu('form', 'base'), s: num(5) }, gen: (g) => `self.setForm(${g.arg('f')}, ${g.arg('s')});` },
  { op: 'looks.color', category: 'looks', shape: 'stack', text: 'set color to {c}', slots: { c: color() }, gen: (g) => `self.color = ${str(g.bare('c'))};` },
  { op: 'looks.show', category: 'looks', shape: 'stack', text: 'show', gen: () => 'self.visible = true;' },
  { op: 'looks.hide', category: 'looks', shape: 'stack', text: 'hide', gen: () => 'self.visible = false;' },
  { op: 'looks.flash', category: 'looks', shape: 'stack', text: 'flash for {s} seconds', slots: { s: num(0.4) }, gen: (g) => `self.flash(${g.arg('s')});` },
  { op: 'looks.hud', category: 'looks', shape: 'stack', text: 'show text {t} at x: {x} y: {y}', slots: { t: text('Hello!'), x: num(10), y: num(20) }, gen: (g) => `world.hud.text(${str(g.bare('t'))}, ${g.arg('x')}, ${g.arg('y')});`, hint: 'Screen text for this frame only: repeat it in a forever loop. y < 0 counts from the bottom.' },
  { op: 'looks.range', category: 'looks', shape: 'stack', text: 'show range circle {r}', slots: { r: num(100) }, gen: (g) => `self.data.__range = ${g.arg('r')};`, hint: 'A faint circle around me (how far a tower reaches). 0 hides it.' },
  { op: 'looks.stateName', category: 'looks', shape: 'reporter', output: 'text', text: 'state', gen: () => 'self.state' },
  { op: 'looks.stateTime', category: 'looks', shape: 'reporter', output: 'num', text: 'time in state', gen: () => 'self.stateTime' },
  { op: 'looks.formName', category: 'looks', shape: 'reporter', output: 'text', text: 'form', gen: () => 'self.form' },
  { op: 'looks.colorValue', category: 'looks', shape: 'reporter', output: 'text', text: 'color', gen: () => 'self.color' },

  // Actions -----------------------------------------------------------------
  { op: 'actions.shoot', category: 'actions', shape: 'stack', text: 'shoot {p} forward', slots: { p: menu('projectile') }, gen: (g) => `self.shoot(${g.arg('p')}, self.facing, 0);` },
  { op: 'actions.shootDir', category: 'actions', shape: 'stack', text: 'shoot {p} direction x: {dx} y: {dy}', slots: { p: menu('projectile'), dx: num(1), dy: num(0) }, gen: (g) => `self.shoot(${g.arg('p')}, ${g.arg('dx')}, ${g.arg('dy')});` },
  { op: 'actions.shootAt', category: 'actions', shape: 'stack', text: 'shoot {p} at {a}', slots: { p: menu('projectile'), a: actor }, gen: (g) => `self.shootAt(${g.arg('p')}, ${g.arg('a')});`, hint: 'Aims where the target will be when the projectile arrives. Nothing happens without a target.' },
  { op: 'actions.damage', category: 'actions', shape: 'stack', text: 'damage {a} by {n}', slots: { a: actor, n: num(1) }, gen: (g) => `${g.arg('a')}?.damage(${g.arg('n')}, self);`, hint: 'Goes through the target\'s "when I get hit" / onHit, so immune forms can ignore it.' },
  { op: 'actions.setHealth', category: 'actions', shape: 'stack', text: 'set health to {n}', slots: { n: num(3) }, gen: (g) => `self.health = ${g.arg('n')};` },
  { op: 'actions.changeHealth', category: 'actions', shape: 'stack', text: 'change health by {n}', slots: { n: num(-1) }, gen: (g) => `self.health += ${g.arg('n')};` },
  { op: 'actions.kill', category: 'actions', shape: 'stack', text: 'die', gen: () => 'self.kill();', hint: 'Marks the actor dead; its scripts keep running (to animate, respawn or remove it).' },
  { op: 'actions.revive', category: 'actions', shape: 'stack', text: 'revive', gen: () => 'self.revive();' },
  { op: 'actions.destroy', category: 'actions', shape: 'cap', text: 'remove from level', gen: () => 'self.destroy();\nreturn;' },
  { op: 'actions.burst', category: 'actions', shape: 'stack', text: 'burst {n} particles of color {c}', slots: { n: num(20), c: color('#ffd166') }, gen: (g) => `world.burst(self.x, self.y, ${str(g.bare('c'))}, ${g.arg('n')});` },
  { op: 'actions.follow', category: 'actions', shape: 'stack', text: 'camera follows me', gen: () => 'world.camera.follow(self);' },
  { op: 'actions.log', category: 'actions', shape: 'stack', text: 'log {t}', slots: { t: text('Hello!') }, gen: (g) => `world.log(${g.bare('t')});` },
  { op: 'actions.health', category: 'actions', shape: 'reporter', output: 'num', text: 'health', gen: () => 'self.health' },
  { op: 'actions.alive', category: 'actions', shape: 'boolean', output: 'bool', text: 'alive?', gen: () => 'self.alive' },

  // Game --------------------------------------------------------------------
  {
    op: 'game.spawn', category: 'game', shape: 'stack', text: 'spawn {s} {w}', slots: { s: menu('scene'), w: menu(SPAWN_WHERE, 'here') },
    gen: (g) => `spawnAt(self, world, ${g.arg('s')}, ${JSON.stringify(g.literal('w'))});`,
    hint: 'Adds a new actor to the level; its "when I start" scripts run at once. On the grid: in the middle of the grid cell under the mouse.',
  },
  { op: 'game.spawnAt', category: 'game', shape: 'stack', text: 'spawn {s} at x: {x} y: {y}', slots: { s: menu('scene'), x: num(0), y: num(0) }, gen: (g) => `world.spawn(${g.arg('s')}, ${g.arg('x')}, ${g.arg('y')});` },
  {
    op: 'game.pop', category: 'game', shape: 'stack', text: 'pop up text {t} {w} color {c}', slots: { t: text('+1'), w: menu(POP_WHERE, 'here'), c: color('#ffd166') },
    gen: (g) => `popUp(self, world, ${str(g.bare('t'))}, ${JSON.stringify(g.literal('w'))}, ${str(g.bare('c'))});`,
    hint: 'Text that floats up and fades away (a coin "+5", "Not enough money").',
  },
  { op: 'game.over', category: 'game', shape: 'stack', text: 'game over', gen: () => 'world.endGame(false);', hint: 'Everything stops and "Game over" is shown. Enter or a click plays again.' },
  { op: 'game.win', category: 'game', shape: 'stack', text: 'win the game', gen: () => 'world.endGame(true);', hint: 'Everything stops and "You win!" is shown. Enter or a click plays again.' },
  { op: 'game.ended', category: 'game', shape: 'boolean', output: 'bool', text: 'game ended?', gen: () => 'world.ended !== null' },

  // Interact ----------------------------------------------------------------
  {
    op: 'interact.step', category: 'interact', module: 'interactions', shape: 'stack', text: 'step {d} over {s} seconds', slots: { d: menu(DIRECTIONS, '1,0'), s: num(0.15) },
    gen: (g) => {
      const [dx, dy] = g.literal('d').split(',').map((v) => Number(v) || 0);
      return `if (self.gridMove(${dx}, ${dy}, ${g.arg('s')})) while (self.moving) yield;`;
    },
    hint: 'One cell of the level grid, pushing pushable things if strong enough; waits until arrived. Does nothing when blocked.',
  },
  { op: 'interact.moving', category: 'interact', module: 'interactions', shape: 'boolean', output: 'bool', text: 'stepping?', gen: () => 'self.moving' },
  { op: 'interact.add', category: 'interact', module: 'interactions', shape: 'stack', text: 'start {s} for {n} seconds', slots: { s: menu('status', 'burning'), n: num(0) }, gen: (g) => `self.addStatus(${g.arg('s')}, ${g.arg('n')});`, hint: '0 seconds: the status\' own duration.' },
  { op: 'interact.remove', category: 'interact', module: 'interactions', shape: 'stack', text: 'stop {s}', slots: { s: menu('status', 'burning') }, gen: (g) => `self.removeStatus(${g.arg('s')});` },
  { op: 'interact.has', category: 'interact', module: 'interactions', shape: 'boolean', output: 'bool', text: 'I am {s}?', slots: { s: menu('status', 'burning') }, gen: (g) => `self.hasStatus(${g.arg('s')})` },
  { op: 'interact.hasOf', category: 'interact', module: 'interactions', shape: 'boolean', output: 'bool', text: '{a} is {s}?', slots: { a: actor, s: menu('status', 'burning') }, gen: (g) => `!!${g.arg('a')}?.hasStatus(${g.arg('s')})` },
  { op: 'interact.kindOf', category: 'interact', module: 'interactions', shape: 'boolean', output: 'bool', text: '{a} is a {k}?', slots: { a: actor, k: menu('kind', 'crate') }, gen: (g) => `!!${g.arg('a')}?.is(${g.arg('k')})` },
  { op: 'interact.left', category: 'interact', module: 'interactions', shape: 'reporter', output: 'num', text: 'seconds of {s} left', slots: { s: menu('status', 'burning') }, gen: (g) => `self.statusLeft(${g.arg('s')})` },
  { op: 'interact.emit', category: 'interact', module: 'interactions', shape: 'stack', text: 'give off {e} within {r} px', slots: { e: menu('element', 'fire'), r: num(48) }, gen: (g) => `world.emit(${g.arg('e')}, self.x, self.y, ${g.arg('r')});`, hint: 'Once, like an explosion or a splash: reactions run for everything in range.' },
  { op: 'interact.hitElement', category: 'interact', module: 'interactions', shape: 'reporter', output: 'text', text: 'hit element', gen: () => "(t.hit?.element ?? '')", hint: 'In "when I get hit": the element of damage from a status (burning: fire), else empty.' },

  // Control -----------------------------------------------------------------
  { op: 'control.wait', category: 'control', shape: 'stack', text: 'wait {s} seconds', slots: { s: num(1) }, gen: (g) => `yield* wait(world, ${g.arg('s')});` },
  { op: 'control.waitUntil', category: 'control', shape: 'stack', text: 'wait until {c}', slots: { c: bool }, gen: (g) => `while (!(${g.bare('c')})) yield;` },
  { op: 'control.forever', category: 'control', shape: 'c', text: ['forever'], mouths: ['do'], gen: (g) => loop('while (true)', g.mouth('do')), hint: 'One pass per frame.' },
  {
    op: 'control.repeat', category: 'control', shape: 'c', text: ['repeat {n}'], mouths: ['do'], slots: { n: num(10) },
    gen: (g) => {
      const i = g.local('i');
      return loop(`for (let ${i} = 0, n = ${g.arg('n')}; ${i} < n; ${i}++)`, g.mouth('do'));
    },
    hint: 'One pass per frame.',
  },
  { op: 'control.until', category: 'control', shape: 'c', text: ['repeat until {c}'], mouths: ['do'], slots: { c: bool }, gen: (g) => loop(`while (!(${g.bare('c')}))`, g.mouth('do')), hint: 'One pass per frame.' },
  { op: 'control.if', category: 'control', shape: 'c', text: ['if {c} then'], mouths: ['do'], slots: { c: bool }, gen: (g) => `if (${g.bare('c')}) {\n${g.mouth('do')}\n}` },
  { op: 'control.ifElse', category: 'control', shape: 'c', text: ['if {c} then', 'else'], mouths: ['do', 'else'], slots: { c: bool }, gen: (g) => `if (${g.bare('c')}) {\n${g.mouth('do')}\n} else {\n${g.mouth('else')}\n}` },
  {
    op: 'control.each', category: 'control', shape: 'c', text: ['for each other actor tagged {t}'], mouths: ['do'], slots: { t: text('enemy') },
    gen: (g) => {
      const a = g.local('actor');
      const body = g.withEachActor(a, () => g.mouth('do'));
      return `for (const ${a} of others(self, world, ${str(g.bare('t'))})) {\n${body}\n}`;
    },
    hint: 'Every living actor except this one having any of the comma-separated tags (empty: all). Runs all passes in the same frame; use "each actor" inside.',
  },
  { op: 'control.stop', category: 'control', shape: 'cap', text: 'stop this script', gen: () => 'return;' },
  { op: 'control.stopAll', category: 'control', shape: 'cap', text: 'stop all my scripts', gen: () => 'stopAll(self);\nreturn;' },
  { op: 'control.ignoreHit', category: 'control', shape: 'stack', text: 'ignore this hit', gen: () => 't.ignore = true;', hint: 'In "when I get hit", before any wait: the projectile passes through / the damage is refused.' },

  // Sensing -----------------------------------------------------------------
  { op: 'sensing.keyDown', category: 'sensing', shape: 'boolean', output: 'bool', text: 'key {key} down?', slots: { key: menu('key', 'Space') }, gen: (g) => `world.input.isDown(${g.arg('key')})` },
  { op: 'sensing.keyPressed', category: 'sensing', shape: 'boolean', output: 'bool', text: 'key {key} just pressed?', slots: { key: menu('key', 'Space') }, gen: (g) => `world.input.pressed(${g.arg('key')})` },
  { op: 'sensing.touching', category: 'sensing', shape: 'boolean', output: 'bool', text: 'touching {a}?', slots: { a: actor }, gen: (g) => `touching(self, world, ${g.arg('a')})` },
  { op: 'sensing.touchingTag', category: 'sensing', shape: 'boolean', output: 'bool', text: 'touching actor tagged {t}?', slots: { t: text('enemy') }, gen: (g) => `others(self, world, ${str(g.bare('t'))}).some((a) => world.overlaps(self, a))` },
  { op: 'sensing.nearestWithin', category: 'sensing', shape: 'reporter', output: 'actor', text: 'nearest actor tagged {t} within {r}', slots: { t: text('enemy'), r: num(120) }, gen: (g) => `nearestWithin(self, world, ${str(g.bare('t'))}, ${g.arg('r')})`, hint: 'The closest living actor with that tag, if it is close enough (else nothing).' },
  { op: 'sensing.inZone', category: 'sensing', shape: 'boolean', output: 'bool', text: 'I am in zone {z}?', slots: { z: menu('zone') }, gen: (g) => `world.inZone(self.x, self.y, ${g.arg('z')})` },
  { op: 'sensing.mouseInZone', category: 'sensing', shape: 'boolean', output: 'bool', text: 'mouse in zone {z}?', slots: { z: menu('zone') }, gen: (g) => `world.inZone(world.input.mouse.x, world.input.mouse.y, ${g.arg('z')})` },
  { op: 'sensing.nearMouse', category: 'sensing', shape: 'boolean', output: 'bool', text: 'actor tagged {t} within {r} of the mouse?', slots: { t: text('tower'), r: num(20) }, gen: (g) => `nearMouse(self, world, ${str(g.bare('t'))}, ${g.arg('r')})`, hint: 'Is the spot taken? (e.g. before building a tower there)' },
  { op: 'sensing.mouseX', category: 'sensing', shape: 'reporter', output: 'num', text: 'mouse x', gen: () => 'world.input.mouse.x' },
  { op: 'sensing.mouseY', category: 'sensing', shape: 'reporter', output: 'num', text: 'mouse y', gen: () => 'world.input.mouse.y' },
  { op: 'sensing.mouseDown', category: 'sensing', shape: 'boolean', output: 'bool', text: 'mouse down?', gen: () => 'world.input.mouseDown' },
  { op: 'sensing.self', category: 'sensing', shape: 'reporter', output: 'actor', text: 'myself', gen: () => 'self' },
  { op: 'sensing.nearest', category: 'sensing', shape: 'reporter', output: 'actor', text: 'nearest actor tagged {t}', slots: { t: text('player') }, gen: (g) => `world.nearest(self, ${g.arg('t')})` },
  { op: 'sensing.find', category: 'sensing', shape: 'reporter', output: 'actor', text: 'first actor tagged {t}', slots: { t: text('player') }, gen: (g) => `world.find(${g.arg('t')})` },
  { op: 'sensing.each', category: 'sensing', shape: 'reporter', output: 'actor', text: 'each actor', gen: (g) => g.eachActor, hint: 'The actor of the surrounding "for each" loop.' },
  { op: 'sensing.hitFrom', category: 'sensing', shape: 'reporter', output: 'actor', text: 'hit source', gen: () => '(t.hit?.from ?? null)', hint: 'Who fired or dealt the hit (in "when I get hit").' },
  { op: 'sensing.hitDamage', category: 'sensing', shape: 'reporter', output: 'num', text: 'hit damage', gen: () => '(t.hit?.damage ?? 0)' },
  { op: 'sensing.distance', category: 'sensing', shape: 'reporter', output: 'num', text: 'distance to {a}', slots: { a: actor }, gen: (g) => `distanceTo(self, world, ${g.arg('a')})`, hint: 'Infinity when there is no actor.' },
  { op: 'sensing.of', category: 'sensing', shape: 'reporter', output: 'text', text: '{p} of {a}', slots: { p: menu(PROPS_OF, 'x'), a: actor }, gen: (g) => `${member(g.arg('a'), g.arg('p'), true)} ?? 0` },
  { op: 'sensing.varOf', category: 'sensing', shape: 'reporter', output: 'text', text: 'variable {v} of {a}', slots: { v: text('score'), a: actor }, gen: (g) => `${member(`${g.arg('a')}?.data`, str(g.bare('v')))} ?? 0`, hint: 'Reads another actor\'s variable (its data).' },
  { op: 'sensing.exists', category: 'sensing', shape: 'boolean', output: 'bool', text: '{a} exists?', slots: { a: actor }, gen: (g) => `!!${g.arg('a')}` },
  { op: 'sensing.aliveOf', category: 'sensing', shape: 'boolean', output: 'bool', text: '{a} alive?', slots: { a: actor }, gen: (g) => `!!${g.arg('a')}?.alive` },
  { op: 'sensing.hasTag', category: 'sensing', shape: 'boolean', output: 'bool', text: '{a} has tag {t}?', slots: { a: actor, t: text('enemy') }, gen: (g) => `!!${g.arg('a')}?.is(${g.arg('t')})` },
  { op: 'sensing.time', category: 'sensing', shape: 'reporter', output: 'num', text: 'game time', gen: () => 'world.time' },
  { op: 'sensing.idle', category: 'sensing', shape: 'reporter', output: 'num', text: 'seconds without input', gen: () => 'world.input.idleTime' },
  { op: 'sensing.view', category: 'sensing', shape: 'boolean', output: 'bool', text: 'view is {v}?', slots: { v: menu([['side', 'side'], ['topdown', 'top-down'], ['isometric', 'isometric']], 'side') }, gen: (g) => `world.view === ${g.arg('v')}` },

  // Operators ---------------------------------------------------------------
  { op: 'op.add', category: 'operators', shape: 'reporter', output: 'num', text: '{a} + {b}', slots: { a: num(), b: num() }, gen: (g) => `${g.arg('a')} + ${g.arg('b')}` },
  { op: 'op.sub', category: 'operators', shape: 'reporter', output: 'num', text: '{a} − {b}', slots: { a: num(), b: num() }, gen: (g) => `${g.arg('a')} - ${g.arg('b')}` },
  { op: 'op.mul', category: 'operators', shape: 'reporter', output: 'num', text: '{a} × {b}', slots: { a: num(), b: num() }, gen: (g) => `${g.arg('a')} * ${g.arg('b')}` },
  { op: 'op.div', category: 'operators', shape: 'reporter', output: 'num', text: '{a} ÷ {b}', slots: { a: num(), b: num() }, gen: (g) => `${g.arg('a')} / ${g.arg('b')}` },
  { op: 'op.mod', category: 'operators', shape: 'reporter', output: 'num', text: '{a} mod {b}', slots: { a: num(), b: num(2) }, gen: (g) => `mod(${g.arg('a')}, ${g.arg('b')})` },
  { op: 'op.random', category: 'operators', shape: 'reporter', output: 'num', text: 'pick random {a} to {b}', slots: { a: num(1), b: num(10) }, gen: (g) => `random(${g.arg('a')}, ${g.arg('b')})`, hint: 'Whole numbers when both ends are whole.' },
  { op: 'op.math', category: 'operators', shape: 'reporter', output: 'num', text: '{f} of {n}', slots: { f: menu(MATH, 'abs'), n: num() }, gen: (g) => `Math.${MATH.some(([v]) => v === g.literal('f')) ? g.literal('f') : 'abs'}(${g.arg('n')})` },
  { op: 'op.lt', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} < {b}', slots: { a: text(), b: text('50') }, gen: (g) => `compare(${g.arg('a')}, ${g.arg('b')}) < 0` },
  { op: 'op.gt', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} > {b}', slots: { a: text(), b: text('50') }, gen: (g) => `compare(${g.arg('a')}, ${g.arg('b')}) > 0` },
  { op: 'op.gte', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} ≥ {b}', slots: { a: text(), b: text('50') }, gen: (g) => `compare(${g.arg('a')}, ${g.arg('b')}) >= 0` },
  { op: 'op.lte', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} ≤ {b}', slots: { a: text(), b: text('50') }, gen: (g) => `compare(${g.arg('a')}, ${g.arg('b')}) <= 0` },
  { op: 'op.eq', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} = {b}', slots: { a: text(), b: text('50') }, gen: (g) => `compare(${g.arg('a')}, ${g.arg('b')}) === 0` },
  { op: 'op.and', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} and {b}', slots: { a: bool, b: bool }, gen: (g) => `${g.arg('a')} && ${g.arg('b')}` },
  { op: 'op.or', category: 'operators', shape: 'boolean', output: 'bool', text: '{a} or {b}', slots: { a: bool, b: bool }, gen: (g) => `${g.arg('a')} || ${g.arg('b')}` },
  { op: 'op.not', category: 'operators', shape: 'boolean', output: 'bool', text: 'not {a}', slots: { a: bool }, gen: (g) => `!${g.arg('a')}` },
  { op: 'op.join', category: 'operators', shape: 'reporter', output: 'text', text: 'join {a} {b}', slots: { a: text('apple '), b: text('banana') }, gen: (g) => `${str(g.bare('a'))} + ${str(g.bare('b'))}` },

  // Variables (the palette adds one reporter per variable / prop) ------------
  { op: 'var.get', category: 'variables', shape: 'reporter', output: 'text', text: '{v}', slots: { v: menu('var') }, gen: (g) => member('self.data', g.arg('v')) },
  { op: 'var.prop', category: 'variables', shape: 'reporter', output: 'text', text: '{v}', slots: { v: menu('prop') }, gen: (g) => member('self.props', g.arg('v')), hint: 'A prop: tunable per instance, read-only, overridden by the active form.' },
  { op: 'var.global', category: 'variables', shape: 'reporter', output: 'text', text: '{v}', slots: { v: menu('global') }, gen: (g) => `(${member('world.vars', g.arg('v'))} ?? 0)`, hint: 'A game variable: the same for every actor.' },
  { op: 'var.setGlobal', category: 'variables', shape: 'stack', text: 'set game {v} to {x}', slots: { v: menu('global'), x: text('0') }, gen: (g) => `${member('world.vars', g.arg('v'))} = ${g.arg('x')};` },
  {
    op: 'var.changeGlobal', category: 'variables', shape: 'stack', text: 'change game {v} by {n}', slots: { v: menu('global'), n: num(1) },
    gen: (g) => {
      const v = member('world.vars', g.arg('v'));
      return `${v} = Number(${v} ?? 0) + ${g.arg('n')};`;
    },
  },
  { op: 'var.set', category: 'variables', shape: 'stack', text: 'set {v} to {x}', slots: { v: menu('var'), x: text('0') }, gen: (g) => `${member('self.data', g.arg('v'))} = ${g.arg('x')};` },
  { op: 'var.change', category: 'variables', shape: 'stack', text: 'change {v} by {n}', slots: { v: menu('var'), n: num(1) }, gen: (g) => {
    const v = member('self.data', g.arg('v'));
    return `${v} = Number(${v} ?? 0) + ${g.arg('n')};`;
  } },
];

export const BLOCKS: ReadonlyMap<string, BlockDef> = new Map(DEFS.map((d) => [d.op, d]));

export function blockDef(op: string): BlockDef | undefined {
  return BLOCKS.get(op);
}

export function categoryColor(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.color ?? '#888';
}

/** Blocks shown in a category's palette section, in order. */
export function paletteBlocks(category: CategoryId): BlockDef[] {
  return DEFS.filter((d) => d.category === category && d.op !== 'var.get' && d.op !== 'var.prop' && d.op !== 'var.global');
}

/** Text lines of a block, one per C-block mouth. */
export function textLines(def: BlockDef): readonly string[] {
  return typeof def.text === 'string' ? [def.text] : def.text;
}

/** Can a reporter of this type go into this slot? */
export function accepts(slot: SlotSpec['kind'], output: ValueType | undefined): boolean {
  if (!output || slot === 'menu') return false;
  if (slot === 'bool') return output === 'bool';
  if (slot === 'actor') return output === 'actor';
  // Numbers, text and colours take any value except actors (that would be meaningless there).
  return output !== 'actor' || slot === 'text';
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const KEY_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['Space', 'space'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['Enter', 'enter'],
  ['ShiftLeft', 'shift'],
  ...LETTERS.map((l) => [`Key${l}`, l.toLowerCase()] as const),
  ...'0123456789'.split('').map((d) => [`Digit${d}`, d] as const),
];
