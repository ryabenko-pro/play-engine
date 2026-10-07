import { describe, expect, it } from 'vitest';
import {
  AssetStore,
  Game,
  Input,
  RtPath,
  createActorScene,
  createInstance,
  createLevelScene,
  createPath,
  createProjectileAsset,
  createZone,
  simplify,
  type BlockNode,
  type BlockProgram,
  type Project,
  type ProjectileAsset,
} from '../src/engine';
import { generateScript, setBlocks } from '../src/editor/blocks/codegen';
import { renameInBlocks } from '../src/editor/blocks/refs';
import { b } from '../src/editor/demo-blocks';
import { BUILD_AREAS, MONEY, PRICES, createTowerDefenceProject } from '../src/games/td/project';

const program = (stacks: BlockNode[][], vars: BlockProgram['vars'] = []): BlockProgram => ({ vars, stacks: stacks.map((blocks, i) => ({ x: 0, y: i * 100, blocks })) });

interface Placement {
  name?: string;
  prog?: BlockProgram;
  script?: string;
  x?: number;
  y?: number;
  tags?: string;
  r?: number;
  /** Only an actor scene, not placed (to spawn it). */
  scene?: boolean;
}

/** A top-down level with a path "Road" (0,0) → (100,0) → (100,100) and a zone "Build" around (200, 200). */
function setup(actors: Placement[], assets: ProjectileAsset[] = []) {
  const level = createLevelScene('L', 'topdown');
  level.entities.push(
    createPath('Road', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]),
    createZone('Build', [{ x: 150, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 250 }, { x: 150, y: 250 }]),
  );
  const project: Project = { version: 4, name: 't', assets, scenes: [level], mainSceneId: level.id };
  for (const a of actors) {
    const scene = createActorScene(a.name ?? 'A');
    scene.actor.tags = a.tags ?? '';
    scene.actor.collider = { kind: 'circle', r: a.r ?? 8 };
    scene.actor.script = a.prog ? generateScript(a.prog, { key: scene.id }) : (a.script ?? '');
    project.scenes.push(scene);
    if (!a.scene) level.entities.push(createInstance(scene, a.x ?? 0, a.y ?? 0));
  }
  const input = new Input();
  const logs: string[] = [];
  const game = new Game(project, level.id, new AssetStore(project.assets), input, { onLog: (m) => logs.push(m) });
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) game.step(1 / 60);
  };
  return { game, input, logs, frames, project };
}

describe('paths', () => {
  it('measures a path and finds points along it', () => {
    const p = new RtPath('Road', [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }]);
    expect(p.length).toBe(70);
    expect(p.pointAt(15)).toEqual({ x: 15, y: 0 });
    expect(p.pointAt(50)).toEqual({ x: 30, y: 20 });
    expect(p.pointAt(999)).toEqual({ x: 30, y: 40 });
  });

  it('simplifies a freehand stroke but keeps its corners', () => {
    const pts = [...Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 })), ...Array.from({ length: 10 }, (_, i) => ({ x: 100, y: (i + 1) * 10 }))];
    expect(simplify(pts, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it('goes straight to the start of the path, then along it, and finishes at the end', () => {
    const walker = program([[b('events.start'), b('motion.followPath', { p: 'Road', n: 60 }), b('var.set', { v: 'arrived', x: 'yes' })]], [{ name: 'arrived', value: 'no', prop: false }]);
    const { game, frames, logs } = setup([{ prog: walker, x: -60, y: 0 }]);
    const a = game.all()[0];
    frames(30); // half a second (plus the first step, taken in init): 31 px towards the start
    expect(a.x).toBeCloseTo(-29, 0);
    expect(a.pathDistance).toBe(0);
    frames(60); // at the start after 1 s, then 31 px along
    expect(a.x).toBeCloseTo(31, 0);
    expect(a.pathDistance).toBeCloseTo(31, 0);
    expect(a.vx).toBeCloseTo(60, 0);
    frames(150); // 200 px of path → done after 4.33 s in total
    expect(a.data.arrived).toBe('no');
    frames(40);
    expect({ x: a.x, y: a.y }).toEqual({ x: 100, y: 100 });
    expect(a.data.arrived).toBe('yes');
    expect(logs).toEqual([]);
  });

  it('reports a missing path once and stays put', () => {
    const { game, frames, logs } = setup([{ prog: program([[b('events.start'), b('motion.followPath', { p: 'Nowhere', n: 60 })]]), x: 5 }]);
    frames(10);
    expect(game.all()[0].x).toBe(5);
    expect(logs).toEqual(['A: there is no path named "Nowhere"']);
  });
});

describe('zones', () => {
  it('knows what is inside a zone, also for maps nested in other levels', () => {
    const { game } = setup([]);
    expect(game.inZone(200, 200, 'Build')).toBe(true);
    expect(game.inZone(100, 200, 'Build')).toBe(false);
    expect(game.inZone(200, 200, 'Other')).toBe(false);
  });

  it('keeps an actor inside a zone', () => {
    const walker = program([[b('events.start'), b('control.forever', {}, { do: [b('motion.changeX', { n: 5 }), b('motion.stayInZone', { z: 'Build' })] })]]);
    const { game, frames } = setup([{ prog: walker, x: 200, y: 200 }]);
    frames(60);
    expect(game.all()[0].x).toBeLessThan(250);
    expect(game.all()[0].x).toBeGreaterThanOrEqual(245);
  });
});

