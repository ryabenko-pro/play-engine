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

export interface HasBody {
  collider: BodyShape;
}

export interface SpriteVisual {
  spriteId: string | null;
  spriteScale: number;
  /** Extra vertical screen offset of the sprite. */
  spriteOffsetY: number;
}

export interface Scripted {
  /** TypeScript module source: exports `props`, `init`, `update`, `onHit`. */
  script: string;
}

/** Look & feel modifiers. A form scene sets these to change how its container looks and fits. */
export interface Effects {
  /** Size factor for the sprite and every collider (1 = as authored). */
  scale: number;
  /** Afterimages left behind while moving (0 = off). */
  trail: number;
  /** Squash-and-stretch deformation (0 = off, 0.1 = strong). */
  wobble: number;
}

export interface FiresProjectiles {
  projectileId: string | null;
}

// ---------------------------------------------------------------------------
// States: pure data (animation + optional collider). Code switches between them.
// ---------------------------------------------------------------------------

export interface PlaysAnimation {
  animation: string;
}

/** Collider shape placed relative to the actor position (x offset is mirrored with facing). */
export interface PlacedBody {
  shape: BodyShape;
  offsetX: number;
  offsetY: number;
}

export interface BodyOverride {
  /** Replaces the actor's collider while in this state (e.g. lying down). null = use the body collider. */
  body: PlacedBody | null;
}

export interface ActorState extends Named, PlaysAnimation, BodyOverride {}

