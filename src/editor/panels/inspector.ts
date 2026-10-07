import { h } from '../ui';
import { assetInspector } from './inspect-assets';
import { actorPartInspector, actorSceneSettings } from './inspect-actor';
import type { InspectorStore } from './inspect-common';
import { entityInspector, levelSettings } from './inspect-level';

export type { InspectorStore };

export function mountInspector(root: HTMLElement, store: InspectorStore): void {
  const render = () => {
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && root.contains(active) ? active.getAttribute('data-key') : null;
    const scroll = root.scrollTop;
    root.replaceChildren(h('div', { class: 'panel-title' }, 'Inspector'));
    build(root, store);
    root.scrollTop = scroll;
    if (focusKey) root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  };
  store.subscribe((reason) => {
    if (reason === 'change' || reason === 'selection' || reason === 'gesture') render();
  });
  render();
}

function build(root: HTMLElement, store: InspectorStore): void {
  const sel = store.selection;
  const level = store.level;
  const actor = store.actorScene;
  if (sel?.kind === 'asset') {
    const a = store.asset(sel.id);
    if (a) assetInspector(root, store, a);
  } else if (sel?.kind === 'entity' && level) {
    const e = store.entity(sel.id);
    if (e) entityInspector(root, store, e);
  } else if (sel?.kind === 'part' && actor) {
    actorPartInspector(root, store, actor, sel.id);
  } else if (level) {
    levelSettings(root, store, level);
  } else if (actor) {
    actorSceneSettings(root, store, actor);
  }
}
