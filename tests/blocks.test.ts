import { describe, expect, it } from 'vitest';
import {
  AssetStore,
  Game,
  Input,
  ScriptCache,
  compileModule,
  createActorScene,
  createDefaultInteractions,
  createInstance,
  createLevelScene,
  createProjectileAsset,
  type BlockArg,
  type BlockNode,
  type BlockProgram,
  type Project,
  type PropValues,
} from '../src/engine';
import { BLOCKS, type BlockDef } from '../src/editor/blocks/catalog';
import { atomic, generateScript } from '../src/editor/blocks/codegen';
import { b } from '../src/editor/demo-blocks';

const program = (stacks: BlockNode[][], vars: BlockProgram['vars'] = []): BlockProgram => ({
  vars,
  stacks: stacks.map((blocks, i) => ({ x: 0, y: i * 100, blocks })),
});

interface Placement {
  prog?: BlockProgram;
  script?: string;
  x?: number;
  y?: number;
  tags?: string;
  kinds?: string[];
  props?: PropValues;
}

/** A top-down level (no gravity) with one instance per placement. */
function setup(actors: Placement[]) {
  const level = createLevelScene('L', 'topdown');
  const bolt = createProjectileAsset('Bolt');
  level.gridSize = 32;
  const project: Project = { version: 4, name: 't', assets: [bolt], scenes: [level], mainSceneId: level.id, interactions: createDefaultInteractions() };
  for (const a of actors) {
    const scene = createActorScene('A');
    scene.actor.tags = a.tags ?? '';
    scene.actor.kinds = a.kinds ?? [];
    scene.actor.script = a.prog ? generateScript(a.prog, { key: scene.id }) : (a.script ?? '');
    project.scenes.push(scene);
    const inst = createInstance(scene, a.x ?? 0, a.y ?? 0);
    inst.props = a.props ?? {};
    level.entities.push(inst);
  }
  const input = new Input();
  const logs: string[] = [];
  const game = new Game(project, level.id, new AssetStore(project.assets), input, { onLog: (m) => logs.push(m) });
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) game.step(1 / 60);
  };
  return { game, input, logs, frames };
}

