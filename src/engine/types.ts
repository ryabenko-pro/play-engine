/**
 * Project data model. Everything here is plain JSON-serializable data.
 *
 * Entities and assets are composed from small, single-purpose interfaces so that
 * systems (physics, rendering, AI, editor) depend only on the slice they use.
 */

export type ViewMode = 'side' | 'topdown' | 'isometric';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface RectShape {
  kind: 'rect';
  w: number;
  h: number;
}

export interface CircleShape {
  kind: 'circle';
  r: number;
}

export interface LineShape {
  kind: 'line';
  /** End point relative to the entity position (which is the start point). */
  x2: number;
  y2: number;
  thickness: number;
}

export type ShapeDef = RectShape | CircleShape | LineShape;
export type BodyShape = RectShape | CircleShape;

// ---------------------------------------------------------------------------
// Small capability interfaces
// ---------------------------------------------------------------------------

export interface Identifiable {
  id: string;
}

export interface Named {
  name: string;
}

export interface Positioned {
  x: number;
  y: number;
}

export interface Rotatable {
  /** Degrees, clockwise (y points down). */
  rotation: number;
}

export interface Tagged {
  /** Comma-separated tags, usable from scripts. */
  tags: string;
}

export interface Colored {
  color: string;
}

export interface Shaped {
  shape: ShapeDef;
}

export interface Solid {
  /** Blocks movement of characters and projectiles. */
  solid: boolean;
}

export interface Extruded {
  /** Wall height in pixels, only visible in isometric view. */
  height: number;
}

export interface Textured {
  textureId: string | null;
}

export interface Teamed {
  /** Projectiles don't hurt members of the same team. */
  team: string;
}

export interface HasBody {
  collider: BodyShape;
}

export interface SpriteVisual {
  spriteId: string | null;
  spriteScale: number;
  /** Extra vertical screen offset, e.g. to stand sprites on their feet in isometric view. */
  spriteOffsetY: number;
}

export interface AnimationSet {
  animIdle: string;
  animRun: string;
  animJump: string;
}

export interface Mobile {
  speed: number;
  /** Only used in side view. */
  jumpSpeed: number;
}

export interface Mortal {
  maxHealth: number;
}

export type ControlMode = 'player' | 'npc';

export interface Controllable {
  control: ControlMode;
  /** Seconds without input before the behavior takes over a player character. 0 = never. */
  idleTakeover: number;
}

export type BehaviorKind = 'none' | 'patrol' | 'wander' | 'chase' | 'script';

export interface Behaving {
  behavior: BehaviorKind;
  /** Patrol distance / wander radius / sight range, depending on behavior. */
  behaviorRange: number;
  /** TypeScript source, used when behavior is 'script'. */
  script: string;
}

export interface FiresProjectiles {
  projectileId: string | null;
}

export interface Armed extends FiresProjectiles {
  fireCooldown: number;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface EntityBase extends Identifiable, Named, Positioned, Tagged {}

export interface BlockEntity extends EntityBase, Rotatable, Shaped, Colored, Solid, Extruded, Textured {
  type: 'block';
}

export interface CharacterEntity
  extends EntityBase,
    Teamed,
    HasBody,
    Colored,
    SpriteVisual,
    AnimationSet,
    Mobile,
    Mortal,
    Controllable,
    Behaving,
    Armed {
  type: 'character';
}

/** A projectile placed in the scene; it starts flying along `rotation` when the game starts. */
export interface ProjectileEntity extends EntityBase, Rotatable, Teamed, FiresProjectiles {
  type: 'projectile';
}

export type Entity = BlockEntity | CharacterEntity | ProjectileEntity;
export type EntityType = Entity['type'];

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetBase extends Identifiable, Named {}

export interface ImageSource {
  /** URL or data-URL. */
  src: string;
  width: number;
  height: number;
}

export interface SpriteSheet {
  imageId: string | null;
  frameW: number;
  frameH: number;
  /** Pivot inside a frame, 0..1. */
  originX: number;
  originY: number;
}

export interface SpriteAnim {
  name: string;
  /** Frame list like "0-3, 5, 7-6". */
  frames: string;
  fps: number;
  loop: boolean;
}

export interface Animations {
  animations: SpriteAnim[];
}

export interface Ballistics {
  radius: number;
  speed: number;
  /** Seconds before the projectile disappears. */
  lifetime: number;
  /** Multiplier of scene gravity (side view only). */
  gravityScale: number;
  /** How many times it bounces off solids before dying. */
  bounces: number;
}

export interface Damaging {
  damage: number;
}

export interface ImageAsset extends AssetBase, ImageSource {
  type: 'image';
}

export interface SpriteAsset extends AssetBase, SpriteSheet, Animations {
  type: 'sprite';
}

export interface ProjectileAsset extends AssetBase, Ballistics, Damaging, Colored {
  type: 'projectile';
  spriteId: string | null;
}

export type Asset = ImageAsset | SpriteAsset | ProjectileAsset;
export type AssetType = Asset['type'];
export type AssetOf<T extends AssetType> = Extract<Asset, { type: T }>;

// ---------------------------------------------------------------------------
// Scenes & project
// ---------------------------------------------------------------------------

export interface SceneSettings {
  view: ViewMode;
  /** Pixels / s², side view only. */
  gravity: number;
  background: string;
  gridSize: number;
}

export interface Scene extends Identifiable, Named, SceneSettings {
  entities: Entity[];
}

export interface Project extends Named {
  version: 1;
  assets: Asset[];
  scenes: Scene[];
  mainSceneId: string;
}
