import { createActorScene, createBlock, createInstance, createLevelScene, createPath, createProjectileAsset, createZone } from '../../engine/factory';
import type { ActorScene, BlockArg, BlockNode, BlockProgram, BlockVariable, InstanceEntity, Project, ProjectileAsset } from '../../engine/types';
import { setBlocks } from '../../editor/blocks/codegen';
import { b } from '../../editor/demo-blocks';

/*
 * Course project 1: Tower Defence, made only of blocks and plain shapes.
 * Yellow and red dots walk along the road; green and blue dots (towers) shoot white dots
 * at them. A defeated enemy pays coins at once; coins buy towers, built by clicking the
 * green areas. An enemy reaching the base costs a life; no lives left is game over, and
 * surviving 3 minutes wins.
 */

/** Seconds to survive. */
export const SURVIVE = 180;

const G = 32;
const W = 30 * G;
const H = 20 * G;

/** The road, in world px: from the left edge to the base on the right. */
export const ROAD: ReadonlyArray<{ x: number; y: number }> = [
  { x: 32, y: 96 },
  { x: 416, y: 96 },
  { x: 416, y: 288 },
  { x: 160, y: 288 },
  { x: 160, y: 480 },
  { x: 800, y: 480 },
  { x: 800, y: 160 },
  { x: 928, y: 160 },
];

/** Where towers may be built: grid-aligned rectangles off the road (x0, y0, x1, y1). */
export const BUILD_AREAS: ReadonlyArray<readonly [number, number, number, number]> = [
  [64, 128, 384, 256],
  [448, 64, 768, 320],
  [192, 320, 768, 448],
  [64, 512, 768, 608],
  [832, 192, 928, 608],
];

export const SPAWNER_AT = { x: -48, y: 96 };

// Small helpers for readable programs ----------------------------------------

const prop = (v: string) => b('var.prop', { v });
const game = (v: string) => b('var.global', { v });
const local = (v: string) => b('var.get', { v });
const minus = (x: BlockArg) => b('op.sub', { a: 0, b: x });

/** Stacks one under the other, with room for their blocks. */
function layout(...stacks: BlockNode[][]): BlockProgram['stacks'] {
  const size = (n: BlockNode): number => 1 + Object.values(n.stacks ?? {}).reduce((s, l) => s + l.reduce((t, x) => t + size(x), 0) + 0.6, 0);
  let y = 30;
  return stacks.map((blocks) => {
    const at = { x: 30, y, blocks };
    y += blocks.reduce((s, n) => s + size(n), 0) * 40 + 50;
    return at;
  });
}

function program(vars: BlockVariable[], ...stacks: BlockNode[][]): BlockProgram {
  return { vars, stacks: layout(...stacks) };
}

function blockActor(name: string, color: string, r: number, tags: string, prog: BlockProgram): ActorScene {
  const s = createActorScene(name);
  s.previewView = 'topdown';
  Object.assign(s.actor, { tags, color, collider: { kind: 'circle', r } });
  return setBlocks(s, prog);
}

// The actors -----------------------------------------------------------------

/**
 * An enemy: walks the road; at the end it takes a life. Hit: loses health; at 0 it pays its
 * reward (the coin is collected at once) and disappears.
 */
export function enemyProgram(health: number, speed: number, reward: number): BlockProgram {
  return program(
    [
      { name: 'health', value: health, prop: true },
      { name: 'speed', value: speed, prop: true },
      { name: 'reward', value: reward, prop: true },
    ],
    [
      b('events.start'),
      b('actions.setHealth', { n: prop('health') }),
      b('motion.followPath', { p: 'Road', n: prop('speed') }),
      b('var.changeGlobal', { v: 'lives', n: -1 }),
      b('game.pop', { t: '-1 life', w: 'here', c: '#ff6b6b' }),
      b('actions.destroy'),
    ],
    [
      b('events.hit'),
      b('actions.changeHealth', { n: minus(b('sensing.hitDamage')) }),
      b('looks.flash', { s: 0.1 }),
      b('control.if', { c: b('op.lt', { a: b('actions.health'), b: '1' }) }, {
        do: [
          b('var.changeGlobal', { v: 'money', n: prop('reward') }),
          b('game.pop', { t: b('op.join', { a: '+', b: prop('reward') }), w: 'here', c: '#ffd84d' }),
          b('actions.burst', { n: 12, c: '#ffd84d' }),
          b('actions.destroy'),
        ],
      }),
    ],
  );
}

