import { describe, expect, it } from 'vitest';
import {
  AssetStore,
  Game,
  Input,
  collide,
  compileModule,
  createActorScene,
  createBlock,
  createInstance,
  createLevelScene,
  createProjectileAsset,
  expandLevel,
  levelContains,
  migrateProject,
  parseFrames,
  project,
  shapeCollider,
  unproject,
  type ActorDef,
  type Asset,
  type LevelScene,
  type Project,
  type PropValues,
  type ViewMode,
} from '../src/engine';
import { GRUNT_SCRIPT, HERO_BIG_SCRIPT, HERO_SCRIPT, HERO_SMALL_SCRIPT, MINE_SCRIPT, PILL_SCRIPT } from '../src/editor/demo-scripts';
import { generateScript } from '../src/editor/blocks/codegen';
import { mineBlocks } from '../src/editor/demo-blocks';
import { highlightHtml, tokenize } from '../src/editor/highlight';
import { arrangeEntities } from '../src/editor/panels/tree-arrange';
import { FrameStats } from '../src/engine/debug';
import { SceneHistory } from '../src/editor/history';

interface Placement {
  script: string;
  x: number;
  y: number;
  def?: Partial<ActorDef>;
  props?: PropValues;
  name?: string;
}

/** A level with the given blocks plus one actor scene + instance per placement. */
function setup(view: ViewMode, blocks: LevelScene['entities'], actors: Placement[], assets: Asset[] = []) {
  const level = createLevelScene('L', view);
  level.entities.push(...blocks);
  const project: Project = { version: 4, name: 't', assets, scenes: [level], mainSceneId: level.id };
  for (const a of actors) {
    const scene = createActorScene(a.name ?? 'actor');
    Object.assign(scene.actor, { script: a.script }, a.def);
    project.scenes.push(scene);
    const inst = createInstance(scene, a.x, a.y);
    inst.props = a.props ?? {};
    level.entities.push(inst);
  }
  const input = new Input();
  const logs: string[] = [];
  const game = new Game(project, level.id, new AssetStore(assets), input, { onLog: (m) => logs.push(m) });
  return { game, input, logs };
}

function run(game: Game, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.step(1 / 60);
}

const ground = () => createBlock({ kind: 'rect', w: 2000, h: 40 }, 0, 20); // top at y = 0
const HERO = { script: HERO_SCRIPT, def: { tags: 'player' }, name: 'Hero' };

describe('collision', () => {
  it('pushes a box up out of the floor', () => {
    const floor = shapeCollider({ kind: 'rect', w: 200, h: 20 }, 0, 0);
    const box = shapeCollider({ kind: 'rect', w: 20, h: 20 }, 0, -18);
    const c = collide(box, floor)!;
    expect(c.ny).toBeCloseTo(-1);
    expect(c.depth).toBeCloseTo(2);
  });

  it('circle vs segment and vs rotated rect', () => {
    const seg = shapeCollider({ kind: 'line', x2: 100, y2: 0, thickness: 0 }, 0, 0);
    const c = collide({ type: 'circle', c: { x: 50, y: -8 }, r: 10 }, seg)!;
    expect(c.ny).toBeCloseTo(-1);
    expect(c.depth).toBeCloseTo(2);
    const slope = shapeCollider({ kind: 'rect', w: 200, h: 20 }, 0, 0, -30);
    expect(collide({ type: 'circle', c: { x: 0, y: -15 }, r: 10 }, slope)).not.toBeNull();
    expect(collide({ type: 'circle', c: { x: 0, y: -40 }, r: 10 }, slope)).toBeNull();
  });

  it('separated shapes do not collide', () => {
    expect(collide(shapeCollider({ kind: 'circle', r: 5 }, 0, 0), shapeCollider({ kind: 'circle', r: 5 }, 11, 0))).toBeNull();
  });
});

describe('assets & projection', () => {
  it('parses frame lists', () => {
    expect(parseFrames('0-3, 5 7-6')).toEqual([0, 1, 2, 3, 5, 7, 6]);
  });
  it('isometric projection round-trips', () => {
    const p = { x: 37, y: -12 };
    const back = unproject('isometric', project('isometric', p));
    expect(back.x).toBeCloseTo(37);
    expect(back.y).toBeCloseTo(-12);
  });
  it('compiles TypeScript modules with exports', () => {
    const m = compileModule('export const props = { speed: 3 as number };\nexport function update(self: Actor) { (self as any).hit = props.speed; }');
    expect(m.props).toEqual({ speed: 3 });
    const self = {} as Record<string, unknown>;
    m.update!(self as never, {} as never, 0);
    expect(self.hit).toBe(3);
  });
});

