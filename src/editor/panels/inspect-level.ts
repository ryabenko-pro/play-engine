import { expandLevel, findActorScene, findLevel } from '../../engine/prefabs';
import type { BlockEntity, Entity, InstanceEntity, LevelScene, PathEntity, ProjectileEntity, PropValue, ZoneEntity } from '../../engine/types';
import { clone, uid } from '../../engine/util';
import { renameInBlocks } from '../blocks/refs';
import { modules } from '../modules';
import type { ProjectReader, ProjectWriter, SelectionModel } from '../store';
import { Form, type RowExtras } from '../ui';
import { VIEWS, assetOptions, kindSummary, orNull, projectKinds, type InspectorStore } from './inspect-common';

type Updater = <T extends Entity>(fn: (x: T) => void) => void;

export function levelSettings(root: HTMLElement, store: InspectorStore, scene: LevelScene): void {
  const upd = (fn: (s: LevelScene) => void) =>
    store.commit((p) => {
      const s = p.scenes.find((x) => x.id === scene.id);
      if (s?.kind === 'level') fn(s);
    });
  const f = new Form(root, 'Level');
  f.text('Name', scene.name, (v) => upd((s) => (s.name = v)));
  f.select('View', scene.view, VIEWS, (v) => upd((s) => (s.view = v as LevelScene['view'])));
  f.num('Gravity', scene.gravity, (v) => upd((s) => (s.gravity = v)), { step: 50, hint: 'px/s², side view only' });
  f.color('Background', scene.background, (v) => upd((s) => (s.background = v)));
  f.num('Grid size', scene.gridSize, (v) => upd((s) => (s.gridSize = v)), { min: 1 });
  f.check('Main scene', store.project.mainSceneId === scene.id, (v) => v && store.commit((p) => (p.mainSceneId = scene.id)), {
    hint: 'Level started by the standalone player',
  });
  f.note('Drag an actor from the Scenes dock into the viewport to place an instance. Drag another level to place it as a room / building: its contents become part of this level.');
}

export function entityInspector(root: HTMLElement, store: InspectorStore, e: Entity): void {
  const upd: Updater = (fn) =>
    store.commit(() => {
      const cur = store.entity(e.id);
      if (cur) fn(cur as never);
    });

  const placedLevel = e.type === 'instance' ? findLevel(store.project, e.sceneId) : undefined;
  const TITLES = { block: 'Block', instance: 'Instance', projectile: 'Projectile', path: 'Path', zone: 'Zone' } as const;
  const title = placedLevel ? 'Placed level' : TITLES[e.type];
  const f = new Form(root, title);
  const map = e.type === 'path' || e.type === 'zone';
  f.text('Name', e.name, (v) => {
    const to = v.trim();
    if (!to || to === e.name) return;
    // Blocks choose paths and zones by name: rename them there too.
    store.commit((p) => {
      const cur = store.entity(e.id);
      if (!cur) return;
      if (map && !sameNameElsewhere(p, e)) renameInBlocks(p, e.type, e.name, to);
      cur.name = to;
    });
  }, { hint: map ? 'Blocks find it by this name (renaming updates them)' : undefined });
  f.num('X', e.x, (v) => upd((x) => (x.x = v)));
  f.num('Y', e.y, (v) => upd((x) => (x.y = v)));
  if (e.type === 'block' || e.type === 'projectile') f.num('Rotation°', e.rotation, (v) => upd<BlockEntity | ProjectileEntity>((x) => (x.rotation = v)), { step: 5 });
  f.text('Tags', e.tags, (v) => upd((x) => (x.tags = v)), {
    hint: placedLevel ? 'Added to everything inside (e.g. world.all("east-wing"))' : 'Comma-separated; visible to scripts',
  });

  if (e.type === 'block') blockSections(root, store, e, upd);
  else if (e.type === 'instance') instanceSections(root, store, e, upd);
  else if (e.type === 'path') pathSections(root, e, upd);
  else if (e.type === 'zone') zoneSections(root, e, upd);
  else projectileSections(root, store, e, upd);

  new Form(root, 'Actions').buttons(
    ['Duplicate', () => duplicateEntity(store, e.id)],
    ['Delete', () => deleteEntity(store, e.id), 'danger'],
  );
}

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
  look.check('Solid', e.solid, (v) => shape((b) => (b.solid = v)), { hint: 'Blocks characters and projectiles' });
  look.color('Color', e.color, (v) => shape((b) => (b.color = v)));
  look.select('Texture', e.textureId ?? '', assetOptions(store, 'image'), (v) => shape((b) => (b.textureId = orNull(v))));
  look.num('Height (iso)', e.height, (v) => shape((b) => (b.height = v)), { min: 0, hint: 'Wall height in isometric view' });

  if (!modules.interactions) return;
  const kinds = e.kinds ?? [];
  const k = new Form(root, 'Kinds');
  k.chips('Kinds', projectKinds(store), kinds, (v) => shape((b) => (b.kinds = v)), { hint: 'What the block is (see ⚗ Interactions)' });
  const summary = kindSummary(store, kinds);
  k.note(
    (summary ? `Gives: ${summary}. ` : '') +
      (e.solid ? 'A solid block affects what touches it (a lava floor).' : 'Not solid: a zone affecting what is inside it (a pond, a fire pit).'),
  );
}

