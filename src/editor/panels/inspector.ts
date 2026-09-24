import { createSpriteAsset } from '../../engine/factory';
import type {
  Asset,
  AssetType,
  BehaviorKind,
  BlockEntity,
  CharacterEntity,
  ControlMode,
  Entity,
  ImageAsset,
  ProjectileAsset,
  ProjectileEntity,
  Scene,
  SpriteAsset,
  ViewMode,
} from '../../engine/types';
import { clone, uid } from '../../engine/util';
import { removeAsset, type AssetCache, type Observable, type ProjectReader, type ProjectWriter, type SceneSwitcher, type SelectionModel } from '../store';
import { Form, h, type Options } from '../ui';
import { spritePreview } from './sprite-preview';

export type InspectorStore = Observable & ProjectReader & ProjectWriter & SelectionModel & SceneSwitcher & AssetCache;

const BEHAVIORS: Options = [
  ['none', 'None (stand still)'],
  ['patrol', 'Patrol'],
  ['wander', 'Wander'],
  ['chase', 'Chase & attack'],
  ['script', 'Script (TypeScript)'],
];

const VIEWS: Options = [
  ['side', 'Side view'],
  ['topdown', 'Top-down'],
  ['isometric', 'Isometric'],
];

function assetOptions(store: ProjectReader, type: AssetType, noneLabel = '— none —'): Options {
  return [['', noneLabel], ...store.project.assets.filter((a) => a.type === type).map((a) => [a.id, a.name] as const)];
}

const orNull = (v: string): string | null => v || null;