describe('scripted actors', () => {
  it('hero lands, runs and jumps from its own script', () => {
    const { game, input } = setup('side', [ground()], [{ ...HERO, x: 0, y: -100 }]);
    run(game, 1);
    const hero = game.actors[0];
    expect(hero.grounded).toBe(true);
    expect(hero.y).toBeCloseTo(-19, 0);
    expect(hero.state).toBe('idle');
    input.press('ArrowRight');
    run(game, 0.2);
    expect(hero.state).toBe('run');
    input.press('Space');
    run(game, 0.1);
    expect(hero.state).toBe('jump');
    expect(hero.x).toBeGreaterThan(20);
  });

  it('idle hero is driven by its script AI, any key takes control back', () => {
    const { game, input } = setup('topdown', [], [{ ...HERO, x: 0, y: 0, props: { aiAfterIdle: 0.5 } }]);
    run(game, 0.4);
    expect(game.actors[0].x).toBeCloseTo(0);
    run(game, 6);
    const moved = Math.hypot(game.actors[0].x, game.actors[0].y);
    expect(moved).toBeGreaterThan(10);
    input.press('KeyQ');
    game.step(1 / 60);
    expect(game.input.idleTime).toBe(0);
  });

  // The demo Mine exists as TypeScript and as blocks: both must behave the same.
  describe.each([
    ['code', MINE_SCRIPT],
    ['blocks', generateScript(mineBlocks(), { key: 'mine' })],
  ])('mine (%s)', (_kind, mineScript) => {
    it('mine kills the player on touch and changes colour nearby', () => {
      const mine = { script: mineScript, def: { collider: { kind: 'circle' as const, r: 14 } }, name: 'Mine' };
      const { game, input, logs } = setup('side', [ground()], [
        { ...HERO, x: 0, y: -19 },
        { ...mine, x: 200, y: -14 },
      ]);
      const [hero, m] = game.actors;
      run(game, 0.1);
      expect(m.color).toBe('#5c6b7a');
      hero.x = 120; // within warnRadius (110) of the mine at 200? no: 80 away → near
      run(game, 1 / 60);
      expect(m.color).toBe('#ff5a4d');
      input.press('ArrowRight');
      run(game, 1.5);
      expect(hero.alive).toBe(false);
      expect(hero.state).toBe('dead');
      expect(logs.some((l) => /killed Hero/.test(l))).toBe(true);
      expect(m.color).toBe('#5c6b7a'); // nobody alive to warn about
      input.release('ArrowRight');
      run(game, 2);
      expect(hero.alive).toBe(true); // hero script respawns itself
    });

    it('mine also kills NPCs that walk into it', () => {
      const mine = { script: mineScript, def: { collider: { kind: 'circle' as const, r: 14 } }, name: 'Mine' };
      const { game, logs } = setup('side', [ground()], [
        { script: GRUNT_SCRIPT, def: { tags: 'enemy' }, name: 'Grunt', x: 0, y: -19, props: { patrolRange: 500 } },
        { ...mine, x: 120, y: -14 },
      ]);
      const grunt = game.actors[0];
      run(game, 4);
      expect(logs.some((l) => /killed Grunt/.test(l))).toBe(true);
      expect(grunt.destroyed || !grunt.alive).toBe(true);
    });

    it('mine ignores actors whose tags are not victims', () => {
      const mine = { script: mineScript, def: { collider: { kind: 'circle' as const, r: 14 } }, name: 'Mine' };
      const { game } = setup('side', [ground()], [
        { script: GRUNT_SCRIPT, def: { tags: 'enemy' }, name: 'Grunt', x: 0, y: -19, props: { patrolRange: 500 } },
        { ...mine, x: 120, y: -14, props: { victims: 'player' } },
      ]);
      run(game, 4);
      expect(game.actors[0].alive).toBe(true);
    });
  });

  it('grunts with sight shoot at the player; onHit decides the damage', () => {
    const bolt = Object.assign(createProjectileAsset('Bolt'), { damage: 1 });
    const { game } = setup(
      'topdown',
      [],
      [
        { script: GRUNT_SCRIPT, x: 0, y: 0, props: { sight: 400, projectile: 'Bolt', fireCooldown: 0.2, speed: 0 } },
        { ...HERO, x: 150, y: 0, props: { aiAfterIdle: 0 } },
      ],
      [bolt],
    );
    const hero = game.actors[1];
    run(game, 0.8);
    expect(hero.health).toBeLessThan(5);
  });

  it('a state with its own collider replaces the body collider', () => {
    const script = "export function update(self: Actor, world: World, dt: number) { self.vy += world.gravity * dt; self.moveAndSlide(); if (world.time > 0.3) self.setState('dead'); }";
    const { game } = setup('side', [ground()], [{ script, x: 0, y: -19 }]);
    const a = game.actors[0];
    const dead = a.e.states.find((s) => s.name === 'dead')!;
    dead.body = { shape: { kind: 'rect', w: 40, h: 14 }, offsetX: 6, offsetY: 12 };
    run(game, 0.2);
    expect(a.worldBody().shape).toEqual(a.e.collider);
    run(game, 1);
    const b = a.worldBody();
    expect(b.shape).toEqual({ kind: 'rect', w: 40, h: 14 });
    expect(b.x).toBeCloseTo(a.x + 6);
    expect(b.y + 7).toBeCloseTo(0, 0); // feet stay on the ground
    a.facing = -1;
    expect(a.worldBody().x).toBeCloseTo(a.x - 6);
  });

  it('script errors are logged and only stop that actor', () => {
    const { game, logs } = setup('topdown', [], [
      { script: 'export function update(self: Actor) { (self as any).nope(); }', x: 0, y: 0, name: 'Broken' },
      { script: 'export function update(self: Actor) { self.x += 1; }', x: 0, y: 0 },
    ]);
    run(game, 0.5);
    expect(logs.filter((l) => /update\(\) error/.test(l))).toHaveLength(1);
    expect(game.actors[1].x).toBe(30);
  });

  it('instances override exported props', () => {
    const script = 'export const props = { speed: 5 };\nexport function update(self: Actor) { self.x += self.props.speed as number; }';
    const { game } = setup('topdown', [], [{ script, x: 0, y: 0, props: { speed: 2 } }]);
    run(game, 1);
    expect(game.actors[0].x).toBe(120);
    expect(game.actors[0].props).toEqual({ speed: 2 });
  });
});

