import { createActorScene, createLevelScene } from '../../engine/factory';
import { formUsers } from '../../engine/prefabs';
import type { Scene } from '../../engine/types';
import type { Observable, ProjectReader, ProjectWriter, SceneSwitcher } from '../store';
import { setBlocks } from '../blocks/codegen';
import { h, openMenu } from '../ui';
import { claimMenu, sceneMarks, type PresenceView } from './presence';

export type ScenesStore = Observable & ProjectReader & ProjectWriter & SceneSwitcher;

/** MIME type used when dragging a scene (actor, or a level as a room) into a level. */
export const SCENE_DRAG_TYPE = 'application/x-engine-scene';

function sceneItem(store: ScenesStore, s: Scene, presence?: PresenceView): HTMLElement {
  const isMain = s.id === store.project.mainSceneId;
  const formOf = s.kind === 'actor' ? formUsers(store.project, s.id)[0] : undefined;
  const badge = isMain ? 'main' : formOf ? `form of ${formOf.container.name}` : null;
  const item = h('li', {
    class: `tree-item ${s.id === store.sceneId ? 'selected' : ''}`,
    title: s.kind === 'actor' ? 'Click to edit · drag into a level to place' : 'Click to open · drag into another level to place it there (rooms → buildings → worlds)',
    draggable: true,
    onClick: () => store.setScene(s.id),
  }, h('span', { class: 'icon' }, s.kind === 'level' ? '▦' : formOf ? '◈' : '☺'), s.name, badge ? h('span', { class: 'badge' }, badge) : null,
    ...(presence ? sceneMarks(presence.marks(s.id)) : []));
  if (presence) {
    item.title += ' · right-click: “I’m working on this”';
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, claimMenu(presence, s.id));
    });
  }
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(SCENE_DRAG_TYPE, s.id);
    e.dataTransfer!.effectAllowed = 'copy';
  });
  return item;
}

/** With `presence` (a shared project), each scene shows who is in it and who claimed it. */
export function mountScenes(root: HTMLElement, store: ScenesStore, presence?: PresenceView): void {
  const render = () => {
    const levels = store.project.scenes.filter((s) => s.kind === 'level');
    const actors = store.project.scenes.filter((s) => s.kind === 'actor');
    const add = (s: Scene) => {
      store.commit((p) => p.scenes.push(s));
      store.setScene(s.id);
    };
    root.replaceChildren(
      h('div', { class: 'panel-title' }, 'Scenes', h('span', { class: 'spacer' }),
        h('button', { class: 'small', title: 'New level', onClick: () => add(createLevelScene(`Level ${levels.length + 1}`, store.level?.view ?? 'side')) }, '+ Level'),
        h('button', {
          class: 'small',
          title: 'New actor scene (character, NPC, object…), programmed in TypeScript or with blocks',
          onClick: (e: MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const name = `Actor ${actors.length + 1}`;
            openMenu(r.left, r.bottom + 2, [
              ['{ } Script actor', () => add(createActorScene(name)), 'Behaviour written in TypeScript'],
              ['▦ Blocks actor', () => add(setBlocks(createActorScene(name))), 'Behaviour built from Scratch-like blocks (can be converted to code later, not back)'],
            ]);
          },
        }, '+ Actor ▾'),
      ),
      h('div', { class: 'group-label' }, 'Levels'),
      h('ul', { class: 'tree' }, ...levels.map((s) => sceneItem(store, s, presence))),
      h('div', { class: 'group-label' }, 'Actors'),
      h('ul', { class: 'tree' }, ...actors.map((s) => sceneItem(store, s, presence))),
    );
  };
  store.subscribe((reason) => {
    if (reason === 'change') render();
  });
  presence?.subscribe(render);
  render();
}