describe('block scripts', () => {
  it('runs "when game starts" at once and resumes after wait', () => {
    const { game, frames } = setup([
      { prog: program([[b('events.start'), b('motion.changeX', { n: 10 }), b('control.wait', { s: 1 }), b('motion.changeX', { n: 10 })]]) },
    ]);
    const a = game.actors[0];
    expect(a.x).toBe(10); // the first step ran in init
    frames(30);
    expect(a.x).toBe(10);
    frames(40);
    expect(a.x).toBe(20);
  });

  it('loops take one pass per frame', () => {
    const { game, frames } = setup([{ prog: program([[b('events.start'), b('control.repeat', { n: 5 }, { do: [b('motion.changeX', { n: 1 })] })]]) }]);
    const a = game.actors[0];
    expect(a.x).toBe(1);
    frames(2);
    expect(a.x).toBe(3);
    frames(10);
    expect(a.x).toBe(5);
  });

  it('runs several scripts side by side; forever never blocks the others', () => {
    const { game, frames } = setup([
      {
        prog: program([
          [b('events.start'), b('control.forever', {}, { do: [b('motion.changeX', { n: 1 })] })],
          [b('events.start'), b('control.forever', {}, { do: [b('motion.changeY', { n: 2 })] })],
        ]),
      },
    ]);
    frames(9);
    expect(game.actors[0].x).toBe(10);
    expect(game.actors[0].y).toBe(20);
  });

  it('starts key scripts on a press, without restarting a running one', () => {
    const { game, input, frames } = setup([
      { prog: program([[b('events.key', { key: 'Space' }), b('motion.changeX', { n: 1 }), b('control.wait', { s: 0.5 }), b('motion.changeX', { n: 100 })]]) },
    ]);
    const a = game.actors[0];
    input.press('Space');
    frames(1);
    expect(a.x).toBe(1);
    input.release('Space');
    input.press('Space'); // pressed again while waiting: ignored
    frames(1);
    expect(a.x).toBe(1);
    frames(40);
    expect(a.x).toBe(101);
  });

  it('"when … becomes true" fires on each false → true change', () => {
    const cond = b('op.gt', { a: b('motion.y'), b: '5' });
    const { game, frames } = setup([{ prog: program([[b('events.when', { c: cond }), b('motion.changeX', { n: 1 })]]) }]);
    const a = game.actors[0];
    frames(3);
    expect(a.x).toBe(0);
    a.y = 10;
    frames(3);
    expect(a.x).toBe(1);
    a.y = 0;
    frames(1);
    a.y = 10;
    frames(1);
    expect(a.x).toBe(2);
  });

  it('variables live in data, props are tunable per instance', () => {
    const prog = program(
      [[b('events.start'), b('var.change', { v: 'score', n: b('var.prop', { v: 'bonus' }) }), b('var.change', { v: 'score', n: 1 })]],
      [
        { name: 'score', value: 10, prop: false },
        { name: 'bonus', value: 5, prop: true },
      ],
    );
    expect(new ScriptCache().props(generateScript(prog, { key: 'k' }))).toEqual({ bonus: 5 });
    const { game } = setup([{ prog }, { prog, props: { bonus: 100 } }]);
    expect(game.actors[0].data.score).toBe(16);
    expect(game.actors[1].data.score).toBe(111);
  });

  it('"when I get hit" runs on hits; "ignore this hit" refuses them', () => {
    const hurt = program([[b('events.hit'), b('actions.changeHealth', { n: b('op.sub', { a: 0, b: b('sensing.hitDamage') }) })]]);
    const immune = program([[b('events.hit'), b('control.ignoreHit')]]);
    const { game } = setup([{ prog: hurt }, { prog: immune }, { prog: program([[b('events.start')]]) }]);
    const [a, i, none] = game.actors;
    a.health = i.health = 5;
    expect(a.damage(2)).toBe(true);
    expect(a.health).toBe(3);
    expect(i.damage(2)).toBe(false);
    expect(none.damage(2)).toBe(false); // no hat: no onHit at all
  });

  it('for each + touching + damage: a block trap kills code actors', () => {
    const trap = program([
      [
        b('events.start'),
        b('control.forever', {}, {
          do: [b('control.each', { t: 'player' }, { do: [b('control.if', { c: b('sensing.touching', { a: b('sensing.each') }) }, { do: [b('actions.damage', { a: b('sensing.each'), n: 1 })] })] })],
        }),
      ],
    ]);
    const victim = `export function onHit(self, world, hit) { self.health -= hit.damage; if (self.health <= 0) self.kill(); }`;
    const { game, frames } = setup([{ prog: trap }, { script: victim, tags: 'player', x: 200 }]);
    const v = game.actors[1];
    v.health = 3;
    frames(5);
    expect(v.health).toBe(3);
    v.x = 5;
    frames(3);
    expect(v.alive).toBe(false);
  });

  it('stop all and remove from level end the actor\'s scripts', () => {
    const { game, frames } = setup([
      {
        prog: program([
          [b('events.start'), b('control.forever', {}, { do: [b('motion.changeX', { n: 1 })] })],
          [b('events.start'), b('control.wait', { s: 0.1 }), b('control.stopAll')],
        ]),
      },
      { prog: program([[b('events.start'), b('control.wait', { s: 0.1 }), b('actions.destroy')]]) },
    ]);
    frames(30);
    expect(game.actors[0].x).toBeLessThan(10);
    expect(game.actors.length).toBe(1);
  });
});

