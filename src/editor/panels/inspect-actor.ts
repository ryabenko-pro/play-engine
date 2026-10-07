import { FORM_SCRIPT, createActorScene, createState } from '../../engine/factory';
import { findActorScene, formUsers } from '../../engine/prefabs';
import { type StubKind, stubSprite } from '../../engine/stubs';
import type { ActorDef, ActorScene, ActorState, FormRef, ViewMode } from '../../engine/types';
import { clone } from '../../engine/util';
import { setBlocks } from '../blocks/codegen';
import { renameInBlocks } from '../blocks/refs';
import { modules } from '../modules';
import { instanceUsage, removeScene, type ProjectWriter, type SelectionModel } from '../store';
import { Form, h, type Options } from '../ui';
import { VIEWS, assetOptions, kindSummary, orNull, projectKinds, type InspectorStore } from './inspect-common';
import { spritePreview } from './sprite-preview';

type ActorInspectorStore = InspectorStore;

type DefUpdater = (fn: (d: ActorDef) => void) => void;

function defUpdater(store: ProjectWriter, sceneId: string): DefUpdater {
  return (fn) =>
    store.commit((p) => {
      const s = findActorScene(p, sceneId);
      if (s) fn(s.actor);
    });
}

export function actorSceneSettings(root: HTMLElement, store: ActorInspectorStore, scene: ActorScene): void {
  const upd = (fn: (s: ActorScene) => void) =>
    store.commit((p) => {
      const s = findActorScene(p, scene.id);
      if (s) fn(s);
    });
  const f = new Form(root, 'Actor scene');
  f.text('Name', scene.name, (v) => {
    const to = v.trim();
    if (!to || to === scene.name) return;
    // "spawn …" blocks choose actor scenes by name: rename them there too.
    store.commit((p) => {
      const s = findActorScene(p, scene.id);
      if (!s) return;
      if (p.scenes.filter((x) => x.kind === 'actor' && x.name === s.name).length === 1) renameInBlocks(p, 'scene', s.name, to);
      s.name = to;
    });
  }, { hint: 'world.spawn() and "spawn" blocks find it by this name' });
  f.text('Tags', scene.actor.tags, (v) => upd((s) => (s.actor.tags = v)), { hint: 'Comma-separated; scripts find actors by tag, e.g. world.find("player")' });
  if (modules.interactions) {
    const kinds = scene.actor.kinds ?? [];
    f.chips('Kinds', projectKinds(store), kinds, (v) => upd((s) => (s.actor.kinds = v)), {
      hint: 'What it is (see ⚗ Interactions): decides what fire, water… do to it, whether it is solid or pushable, and what it gives off',
    });
    const summary = kindSummary(store, kinds);
    if (summary) f.note(summary.charAt(0).toUpperCase() + summary.slice(1) + '.');
  }
  f.select('Preview view', scene.previewView, VIEWS, (v) => upd((s) => (s.previewView = v as ViewMode)), {
    hint: 'How the actor is shown here and play-tested with ▶ Test',
  });
  const uses = instanceUsage(store.project, scene.id);
  f.note(`Used by ${uses} instance${uses === 1 ? '' : 's'} in levels. Everything it does is in its Script.`);
  const users = formUsers(store.project, scene.id);
  if (users.length) {
    f.note(
      `A form of ${users.map((u) => `"${u.container.name}" ('${u.form}')`).join(', ')}: while active it supplies the look, states, colliders and effects, ` +
        'its props are laid over the container\'s, and its hooks run on top of the container\'s script. ▶ Test runs it inside the container.',
    );
    f.buttons(...users.map((u): [string, () => void] => [`✎ Open "${u.container.name}"`, () => store.setScene(u.container.id)]));
  }
  if (scene.actor.forms.length) f.note(`Forms: ${scene.actor.forms.map((x) => x.name).join(', ')} (plus 'base', its own look). Switch with self.setForm(name, seconds?).`);
  f.buttons(
    [scene.actor.blocks ? '✎ Edit blocks' : '✎ Edit script', () => store.select({ kind: 'part', id: 'script' })],
    [
      'Delete scene',
      () => {
        if (!confirm(`Delete "${scene.name}" and its ${uses} instance(s)?`)) return;
        store.commit((p) => removeScene(p, scene.id));
        store.setScene(store.project.mainSceneId);
      },
      'danger',
    ],
  );
}