/** A tower: shows its range and shoots at the nearest enemy in it, then reloads. */
export function towerProgram(projectile: string, range: number, reload: number): BlockProgram {
  return program(
    [
      { name: 'range', value: range, prop: true },
      { name: 'reload', value: reload, prop: true },
    ],
    [
      b('events.start'),
      b('looks.range', { r: prop('range') }),
      b('control.forever', {}, {
        do: [
          b('actions.shootAt', { p: projectile, a: b('sensing.nearestWithin', { t: 'enemy', r: prop('range') }) }),
          b('control.wait', { s: prop('reload') }),
        ],
      }),
    ],
  );
}

/** The base at the end of the road: keeps the lives; none left is game over. */
export function baseProgram(lives: number): BlockProgram {
  return program(
    [{ name: 'lives', value: lives, prop: false, global: true, show: true }],
    [b('events.when', { c: b('op.lt', { a: game('lives'), b: '1' }) }), b('game.over')],
  );
}

/** Starting money; the towers' prices. */
export const MONEY = 100;
export const PRICES = { Green: 50, Blue: 80 } as const;

/** The shop (invisible): keeps the money; keys 1 / 2 choose a tower, a click on a green area builds it. */
export function shopProgram(): BlockProgram {
  const choose = (key: string, name: keyof typeof PRICES) => [
    b('events.key', { key }),
    b('var.set', { v: 'tower', x: name }),
    b('var.set', { v: 'price', x: String(PRICES[name]) }),
  ];
  return program(
    [
      { name: 'money', value: MONEY, prop: false, global: true, show: true },
      { name: 'tower', value: 'Green', prop: false },
      { name: 'price', value: PRICES.Green, prop: false },
    ],
    [
      b('events.start'),
      b('looks.hide'),
      b('control.forever', {}, {
        do: [
          b('looks.hud', { t: b('op.join', { a: 'Building: ', b: b('op.join', { a: local('tower'), b: b('op.join', { a: ' tower, ', b: b('op.join', { a: local('price'), b: ' coins' }) }) }) }), x: 10, y: -36 }),
          b('looks.hud', { t: `Keys 1 / 2: Green (${PRICES.Green}) or Blue (${PRICES.Blue}) tower · click a green area to build`, x: 10, y: -14 }),
        ],
      }),
    ],
    choose('Digit1', 'Green'),
    choose('Digit2', 'Blue'),
    [
      b('events.click'),
      b('control.ifElse', { c: b('sensing.mouseInZone', { z: 'Build' }) }, {
        do: [
          b('control.ifElse', { c: b('sensing.nearMouse', { t: 'tower', r: 24 }) }, {
            do: [b('game.pop', { t: 'Taken!', w: 'mouse', c: '#ff6b6b' })],
            else: [
              b('control.ifElse', { c: b('op.gte', { a: game('money'), b: local('price') }) }, {
                do: [
                  b('control.ifElse', { c: b('op.eq', { a: local('tower'), b: 'Green' }) }, {
                    do: [b('game.spawn', { s: 'Green', w: 'grid' })],
                    else: [b('game.spawn', { s: 'Blue', w: 'grid' })],
                  }),
                  b('var.changeGlobal', { v: 'money', n: minus(local('price')) }),
                ],
                else: [b('game.pop', { t: b('op.join', { a: 'Need ', b: b('op.join', { a: local('price'), b: ' coins' }) }), w: 'mouse', c: '#ff6b6b' })],
              }),
            ],
          }),
        ],
        else: [b('game.pop', { t: 'Build on the green areas', w: 'mouse', c: '#cccccc' })],
      }),
    ],
  );
}