describe('game: spawn, variables, mouse, timers, end', () => {
  it('spawns actor scenes by name; their "when I start" runs at once', () => {
    const spawner = program([[b('events.start'), b('game.spawn', { s: 'Dot', w: 'here' }), b('game.spawnAt', { s: 'Dot', x: 50, y: 60 }), b('game.spawn', { s: 'Nope', w: 'here' })]]);
    const dot = program([[b('events.start'), b('var.set', { v: 'born', x: 'yes' })]], [{ name: 'born', value: 'no', prop: false }]);
    const { game, logs } = setup([{ prog: spawner, x: 10, y: 20 }, { name: 'Dot', prog: dot, tags: 'dot', scene: true }]);
    const dots = game.all('dot');
    expect(dots.map((d) => [d.x, d.y, d.data.born])).toEqual([[10, 20, 'yes'], [50, 60, 'yes']]);
    expect(new Set(dots.map((d) => d.id)).size).toBe(2);
    expect(logs).toEqual(['spawn: there is no actor scene named "Nope"']);
  });

  it('shares game variables between actors and shows them', () => {
    const bank = program([[b('events.start')]], [{ name: 'money', value: 100, prop: false, global: true, show: true }]);
    const spender = program([[b('events.start'), b('var.changeGlobal', { v: 'money', n: -30 })]]);
    const { game } = setup([{ prog: bank }, { prog: spender }]);
    expect(game.vars.money).toBe(70);
  });

  it('runs timer hats every few seconds within their stage only', () => {
    const t = program([[b('events.timer', { n: 2, a: 1, b: 7 }), b('var.change', { v: 'n', n: 1 })]], [{ name: 'n', value: 0, prop: false }]);
    const { game, frames } = setup([{ prog: t }]);
    const n = () => game.all()[0].data.n;
    frames(50);
    expect(n()).toBe(0);
    frames(20); // 1.17 s
    expect(n()).toBe(1);
    frames(6 * 60); // fired at 1, 3, 5 (and not at 7)
    expect(n()).toBe(3);
  });

  it('a timer of an actor spawned late fires once at once, then keeps the rhythm', () => {
    const t = program([[b('events.timer', { n: 1, a: 0, b: 100 }), b('var.change', { v: 'n', n: 1 })]], [{ name: 'n', value: 0, prop: false }]);
    const later = program([[b('events.at', { t: 5 }), b('game.spawn', { s: 'Timer', w: 'here' })]]);
    const { game, frames } = setup([{ prog: later }, { name: 'Timer', prog: t, tags: 'timer', scene: true }]);
    frames(5 * 60 + 1);
    const timer = game.find('timer')!;
    expect(timer.data.n).toBe(1);
    frames(30);
    expect(timer.data.n).toBe(1);
    frames(31);
    expect(timer.data.n).toBe(2);
  });

  it('starts click scripts and reads the mouse in world coordinates', () => {
    const builder = program([[b('events.click'), b('control.if', { c: b('sensing.mouseInZone', { z: 'Build' }) }, { do: [b('game.spawn', { s: 'Tower', w: 'grid' })] })]]);
    const { game, input, frames } = setup([{ prog: builder }, { name: 'Tower', script: '', tags: 'tower', scene: true }]);
    input.setPointer(100, 100, true); // outside the zone
    frames(1);
    input.setPointer(205, 170, true);
    frames(1);
    expect(game.all('tower').map((t) => [t.x, t.y])).toEqual([[208, 176]]);
  });

  it('ends the game: everything stops until the player asks to play again', () => {
    const ender = program([[b('events.at', { t: 1 }), b('game.win')], [b('events.start'), b('control.forever', {}, { do: [b('motion.changeX', { n: 1 })] })]]);
    const { game, input, frames } = setup([{ prog: ender }]);
    frames(70);
    expect(game.ended).toBe('won');
    const x = game.all()[0].x;
    frames(30);
    expect(game.all()[0].x).toBe(x);
    expect(game.restartRequested).toBe(false);
    input.press('Enter');
    frames(1);
    expect(game.restartRequested).toBe(true);
  });
});

