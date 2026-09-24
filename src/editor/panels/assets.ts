import type { AssetStore } from '../../engine/assets';
import { createProjectileAsset, createSpriteAsset } from '../../engine/factory';
import type { Asset } from '../../engine/types';
import { readImageFile } from '../demo';
import type { AssetCache, LogSink, Observable, ProjectReader, ProjectWriter, SelectionModel } from '../store';
import { h, pickFiles } from '../ui';

export type AssetsStore = Observable & ProjectReader & ProjectWriter & SelectionModel & AssetCache & LogSink;

const TYPE_LABEL: Record<Asset['type'], string> = { image: 'Image', sprite: 'Sprite', projectile: 'Projectile' };

export async function importImages(store: AssetsStore, files: File[]): Promise<void> {
  for (const f of files.filter((f) => f.type.startsWith('image/'))) {
    try {
      const img = await readImageFile(f);
      store.commit((p) => p.assets.push(img));
      store.select({ kind: 'asset', id: img.id });
      store.log(`Imported ${f.name} (${img.width}×${img.height})`);
    } catch (err) {
      store.log(`Import error: ${(err as Error).message}`);
    }
  }
}

function thumbnail(a: Asset, assets: AssetStore): HTMLElement {
  if (a.type === 'image') return h('img', { class: 'thumb', src: a.src, alt: '' });
  const cv = h('canvas', { class: 'thumb', width: 40, height: 40 });
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (a.type === 'projectile') {
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(20, 20, Math.min(16, Math.max(4, a.radius * 1.5)), 0, Math.PI * 2);
    ctx.fill();
    return cv;
  }
  const fr = assets.frameRect(a, 0);
  if (fr) {
    const s = Math.min(40 / fr.sw, 40 / fr.sh);
    ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, (40 - fr.sw * s) / 2, (40 - fr.sh * s) / 2, fr.sw * s, fr.sh * s);
  }
  return cv;
}

export function mountAssets(root: HTMLElement, store: AssetsStore): void {
  const add = (a: Asset) => {
    store.commit((p) => p.assets.push(a));
    store.select({ kind: 'asset', id: a.id });
  };
  const render = () => {
    const sel = store.selection;
    root.replaceChildren(
      h('div', { class: 'panel-title' }, 'Assets',
        h('span', { class: 'spacer' }),
        h('button', { class: 'small', onClick: async () => importImages(store, await pickFiles('image/*', true)) }, '+ Image'),
        h('button', { class: 'small', onClick: () => add(createSpriteAsset(`Sprite ${store.project.assets.length + 1}`, store.project.assets.find((a) => a.type === 'image') ?? null)) }, '+ Sprite'),
        h('button', { class: 'small', onClick: () => add(createProjectileAsset()) }, '+ Projectile'),
      ),
      h('div', { class: 'asset-grid' },
        ...store.project.assets.map((a) =>
          h('div', {
            class: `asset ${sel?.kind === 'asset' && sel.id === a.id ? 'selected' : ''}`,
            title: `${TYPE_LABEL[a.type]}: ${a.name}`,
            onClick: () => store.select({ kind: 'asset', id: a.id }),
          }, thumbnail(a, store.assets), h('div', { class: 'asset-name' }, a.name), h('div', { class: 'asset-type' }, TYPE_LABEL[a.type])),
        ),
        store.project.assets.length ? null : h('p', { class: 'note' }, 'Drop image files here, or use + Image.'),
      ),
    );
  };
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    void importImages(store, [...(e.dataTransfer?.files ?? [])]);
  });
  store.subscribe((reason) => {
    if (reason === 'change' || reason === 'selection' || reason === 'assets-loaded') render();
  });
  render();
}
