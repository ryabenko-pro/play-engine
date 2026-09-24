import type {
  BlockEntity,
  CharacterEntity,
  ControlMode,
  ImageAsset,
  Project,
  ProjectileAsset,
  ProjectileEntity,
  Scene,
  ShapeDef,
  SpriteAsset,
  ViewMode,
} from './types';
import { uid } from './util';

export const DEFAULT_SCRIPT = `// TypeScript. Runs every frame for this character.
// self / world / intent / memory are typed: see ScriptSelf, ScriptWorld, ScriptIntent.
const t = (memory.t = ((memory.t as number) ?? 0) + dt);
intent.moveX = Math.sin(t) > 0 ? 1 : -1;

const target = world.nearest();
if (target && target.distance < 200) {
  intent.aimX = Math.sign(target.x - self.x);
  intent.shoot = true;
}
if (self.grounded && t % 2 < dt) intent.jump = true;
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

export function createCharacter(control: ControlMode, x: number, y: number): CharacterEntity {
  const player = control === 'player';
  return {
    id: uid('c_'),
    type: 'character',
    name: player ? 'Player' : 'NPC',
    x,
    y,
    tags: '',
    control,
    team: player ? 'player' : 'enemy',
    collider: { kind: 'rect', w: 20, h: 38 },
    color: player ? '#4da3ff' : '#ff6b5a',
    spriteId: null,
    spriteScale: 1.5,
    spriteOffsetY: 0,
    animIdle: 'idle',
    animRun: 'run',
    animJump: 'jump',
    speed: player ? 220 : 110,
    jumpSpeed: 640,
    maxHealth: player ? 5 : 3,
    behavior: player ? 'wander' : 'patrol',
    behaviorRange: 160,
    script: DEFAULT_SCRIPT,
    idleTakeover: 0,
    projectileId: null,
    fireCooldown: player ? 0.3 : 1.2,
  };
}

export function createProjectileEntity(x: number, y: number, projectileId: string | null): ProjectileEntity {
  return { id: uid('p_'), type: 'projectile', name: 'Projectile', x, y, rotation: 0, tags: '', team: '', projectileId };
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
  };
}

export function createScene(name: string, view: ViewMode): Scene {
  return { id: uid('s_'), name, view, gravity: 1800, background: '#1b1f27', gridSize: 32, entities: [] };
}

export function createEmptyProject(): Project {
  const scene = createScene('Main', 'side');
  return { version: 1, name: 'Untitled', assets: [], scenes: [scene], mainSceneId: scene.id };
}