describe('combat', () => {
  const target = (hp: number) =>
    program([[b('events.start'), b('actions.setHealth', { n: hp })], [b('events.hit'), b('actions.changeHealth', { n: b('op.sub', { a: 0, b: b('sensing.hitDamage') }) })]]);

  it('splash damage hits everything within the blast radius', () => {
    const bomb = Object.assign(createProjectileAsset('Bomb'), { speed: 300, blast: 30, damage: 2 });
    const tower = program([[b('events.start'), b('actions.shootAt', { p: 'Bomb', a: b('sensing.nearestWithin', { t: 'enemy', r: 500 }) })]]);
    const { game, frames } = setup([{ prog: tower, x: 0 }, { prog: target(5), x: 100, tags: 'enemy' }, { prog: target(5), x: 120, tags: 'enemy' }, { prog: target(5), x: 200, tags: 'enemy' }], [bomb]);
    frames(30);
    expect(game.all('enemy').map((e) => e.health)).toEqual([3, 3, 5]);
  });

  it('aims ahead at a target walking along a path', () => {
    const bullet = Object.assign(createProjectileAsset('Bullet'), { speed: 200, radius: 3, lifetime: 3 });
    const walker = program([[b('events.start'), b('actions.setHealth', { n: 9 })], [b('events.start'), b('motion.followPath', { p: 'Road', n: 80 })], target(9).stacks[1].blocks]);
    const tower = program([[b('events.start'), b('control.wait', { s: 0.2 }), b('actions.shootAt', { p: 'Bullet', a: b('sensing.nearestWithin', { t: 'enemy', r: 500 }) })]]);
    const { game, frames } = setup([{ prog: walker, x: 0, y: 0, tags: 'enemy' }, { prog: tower, x: 50, y: -120 }], [bullet]);
    frames(120);
    expect(game.find('enemy')!.health).toBe(8);
  });
});

describe('renaming', () => {
  it('renames paths, zones and actor scenes in every block program', () => {
    const scene = setBlocks(createActorScene('A'), program([[b('events.start'), b('motion.followPath', { p: 'Road', n: 1 }), b('game.spawn', { s: 'Yellow', w: 'here' })]]));
    const project: Project = { version: 4, name: 't', assets: [], scenes: [scene], mainSceneId: scene.id };
    expect(renameInBlocks(project, 'path', 'Road', 'Street')).toBe(1);
    expect(renameInBlocks(project, 'scene', 'Yellow', 'Bee')).toBe(1);
    expect(scene.actor.script).toContain('self.followPath("Street"');
    expect(scene.actor.script).toContain('"Bee"');
  });
});

describe('tower defence course project', () => {
  function start() {
    const project = createTowerDefenceProject();
    const input = new Input();
    const logs: string[] = [];
    const game = new Game(project, project.mainSceneId, new AssetStore(project.assets), input, { onLog: (m) => logs.push(m) });
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 60 && !game.ended; i++) game.step(1 / 60);
    };
    const click = (x: number, y: number) => {
      input.setPointer(x, y, true);
      game.step(1 / 60);
    };
    return { game, input, logs, run, click, project };
  }

  it('is made only of blocks', () => {
    const { project } = start();
    for (const s of project.scenes) if (s.kind === 'actor') expect(s.actor.blocks, s.name).toBeTruthy();
  });

  it('enemies walk to the base and take lives; with only the first tower the game is lost', () => {
    const { game, run, logs } = start();
    expect(game.vars).toEqual({ lives: 10, money: MONEY });
    run(20);
    expect(game.all('enemy').length).toBeGreaterThan(0);
    expect(Number(game.vars.money)).toBeGreaterThan(MONEY); // coins from defeated enemies
    run(200);
    expect(game.ended).toBe('lost');
    expect(game.vars.lives).toBe(0);
    expect(logs).toEqual([]);
  });

  it('builds towers on the green areas only, for money', () => {
    const { game, click, input } = start();
    const towers = () => game.all('tower').length;
    click(300, 96); // the road: not a build area
    expect(towers()).toBe(1);
    click(240, 176);
    expect(towers()).toBe(2);
    expect(game.vars.money).toBe(MONEY - PRICES.Green);
    click(245, 180); // the same cell
    expect(towers()).toBe(2);
    input.press('Digit2');
    game.step(1 / 60);
    click(112, 176); // a blue tower costs more than what is left
    expect(towers()).toBe(2);
    expect(game.all('tower').map((t) => [t.name, t.x, t.y])).toContainEqual(['Green', 240, 176]);
  });

  it('can be won by building towers along the road', () => {
    const { game, run, click, input, logs } = start();
    const plan: Array<[number, number, number, string?]> = [
      [1, 240, 176], [3, 112, 176], [20, 432, 368], [40, 624, 368, 'Digit2'], [70, 720, 400], [90, 304, 368], [110, 496, 400], [130, 848, 240],
    ];
    for (const [t, x, y, key] of plan) {
      run(t - game.time);
      if (key) {
        input.press(key);
        game.step(1 / 60);
        input.release(key);
      }
      click(x, y);
    }
    run(200);
    expect(game.ended).toBe('won');
    expect(game.vars.lives).toBe(10);
    expect(logs).toEqual([]);
  });

  it('build areas stay off the road', () => {
    const { game } = start();
    const road = game.path('Road')!;
    for (let d = 0; d <= road.length; d += 8) {
      const p = (road as RtPath).pointAt(d);
      expect(BUILD_AREAS.some(([x0, y0, x1, y1]) => p.x > x0 - 14 && p.x < x1 + 14 && p.y > y0 - 14 && p.y < y1 + 14), `${p.x},${p.y}`).toBe(false);
    }
  });
});
