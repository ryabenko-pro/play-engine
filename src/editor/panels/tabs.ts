import type { History, Observable, ProjectReader, SceneTabs } from '../store';
import { h, openMenu } from '../ui';
import { claimMenu, sceneMarks, sceneNotice, type PresenceView } from './presence';

export type TabsStore = Observable & ProjectReader & SceneTabs & History;

/** Godot-style scene tabs above the viewport: one tab per open scene. */
export function mountTabs(root: HTMLElement, store: TabsStore, presence?: PresenceView): void {
  const render = () => {
    const closable = store.openScenes.length > 1;
    root.replaceChildren(
      ...store.openScenes.map((id) => {
        const scene = store.project.scenes.find((s) => s.id === id);
        if (!scene) return '';
        const active = id === store.sceneId;
        const close = closable
          ? h('button', {
              class: 'tab-close',
              title: 'Close tab',
              onClick: (e: Event) => {
                e.stopPropagation();
                store.closeScene(id);
              },
            }, '×')
          : '';
        const tab = h('div', {
          class: `tab ${active ? 'active' : ''} kind-${scene.kind}`,
          title: `${scene.kind === 'level' ? 'Level' : 'Actor'}: ${scene.name}${scene.id === store.project.mainSceneId ? ' (main)' : ''}`,
          onClick: () => store.setScene(id),
        }, h('span', { class: 'tab-icon' }, scene.kind === 'level' ? '▦' : '☺'), scene.name, ...(presence ? sceneMarks(presence.marks(id)) : []), close);
        if (presence) {
          tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openMenu(e.clientX, e.clientY, claimMenu(presence, id));
          });
        }
        // Middle click closes, like browsers and Godot.
        tab.addEventListener('auxclick', (e) => {
          if (e.button === 1 && closable) store.closeScene(id);
        });
        return tab;
      }),
      // A shared project: warn when someone else claimed or is changing the scene being edited.
      notice(),
    );
  };
  const notice = () => {
    const text = presence ? sceneNotice(presence.marks(store.sceneId)) : null;
    return text ? h('div', { class: 'tab-notice' }, text) : '';
  };
  store.subscribe((reason) => {
    if (reason === 'change') render();
  });
  presence?.subscribe(render);
  render();
}
