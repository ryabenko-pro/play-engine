import type { Entity } from '../../engine/types';
import type { Observable, ProjectReader, SelectionModel } from '../store';
import { h } from '../ui';

export type HierarchyStore = Observable & ProjectReader & SelectionModel;

export function entityIcon(e: Entity): string {
  if (e.type === 'projectile') return '➤';
  if (e.type === 'character') return e.control === 'player' ? '☺' : '☻';
  return e.shape.kind === 'rect' ? '▭' : e.shape.kind === 'circle' ? '◯' : '╱';
}

export function mountHierarchy(root: HTMLElement, store: HierarchyStore): void {
  const render = () => {
    const sel = store.selection;
    const scene = store.scene;
    root.replaceChildren(
      h('div', { class: 'panel-title' }, 'Scene'),
      h('div', { class: `tree-item scene ${sel === null ? 'selected' : ''}`, onClick: () => store.select(null) }, `⚙ ${scene.name}`),
      h('ul', { class: 'tree' },
        ...scene.entities.map((e) =>
          h('li', {
            class: `tree-item ${sel?.kind === 'entity' && sel.id === e.id ? 'selected' : ''} type-${e.type}`,
            onClick: () => store.select({ kind: 'entity', id: e.id }),
          }, h('span', { class: 'icon' }, entityIcon(e)), e.name),
        ),
      ),
    );
  };
  store.subscribe((reason) => {
    if (reason === 'change' || reason === 'selection') render();
  });
  render();
}
