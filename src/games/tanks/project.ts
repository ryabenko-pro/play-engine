import { createActorScene, createBlock, createInstance, createLevelScene, createProjectileAsset, createState } from '../../engine/factory';
import type { ActorDef, ActorScene, Asset, Entity, InstanceEntity, Project, ProjectileAsset, PropValues } from '../../engine/types';
import {
  BANNERS,
  BONUS_KINDS,
  DIRECTIONS,
  type TankPalette,
  bannerSheet,
  baseSheet,
  bonusSheet,
  brickSheet,
  steelSheet,
  tankSheet,
  waterSheet,
} from './sprites';
import {
  BANNER_SCRIPT,
  BASE_SCRIPT,
  BONUS_SCRIPT,
  BRICK_SCRIPT,
  DIRECTOR_SCRIPT,
  ENEMY_ARMOR_SCRIPT,
  ENEMY_FAST_SCRIPT,
  ENEMY_POWER_SCRIPT,
  ENEMY_SCRIPT,
  PLAYER_SCRIPT,
  PLAYER_SHIELD_SCRIPT,
  SPAWN_SCRIPT,
  STEEL_SCRIPT,
  WATER_SCRIPT,
} from './scripts';

/** One map tile is 32 px (a tank fits in it); bricks, steel and water come in 16 px cells. */
export const TILE = 32;
const CELL = TILE / 2;

/**
 * Stage map, one character per tile:
 *   .  empty        #  brick        @  steel        ~  water
 *   t b l r  brick top / bottom / left / right half
 *   p q      brick bottom-left / bottom-right quarter
 *   E  enemy spawn  P  player       B  base
 */
export const STAGE_MAP = [
  'E.....E.....E',
  '.#.#.#.#.#.#.',
  '.#.#.#@#.#.#.',
  '.#.#.#.#.#.#.',
  '.#.#.t.t.#.#.',
  '....t...t....',
  '@.bb..~..bb.@',
  '....#...#....',
  '.#.#.#b#.#.#.',
  '.#.#.#.#.#.#.',
  '.#.#.....#.#.',
  '.....qbp.....',
  '....PrBl.....',
];

/** Which 16 px cells of a tile are filled: [top-left, top-right, bottom-left, bottom-right]. */
const CELLS: Record<string, [number, number, number, number]> = {
  '#': [1, 1, 1, 1],
  '@': [1, 1, 1, 1],
  '~': [1, 1, 1, 1],
  t: [1, 1, 0, 0],
  b: [0, 0, 1, 1],
  l: [1, 0, 1, 0],
  r: [0, 1, 0, 1],
  p: [0, 0, 1, 0],
  q: [0, 0, 0, 1],
};

const PLAYER: TankPalette = { body: '#e8c547', dark: '#7a5c12', light: '#fff1a8' };
const ENEMIES: Record<string, TankPalette> = {
  base: { body: '#b8c0c8', dark: '#4a5058', light: '#eef2f6' },
  fast: { body: '#6fd0dc', dark: '#1d5c66', light: '#d4f7fb' },
  power: { body: '#e0785a', dark: '#6e2716', light: '#ffd2c2' },
  armor: { body: '#6fbf5a', dark: '#2a5a1f', light: '#d2f5c8' },
};

function actorScene(name: string, script: string, def: Partial<ActorDef>): ActorScene {
  const s = createActorScene(name);
  s.previewView = 'topdown';
  Object.assign(s.actor, { script, spriteScale: 1, collider: { kind: 'circle', r: 6 } }, def);
  return s;
}

/** States that just play the animation of the same name. */
function states(names: readonly string[]): Pick<ActorDef, 'states' | 'initialState'> {
  return { initialState: names[0], states: names.map((n) => createState(n)) };
}

const TANK_STATES = [...DIRECTIONS.flatMap((d) => [d, `${d}-move`]), 'spawn', 'explode'];

/** A form of `container` with its own sprite and script (props, hooks). */
function formScene(container: ActorScene, form: string, script: string, spriteId: string): ActorScene {
  const s = actorScene(`${container.name} · ${form[0].toUpperCase()}${form.slice(1)}`, script, {
    ...states(TANK_STATES),
    collider: { ...container.actor.collider },
    spriteId,
  });
  container.actor.forms.push({ name: form, sceneId: s.id });
  return s;
}

function place(scene: ActorScene, x: number, y: number, name = scene.name, props: PropValues = {}): InstanceEntity {
  return Object.assign(createInstance(scene, x, y), { name, props });
}

function shell(name: string, props: Partial<ProjectileAsset>): ProjectileAsset {
  return Object.assign(createProjectileAsset(name), { radius: 3, speed: 260, lifetime: 2, damage: 1, color: '#ffffff' }, props);
}