/** Inspector for one part of the open actor scene. */
export function actorPartInspector(root: HTMLElement, store: ActorInspectorStore, scene: ActorScene, part: string): void {
  const upd = defUpdater(store, scene.id);
  const d = scene.actor;
  if (part === 'body') bodyPart(root, d, upd);
  else if (part === 'visual') visualPart(root, store, scene, upd);
  else if (part === 'script') scriptPart(root, store, d);
  else if (part.startsWith('form:')) {
    const ref = d.forms.find((x) => x.name === part.slice(5));
    if (ref) formPart(root, store, scene, ref);
  }
  else if (part.startsWith('state:')) {
    const st = d.states.find((s) => s.name === part.slice(6));
    if (st) statePart(root, store, d, st, upd);
  }
}

function bodyPart(root: HTMLElement, d: ActorDef, upd: DefUpdater): void {
  const col = new Form(root, 'Collider');
  col.select('Shape', d.collider.kind, [['rect', 'Rectangle'], ['circle', 'Circle']], (v) =>
    upd((x) => (x.collider = v === 'rect' ? { kind: 'rect', w: 20, h: 38 } : { kind: 'circle', r: 12 })),
  );
  if (d.collider.kind === 'rect') {
    col.num('Width', d.collider.w, (v) => upd((x) => x.collider.kind === 'rect' && (x.collider.w = v)), { min: 1 });
    col.num('Height', d.collider.h, (v) => upd((x) => x.collider.kind === 'rect' && (x.collider.h = v)), { min: 1 });
  } else {
    col.num('Radius', d.collider.r, (v) => upd((x) => x.collider.kind === 'circle' && (x.collider.r = v)), { min: 1 });
  }
  col.note(
    'Used by moveAndSlide(), world.overlaps() and projectile hits. States can have their own collider. In top-down / isometric levels it becomes a round footprint (width / 2).',
  );
}

const STUB_IMAGE = /\(stub(?: (\d+))?\)\.svg$/;

/**
 * Gives the actor generated placeholder art (named after the scene). If its sprite is
 * already a stub, that stub is redrawn as the next variant instead of adding assets.
 */
function useStub(store: ActorInspectorStore, scene: ActorScene, kind: StubKind): void {
  store.commit((p) => {
    const s = findActorScene(p, scene.id);
    if (!s) return;
    const oldSprite = p.assets.find((a) => a.id === s.actor.spriteId && a.type === 'sprite');
    const oldImage = oldSprite?.type === 'sprite' ? p.assets.find((a) => a.id === oldSprite.imageId && a.type === 'image') : undefined;
    const m = oldImage ? STUB_IMAGE.exec(oldImage.name) : null;
    const variant = m ? Number(m[1] ?? 1) + 1 : 1;
    const stub = stubSprite(s.name, { kind, seed: variant > 1 ? variant : undefined });
    stub.image.name = `${s.name} (stub${variant > 1 ? ` ${variant}` : ''}).svg`;
    if (m && oldSprite?.type === 'sprite' && oldImage?.type === 'image') {
      Object.assign(oldImage, { name: stub.image.name, src: stub.image.src, width: stub.image.width, height: stub.image.height });
      Object.assign(oldSprite, { frameW: stub.sprite.frameW, frameH: stub.sprite.frameH, originX: stub.sprite.originX, originY: stub.sprite.originY, animations: stub.sprite.animations });
    } else {
      p.assets.push(stub.image, stub.sprite);
      s.actor.spriteId = stub.sprite.id;
    }
    s.actor.color = stub.color;
  });
}

