import { levelContains } from '../../engine/prefabs';
import type { ViewMode } from '../../engine/types';
import type { History, Observable, PlayState, ProjectReader, ProjectWriter, SceneSwitcher, StatusLine, Tool, ToolModel } from '../store';
import { modules } from '../modules';
import { h, openMenu } from '../ui';

export interface PlayControls {
  togglePlay(): void;
  frameAll(): void;
}

export interface DebugControls {
  readonly debug: boolean;
  toggleDebug(): void;
}

export interface PanelToggles {
  /** The project-wide Interactions editor. */
  readonly interactions: { readonly open: boolean; toggle(): void };
}

export interface ProjectActions {
  newProject(): void;
  loadDemo(): void;
  loadTanks(): void;
  loadAura(): void;
  loadTowerDefence(): void;
  importProject(): void;
  exportProject(): void;
  /** The project as a folder of text files (for git), zipped. */
  exportFolder(): void;
  runInTab(): void;
}

/** A shared project (opened from the sync server): Save and Get latest instead of New / Import. */
export interface SharedControls {
  readonly name: string;
  readonly me: string;
  readonly busy: boolean;
  /** Someone saved a newer version. */
  readonly behind: boolean;
  /** I have unsaved changes. */
  dirty(): boolean;
  save(): void;
  getLatest(): void;
  history(): void;
}

export type ToolbarStore = Observable & ProjectReader & ProjectWriter & SceneSwitcher & ToolModel & PlayState & History & StatusLine;

const SHAPE_TOOLS: Array<[Tool, string, string]> = [
  ['select', '⬚ Select', 'V'],
  ['rect', '▭ Rect', 'R'],
  ['circle', '◯ Circle', 'C'],
  ['line', '╱ Line', 'L'],
  ['projectile', '➤ Projectile', 'B'],
  ['path', '〰 Path', 'P'],
  ['zone', '⬠ Zone', 'Z'],
];

const VIEWS: Array<[ViewMode, string]> = [
  ['side', 'Side view'],
  ['topdown', 'Top-down'],
  ['isometric', 'Isometric'],
];

function viewSelect(value: ViewMode, title: string, onChange: (v: ViewMode) => void): HTMLSelectElement {
  return h(
    'select',
    { title, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value as ViewMode) },
    ...VIEWS.map(([v, l]) => h('option', { value: v, selected: v === value }, l)),
  );
}