/** Waves: every stage spawns more often, and red enemies join. Surviving to the end wins. */
export function spawnerProgram(): BlockProgram {
  const every = (n: number, a: number, z: number, ...blocks: BlockNode[]) => [b('events.timer', { n, a, b: z }), ...blocks];
  const spawn = (s: string) => b('game.spawn', { s, w: 'here' });
  return program(
    [],
    every(2.5, 0, 60, spawn('Yellow')),
    every(1.6, 60, 120, spawn('Yellow')),
    every(6, 60, 120, spawn('Red')),
    every(1.1, 120, SURVIVE - 5, spawn('Yellow')),
    every(3.5, 120, SURVIVE - 5, spawn('Red')),
    [b('events.at', { t: SURVIVE }), b('game.win')],
    [
      b('events.start'),
      b('control.forever', {}, {
        do: [
          b('looks.hud', {
            t: b('op.join', { a: 'Survive! ', b: b('op.join', { a: b('op.math', { f: 'ceil', n: b('op.sub', { a: SURVIVE, b: b('sensing.time') }) }), b: ' s left' }) }),
            x: 10,
            y: -58,
          }),
        ],
      }),
    ],
  );
}

// The project ------------------------------------------------------------------

function projectile(name: string, props: Partial<ProjectileAsset>): ProjectileAsset {
  return Object.assign(createProjectileAsset(name), { color: '#ffffff' }, props);
}

export function createTowerDefenceProject(): Project {
  const bullet = projectile('Bullet', { radius: 3, speed: 420, damage: 1, lifetime: 0.5 });
  const bomb = projectile('Bomb', { radius: 5, speed: 260, damage: 2, lifetime: 0.8, blast: 40 });

  const yellow = blockActor('Yellow', '#ffd84d', 8, 'enemy', enemyProgram(3, 70, 5));
  const red = blockActor('Red', '#ff5a4d', 11, 'enemy', enemyProgram(10, 45, 12));
  const green = blockActor('Green', '#3fb950', 12, 'tower', towerProgram('Bullet', 110, 0.4));
  const blue = blockActor('Blue', '#4c8dff', 12, 'tower', towerProgram('Bomb', 150, 1.2));
  const base = blockActor('Base', '#f0f0f0', 16, 'base', baseProgram(10));
  const shop = blockActor('Shop', '#8b949e', 10, 'shop', shopProgram());
  const spawner = blockActor('Spawner', '#6e7681', 10, 'spawner', spawnerProgram());

  const map = createLevelScene('Map', 'topdown');
  map.gridSize = G;
  map.background = '#121a14';
  const ground = Object.assign(createBlock({ kind: 'rect', w: W, h: H }, W / 2, H / 2), { name: 'Grass', color: '#3c7a46', solid: false });
  const place = (s: ActorScene, x: number, y: number): InstanceEntity => createInstance(s, x, y);
  const road = Object.assign(createPath('Road', ROAD), { color: '#c9a86a', width: 28 });
  const zones = BUILD_AREAS.map(([x0, y0, x1, y1]) =>
    Object.assign(createZone('Build', [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]), { color: '#7ee787' }),
  );
  const last = ROAD[ROAD.length - 1];
  map.entities.push(
    ground,
    ...zones,
    road,
    place(spawner, SPAWNER_AT.x, SPAWNER_AT.y),
    place(base, last.x, last.y),
    place(shop, -48, H - 48),
    place(green, 368, 176),
  );

  return {
    version: 4,
    name: 'Tower Defence',
    assets: [bullet, bomb],
    scenes: [map, yellow, red, green, blue, base, shop, spawner],
    mainSceneId: map.id,
    // Taps build towers; no joystick needed.
    touch: { show: 'never' },
  };
}