export function mountInspector(root: HTMLElement, store: InspectorStore): void {
  const render = () => {
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && root.contains(active) ? active.getAttribute('data-key') : null;
    const scroll = root.scrollTop;
    root.replaceChildren(h('div', { class: 'panel-title' }, 'Inspector'));
    const sel = store.selection;
    if (!sel) sceneInspector(root, store, store.scene);
    else if (sel.kind === 'entity') {
      const e = store.entity(sel.id);
      if (e) entityInspector(root, store, e);
    } else {
      const a = store.asset(sel.id);
      if (a) assetInspector(root, store, a);
    }
    root.scrollTop = scroll;
    if (focusKey) root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  };
  store.subscribe((reason) => {
    if (reason === 'change' || reason === 'selection' || reason === 'gesture') render();
  });
  render();
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function sceneInspector(root: HTMLElement, store: InspectorStore, scene: Scene): void {
  const upd = (fn: (s: Scene) => void) =>
    store.commit((p) => {
      const s = p.scenes.find((x) => x.id === scene.id);
      if (s) fn(s);
    });
  const f = new Form(root, 'Scene');
  f.text('Name', scene.name, (v) => upd((s) => (s.name = v)));
  f.select('View', scene.view, VIEWS, (v) => upd((s) => (s.view = v as ViewMode)));
  f.num('Gravity', scene.gravity, (v) => upd((s) => (s.gravity = v)), { step: 50, hint: 'px/s², side view only' });
  f.color('Background', scene.background, (v) => upd((s) => (s.background = v)));
  f.num('Grid size', scene.gridSize, (v) => upd((s) => (s.gridSize = v)), { min: 1 });
  f.check('Main scene', store.project.mainSceneId === scene.id, (v) => v && store.commit((p) => (p.mainSceneId = scene.id)), 'Scene started by the standalone player');
  if (store.project.scenes.length > 1) {
    f.buttons([
      'Delete scene',
      () => {
        if (!confirm(`Delete scene "${scene.name}"?`)) return;
        store.commit((p) => {
          p.scenes = p.scenes.filter((s) => s.id !== scene.id);
          if (p.mainSceneId === scene.id) p.mainSceneId = p.scenes[0].id;
        });
        store.setScene(store.project.scenes[0].id);
      },
      'danger',
    ]);
  }

  const pf = new Form(root, 'Project');
  pf.text('Name', store.project.name, (v) => store.commit((p) => (p.name = v)));
  pf.note('Select an object in the viewport or the Scene tree to edit it. Tools: V select, R rect, C circle, L line, P player, N NPC, B projectile.');
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function entityInspector(root: HTMLElement, store: InspectorStore, e: Entity): void {
  const upd = <T extends Entity>(fn: (x: T) => void) =>
    store.commit(() => {
      const cur = store.entity(e.id) as T | undefined;
      if (cur) fn(cur);
    });

  const f = new Form(root, e.type === 'block' ? 'Block' : e.type === 'character' ? 'Character' : 'Projectile');
  f.text('Name', e.name, (v) => upd((x) => (x.name = v)));
  f.num('X', e.x, (v) => upd((x) => (x.x = v)));
  f.num('Y', e.y, (v) => upd((x) => (x.y = v)));
  if (e.type !== 'character') f.num('Rotation°', e.rotation, (v) => upd<BlockEntity | ProjectileEntity>((x) => (x.rotation = v)), { step: 5 });
  f.text('Tags', e.tags, (v) => upd((x) => (x.tags = v)), 'Comma-separated; visible to scripts');

  if (e.type === 'block') blockSections(root, store, e, upd);
  else if (e.type === 'character') characterSections(root, store, e, upd);
  else projectileEntitySections(root, store, e, upd);

  const actions = new Form(root, 'Actions');
  actions.buttons(
    ['Duplicate', () => duplicateEntity(store, e.id)],
    ['Delete', () => deleteEntity(store, e.id), 'danger'],
  );
}

type Updater = <T extends Entity>(fn: (x: T) => void) => void;

function blockSections(root: HTMLElement, store: InspectorStore, e: BlockEntity, upd: Updater): void {
  const s = new Form(root, 'Shape');
  const sh = e.shape;
  const shape = (fn: (b: BlockEntity) => void) => upd<BlockEntity>(fn);
  if (sh.kind === 'rect') {
    s.num('Width', sh.w, (v) => shape((b) => b.shape.kind === 'rect' && (b.shape.w = v)), { min: 1 });
    s.num('Height', sh.h, (v) => shape((b) => b.shape.kind === 'rect' && (b.shape.h = v)), { min: 1 });
  } else if (sh.kind === 'circle') {
    s.num('Radius', sh.r, (v) => shape((b) => b.shape.kind === 'circle' && (b.shape.r = v)), { min: 1 });
  } else {
    s.num('End X', sh.x2, (v) => shape((b) => b.shape.kind === 'line' && (b.shape.x2 = v)), { hint: 'Relative to start' });
    s.num('End Y', sh.y2, (v) => shape((b) => b.shape.kind === 'line' && (b.shape.y2 = v)));
    s.num('Thickness', sh.thickness, (v) => shape((b) => b.shape.kind === 'line' && (b.shape.thickness = v)), { min: 0 });
  }

  const look = new Form(root, 'Collision & look');
  look.check('Solid', e.solid, (v) => shape((b) => (b.solid = v)), 'Blocks characters and projectiles');
  look.color('Color', e.color, (v) => shape((b) => (b.color = v)));
  look.select('Texture', e.textureId ?? '', assetOptions(store, 'image'), (v) => shape((b) => (b.textureId = orNull(v))));
  look.num('Height (iso)', e.height, (v) => shape((b) => (b.height = v)), { min: 0, hint: 'Wall height in isometric view' });
}

function characterSections(root: HTMLElement, store: InspectorStore, e: CharacterEntity, upd: Updater): void {
  const ch = (fn: (c: CharacterEntity) => void) => upd<CharacterEntity>(fn);

  const c = new Form(root, 'Control');
  c.select('Controlled by', e.control, [['player', 'Player (keyboard)'], ['npc', 'NPC (behavior)']], (v) =>
    ch((x) => (x.control = v as ControlMode)),
  );
  if (e.control === 'player') {
    c.num('AI takeover (s)', e.idleTakeover, (v) => ch((x) => (x.idleTakeover = v)), {
      min: 0,
      step: 0.5,
      hint: 'After this many idle seconds the Brain drives the hero; any key returns control. 0 = never.',
    });
  }
  c.text('Team', e.team, (v) => ch((x) => (x.team = v)), "Projectiles don't hurt the same team");

  const m = new Form(root, 'Movement & health');
  m.num('Speed', e.speed, (v) => ch((x) => (x.speed = v)), { min: 0, step: 10 });
  m.num('Jump speed', e.jumpSpeed, (v) => ch((x) => (x.jumpSpeed = v)), { min: 0, step: 10, hint: 'Side view only' });
  m.num('Max health', e.maxHealth, (v) => ch((x) => (x.maxHealth = v)), { min: 1 });

  const col = new Form(root, 'Collider');
  col.select('Shape', e.collider.kind, [['rect', 'Rectangle'], ['circle', 'Circle']], (v) =>
    ch((x) => (x.collider = v === 'rect' ? { kind: 'rect', w: 20, h: 38 } : { kind: 'circle', r: 12 })),
  );
  if (e.collider.kind === 'rect') {
    col.num('Width', e.collider.w, (v) => ch((x) => x.collider.kind === 'rect' && (x.collider.w = v)), { min: 1 });
    col.num('Height', e.collider.h, (v) => ch((x) => x.collider.kind === 'rect' && (x.collider.h = v)), { min: 1 });
  } else {
    col.num('Radius', e.collider.r, (v) => ch((x) => x.collider.kind === 'circle' && (x.collider.r = v)), { min: 1 });
  }

  const vis = new Form(root, 'Visual');
  vis.color('Color', e.color, (v) => ch((x) => (x.color = v)));
  vis.select('Sprite', e.spriteId ?? '', assetOptions(store, 'sprite', '— shape only —'), (v) => ch((x) => (x.spriteId = orNull(v))));
  const sprite = store.assets.get(e.spriteId, 'sprite');
  if (sprite) {
    vis.num('Scale', e.spriteScale, (v) => ch((x) => (x.spriteScale = v)), { min: 0.1, step: 0.25 });
    vis.num('Offset Y', e.spriteOffsetY, (v) => ch((x) => (x.spriteOffsetY = v)), { hint: 'Shift the sprite vertically (screen px)' });
    const anims: Options = sprite.animations.map((a) => [a.name, a.name] as const);
    vis.select('Idle anim', e.animIdle, anims, (v) => ch((x) => (x.animIdle = v)));
    vis.select('Run anim', e.animRun, anims, (v) => ch((x) => (x.animRun = v)));
    vis.select('Jump anim', e.animJump, anims, (v) => ch((x) => (x.animJump = v)));
  }

  const brain = new Form(root, 'Brain');
  brain.note(
    e.control === 'player'
      ? 'Drives the hero only after the idle takeover time.'
      : 'NPCs ignore the keyboard; this behavior drives them.',
  );
  brain.select('Behavior', e.behavior, BEHAVIORS, (v) => ch((x) => (x.behavior = v as BehaviorKind)));
  if (e.behavior !== 'none' && e.behavior !== 'script') {
    brain.num('Range', e.behaviorRange, (v) => ch((x) => (x.behaviorRange = v)), { min: 0, step: 10, hint: 'Patrol distance / wander radius / sight' });
  }
  if (e.behavior === 'script') {
    brain.area('Script (TypeScript)', e.script, (v) => ch((x) => (x.script = v)), 14);
    brain.custom(
      h('details', { class: 'api' }, h('summary', {}, 'Script API'), h('pre', {}, SCRIPT_API_HELP)),
    );
  }

  const w = new Form(root, 'Weapon');
  w.select('Projectile', e.projectileId ?? '', assetOptions(store, 'projectile', '— unarmed —'), (v) => ch((x) => (x.projectileId = orNull(v))));
  if (e.projectileId) w.num('Cooldown (s)', e.fireCooldown, (v) => ch((x) => (x.fireCooldown = v)), { min: 0, step: 0.1 });
}

const SCRIPT_API_HELP = `self:   x y vx vy grounded hitWall facing
        name team tags health spawnX spawnY
world:  time view
        nearest(team?) → {x y name team tags distance} | null
        player()       → same | null
        log(...args)
intent: moveX moveY (-1..1)  jump  shoot  aimX aimY
dt:     seconds since last step (1/60)
memory: object kept between frames`;

function projectileEntitySections(root: HTMLElement, store: InspectorStore, e: ProjectileEntity, upd: Updater): void {
  const f = new Form(root, 'Launch');
  f.select('Projectile', e.projectileId ?? '', assetOptions(store, 'projectile'), (v) =>
    upd<ProjectileEntity>((x) => (x.projectileId = orNull(v))),
  );
  f.text('Team', e.team, (v) => upd<ProjectileEntity>((x) => (x.team = v)));
  f.note('Flies along its rotation when the game starts.');
}

export function duplicateEntity(store: ProjectReader & ProjectWriter & SelectionModel, id: string): void {
  const src = store.entity(id);
  if (!src) return;
  const copy = clone(src);
  copy.id = uid(`${src.type[0]}_`);
  copy.x += store.scene.gridSize;
  copy.y += store.scene.gridSize;
  store.commit(() => store.scene.entities.push(copy));
  store.select({ kind: 'entity', id: copy.id });
}

export function deleteEntity(store: ProjectReader & ProjectWriter & SelectionModel, id: string): void {
  store.commit(() => {
    const s = store.scene;
    s.entities = s.entities.filter((x) => x.id !== id);
  });
  store.select(null);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function assetInspector(root: HTMLElement, store: InspectorStore, a: Asset): void {
  const upd = <T extends Asset>(fn: (x: T) => void) =>
    store.commit(() => {
      const cur = store.asset(a.id) as T | undefined;
      if (cur) fn(cur);
    });
  const f = new Form(root, a.type === 'image' ? 'Image' : a.type === 'sprite' ? 'Sprite' : 'Projectile');
  f.text('Name', a.name, (v) => upd((x) => (x.name = v)));

  if (a.type === 'image') imageSections(root, store, a, f);
  else if (a.type === 'sprite') spriteSections(root, store, a, upd);
  else projectileAssetSections(root, store, a, upd);

  new Form(root, 'Actions').buttons([
    'Delete asset',
    () => {
      if (!confirm(`Delete "${a.name}"? References to it will be cleared.`)) return;
      store.commit((p) => removeAsset(p, a.id));
      store.select(null);
    },
    'danger',
  ]);
}

function imageSections(root: HTMLElement, store: InspectorStore, a: ImageAsset, f: Form): void {
  f.note(`${a.width} × ${a.height} px`);
  f.custom(h('img', { class: 'image-preview', src: a.src, alt: a.name }));
  new Form(root, 'Use').buttons([
    'Create sprite from image',
    () => {
      const s = createSpriteAsset(a.name.replace(/\.[a-z]+$/i, ''), a);
      store.commit((p) => p.assets.push(s));
      store.select({ kind: 'asset', id: s.id });
    },
  ]);
}

type AssetUpdater = <T extends Asset>(fn: (x: T) => void) => void;

function spriteSections(root: HTMLElement, store: InspectorStore, a: SpriteAsset, upd: AssetUpdater): void {
  const sp = (fn: (s: SpriteAsset) => void) => upd<SpriteAsset>(fn);
  const sheet = new Form(root, 'Sheet');
  sheet.select('Image', a.imageId ?? '', assetOptions(store, 'image'), (v) => sp((s) => (s.imageId = orNull(v))));
  sheet.num('Frame width', a.frameW, (v) => sp((s) => (s.frameW = v)), { min: 1 });
  sheet.num('Frame height', a.frameH, (v) => sp((s) => (s.frameH = v)), { min: 1 });
  sheet.num('Origin X', a.originX, (v) => sp((s) => (s.originX = v)), { step: 0.05, hint: '0..1 inside the frame' });
  sheet.num('Origin Y', a.originY, (v) => sp((s) => (s.originY = v)), { step: 0.05 });

  const preview = spritePreview(a, store.assets);
  sheet.custom(preview.el);

  const anims = new Form(root, 'Animations');
  const table = h('div', { class: 'anim-table' }, h('div', { class: 'anim-row head' }, h('span', {}, 'Name'), h('span', {}, 'Frames'), h('span', {}, 'FPS'), h('span', {}, 'Loop'), h('span', {})));
  a.animations.forEach((an, i) => {
    const set = (fn: (s: SpriteAsset) => void) => sp(fn);
    const key = (k: string) => ({ 'data-key': `anim/${i}/${k}` });
    const name = h('input', { type: 'text', value: an.name, ...key('name'), onFocus: () => preview.setAnim(an.name) });
    name.addEventListener('change', () => set((s) => (s.animations[i].name = name.value)));
    const frames = h('input', { type: 'text', value: an.frames, placeholder: '0-3', ...key('frames'), onFocus: () => preview.setAnim(an.name) });
    frames.addEventListener('change', () => set((s) => (s.animations[i].frames = frames.value)));
    const fps = h('input', { type: 'number', value: String(an.fps), min: 0, ...key('fps') });
    fps.addEventListener('change', () => set((s) => (s.animations[i].fps = Math.max(0, Number(fps.value) || 0))));
    const loop = h('input', { type: 'checkbox', checked: an.loop, ...key('loop') });
    loop.addEventListener('change', () => set((s) => (s.animations[i].loop = loop.checked)));
    table.append(
      h('div', { class: 'anim-row' }, name, frames, fps, loop,
        h('span', {},
          h('button', { class: 'small', title: 'Preview', onClick: () => preview.setAnim(an.name) }, '▶'),
          h('button', { class: 'small', title: 'Remove', onClick: () => set((s) => s.animations.splice(i, 1)) }, '✕'),
        ),
      ),
    );
  });
  anims.custom(table);
  anims.buttons(['+ Animation', () => sp((s) => s.animations.push({ name: `anim${s.animations.length + 1}`, frames: '0', fps: 8, loop: true }))]);
  anims.note('Frames are indices into the sheet grid, e.g. "0-3", "4, 5, 6", "7-4".');
}

function projectileAssetSections(root: HTMLElement, store: InspectorStore, a: ProjectileAsset, upd: AssetUpdater): void {
  const pr = (fn: (p: ProjectileAsset) => void) => upd<ProjectileAsset>(fn);
  const f = new Form(root, 'Ballistics');
  f.num('Speed', a.speed, (v) => pr((p) => (p.speed = v)), { min: 0, step: 10 });
  f.num('Radius', a.radius, (v) => pr((p) => (p.radius = v)), { min: 1 });
  f.num('Lifetime (s)', a.lifetime, (v) => pr((p) => (p.lifetime = v)), { min: 0.05, step: 0.1 });
  f.num('Gravity scale', a.gravityScale, (v) => pr((p) => (p.gravityScale = v)), { step: 0.1, hint: 'Side view: 0 = straight, 1 = lobbed' });
  f.num('Bounces', a.bounces, (v) => pr((p) => (p.bounces = Math.round(v))), { min: 0 });
  f.num('Damage', a.damage, (v) => pr((p) => (p.damage = v)), { min: 0 });
  const look = new Form(root, 'Look');
  look.color('Color', a.color, (v) => pr((p) => (p.color = v)));
  look.select('Sprite', a.spriteId ?? '', assetOptions(store, 'sprite', '— circle —'), (v) => pr((p) => (p.spriteId = orNull(v))));
}
