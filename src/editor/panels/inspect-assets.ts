import { createSpriteAsset } from '../../engine/factory';
import type { Asset, ImageAsset, ProjectileAsset, SpriteAsset } from '../../engine/types';
import { removeAsset } from '../store';
import { Form, h } from '../ui';
import { assetOptions, orNull, type InspectorStore } from './inspect-common';
import { spritePreview } from './sprite-preview';

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function assetInspector(root: HTMLElement, store: InspectorStore, a: Asset): void {
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
  f.num('Blast radius', a.blast ?? 0, (v) => pr((p) => (p.blast = v)), { min: 0, hint: 'On impact, every other actor this close is hit too (0 = only the one it touches)' });
  const look = new Form(root, 'Look');
  look.color('Color', a.color, (v) => pr((p) => (p.color = v)));
  look.select('Sprite', a.spriteId ?? '', assetOptions(store, 'sprite', '— circle —'), (v) => pr((p) => (p.spriteId = orNull(v))));
}
