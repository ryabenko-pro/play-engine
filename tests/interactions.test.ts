import { describe, expect, it } from 'vitest';
import {
  AssetStore,
  Game,
  Input,
  createActorScene,
  createBlock,
  createDefaultInteractions,
  createInstance,
  createLevelScene,
  migrateProject,
  type BlockEntity,
  type Project,
  type PropValues,
  type ViewMode,
} from '../src/engine';

interface Placement {
  kinds?: string[];
  script?: string;
  x: number;
  y: number;
  props?: PropValues;
  collider?: { kind: 'rect'; w: number; h: number };
}

/** A creature that logs statuses and hits; health 10. */
const TRACKER = `
export const props = { speed: 100 };
export function init(self) { self.health = 10; }
export function onHit(self, world, hit) { self.health -= hit.damage; world.log('hit ' + hit.damage + ' ' + (hit.element ?? '')); }
export function onStatus(self, world, status, added) { world.log((added ? '+' : '-') + status); }
`;

const CRATE = `
export function init(self) { self.health = 2; }
export function onHit(self, world, hit) { self.health -= hit.damage; if (self.health <= 0) self.destroy(); }
`;

function setup(view: ViewMode, blocks: BlockEntity[], actors: Placement[]) {
  const level = createLevelScene('L', view);
  level.gridSize = 32;
  level.entities.push(...blocks);
  const project: Project = { version: 4, name: 't', assets: [], scenes: [level], mainSceneId: level.id, interactions: createDefaultInteractions() };
  for (const a of actors) {
    const scene = createActorScene('A');
    Object.assign(scene.actor, { script: a.script ?? '', kinds: a.kinds ?? [], collider: a.collider ?? { kind: 'rect', w: 30, h: 30 } });
    project.scenes.push(scene);
    const inst = createInstance(scene, a.x, a.y);
    inst.props = a.props ?? {};
    level.entities.push(inst);
  }
  const logs: string[] = [];
  const game = new Game(project, level.id, new AssetStore([]), new Input(), { onLog: (m) => logs.push(m) });
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) game.step(1 / 60);
  };
  return { game, logs, run };
}

/** A non-solid zone block with kinds. */
function zone(kinds: string[], x: number, y: number, w = 64, h = 64): BlockEntity {
  return Object.assign(createBlock({ kind: 'rect', w, h }, x, y), { solid: false, kinds });
}

describe('elements, statuses and reactions', () => {
  it('fire sets creatures burning; burning deals fire damage over time through onHit', () => {
    const { game, logs, run } = setup('topdown', [zone(['fire'], 0, 0)], [{ kinds: ['creature'], script: TRACKER, x: 0, y: 0 }]);
    const a = game.actors[0];
    run(0.05);
    expect(a.hasStatus('burning')).toBe(true);
    expect(logs).toContain('+burning');
    a.x = 500; // out of the fire: keeps burning for its duration
    run(2.05);
    expect(a.health).toBe(8);
    expect(logs).toContain('hit 1 fire');
    run(3);
    expect(a.hasStatus('burning')).toBe(false);
    expect(logs).toContain('-burning');
  });

  it('water puts fire out and makes things wet; wet things do not catch fire', () => {
    const { game, run } = setup('topdown', [zone(['fire'], 0, 0), zone(['water'], 300, 0)], [{ kinds: ['creature'], script: TRACKER, x: 0, y: 0 }]);
    const a = game.actors[0];
    run(0.05);
    expect(a.hasStatus('burning')).toBe(true);
    a.x = 300;
    run(0.05);
    expect(a.hasStatus('burning')).toBe(false);
    expect(a.hasStatus('wet')).toBe(true);
    a.x = 0; // back into the fire while still wet
    run(0.5);
    expect(a.hasStatus('burning')).toBe(false);
  });

  it('cold chills (props.speed halved while it lasts); heat exhausts', () => {
    const { game, run } = setup('topdown', [zone(['snow'], 0, 0), zone(['hot'], 300, 0)], [{ kinds: ['creature'], script: TRACKER, x: 0, y: 0 }]);
    const a = game.actors[0];
    run(0.05);
    expect(a.hasStatus('chilled')).toBe(true);
    expect(a.props.speed).toBe(50);
    a.x = 1000;
    run(3.1);
    expect(a.hasStatus('chilled')).toBe(false);
    expect(a.props.speed).toBe(100);
    a.x = 300;
    run(0.05);
    expect(a.props.speed).toBeCloseTo(70);
  });

  it('fire spreads between wooden crates standing side by side', () => {
    const { game, run } = setup('topdown', [], [
      { kinds: ['crate', 'wood'], script: CRATE, x: 16, y: 16 },
      { kinds: ['crate', 'wood'], script: CRATE, x: 48, y: 16 },
      { kinds: ['crate', 'wood'], script: CRATE, x: 80, y: 16 },
      { kinds: ['crate', 'wood'], script: CRATE, x: 400, y: 16 },
    ]);
    const [c1, c2, c3, far] = game.actors;
    c1.addStatus('burning');
    run(0.1);
    expect(c2.hasStatus('burning') && c3.hasStatus('burning')).toBe(true);
    expect(far.hasStatus('burning')).toBe(false);
    run(2.5);
    expect(c1.destroyed).toBe(true); // 2 health, 1 fire damage per second
  });

  it('world.emit reaches everything in the radius once', () => {
    const { game } = setup('topdown', [], [
      { kinds: ['creature'], script: TRACKER, x: 0, y: 0 },
      { kinds: ['creature'], script: TRACKER, x: 200, y: 0 },
    ]);
    game.emit('fire', 0, 0, 50);
    expect(game.actors[0].hasStatus('burning')).toBe(true);
    expect(game.actors[1].hasStatus('burning')).toBe(false);
  });

  it('addStatus from scripts; unknown statuses are refused; kinds count for is()', () => {
    const { game } = setup('topdown', [], [{ kinds: ['creature'], script: TRACKER, x: 0, y: 0 }]);
    const a = game.actors[0];
    expect(a.addStatus('wet', 10)).toBe(true);
    expect(a.statusLeft('wet')).toBe(10);
    expect(a.addStatus('nope')).toBe(false);
    expect(a.is('creature')).toBe(true);
    expect(game.find('creature')).toBe(a);
  });
});