function visualPart(root: HTMLElement, store: ActorInspectorStore, scene: ActorScene, upd: DefUpdater): void {
  const d = scene.actor;
  const vis = new Form(root, 'Visual');
  vis.select('Sprite', d.spriteId ?? '', assetOptions(store, 'sprite', '— shape only —'), (v) => upd((x) => (x.spriteId = orNull(v))));
  vis.color('Color', d.color, (v) => upd((x) => (x.color = v)), { hint: 'Starting fill colour without a sprite; scripts can change self.color' });
  const fx = new Form(root, 'Size & effects');
  fx.num('Scale', d.scale, (v) => upd((x) => (x.scale = v)), { min: 0.05, step: 0.1, hint: 'Scales the sprite and every collider (physically bigger / smaller)' });
  fx.num('Trail', d.trail, (v) => upd((x) => (x.trail = Math.round(v))), { min: 0, max: 20, hint: 'Afterimages left behind while moving (0 = off)' });
  fx.num('Wobble', d.wobble, (v) => upd((x) => (x.wobble = v)), { min: 0, max: 0.5, step: 0.01, hint: 'Squash-and-stretch deformation (0 = off, 0.1 = strong)' });
  fx.note('Typically set on form scenes (a "small & fast" or "big & slow" form of a hero). Scripts read self.scale.');
  const sprite = store.assets.get(d.spriteId, 'sprite');
  const stubs: Array<[string, () => void]> = (['creature', 'item', 'prop', 'tile'] as const).map((k) => [`🎲 ${k}`, () => useStub(store, scene, k)]);
  if (!sprite) {
    vis.note('Without a sprite the actor is drawn as its current collider, filled with self.color.');
    vis.note('Or generate placeholder art from the scene name (each name looks different; creatures get the default state animations):');
    vis.buttons(...stubs);
    return;
  }
  vis.num('Scale', d.spriteScale, (v) => upd((x) => (x.spriteScale = v)), { min: 0.1, step: 0.25 });
  vis.num('Offset Y', d.spriteOffsetY, (v) => upd((x) => (x.spriteOffsetY = v)), { hint: 'Shift the sprite vertically (screen px)' });
  vis.custom(spritePreview(sprite, store.assets).el);
  vis.buttons([`Edit sprite "${sprite.name}"`, () => store.select({ kind: 'asset', id: sprite.id })]);
  const isStub = STUB_IMAGE.test(store.assets.get(sprite.imageId, 'image')?.name ?? '');
  vis.note(isStub ? 'Placeholder art: 🎲 draws another variant (replace the image later with the real one).' : 'Placeholder art from the scene name:');
  vis.buttons(...stubs);
}

function scriptPart(root: HTMLElement, store: ActorInspectorStore, d: ActorDef): void {
  const f = new Form(root, 'Script');
  const r = store.scripts.get(d.script);
  if (!r.ok) {
    f.custom(h('pre', { class: 'script-error' }, r.error));
  } else {
    const hooks = (['init', 'update', 'onHit'] as const).filter((k) => typeof r.module[k] === 'function');
    f.note(`Compiles. Hooks: ${hooks.join(', ') || 'none'}.`);
  }
  const props = store.scripts.props(d.script);
  const p = new Form(root, 'Exported props');
  const keys = Object.keys(props);
  if (!keys.length) p.note('None. Export `const props = { … }` to make values tunable per instance.');
  for (const k of keys) p.custom(h('div', { class: 'prop-line' }, h('span', {}, k), h('code', {}, JSON.stringify(props[k]))));
  p.note('Instances can override these in the level inspector.');
}

