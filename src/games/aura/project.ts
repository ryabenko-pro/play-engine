import { createActorScene, createBlock, createEmptyProject, createInstance, createLevelScene } from '../../engine/factory';
import { type StubKind, stubSprite } from '../../engine/stubs';
import type { ActorDef, ActorScene, Asset, Entity, InstanceEntity, Project, PropValues } from '../../engine/types';
import { ENEMY_SCRIPT, HERO_SCRIPT, ORB_SCRIPT, SCENERY_SCRIPT } from './scripts';

const W = 960;
const H = 720;
const WALL = 32;

/**
 * Aura, built in code: a top-down arena where every look is a generated stub
 * (creatures, items, props, the wall tile) and the hero's aura is drawn by its script.
 */
export function createAuraProject(): Project {
  const assets: Asset[] = [];
  const stub = (name: string, kind: StubKind, opts: { size?: number; color?: string; label?: string } = {}) => {
    const s = stubSprite(name, { kind, ...opts });
    assets.push(s.image, s.sprite);
    return s;
  };
  const actor = (name: string, script: string, kind: StubKind, def: Partial<ActorDef>, opts: { size?: number; color?: string; label?: string } = {}): ActorScene => {
    const s = createActorScene(name);
    s.previewView = 'topdown';
    const art = stub(name, kind, opts);
    Object.assign(s.actor, { script, spriteId: art.sprite.id, color: art.color, spriteScale: 1.5, collider: { kind: 'circle', r: 12 } }, def);
    return s;
  };

  const hero = actor('Hero', HERO_SCRIPT, 'creature', { tags: 'player' }, { color: '#4fd1c5' });
  // Three enemies, three different looks — only their names (and props) differ.
  const slime = actor('Slime', ENEMY_SCRIPT, 'creature', { tags: 'enemy' });
  const bat = actor('Bat', ENEMY_SCRIPT, 'creature', { tags: 'enemy', spriteScale: 1.2, collider: { kind: 'circle', r: 9 } });
  const golem = actor('Golem', ENEMY_SCRIPT, 'creature', { tags: 'enemy', spriteScale: 2, collider: { kind: 'circle', r: 17 } });
  const orb = actor('Orb', ORB_SCRIPT, 'item', { tags: 'orb', spriteScale: 1, collider: { kind: 'circle', r: 10 } }, { label: '' });
  const tree = actor('Tree', SCENERY_SCRIPT, 'prop', { tags: 'scenery', spriteScale: 2 }, { label: '' });
  const rock = actor('Rock', SCENERY_SCRIPT, 'prop', { tags: 'scenery' }, { label: '' });
  const wallTile = stub('Wall', 'tile', { label: '' });

  const level = createLevelScene('Arena', 'topdown');
  level.background = '#15171e';
  level.gridSize = 32;
  const place = (scene: ActorScene, x: number, y: number, props: PropValues = {}): InstanceEntity => Object.assign(createInstance(scene, x, y), { props });
  const wall = (x: number, y: number, w: number, h: number): Entity => {
    const b = createBlock({ kind: 'rect', w, h }, x + w / 2, y + h / 2);
    b.name = 'Wall';
    b.color = '#3a4150';
    b.textureId = wallTile.image.id;
    return b;
  };

  level.entities = [
    wall(0, 0, W, WALL),
    wall(0, H - WALL, W, WALL),
    wall(0, WALL, WALL, H - 2 * WALL),
    wall(W - WALL, WALL, WALL, H - 2 * WALL),
    wall(256, 192, 64, 64),
    wall(640, 192, 64, 64),
    wall(256, 464, 64, 64),
    wall(640, 464, 64, 64),
    wall(448, 96, 64, 128),
    wall(448, 496, 64, 128),
    ...[[120, 120], [840, 600], [120, 600], [860, 130], [560, 360]].map(([x, y]) => place(tree, x, y)),
    ...[[380, 300], [600, 420], [180, 380], [780, 330]].map(([x, y]) => place(rock, x, y)),
    ...[[160, 240], [800, 240], [160, 480], [800, 480], [480, 300], [480, 420], [340, 360], [620, 300], [300, 120], [660, 620]].map(([x, y]) => place(orb, x, y)),
    place(slime, 720, 140),
    place(slime, 220, 560, { speed: 45 }),
    place(bat, 820, 400, { speed: 95, health: 1 }),
    place(bat, 140, 160, { speed: 95, health: 1 }),
    place(golem, 700, 560, { speed: 30, health: 6, sight: 160 }),
    place(hero, 400, 360),
  ];

  const base = createEmptyProject();
  return {
    ...base,
    name: 'Aura',
    assets,
    scenes: [level, hero, slime, bat, golem, orb, tree, rock],
    mainSceneId: level.id,
    touch: { buttons: [{ key: 'Space', label: 'A' }, { key: 'KeyJ', label: 'B' }] },
  };
}