describe('grid pushing', () => {
  const walker = (x: number, y: number): Placement => ({ kinds: ['creature'], x, y }); // strength 2
  const crate = (x: number, y: number): Placement => ({ kinds: ['crate'], x, y }); // weight 1
  const cell = (n: number) => n * 32 + 16;

  it('pushes two crates but not three', () => {
    const two = setup('topdown', [], [walker(cell(0), cell(0)), crate(cell(1), cell(0)), crate(cell(2), cell(0))]);
    expect(two.game.actors[0].gridMove(1, 0, 0.1)).toBe(true);
    two.run(0.2);
    expect(two.game.actors.map((a) => a.x)).toEqual([cell(1), cell(2), cell(3)]);

    const three = setup('topdown', [], [walker(cell(0), cell(0)), crate(cell(1), cell(0)), crate(cell(2), cell(0)), crate(cell(3), cell(0))]);
    expect(three.game.actors[0].gridMove(1, 0)).toBe(false);
    three.run(0.2);
    expect(three.game.actors.map((a) => a.x)).toEqual([cell(0), cell(1), cell(2), cell(3)]);
  });

  it('a heavier boulder counts double; walls and unpushable solids stop the chain', () => {
    const boulder = setup('topdown', [], [walker(cell(0), cell(0)), { kinds: ['boulder'], x: cell(1), y: cell(0) }, crate(cell(2), cell(0))]);
    expect(boulder.game.actors[0].gridMove(1, 0)).toBe(false); // 2 + 1 > 2

    const wall = Object.assign(createBlock({ kind: 'rect', w: 32, h: 32 }, cell(3), cell(0)), { solid: true });
    const walled = setup('topdown', [wall], [walker(cell(0), cell(0)), crate(cell(1), cell(0)), crate(cell(2), cell(0))]);
    expect(walled.game.actors[0].gridMove(1, 0)).toBe(false);
    expect(walled.game.actors[0].gridMove(0, 1)).toBe(true); // other directions are free

    const stone = setup('topdown', [], [walker(cell(0), cell(0)), crate(cell(1), cell(0)), { kinds: ['stone'], x: cell(2), y: cell(0) }]);
    expect(stone.game.actors[0].gridMove(1, 0)).toBe(false);
  });

  it('steps take their time; no new move until arrived; no diagonals', () => {
    const { game, run } = setup('topdown', [], [walker(cell(0), cell(0))]);
    const a = game.actors[0];
    expect(a.gridMove(1, 1)).toBe(false);
    expect(a.gridMove(0, 1, 0.5)).toBe(true);
    expect(a.moving).toBe(true);
    expect(a.gridMove(0, 1)).toBe(false);
    run(0.25);
    expect(a.y).toBeCloseTo(cell(0) + 16, 0);
    run(0.3);
    expect(a.moving).toBe(false);
    expect(a.y).toBe(cell(1));
  });

  it('solid actors block continuous movement and can be stood on (side view)', () => {
    const floor = createBlock({ kind: 'rect', w: 400, h: 20 }, 0, 10); // top at y = 0
    const fall = `export function update(self, world, dt) { self.vy += 1800 * dt; self.moveAndSlide(); }`;
    const { game, run } = setup('side', [floor], [
      { kinds: ['crate'], script: fall, x: 0, y: -16, collider: { kind: 'rect', w: 32, h: 32 } },
      { script: fall, x: 0, y: -100, collider: { kind: 'rect', w: 20, h: 20 } },
    ]);
    run(1);
    const [box, player] = game.actors;
    expect(box.y).toBeCloseTo(-16, 0);
    expect(player.y).toBeCloseTo(-42, 0); // resting on top of the crate
    expect(player.grounded).toBe(true);
  });
});

describe('interaction data', () => {
  it('old projects get the default library', () => {
    const level = createLevelScene('L', 'side');
    const p = migrateProject({ version: 4, name: 'x', assets: [], scenes: [level], mainSceneId: level.id })!;
    expect(p.interactions?.statuses.map((s) => s.name)).toContain('burning');
  });
});
