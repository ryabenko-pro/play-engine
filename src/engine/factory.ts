import type {
  PathEntity,
  Positioned,
  ZoneEntity,
  ActorDef,
  ActorScene,
  ActorState,
  BlockEntity,
  ImageAsset,
  InstanceEntity,
  LevelScene,
  Project,
  ProjectileAsset,
  ProjectileEntity,
  Scene,
  ShapeDef,
  SpriteAsset,
  StateSet,
  ViewMode,
} from './types';
import { createDefaultInteractions } from './interactions';
import { uid } from './util';

/** Starter module for a new actor: documents the lifecycle and does nothing magical. */
export const DEFAULT_SCRIPT = `// Everything this actor does is here. Types: Actor, World, Hit (see API panel).

// Exported props show up in the inspector; each instance can override them.
export const props = {
  speed: 120,
};

// Called once when the level starts.
export function init(self: Actor, world: World) {
  self.health = 1;
}

// Called every frame (dt = 1/60 s).
export function update(self: Actor, world: World, dt: number) {
  // e.g. self.vx = self.props.speed as number; self.moveAndSlide();
}

// Called when a projectile touches this actor. Return false to let it pass.
export function onHit(self: Actor, world: World, hit: Hit) {
  self.health -= hit.damage;
  if (self.health <= 0) self.destroy();
}
`;

/** Starter module for a form scene: it runs on top of its container's script. */
export const FORM_SCRIPT = `// A form: while active, it replaces the container actor's look (sprite, states,
// colliders, scale, effects) and runs on top of the container's script.

// Props here are laid over the container's props while the form is active,
// e.g. { speed: 340 } makes the container's own movement code faster.
export const props = {};

// Called every time the form becomes active.
export function init(self: Actor, world: World) {}

// Called every frame, after the container's update().
export function update(self: Actor, world: World, dt: number) {}

// Called before the container's onHit(). Return false to ignore the hit (immunity).
// export function onHit(self: Actor, world: World, hit: Hit) { return false; }
`;

const SHAPE_NAMES: Record<ShapeDef['kind'], string> = { rect: 'Rect', circle: 'Circle', line: 'Line' };

export function createBlock(shape: ShapeDef, x: number, y: number): BlockEntity {
  return {
    id: uid('b_'),
    type: 'block',
    name: SHAPE_NAMES[shape.kind],
    x,
    y,
    rotation: 0,
    tags: '',
    shape,
    color: '#5a6b7d',
    solid: true,
    height: 0,
    textureId: null,
  };
}

export function createState(name: string, animation = name): ActorState {
  return { name, animation, body: null };
}

export function createDefaultStates(): StateSet {
  return {
    initialState: 'idle',
    states: ['idle', 'run', 'jump', 'fall', 'attack', 'hurt', 'dead'].map((n) => createState(n)),
  };
}

export function createActorDef(): ActorDef {
  return {
    tags: '',
    collider: { kind: 'rect', w: 20, h: 38 },
    color: '#8a93a3',
    spriteId: null,
    spriteScale: 1.5,
    spriteOffsetY: 0,
    scale: 1,
    trail: 0,
    wobble: 0,
    script: DEFAULT_SCRIPT,
    forms: [],
    ...createDefaultStates(),
  };
}

export function createActorScene(name: string): ActorScene {
  return { id: uid('as_'), kind: 'actor', name, previewView: 'side', actor: createActorDef() };
}

export function createLevelScene(name: string, view: ViewMode): LevelScene {
  return { id: uid('s_'), kind: 'level', name, view, gravity: 1800, background: '#1b1f27', gridSize: 32, entities: [] };
}

/** An instance of an actor scene, or of a level (a room placed in a building…). */
export function createInstance(scene: Scene, x: number, y: number): InstanceEntity {
  return { id: uid('i_'), type: 'instance', name: scene.name, x, y, tags: '', sceneId: scene.id, props: {} };
}

export function createProjectileEntity(x: number, y: number, projectileId: string | null): ProjectileEntity {
  return { id: uid('p_'), type: 'projectile', name: 'Projectile', x, y, rotation: 0, tags: '', projectileId };
}

/** A path through world points; it is placed at the first point (the others are relative to it). */
export function createPath(name: string, points: readonly Positioned[]): PathEntity {
  const o = points[0] ?? { x: 0, y: 0 };
  return { id: uid('pa_'), type: 'path', name, x: o.x, y: o.y, tags: '', color: '#c9a86a', width: 28, visible: true, points: points.map((p) => ({ x: p.x - o.x, y: p.y - o.y })) };
}

/** A zone with a polygon through world points, placed at the first point. */
export function createZone(name: string, points: readonly Positioned[]): ZoneEntity {
  const o = points[0] ?? { x: 0, y: 0 };
  return { id: uid('z_'), type: 'zone', name, x: o.x, y: o.y, tags: '', color: '#4fb06d', visible: true, points: points.map((p) => ({ x: p.x - o.x, y: p.y - o.y })) };
}

export function createImageAsset(name: string, src: string, width: number, height: number): ImageAsset {
  return { id: uid('img_'), type: 'image', name, src, width, height };
}

export function createSpriteAsset(name: string, image: ImageAsset | null): SpriteAsset {
  const size = image ? Math.min(image.width, image.height) : 32;
  const cols = image ? Math.max(1, Math.floor(image.width / size)) : 1;
  return {
    id: uid('spr_'),
    type: 'sprite',
    name,
    imageId: image?.id ?? null,
    frameW: size,
    frameH: size,
    originX: 0.5,
    originY: 0.5,
    animations: [{ name: 'idle', frames: cols > 1 ? `0-${cols - 1}` : '0', fps: 8, loop: true }],
  };
}

export function createProjectileAsset(name = 'Projectile'): ProjectileAsset {
  return {
    id: uid('prj_'),
    type: 'projectile',
    name,
    spriteId: null,
    color: '#ffd166',
    radius: 5,
    speed: 520,
    lifetime: 1.6,
    gravityScale: 0,
    bounces: 0,
    damage: 1,
    blast: 0,
  };
}

export function createEmptyProject(): Project {
  const level = createLevelScene('Main', 'side');
  return { version: 4, name: 'Untitled', assets: [], scenes: [level, createActorScene('Actor')], mainSceneId: level.id, interactions: createDefaultInteractions() };
}