describe('script editor highlighting', () => {
  const kinds = (src: string) => tokenize(src).filter((t) => t.kind !== 'text').map((t) => `${t.kind}:${t.text}`);

  it('classifies TypeScript tokens', () => {
    expect(kinds("export function update(self: Actor, dt: number) { self.moveAndSlide(); const s = 'a'; } // hi")).toEqual(
      expect.arrayContaining(['keyword:export', 'engine:update', 'engine:self', 'type:Actor', 'type:number', 'function:moveAndSlide', "string:'a'", 'comment:// hi']),
    );
    expect(kinds('self.x = 1.5e3; /* c */ true')).toEqual(expect.arrayContaining(['property:x', 'number:1.5e3', 'comment:/* c */', 'literal:true']));
  });

  it('round-trips the source text and escapes HTML', () => {
    const src = "if (a < b && s === `x${1}`) {}\n// <tag>\n";
    expect(tokenize(src).map((t) => t.text).join('')).toBe(src);
    expect(highlightHtml('a<b')).not.toContain('<b');
  });
});

describe('scene tree arrangement', () => {
  const lvl = createLevelScene('L', 'side');
  const hero = createActorScene('Hero');
  const grunt = createActorScene('Grunt');
  const named = <T extends { name: string }>(e: T, name: string) => Object.assign(e, { name });
  lvl.entities.push(
    named(createBlock({ kind: 'rect', w: 1, h: 1 }, 0, 0), 'Ground'),
    named(createInstance(grunt, 0, 0), 'Grunt 10'),
    named(createInstance(hero, 0, 0), 'Hero'),
    named(createInstance(grunt, 0, 0), 'Grunt 2'),
    named(createBlock({ kind: 'circle', r: 1 }, 0, 0), 'Boulder'),
  );
  const sceneName = (id: string) => [hero, grunt].find((s) => s.id === id)?.name;
  const names = (groups: ReturnType<typeof arrangeEntities>) => groups.map((g) => `${g.label}[${g.items.map((e) => e.name).join(',')}]`);

  it('keeps scene order by default and sorts naturally by name', () => {
    expect(names(arrangeEntities(lvl.entities, sceneName, { group: false, sortByName: false }))).toEqual(['[Ground,Grunt 10,Hero,Grunt 2,Boulder]']);
    expect(names(arrangeEntities(lvl.entities, sceneName, { group: false, sortByName: true }))).toEqual(['[Boulder,Ground,Grunt 2,Grunt 10,Hero]']);
  });

  it('groups actors by their scene, then blocks', () => {
    expect(names(arrangeEntities(lvl.entities, sceneName, { group: true, sortByName: true }))).toEqual([
      'Grunt[Grunt 2,Grunt 10]',
      'Hero[Hero]',
      'Blocks[Boulder,Ground]',
    ]);
    expect(lvl.entities.map((e) => e.name)[0]).toBe('Ground'); // the scene itself is untouched
  });
});