export function mountToolbar(
  root: HTMLElement,
  store: ToolbarStore,
  play: PlayControls & DebugControls,
  actions: ProjectActions,
  panels: PanelToggles,
  shared?: SharedControls,
): () => void {
  const render = () => {
    const level = store.level;
    const actor = store.actorScene;
    const setView = (v: ViewMode) => {
      const id = store.sceneId;
      store.commit((p) => {
        const s = p.scenes.find((x) => x.id === id);
        if (s?.kind === 'level') s.view = v;
        if (s?.kind === 'actor') s.previewView = v;
      });
      play.frameAll();
    };

    let sceneGroup: HTMLElement;
    let toolsGroup: HTMLElement | null = null;
    if (level) {
      sceneGroup = h('div', { class: 'group' }, h('span', { class: 'scene-kind' }, '▦ Level'), h('strong', {}, level.name), viewSelect(level.view, 'Projection of this level', setView));
      const actors = store.project.scenes.filter((s) => s.kind === 'actor');
      const rooms = store.project.scenes.filter((s) => s.kind === 'level' && !levelContains(store.project, s.id, level.id));
      const placing = store.tool === 'instance' ? store.project.scenes.find((s) => s.id === store.instanceSceneId) : undefined;
      const instanceSel = h(
        'select',
        {
          class: placing ? 'active' : '',
          title: 'Place an instance of an actor scene, or another level as a room (or drag it from the Scenes dock)',
          onChange: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            if (id) store.setTool('instance', id);
          },
        },
        h('option', { value: '' }, '☺ Place…'),
        h('optgroup', { label: 'Actors' }, ...actors.map((c) => h('option', { value: c.id, selected: placing?.id === c.id }, c.name))),
        rooms.length ? h('optgroup', { label: 'Levels (rooms, buildings)' }, ...rooms.map((c) => h('option', { value: c.id, selected: placing?.id === c.id }, `▦ ${c.name}`))) : null,
      );
      toolsGroup = h('div', { class: 'group tools' },
        ...SHAPE_TOOLS.map(([t, label, key]) =>
          h('button', { class: store.tool === t ? 'active' : '', title: `${label.slice(2)} (${key})`, onClick: () => store.setTool(t) }, label),
        ),
        instanceSel,
        h('label', { class: 'toggle', title: 'Snap to grid (hold Alt to bypass)' },
          h('input', { type: 'checkbox', checked: store.snap, onChange: (e: Event) => (store.snap = (e.target as HTMLInputElement).checked) }),
          'Snap',
        ),
      );
    } else {
      sceneGroup = h('div', { class: 'group' },
        h('span', { class: 'scene-kind char' }, '☺ Actor'),
        h('strong', {}, actor?.name ?? ''),
        viewSelect(actor?.previewView ?? 'side', 'Preview / test view', setView),
      );
    }

    root.replaceChildren(
      h('div', { class: 'group' }, h('strong', { class: 'logo' }, '◆ Engine')),
      sceneGroup,
      toolsGroup ?? '',
      h('div', { class: 'group' },
        h('button', { title: 'Undo in this scene (Ctrl+Z)', disabled: !store.canUndo(), onClick: () => store.undo() }, '↶'),
        h('button', { title: 'Redo in this scene (Ctrl+Shift+Z)', disabled: !store.canRedo(), onClick: () => store.redo() }, '↷'),
        h('button', { title: 'Frame all (F)', onClick: () => play.frameAll() }, '⤢'),
        h('button', {
          class: play.debug ? 'active' : '',
          title: 'Debug overlay: FPS, simulation / render time % (F3)',
          onClick: () => (play.toggleDebug(), render()),
        }, '🐞'),
        !modules.interactions ? null : h('button', {
          class: panels.interactions.open ? 'active' : '',
          title: 'Interactions: kinds, elements (fire, water…), statuses and reactions of the whole project',
          onClick: () => (panels.interactions.toggle(), render()),
        }, '⚗ Interactions'),
      ),
      h('div', { class: 'group' },
        h('button', { class: `play ${store.playing ? 'playing' : ''}`, title: 'Play / Stop (F5, Esc to stop)', onClick: () => play.togglePlay() },
          store.playing ? '■ Stop' : level ? '▶ Play' : '▶ Test'),
        level ? h('button', { title: 'Run this level in a new tab (standalone player)', onClick: actions.runInTab }, '⧉ Run in tab') : null,
      ),
      h('div', { class: 'group right' },
        h('span', { class: 'status' }, store.status),
        ...(shared ? sharedButtons(shared) : [
        h('button', { onClick: actions.newProject }, 'New'),
        h('button', { onClick: actions.loadDemo }, 'Demo'),
        h('button', { title: 'Load the Tanks example game', onClick: actions.loadTanks }, 'Tanks'),
        h('button', { title: 'Load course project 1: a Tower Defence game built only from blocks', onClick: actions.loadTowerDefence }, 'Tower Defence'),
        h('button', { title: 'Load the Aura demo: touch joystick, aura drawn by script, generated stub art', onClick: actions.loadAura }, 'Aura'),
        h('button', { title: 'Open a project file (.json) or a zipped project folder (.zip)', onClick: actions.importProject }, 'Import'),
        ]),
        h('button', {
          onClick: (e: MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu(r.left, r.bottom + 2, [
              ['Project file (.json)', actions.exportProject, 'One file: what play.html loads'],
              ['Project folder (.zip)', actions.exportFolder, 'One text file per level, actor, script and asset, ready for git'],
            ]);
          },
        }, 'Export ▾'),
      ),
    );
  };
  store.subscribe((reason) => {
    if (reason !== 'gesture' && reason !== 'log' && reason !== 'assets-loaded' && reason !== 'selection') render();
  });
  render();
  return render;
}

function sharedButtons(s: SharedControls): HTMLElement[] {
  const dirty = s.dirty();
  return [
    h('a', { class: 'shared-name', href: '/', title: `Shared project: everyone in it works on the same game. You are ${s.me}. Click for all projects.` }, `👥 ${s.name}`),
    h('button', { title: 'Every saved version: play it, undo it, or go back to it', onClick: () => s.history() }, '🕘 History'),
    h('button', {
      class: s.behind ? 'attention' : '',
      disabled: s.busy,
      title: s.behind ? 'Someone saved a newer version: get it (your unsaved changes stay)' : 'Check for changes saved by others',
      onClick: () => s.getLatest(),
    }, s.behind ? '⬇ Get latest •' : '⬇ Get latest'),
    h('button', {
      class: dirty ? 'primary' : '',
      disabled: s.busy,
      title: dirty ? 'Save your changes for everyone' : 'No changes to save',
      onClick: () => s.save(),
    }, s.busy ? '…' : '⬆ Save'),
  ];
}