export interface StateSet {
  initialState: string;
  states: ActorState[];
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface EntityBase extends Identifiable, Named, Positioned, Tagged {}

export interface BlockEntity extends EntityBase, Rotatable, Shaped, Colored, Solid, Extruded, Textured, HasKinds {
  type: 'block';
}

// ---------------------------------------------------------------------------
// Forms: an actor is a container that can swap in another actor scene
// (look, states, colliders, effects, prop overrides, extra hooks).
// ---------------------------------------------------------------------------

export interface SceneRef {
  sceneId: string;
}

/** A named form of a container actor, implemented by an actor scene. */
export interface FormRef extends Named, SceneRef {}

export interface HasForms {
  /** Forms scripts can switch to with self.setForm(name). The actor's own look is the form 'base'. */
  forms: FormRef[];
}

// ---------------------------------------------------------------------------
// Interactions: what things are (kinds), what they give off (elements), timed
// conditions (statuses) and the rules between them (reactions). Project-wide data
// the engine applies every step; scripts react through hooks.
// ---------------------------------------------------------------------------

export interface HasKinds {
  /** Names of project kinds: what this is (wood, crate, water…). A non-solid block with kinds is a zone. */
  kinds?: string[];
}

/** An element given off to everything touching the source (radius 0) or within `radius` px of it. */
export interface Emission {
  element: string;
  radius: number;
}

/** A kind of object. Physical properties are used by grid pushing and actor solidity. */
export interface KindDef extends Named, Colored {
  /** Actors of this kind block other actors (and can be stood on in side view). */
  solid: boolean;
  /** Can be pushed along the grid by an actor strong enough. */
  pushable: boolean;
  /** Weight when pushed; a push moves a chain only if its total weight ≤ the pusher's strength. */
  weight: number;
  strength: number;
  emits: Emission[];
}

/** A numeric prop multiplied while a status is active (speed × 0.5…). */
export interface PropModifier {
  prop: string;
  factor: number;
}

/** A timed condition on an actor (burning, wet, chilled…). */
export interface StatusDef extends Named, Colored {
  /** Seconds it lasts when added without a duration; each new application renews it. */
  duration: number;
  /** Damage dealt through onHit every `interval` seconds (0 = none), tagged with `element`. */
  damage: number;
  interval: number;
  element: string;
  emits: Emission[];
  modifiers: PropModifier[];
}

/**
 * When `element` reaches an actor that is / has `target` (a kind, a status, or 'any'):
 * add / remove a status, burst particles. With `stop`, later reactions to the same element are skipped.
 */
export interface Reaction {
  element: string;
  target: string;
  add: string;
  remove: string;
  /** Particle colour, '' = none. */
  burst: string;
  stop: boolean;
}

export interface Interactions {
  elements: string[];
  kinds: KindDef[];
  statuses: StatusDef[];
  /** Checked in order for every element reaching an actor. */
  reactions: Reaction[];
}

// ---------------------------------------------------------------------------
// Blocks: a Scratch-like program the editor compiles into `script`.
// The runtime never reads it; it only runs the generated TypeScript.
// ---------------------------------------------------------------------------

/** What fills a block's slot: a typed literal or a plugged-in reporter block. */
export type BlockArg = string | number | boolean | BlockNode;

export interface BlockNode {
  id: string;
  /** Catalog entry, e.g. 'motion.changeX'. */
  op: string;
  args: Record<string, BlockArg>;
  /** Contents of a C-block's mouths, by mouth name ('do', 'else'). */
  stacks?: Record<string, BlockNode[]>;
}

/** Blocks snapped together, placed on the workspace. Loose stacks without a hat don't run. */
export interface BlockStack {
  x: number;
  y: number;
  blocks: BlockNode[];
}

/**
 * A variable (`self.data[name]`), with `global` a game variable shared by every actor
 * (`world.vars[name]`), or with `prop` an exported prop tunable per instance.
 */
export interface BlockVariable {
  name: string;
  value: PropValue;
  prop: boolean;
  global?: boolean;
  /** Game variables: shown on screen while playing (like a Scratch variable monitor). */
  show?: boolean;
}

export interface BlockProgram {
  vars: BlockVariable[];
  stacks: BlockStack[];
}

export interface BlockScripted {
  /** When present, the actor is edited as blocks and `script` is generated from them. */
  blocks?: BlockProgram;
}

/** Everything an actor scene defines. Behaviour lives entirely in `script`. */
export interface ActorDef extends Tagged, HasKinds, HasBody, Colored, SpriteVisual, Effects, StateSet, Scripted, BlockScripted, HasForms {}

/** Values of a script's exported `props`. */
export type PropValue = number | string | boolean;
export type PropValues = Record<string, PropValue>;

export interface PropOverrides {
  /** Per-instance values for the script's exported props. */
  props: PropValues;
}

export interface InitialForm {
  /** Form the actor starts in (absent / 'base' = its own look). */
  form?: string;
}

/**
 * A scene placed in a level: an actor scene (hero, NPC, pickup…) or another level
 * (a room in a building, a building in a world), whose contents become part of this level.
 */
export interface InstanceEntity extends EntityBase, SceneRef, PropOverrides, InitialForm {
  type: 'instance';
}

/** A placed projectile; it starts flying along `rotation` when the game starts. */
export interface ProjectileEntity extends EntityBase, Rotatable, FiresProjectiles {
  type: 'projectile';
}

/**
 * A line drawn on the map (a road, a river): scripts move along it with followPath(name).
 * Points are relative to (x, y), which is the first point when drawn.
 */
export interface PathEntity extends EntityBase, Colored {
  type: 'path';
  points: Positioned[];
  /** Drawn width in px. */
  width: number;
  /** Drawn while playing (the editor always shows it). */
  visible: boolean;
}

/**
 * A named area of the map. Scripts ask whether a point is inside it (where towers may be
 * built, where a hero may walk). Points (a polygon) are relative to (x, y).
 */
export interface ZoneEntity extends EntityBase, Colored {
  type: 'zone';
  points: Positioned[];
  /** Drawn while playing (the editor always shows it). */
  visible: boolean;
}

export type Entity = BlockEntity | InstanceEntity | ProjectileEntity | PathEntity | ZoneEntity;
export type EntityType = Entity['type'];

/** A resolved actor: instance placement + scene definition (tags merged). */
export interface ActorEntity extends EntityBase, ActorDef, PropOverrides, InitialForm {
  sceneId: string;
}

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
  /** Splash radius: on impact every other actor within it is hit too (0 / absent = none). */
  blast?: number;
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

export interface SceneBase extends Identifiable, Named {}

/** A world, building or room: blocks, projectiles and instances of actor scenes and of other levels. */
export interface LevelScene extends SceneBase, SceneSettings {
  kind: 'level';
  entities: Entity[];
}

export interface PreviewSettings {
  /** How the actor is previewed and play-tested in its own editor. */
  previewView: ViewMode;
}

/** A reusable actor (hero, NPC, trap, pickup…), edited in isolation and instanced into levels. */
export interface ActorScene extends SceneBase, PreviewSettings {
  kind: 'actor';
  actor: ActorDef;
}

export type Scene = LevelScene | ActorScene;
export type SceneKind = Scene['kind'];

export interface Project extends Named {
  version: 4;
  assets: Asset[];
  scenes: Scene[];
  /** The level the standalone player starts with. */
  mainSceneId: string;
  /** Kinds, elements, statuses and reactions (absent = none). */
  interactions?: Interactions;
  /** On-screen controls for touch screens (absent = a joystick and one button). */
  touch?: TouchLayout;
}

/** An on-screen button: holding it holds a key, so scripts read it with input.isDown / pressed. */
export interface TouchButton {
  /** KeyboardEvent.code it stands for, e.g. 'Space', 'KeyJ'. */
  key: string;
  /** Short text on the button (default: A, B, C…). */
  label?: string;
  color?: string;
}

export interface TouchLayout {
  /** When to show the controls: on touch screens (default), always (testing with a mouse), or never. */
  show?: 'auto' | 'always' | 'never';
  /** Virtual joystick on the left half of the screen (default true); scripts read input.stick. */
  stick?: boolean;
  /** The joystick also holds the arrow keys, so keyboard scripts work unchanged (default true). */
  arrows?: boolean;
  /** Buttons at the bottom right; the first one is the biggest (default: one button for Space). */
  buttons?: TouchButton[];
}