describe('debug frame stats', () => {
  it('reports FPS and the share of each frame spent on simulation, scripts and rendering', () => {
    const stats = new FrameStats();
    for (let i = 0; i < 60; i++) stats.add({ frameMs: 20, simMs: 5, scriptMs: 2, renderMs: 3, steps: 1 });
    stats.add({ frameMs: 2000, simMs: 1, scriptMs: 0, renderMs: 1, steps: 1 }); // a paused tab: ignored
    const s = stats.summary();
    expect(s.fps).toBeCloseTo(50);
    expect(s.simPct).toBeCloseTo(25);
    expect(s.scriptPct).toBeCloseTo(10);
    expect(s.renderPct).toBeCloseTo(15);
    expect(s.idlePct).toBeCloseTo(60);
  });

  it('game reports script time and steps', () => {
    const { game } = setup('topdown', [], [{ script: 'export function update(self: Actor) { let x = 0; for (let i = 0; i < 1e5; i++) x += i; self.data.x = x; }', x: 0, y: 0 }]);
    game.frame(0.05);
    const t = game.takeTimings();
    expect(t.steps).toBe(3);
    expect(t.scriptMs).toBeGreaterThan(0);
    expect(game.takeTimings().steps).toBe(0);
  });
});

describe('per-scene undo history', () => {
  function project() {
    const a = createLevelScene('A', 'side');
    const b = createLevelScene('B', 'side');
    const p: Project = { version: 4, name: 'p', assets: [], scenes: [a, b], mainSceneId: a.id };
    return { p, a: () => p.scenes[0] as LevelScene, b: () => p.scenes[1] as LevelScene };
  }
  const edit = (h: SceneHistory, p: Project, fn: () => void) => {
    const before = h.capture(p);
    fn();
    return h.record(before, p);
  };

  it('undo in one scene does not revert another scene', () => {
    const h = new SceneHistory();
    const { p, a, b } = project();
    const ida = a().id;
    const idb = b().id;
    expect(edit(h, p, () => a().entities.push(createBlock({ kind: 'circle', r: 1 }, 0, 0)))).toBe(ida);
    expect(edit(h, p, () => b().entities.push(createBlock({ kind: 'circle', r: 2 }, 0, 0)))).toBe(idb);
    expect(edit(h, p, () => (a().gravity = 5))).toBe(ida);

    expect(h.undo(p, ida)).toBe(true); // gravity
    expect(a().gravity).toBe(1800);
    expect(b().entities).toHaveLength(1); // B untouched
    expect(h.undo(p, ida)).toBe(true); // A's block (B's newer edit is skipped)
    expect(a().entities).toHaveLength(0);
    expect(b().entities).toHaveLength(1);
    expect(h.undo(p, ida)).toBe(false);

    expect(h.redo(p, ida)).toBe(true); // last undone first: A's block
    expect(a().entities).toHaveLength(1);
    expect(a().gravity).toBe(1800);
    expect(h.redo(p, ida)).toBe(true);
    expect(a().gravity).toBe(5);

    expect(h.undo(p, idb)).toBe(true);
    expect(b().entities).toHaveLength(0);
    expect(a().entities).toHaveLength(1);
  });

  it('project-wide changes are undoable from any scene', () => {
    const h = new SceneHistory();
    const { p, a, b } = project();
    const extra = createActorScene('Extra');
    expect(edit(h, p, () => p.scenes.push(extra))).toBe('project');
    expect(edit(h, p, () => p.assets.push(createProjectileAsset('Bolt')))).toBe('project');
    expect(h.undo(p, b().id)).toBe(true);
    expect(p.assets).toHaveLength(0);
    expect(h.undo(p, a().id)).toBe(true);
    expect(p.scenes.map((s) => s.name)).toEqual(['A', 'B']);
    expect(h.redo(p, a().id)).toBe(true);
    expect(p.scenes.map((s) => s.name)).toEqual(['A', 'B', 'Extra']);
  });
});

