import { type SceneLookup, findActorScene, findLevel, formUsers } from '../../engine/prefabs';
import type { ActorScene, Entity, LevelScene } from '../../engine/types';
import type { Observable, ProjectReader, ProjectWriter, SceneSwitcher, SelectionModel } from '../store';
import { h } from '../ui';
import { addForm, addState } from './inspect-actor';
import { type TreeOptions, arrangeEntities } from './tree-arrange';

export type HierarchyStore = Observable & ProjectReader & ProjectWriter & SelectionModel & SceneSwitcher;

export function entityIcon(e: Entity, lookup?: SceneLookup): string {
  if (e.type === 'projectile') return '➤';
  if (e.type === 'path') return '〰';
  if (e.type === 'zone') return '⬠';
  if (e.type === 'instance') return findLevel(lookup ?? { scenes: [] }, e.sceneId) ? '▦' : '☺';
  return e.shape.kind === 'rect' ? '▭' : e.shape.kind === 'circle' ? '◯' : '╱';
}

function item(store: HierarchyStore, sel: { kind: 'entity' | 'part'; id: string }, icon: string, label: string, cls = ''): HTMLElement {
  const cur = store.selection;
  const selected = cur?.kind === sel.kind && cur.id === sel.id;
  return h('li', { class: `tree-item ${cls} ${selected ? 'selected' : ''}`, onClick: () => store.select(sel) }, h('span', { class: 'icon' }, icon), label);
}

// ---------------------------------------------------------------------------
// View preferences (per browser, not part of the project)
// ---------------------------------------------------------------------------

const PREFS_KEY = 'ge.tree.v1';

interface TreePrefs extends TreeOptions {
  collapsed: string[];
}

function loadPrefs(): TreePrefs {
  const fallback: TreePrefs = { group: false, sortByName: false, collapsed: [] };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<TreePrefs>) };
  } catch {
    return fallback;
  }
}

function savePrefs(p: TreePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

const prefs = loadPrefs();

function entityItem(store: HierarchyStore, e: Entity, nested: boolean): HTMLElement {
  const li = item(store, { kind: 'entity', id: e.id }, entityIcon(e, store.project), e.name, `type-${e.type} ${nested ? 'nested' : ''}`);
  if (e.type === 'instance' && !prefs.group) {
    const scene = store.project.scenes.find((s) => s.id === e.sceneId);
    li.append(h('span', { class: 'badge' }, scene?.name ?? 'missing'));
  }
  return li;
}

function levelTree(store: HierarchyStore, level: LevelScene, rerender: () => void): HTMLElement {
  const sceneName = (id: string) => store.project.scenes.find((s) => s.id === id)?.name;
  const groups = arrangeEntities(level.entities, sceneName, prefs, (id) => !!findLevel(store.project, id));
  const selectedId = store.selection?.kind === 'entity' ? store.selection.id : null;
  const list = h('ul', { class: 'tree' });
  for (const g of groups) {
    if (!prefs.group) {
      list.append(...g.items.map((e) => entityItem(store, e, false)));
      continue;
    }
    // A collapsed group still opens when it holds the selection (e.g. picked in the viewport).
    const collapsed = prefs.collapsed.includes(g.key) && !g.items.some((e) => e.id === selectedId);
    const toggle = () => {
      prefs.collapsed = prefs.collapsed.includes(g.key) ? prefs.collapsed.filter((k) => k !== g.key) : [...prefs.collapsed, g.key];
      savePrefs(prefs);
      rerender();
    };
    list.append(
      h('li', { class: 'tree-group', onClick: toggle, title: collapsed ? 'Expand' : 'Collapse' },
        h('span', { class: 'caret' }, collapsed ? '▸' : '▾'),
        h('span', { class: 'icon' }, g.icon),
        g.label,
        h('span', { class: 'badge' }, String(g.items.length)),
      ),
    );
    if (!collapsed) list.append(...g.items.map((e) => entityItem(store, e, true)));
  }
  return list;
}

function treeOptions(rerender: () => void): HTMLElement {
  const toggle = (label: string, title: string, key: 'group' | 'sortByName') =>
    h('button', {
      class: `small ${prefs[key] ? 'active' : ''}`,
      title,
      onClick: () => {
        prefs[key] = !prefs[key];
        savePrefs(prefs);
        rerender();
      },
    }, label);
  return h('span', { class: 'tree-options' },
    toggle('⊞', 'Group children by type', 'group'),
    toggle('A–Z', 'Sort by name (off = scene order)', 'sortByName'),
  );
}

function actorTree(store: HierarchyStore, scene: ActorScene): HTMLElement {
  const d = scene.actor;
  // A form scene's own forms would be ignored, so don't offer them.
  const isForm = formUsers(store.project, scene.id).length > 0 && !d.forms.length;
  return h('ul', { class: 'tree' },
    item(store, { kind: 'part', id: 'body' }, '◼', 'Body & collider'),
    item(store, { kind: 'part', id: 'visual' }, '🖼', 'Visual'),
    item(store, { kind: 'part', id: 'script' }, '{ }', 'Script'),
    h('li', { class: 'group-label' }, 'States',
      h('button', { class: 'small', title: 'Add state', onClick: () => addState(store, scene.id, d) }, '+')),
    ...d.states.map((s) =>
      item(
        store,
        { kind: 'part', id: `state:${s.name}` },
        s.name === d.initialState ? '▶' : '◇',
        s.name + (s.animation ? `  · ${s.animation}` : '') + (s.body ? '  ▭' : ''),
        'nested',
      ),
    ),
    isForm ? null : h('li', { class: 'group-label', title: 'Other actor scenes this one can switch into: self.setForm(name)' }, 'Forms',
      h('button', { class: 'small', title: 'Add a form (copies this look into a new form scene)', onClick: () => addForm(store, scene) }, '+')),
    ...d.forms.map((f) => {
      const li = item(store, { kind: 'part', id: `form:${f.name}` }, '◈', f.name, 'nested');
      li.append(h('span', { class: 'badge' }, findActorScene(store.project, f.sceneId)?.name ?? 'missing'));
      li.title = 'Double-click to open the form scene';
      li.addEventListener('dblclick', () => store.setScene(f.sceneId));
      return li;
    }),
  );
}

export function mountHierarchy(root: HTMLElement, store: HierarchyStore): void {
  const render = () => {
    const level = store.level;
    const actor = store.actorScene;
    const scene = store.scene;
    root.replaceChildren(
      h('div', { class: 'panel-title' }, 'Scene tree', h('span', { class: 'spacer' }), level ? treeOptions(render) : ''),
      h('div', { class: `tree-item scene ${store.selection === null ? 'selected' : ''}`, onClick: () => store.select(null) },
        `${level ? '▦' : '☺'} ${scene.name}`),
      level ? levelTree(store, level, render) : actor ? actorTree(store, actor) : '',
    );
  };
  store.subscribe((reason) => {
    if (reason === 'change' || reason === 'selection') render();
  });
  render();
}