/** Tanks (Battle City style): defend the base, destroy 20 enemy tanks per stage. */
export function createTanksProject(): Project {
  const arena = STAGE_MAP.length * TILE;
  const assets: Asset[] = [];
  const sprite = (pair: [Asset, Asset]) => {
    assets.push(...pair);
    return pair[1].id;
  };

  // --- Actor scenes ---------------------------------------------------------------
  const tank = (name: string, script: string, tags: string, pal: TankPalette) =>
    actorScene(name, script, { tags, ...states(TANK_STATES), collider: { kind: 'circle', r: 13 }, spriteId: sprite(tankSheet(name, pal)) });

  const director = actorScene('Director', DIRECTOR_SCRIPT, { tags: 'director', collider: { kind: 'circle', r: 4 } });
  const player = tank('Player', PLAYER_SCRIPT, 'player, tank', PLAYER);
  const shield = formScene(player, 'shield', PLAYER_SHIELD_SCRIPT, sprite(tankSheet('Player · Shield', PLAYER, true)));
  const enemy = tank('Enemy', ENEMY_SCRIPT, 'enemy, tank', ENEMIES.base);
  const enemyForms = [
    formScene(enemy, 'fast', ENEMY_FAST_SCRIPT, sprite(tankSheet('Enemy · Fast', ENEMIES.fast))),
    formScene(enemy, 'power', ENEMY_POWER_SCRIPT, sprite(tankSheet('Enemy · Power', ENEMIES.power))),
    formScene(enemy, 'armor', ENEMY_ARMOR_SCRIPT, sprite(tankSheet('Enemy · Armor', ENEMIES.armor))),
  ];
  const brick = actorScene('Brick', BRICK_SCRIPT, { tags: 'brick', ...states(['idle']), spriteId: sprite(brickSheet()) });
  const steel = actorScene('Steel', STEEL_SCRIPT, { tags: 'steel', ...states(['idle']), spriteId: sprite(steelSheet()) });
  const water = actorScene('Water', WATER_SCRIPT, { tags: 'water', ...states(['idle']), spriteId: sprite(waterSheet()) });
  const base = actorScene('Base', BASE_SCRIPT, { tags: 'base', ...states(['idle', 'dead']), collider: { kind: 'circle', r: 14 }, spriteId: sprite(baseSheet()) });
  const spawn = actorScene('Spawn point', SPAWN_SCRIPT, { tags: 'spawn', collider: { kind: 'circle', r: 13 }, color: '#7fe6ff' });
  const bonus = actorScene('Bonus', BONUS_SCRIPT, {
    tags: 'bonus',
    ...states(BONUS_KINDS),
    collider: { kind: 'circle', r: 8 },
    spriteId: sprite(bonusSheet(PLAYER)),
    spriteScale: 1.5,
  });
  // Drawn far below the arena (so it sorts above everything) and shifted up to its centre.
  const bannerY = arena + 500;
  const banner = actorScene('Banner', BANNER_SCRIPT, {
    tags: 'banner',
    ...states(BANNERS),
    collider: { kind: 'circle', r: 1 },
    spriteId: sprite(bannerSheet()),
    spriteOffsetY: arena / 2 - bannerY,
  });

  const shells = [shell('Shell', {}), shell('Fast shell', { speed: 420, color: '#ffe066' }), shell('Heavy shell', { speed: 420, radius: 4, damage: 2, color: '#ff8c1a' })];

  // --- The stage ------------------------------------------------------------------
  const level = createLevelScene('Stage', 'topdown');
  level.background = '#000000';
  level.gridSize = CELL;
  const props = { arena };
  // The Director goes first: every actor looks it up each frame.
  const entities: Entity[] = [place(director, arena / 2, arena / 2)];
  const terrain: Record<string, ActorScene> = { '@': steel, '~': water };
  STAGE_MAP.forEach((row, ty) =>
    [...row].forEach((ch, tx) => {
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (ch === 'E') entities.push(place(spawn, x, y));
      if (ch === 'E' && tx === 0) entities.push(...[0, 1, 2, 3].map((i) => place(enemy, x, y, `Enemy ${i + 1}`, props)));
      if (ch === 'P') entities.push(place(player, x, y, 'Player', props));
      if (ch === 'B') entities.push(place(base, x, y));
      const cells = CELLS[ch];
      if (!cells) return;
      cells.forEach((on, i) => {
        if (!on) return;
        const cx = tx * TILE + (i % 2) * CELL + CELL / 2;
        const cy = ty * TILE + Math.floor(i / 2) * CELL + CELL / 2;
        entities.push(place(terrain[ch] ?? brick, cx, cy));
      });
    }),
  );
  entities.push(place(bonus, arena / 2, arena / 2, 'Bonus', props), place(banner, arena / 2, bannerY));

  // Grey frame around the arena: solid, so shells burst on it. Tanks keep inside by themselves.
  const T = 400;
  const frame = { color: '#636363', name: 'Frame' };
  entities.push(
    Object.assign(createBlock({ kind: 'rect', w: arena + 2 * T, h: T }, arena / 2, -T / 2), frame),
    Object.assign(createBlock({ kind: 'rect', w: arena + 2 * T, h: T }, arena / 2, arena + T / 2), frame),
    Object.assign(createBlock({ kind: 'rect', w: T, h: arena }, -T / 2, arena / 2), frame),
    Object.assign(createBlock({ kind: 'rect', w: T, h: arena }, arena + T / 2, arena / 2), frame),
  );
  level.entities = entities;

  return {
    version: 4,
    name: 'Tanks',
    assets: [...assets, ...shells],
    scenes: [level, director, player, shield, enemy, ...enemyForms, brick, steel, water, base, spawn, bonus, banner],
    mainSceneId: level.id,
  };
}