describe('interaction blocks', () => {
  it('"when I start / stop" hats follow statuses', () => {
    const prog = program([
      [b('events.status', { s: 'wet' }), b('motion.changeX', { n: 1 })],
      [b('events.statusEnd', { s: 'wet' }), b('motion.changeY', { n: 1 })],
      [b('events.start'), b('interact.add', { s: 'wet', n: 0.5 })],
    ]);
    const { game, frames } = setup([{ prog }]);
    const a = game.actors[0];
    expect(a.x).toBe(1);
    expect(a.hasStatus('wet')).toBe(true);
    frames(40);
    expect(a.y).toBe(1);
  });

  it('"step" moves one cell and waits until arrived; pushes crates', () => {
    const walker = program([[b('events.start'), b('interact.step', { d: '1,0', s: 0.1 }), b('interact.step', { d: '1,0', s: 0.1 }), b('motion.changeY', { n: 100 })]]);
    const { game, frames } = setup([
      { prog: walker, x: 16, y: 16, kinds: ['creature'] },
      { prog: program([]), x: 48, y: 16, kinds: ['crate'] },
    ]);
    const [w, c] = game.actors;
    frames(4);
    expect(w.y).toBe(16); // still stepping
    frames(20);
    expect(w.x).toBe(80);
    expect(c.x).toBe(112);
    expect(w.y).toBe(116);
  });
});

describe('block codegen', () => {
  /** A block with every slot filled by its default, plugged where it fits. */
  function sample(def: BlockDef): BlockNode {
    const args: Record<string, BlockArg> = {};
    for (const [name, spec] of Object.entries(def.slots ?? {})) {
      if (spec.kind === 'bool') args[name] = b('sensing.keyDown', { key: 'Space' });
      else if (spec.kind === 'actor') args[name] = b('sensing.nearest', { t: 'player' });
      else if (spec.kind === 'menu' && !spec.value) args[name] = ({ var: 'score', state: 'idle', projectile: 'Bolt', status: 'burning', element: 'fire', kind: 'crate' } as Record<string, string>)[String(spec.menu)] ?? 'x';
    }
    const stacks = def.mouths ? Object.fromEntries(def.mouths.map((m) => [m, [b('motion.changeX', { n: 1 })]])) : undefined;
    return b(def.op, args, stacks);
  }

  it('every block generates code that compiles and runs', () => {
    const vars = [{ name: 'score', value: 0, prop: false }];
    for (const def of BLOCKS.values()) {
      const node = sample(def);
      let stack: BlockNode[];
      if (def.shape === 'hat') stack = [node, b('motion.changeX', { n: 1 })];
      else if (def.shape === 'reporter' || def.shape === 'boolean') stack = [b('events.start'), b('actions.log', { t: node })];
      else stack = [b('events.start'), node];
      const prog = program([stack], vars);
      const src = generateScript(prog, { key: def.op });
      expect(() => compileModule(src), `${def.op}\n${src}`).not.toThrow();
      const { game, frames, logs } = setup([{ prog }, { tags: 'player', x: 30, script: '' }]);
      frames(3);
      game.actors[0].damage(1);
      expect(logs.filter((l) => /error/.test(l)), def.op).toEqual([]);
    }
  });

  it('keeps generated expressions readable', () => {
    expect(atomic('self.x')).toBe(true);
    expect(atomic('world.find("a b")?.x')).toBe(true);
    expect(atomic('(-5)')).toBe(true);
    expect(atomic('a + b')).toBe(false);
    expect(atomic('!x')).toBe(false);
    expect(atomic('f(a) + g(b)')).toBe(false);
    const src = generateScript(
      program([[b('events.start'), b('motion.changeX', { n: b('op.sub', { a: b('motion.x'), b: 2 }) }), b('control.if', { c: b('sensing.keyDown', { key: 'KeyA' }) })]]),
      { key: 'k' },
    );
    expect(src).toContain('self.x += (self.x - 2);');
    expect(src).toContain('if (world.input.isDown("KeyA")) {');
  });

  it('ignores loose blocks and emits onHit only for a hit hat', () => {
    const src = generateScript(program([[b('motion.changeX', { n: 5 })], [b('events.start')]]), { key: 'k' });
    expect(src).not.toContain('+= 5');
    expect(compileModule(src).onHit).toBeUndefined();
  });
});