function statePart(root: HTMLElement, store: ActorInspectorStore & SelectionModel, d: ActorDef, st: ActorState, upd: DefUpdater): void {
  const name = st.name;
  const updState = (fn: (s: ActorState) => void) =>
    upd((x) => {
      const s = x.states.find((y) => y.name === name);
      if (s) fn(s);
    });

  const f = new Form(root, 'State');
  f.note(`Pure data. Switch to it from the script: self.setState('${name}').`);
  f.text('Name', name, (v) => renameState(store, upd, d, name, v.trim()));
  f.check('Initial state', d.initialState === name, (v) => v && upd((x) => (x.initialState = name)));
  const sprite = store.assets.get(d.spriteId, 'sprite');
  if (sprite) {
    const anims: Options = [['', '— none —'], ...sprite.animations.map((a) => [a.name, a.name] as const)];
    f.select('Animation', st.animation, anims, (v) => updState((s) => (s.animation = v)));
  } else {
    f.text('Animation', st.animation, (v) => updState((s) => (s.animation = v)), { hint: 'Animation name on the actor sprite' });
  }
  stateColliderForm(root, d, st, updState);
  if (d.states.length > 1) new Form(root, 'Actions').buttons(['Delete state', () => deleteState(store, upd, d, name), 'danger']);
}

function stateColliderForm(root: HTMLElement, d: ActorDef, st: ActorState, updState: (fn: (s: ActorState) => void) => void): void {
  const f = new Form(root, 'Collider');
  f.check('Own collider', !!st.body, (on) => updState((s) => (s.body = on ? { shape: clone(d.collider), offsetX: 0, offsetY: 0 } : null)), {
    hint: 'Replace the body collider while in this state, e.g. lying down or crouching',
  });
  const b = st.body;
  if (!b) {
    f.note('Uses the shared body collider.');
    return;
  }
  const body = (fn: (x: NonNullable<ActorState['body']>) => void) => updState((s) => s.body && fn(s.body));
  f.select('Shape', b.shape.kind, [['rect', 'Rectangle'], ['circle', 'Circle']], (v) =>
    body((x) => (x.shape = v === 'rect' ? { kind: 'rect', w: 20, h: 38 } : { kind: 'circle', r: 12 })),
  );
  if (b.shape.kind === 'rect') {
    f.num('Width', b.shape.w, (v) => body((x) => x.shape.kind === 'rect' && (x.shape.w = v)), { min: 1 });
    f.num('Height', b.shape.h, (v) => body((x) => x.shape.kind === 'rect' && (x.shape.h = v)), { min: 1 });
  } else {
    f.num('Radius', b.shape.r, (v) => body((x) => x.shape.kind === 'circle' && (x.shape.r = v)), { min: 1 });
  }
  f.num('Offset X', b.offsetX, (v) => body((x) => (x.offsetX = v)), { hint: 'Mirrored when the actor faces left' });
  f.num('Offset Y', b.offsetY, (v) => body((x) => (x.offsetY = v)));
  f.note('Drag the handles in the viewport: corner resizes, centre moves.');
}

// ---------------------------------------------------------------------------
// State list operations (also used by the Scene tree)
// ---------------------------------------------------------------------------

type StateStore = ProjectWriter & SelectionModel;

export function addState(store: StateStore, sceneId: string, d: ActorDef): void {
  let n = d.states.length + 1;
  while (d.states.some((s) => s.name === `state${n}`)) n++;
  const st = createState(`state${n}`, d.states[0]?.animation ?? '');
  defUpdater(store, sceneId)((x) => x.states.push(st));
  store.select({ kind: 'part', id: `state:${st.name}` });
}

function renameState(store: StateStore, upd: DefUpdater, d: ActorDef, from: string, to: string): void {
  if (!to || to === from) return;
  if (d.states.some((s) => s.name === to)) {
    alert(`A state named "${to}" already exists.`);
    return;
  }
  upd((x) => {
    for (const s of x.states) if (s.name === from) s.name = to;
    if (x.initialState === from) x.initialState = to;
  });
  store.select({ kind: 'part', id: `state:${to}` });
}