describe('forms (container actor + form scenes)', () => {
  const PILL = { script: PILL_SCRIPT, def: { collider: { kind: 'circle' as const, r: 9 }, tags: 'pickup' }, name: 'Pill' };

  /** Hero with Small/Big forms, plus extra placements. */
  function heroWithForms(view: ViewMode, blocks: LevelScene['entities'], extra: Placement[] = [], heroProps: PropValues = {}) {
    const level = createLevelScene('L', view);
    level.entities.push(...blocks);
    const hero = createActorScene('Hero');
    Object.assign(hero.actor, { script: HERO_SCRIPT, tags: 'player' });
    const form = (name: string, script: string, def: Partial<ActorDef>) => {
      const s = createActorScene(`Hero ${name}`);
      Object.assign(s.actor, { script, color: '#123456' }, def);
      hero.actor.forms.push({ name, sceneId: s.id });
      return s;
    };
    const small = form('small', HERO_SMALL_SCRIPT, { scale: 0.5, trail: 4 });
    const big = form('big', HERO_BIG_SCRIPT, { scale: 2, wobble: 0.05 });
    const project: Project = { version: 4, name: 't', assets: [], scenes: [level, hero, small, big], mainSceneId: level.id };
    level.entities.push(Object.assign(createInstance(hero, 0, -19), { props: { aiAfterIdle: 0, ...heroProps } }));
    for (const a of extra) {
      const scene = createActorScene(a.name ?? 'actor');
      Object.assign(scene.actor, { script: a.script }, a.def);
      project.scenes.push(scene);
      level.entities.push(Object.assign(createInstance(scene, a.x, a.y), { props: a.props ?? {} }));
    }
    const input = new Input();
    const logs: string[] = [];
    const game = new Game(project, level.id, new AssetStore([]), input, { onLog: (m) => logs.push(m) });
    return { game, input, logs, project, hero: game.actors[0] };
  }

  it('a pill switches the hero into a form: props, scale and collider change, then it wears off', () => {
    const { game, input, hero, logs } = heroWithForms('side', [ground()], [{ ...PILL, x: 60, y: -12, props: { form: 'small', seconds: 2 } }]);
    run(game, 0.2);
    expect(hero.form).toBe('base');
    expect(hero.props.speed).toBe(220);
    const tall = hero.worldBody().shape;
    input.press('ArrowRight');
    run(game, 0.5);
    input.release('ArrowRight');
    expect(hero.form).toBe('small');
    expect(logs.some((l) => /took Pill: small/.test(l))).toBe(true);
    expect(hero.props.speed).toBe(340); // the form's props win
    expect(hero.props.maxHealth).toBe(5); // the rest is the hero's
    expect(hero.scale).toBe(0.5);
    expect(hero.worldBody().shape).toEqual({ kind: 'rect', w: (tall as { w: number }).w * 0.5, h: (tall as { h: number }).h * 0.5 });
    expect(hero.color).toBe('#123456');
    run(game, 0.3);
    expect(hero.grounded).toBe(true);
    expect(hero.y).toBeCloseTo(-19 * 0.5, 0); // smaller body, feet still on the ground
    expect(hero.formLeft).toBeLessThan(2);
    run(game, 2);
    expect(hero.form).toBe('base');
    expect(hero.props.speed).toBe(220);
  });

  it('growing keeps the feet on the floor and records a trail only for trail forms', () => {
    const { game, hero, input } = heroWithForms('side', [ground()]);
    run(game, 0.3);
    expect(hero.setForm('big')).toBe(true);
    const b = hero.worldBody();
    expect(b.y + (b.shape as { h: number }).h / 2).toBeCloseTo(0, 0);
    expect(hero.formLeft).toBe(Infinity);
    expect(hero.setForm('nope')).toBe(false);
    hero.setForm('small');
    input.press('ArrowRight');
    run(game, 0.5);
    expect(hero.trail.length).toBeGreaterThan(0);
    hero.setForm('base');
    expect(hero.trail).toHaveLength(0);
  });

  it("a form's onHit runs first and can make the actor immune (mine included)", () => {
    const mine = { script: MINE_SCRIPT, def: { collider: { kind: 'circle' as const, r: 14 } }, name: 'Mine' };
    const { game, hero, input, logs } = heroWithForms('side', [ground()], [{ ...mine, x: 120, y: -14 }]);
    run(game, 0.2);
    hero.setForm('big');
    expect(hero.damage(3)).toBe(true); // blocked, but taken (a projectile would stop)
    expect(hero.health).toBe(5);
    input.press('ArrowRight');
    run(game, 1.5);
    expect(hero.x).toBeGreaterThan(120); // walked over the mine
    expect(hero.alive).toBe(true);
    expect(logs.some((l) => /killed/.test(l))).toBe(false);
    hero.setForm('base');
    expect(hero.damage(2)).toBe(true);
    expect(hero.health).toBe(3);
  });

  it('an instance can start in a form', () => {
    const level = createLevelScene('L', 'topdown');
    const a = createActorScene('A');
    const f = createActorScene('A ghost');
    Object.assign(f.actor, { script: 'export const props = { speed: 9 };', scale: 3 });
    a.actor.forms.push({ name: 'ghost', sceneId: f.id });
    a.actor.script = 'export const props = { speed: 1, hp: 2 };';
    level.entities.push(Object.assign(createInstance(a, 0, 0), { form: 'ghost' }));
    const project: Project = { version: 4, name: 't', assets: [], scenes: [level, a, f], mainSceneId: level.id };
    const game = new Game(project, level.id, new AssetStore([]), new Input());
    expect(game.actors[0].form).toBe('ghost');
    expect(game.actors[0].props).toEqual({ speed: 9, hp: 2 });
    expect(game.actors[0].scale).toBe(3);
  });
});