function instanceSections(root: HTMLElement, store: InspectorStore, inst: InstanceEntity, upd: Updater): void {
  const level = findLevel(store.project, inst.sceneId);
  if (level) {
    const f = new Form(root, 'Level scene');
    const inside = expandLevel(store.project, level);
    const actors = inside.filter((x) => x.e.type === 'instance').length;
    f.note(`"${level.name}": ${inside.length - actors} block(s)/projectile(s) and ${actors} actor(s), including nested levels. They join this level at play time, moved by this position.`);
    f.buttons([`✎ Edit "${level.name}"`, () => store.setScene(level.id)]);
    return;
  }
  const scene = findActorScene(store.project, inst.sceneId);
  const src = new Form(root, 'Actor scene');
  if (!scene) {
    src.note('The scene of this instance was deleted.');
    return;
  }
  src.buttons([`✎ Edit "${scene.name}"`, () => store.setScene(scene.id)], ['Script', () => (store.setScene(scene.id), store.select({ kind: 'part', id: 'script' }))]);
  if (scene.actor.tags) src.note(`Scene tags: ${scene.actor.tags}`);
  if (scene.actor.forms.length) {
    const forms = [['', 'base (own look)'] as const, ...scene.actor.forms.map((x) => [x.name, x.name] as const)];
    src.select('Start form', inst.form ?? '', forms, (v) => upd<InstanceEntity>((i) => (v ? (i.form = v) : delete i.form)), {
      hint: 'Form this instance starts in (lasts until its script changes it)',
    });
  }

  const defaults = store.scripts.props(scene.actor.script);
  const f = new Form(root, 'Props');
  const keys = Object.keys(defaults);
  if (!keys.length) {
    f.note(store.scripts.get(scene.actor.script).ok ? 'The script exports no props.' : 'The script has errors; fix it to see its props.');
    return;
  }
  f.note("Defaults come from the script's `export const props`. Changed values apply to this instance only (↺ reverts).");
  for (const k of keys) {
    const def = defaults[k];
    const cur = inst.props[k] ?? def;
    const set = (v: PropValue) =>
      upd<InstanceEntity>((i) => {
        if (v === def) delete i.props[k];
        else i.props[k] = v;
      });
    const x: RowExtras = { reset: inst.props[k] !== undefined ? () => upd<InstanceEntity>((i) => delete i.props[k]) : undefined };
    if (typeof def === 'number') f.num(k, Number(cur), set, { step: Number.isInteger(def) ? 1 : 0.1, ...x });
    else if (typeof def === 'boolean') f.check(k, Boolean(cur), set, x);
    else if (/^#[0-9a-f]{6}$/i.test(def)) f.color(k, String(cur), set, x);
    else f.text(k, String(cur), set, x);
  }
  // Overrides for props the script no longer exports.
  const stale = Object.keys(inst.props).filter((k) => !(k in defaults));
  if (stale.length) f.buttons([`Remove ${stale.length} stale override(s)`, () => upd<InstanceEntity>((i) => stale.forEach((k) => delete i.props[k]))]);
}

/** Another path / zone of the project with the same name (then blocks naming it are left alone). */
function sameNameElsewhere(p: { scenes: readonly { kind: string }[] }, e: PathEntity | ZoneEntity): boolean {
  let n = 0;
  for (const s of p.scenes as LevelScene[]) {
    if (s.kind !== 'level') continue;
    n += s.entities.filter((x) => x.type === e.type && x.name === e.name).length;
  }
  return n > 1;
}

function pathSections(root: HTMLElement, e: PathEntity, upd: Updater): void {
  const f = new Form(root, 'Look');
  const path = (fn: (x: PathEntity) => void) => upd<PathEntity>(fn);
  f.color('Color', e.color, (v) => path((x) => (x.color = v)));
  f.num('Width', e.width, (v) => path((x) => (x.width = v)), { min: 1, hint: 'Drawn width in px' });
  f.check('Visible in game', e.visible, (v) => path((x) => (x.visible = v)), { hint: 'Off: only the editor shows it (an invisible route)' });
  f.note(`${e.points.length} points. The green dot is the start, the red one the end. Drag a point to move it; double-click it to delete it.`);
  f.note(`Enemies use it with the block "follow path ${e.name}": they walk straight to the start, then along the path.`);
  f.buttons(['⇄ Reverse direction', () => path((x) => reversePoints(x))]);
}

function zoneSections(root: HTMLElement, e: ZoneEntity, upd: Updater): void {
  const f = new Form(root, 'Look');
  const zone = (fn: (x: ZoneEntity) => void) => upd<ZoneEntity>(fn);
  f.color('Color', e.color, (v) => zone((x) => (x.color = v)));
  f.check('Visible in game', e.visible, (v) => zone((x) => (x.visible = v)), { hint: 'Off: only the editor shows it' });
  f.note(`${e.points.length} corners. Drag a corner to move it; double-click it to delete it.`);
  f.note(`Blocks ask "mouse in zone ${e.name}?" or "I am in zone ${e.name}?", e.g. to allow building towers only here, or "stay inside zone ${e.name}" to keep a hero in it. Several zones may share a name.`);
}

/** Same line, walked the other way: the last point becomes the origin. */
function reversePoints(e: PathEntity): void {
  const world = e.points.map((p) => ({ x: e.x + p.x, y: e.y + p.y })).reverse();
  e.x = world[0].x;
  e.y = world[0].y;
  e.points = world.map((p) => ({ x: p.x - e.x, y: p.y - e.y }));
}

function projectileSections(root: HTMLElement, store: InspectorStore, e: ProjectileEntity, upd: Updater): void {
  const f = new Form(root, 'Launch');
  f.select('Projectile', e.projectileId ?? '', assetOptions(store, 'projectile'), (v) => upd<ProjectileEntity>((x) => (x.projectileId = orNull(v))));
  f.note('Flies along its rotation when the game starts.');
}

type EntityStore = ProjectReader & ProjectWriter & SelectionModel;

export function duplicateEntity(store: EntityStore, id: string): void {
  const level = store.level;
  const src = store.entity(id);
  if (!level || !src) return;
  const copy = clone(src);
  copy.id = uid(`${src.type[0]}_`);
  copy.x += level.gridSize;
  copy.y += level.gridSize;
  store.commit(() => store.level?.entities.push(copy));
  store.select({ kind: 'entity', id: copy.id });
}

export function deleteEntity(store: EntityStore, id: string): void {
  store.commit(() => {
    const l = store.level;
    if (l) l.entities = l.entities.filter((x) => x.id !== id);
  });
  store.select(null);
}