function deleteState(store: StateStore, upd: DefUpdater, d: ActorDef, name: string): void {
  if (!confirm(`Delete state "${name}"? Scripts calling setState('${name}') will fail.`)) return;
  upd((x) => {
    x.states = x.states.filter((s) => s.name !== name);
    if (x.initialState === name) x.initialState = x.states[0]?.name ?? '';
  });
  store.select({ kind: 'part', id: d.states.find((s) => s.name !== name) ? `state:${d.states.find((s) => s.name !== name)!.name}` : 'body' });
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

type FormStore = ActorInspectorStore;

function uniqueName(taken: readonly string[], base: string): string {
  let n = 1;
  while (taken.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Adds a form: a new actor scene starting as a copy of this look, with an empty form script (or blocks). */
export function addForm(store: StateStore, scene: ActorScene): void {
  const d = scene.actor;
  const name = uniqueName(d.forms.map((f) => f.name), 'form');
  const fs = createActorScene(`${scene.name} · ${name}`);
  fs.previewView = scene.previewView;
  const look = clone({ collider: d.collider, states: d.states, initialState: d.initialState });
  Object.assign(fs.actor, look, { color: d.color, spriteId: d.spriteId, spriteScale: d.spriteScale, spriteOffsetY: d.spriteOffsetY, script: FORM_SCRIPT });
  // A form is programmed the same way as its container.
  if (d.blocks) setBlocks(fs);
  store.commit((p) => {
    p.scenes.push(fs);
    findActorScene(p, scene.id)?.actor.forms.push({ name, sceneId: fs.id });
  });
  store.select({ kind: 'part', id: `form:${name}` });
}

function formPart(root: HTMLElement, store: FormStore, scene: ActorScene, ref: FormRef): void {
  const name = ref.name;
  const upd = defUpdater(store, scene.id);
  const updRef = (fn: (f: FormRef) => void) =>
    upd((x) => {
      const f = x.forms.find((y) => y.name === name);
      if (f) fn(f);
    });
  const target = findActorScene(store.project, ref.sceneId);

  const f = new Form(root, 'Form');
  f.note(`From the script: self.setForm('${name}') or self.setForm('${name}', seconds). self.setForm('base') returns to this scene's own look.`);
  f.text('Name', name, (v) => {
    const to = v.trim();
    if (!to || to === name) return;
    if (to === 'base' || scene.actor.forms.some((x) => x.name === to)) return void alert(`"${to}" is already taken.`);
    updRef((x) => (x.name = to));
    store.select({ kind: 'part', id: `form:${to}` });
  });
  const scenes = store.project.scenes.filter((s) => s.kind === 'actor' && s.id !== scene.id).map((s) => [s.id, s.name] as const);
  f.select('Scene', ref.sceneId, scenes, (v) => updRef((x) => (x.sceneId = v)), { hint: 'The actor scene implementing this form' });
  if (!target) {
    f.note('The form scene is missing: pick another one.');
  } else {
    const t = target.actor;
    const props = store.scripts.props(t.script);
    const keys = Object.keys(props);
    f.note(
      `Scale ×${t.scale}` + (t.trail ? ` · trail ${t.trail}` : '') + (t.wobble ? ` · wobble ${t.wobble}` : '') +
        ` · ${t.states.length} state(s). Overrides: ${keys.length ? keys.map((k) => `${k} = ${JSON.stringify(props[k])}`).join(', ') : 'none'}.`,
    );
    const hooks = (() => {
      const r = store.scripts.get(t.script);
      return r.ok ? (['init', 'update', 'onHit'] as const).filter((k) => typeof r.module[k] === 'function') : [];
    })();
    if (hooks.length) f.note(`Extra hooks: ${hooks.join(', ')}${hooks.includes('onHit') ? ' (onHit runs first: set hit.damage = 0 for immunity)' : ''}.`);
    f.buttons([`✎ Edit "${target.name}"`, () => store.setScene(target.id)]);
  }
  new Form(root, 'Actions').buttons([
    'Remove form',
    () => {
      upd((x) => (x.forms = x.forms.filter((y) => y.name !== name)));
      store.select(null);
    },
    'danger',
  ]);
}