describe('nested levels (rooms → buildings → world)', () => {
  function world() {
    const guard = createActorScene('Guard');
    guard.actor.script = 'export function update(self: Actor) {}';
    guard.actor.tags = 'enemy';
    const room = createLevelScene('Room', 'side');
    room.entities.push(createBlock({ kind: 'rect', w: 100, h: 10 }, 50, 5), Object.assign(createInstance(guard, 20, -19), { name: 'Guard' }));
    const building = createLevelScene('Building', 'side');
    building.entities.push(
      Object.assign(createInstance(room, 0, 0), { name: 'Room A' }),
      Object.assign(createInstance(room, 100, 0), { name: 'Room B', tags: 'east' }),
    );
    const w = createLevelScene('World', 'side');
    w.entities.push(Object.assign(createInstance(building, 1000, 500), { name: 'Tower' }));
    const project: Project = { version: 4, name: 't', assets: [], scenes: [w, building, room, guard], mainSceneId: w.id };
    return { project, w, building, room };
  }

  it('flattens nested levels with offsets, path names and inherited tags', () => {
    const { project, w } = world();
    const flat = expandLevel(project, w);
    expect(flat).toHaveLength(4);
    expect(flat.every((x) => x.owner === w.entities[0].id && x.depth === 2)).toBe(true);
    const guards = flat.filter((x) => x.e.type === 'instance').map((x) => x.e);
    expect(guards.map((g) => [g.name, g.x, g.y])).toEqual([
      ['Tower/Room A/Guard', 1020, 481],
      ['Tower/Room B/Guard', 1120, 481],
    ]);
    expect(guards[1].tags).toBe('east');
    expect(new Set(flat.map((x) => x.e.id)).size).toBe(4);

    const game = new Game(project, w.id, new AssetStore([]), new Input());
    expect(game.all('enemy').map((a) => a.name)).toEqual(['Tower/Room A/Guard', 'Tower/Room B/Guard']);
    expect(game.find('east')?.x).toBe(1120);
  });

  it('skips a level that contains itself', () => {
    const { project, w, room } = world();
    room.entities.push(createInstance(w, 0, 0));
    expect(levelContains(project, room.id, w.id)).toBe(true);
    expect(levelContains(project, w.id, room.id)).toBe(true);
    const warnings: string[] = [];
    expect(expandLevel(project, w, (m) => warnings.push(m))).toHaveLength(4);
    expect(warnings.length).toBe(2);
  });

  it('old v3 projects are upgraded', () => {
    const old = { version: 3, name: 'o', assets: [], mainSceneId: 'x', scenes: [{ id: 'a', kind: 'actor', name: 'A', previewView: 'side', actor: { tags: '' } }] };
    const p = migrateProject(old)!;
    expect(p.version).toBe(4);
    expect(p.scenes[0].kind === 'actor' && p.scenes[0].actor).toMatchObject({ forms: [], scale: 1, trail: 0, wobble: 0 });
    expect(migrateProject({ version: 99, scenes: [{}], assets: [] })).toBeNull();
  });
});
