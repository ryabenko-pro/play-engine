import { createScene } from '../../engine/factory';
import type { ViewMode } from '../../engine/types';
import type { History, Observable, PlayState, ProjectReader, ProjectWriter, SceneSwitcher, StatusLine, Tool, ToolModel } from '../store';
import { h } from '../ui';

export interface PlayControls {
  togglePlay(): void;
  frameAll(): void;
}

export interface ProjectActions {
  newProject(): void;
  loadDemo(): void;
  importProject(): void;
  exportProject(): void;
  runInTab(): void;
}

export type ToolbarStore = Observable & ProjectReader & ProjectWriter & SceneSwitcher & ToolModel & PlayState & History & StatusLine;

const TOOLS: Array<[Tool, string, string]> = [
  ['select', '⬚ Select', 'V'],
  ['rect', '▭ Rect', 'R'],
  ['circle', '◯ Circle', 'C'],
  ['line', '╱ Line', 'L'],
  ['player', '☺ Player', 'P'],
  ['npc', '☻ NPC', 'N'],
  ['projectile', '➤ Projectile', 'B'],
];

const VIEWS: Array<[ViewMode, string]> = [
  ['side', 'Side view'],
  ['topdown', 'Top-down'],
  ['isometric', 'Isometric'],
];

export function mountToolbar(root: HTMLElement, store: ToolbarStore, play: PlayControls, actions: ProjectActions): void {
  const render = () => {
    const scene = store.scene;
    const sceneSel = h(
      'select',
      { title: 'Scene', onChange: (e: Event) => store.setScene((e.target as HTMLSelectElement).value) },
      ...store.project.scenes.map((s) => h('option', { value: s.id, selected: s.id === store.sceneId }, s.name)),
    );
    const addScene = h('button', {
      title: 'Add scene',
      onClick: () => {
        const s = createScene(`Scene ${store.project.scenes.length + 1}`, scene.view);
        store.commit((p) => p.scenes.push(s));
        store.setScene(s.id);
      },
    }, '+');
    const viewSel = h(
      'select',
      {
        title: 'Projection of the current scene',
        onChange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value as ViewMode;
          const id = scene.id;
          store.commit((p) => {
            const s = p.scenes.find((x) => x.id === id);
            if (s) s.view = v;
          });
          play.frameAll();
        },
      },
      ...VIEWS.map(([v, l]) => h('option', { value: v, selected: v === scene.view }, l)),
    );
    const tools = TOOLS.map(([t, label, key]) =>
      h('button', { class: store.tool === t ? 'active' : '', title: `${label.slice(2)} (${key})`, onClick: () => store.setTool(t) }, label),
    );
    const snap = h('label', { class: 'toggle', title: 'Snap to grid (hold Alt to bypass)' },
      h('input', { type: 'checkbox', checked: store.snap, onChange: (e: Event) => (store.snap = (e.target as HTMLInputElement).checked) }),
      'Snap',
    );

    root.replaceChildren(
      h('div', { class: 'group' }, h('strong', { class: 'logo' }, '◆ Engine'), sceneSel, addScene, viewSel),
      h('div', { class: 'group tools' }, ...tools, snap),
      h('div', { class: 'group' },
        h('button', { title: 'Undo (Ctrl+Z)', onClick: () => store.undo() }, '↶'),
        h('button', { title: 'Redo (Ctrl+Shift+Z)', onClick: () => store.redo() }, '↷'),
        h('button', { title: 'Frame all (F)', onClick: () => play.frameAll() }, '⤢'),
      ),
      h('div', { class: 'group' },
        h('button', { class: `play ${store.playing ? 'playing' : ''}`, title: 'Play / Stop (F5, Esc to stop)', onClick: () => play.togglePlay() }, store.playing ? '■ Stop' : '▶ Play'),
        h('button', { title: 'Run in a new browser tab (standalone player)', onClick: actions.runInTab }, '⧉ Run in tab'),
      ),
      h('div', { class: 'group right' },
        h('span', { class: 'status' }, store.status),
        h('button', { onClick: actions.newProject }, 'New'),
        h('button', { onClick: actions.loadDemo }, 'Demo'),
        h('button', { onClick: actions.importProject }, 'Import'),
        h('button', { onClick: actions.exportProject }, 'Export'),
      ),
    );
  };
  store.subscribe((reason) => {
    if (reason !== 'gesture' && reason !== 'log' && reason !== 'assets-loaded') render();
  });
  render();
}
