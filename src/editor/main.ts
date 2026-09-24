import { createEmptyProject } from '../engine/factory';
import { isTypingTarget } from '../engine/input';
import { createDemoProject } from './demo';
import { mountAssets } from './panels/assets';
import { mountConsole } from './panels/console';
import { mountHierarchy } from './panels/hierarchy';
import { deleteEntity, duplicateEntity, mountInspector } from './panels/inspector';
import { mountToolbar, type ProjectActions } from './panels/toolbar';
import { Store, isProject, type Tool } from './store';
import { download, pickFiles } from './ui';
import { EditorViewport } from './viewport';
import './style.css';

export const PLAY_STORAGE_KEY = 'ge.play';

const $ = (id: string) => document.getElementById(id)!;

const store = new Store(Store.load() ?? createDemoProject());
const viewport = new EditorViewport($('viewport'), store);

const actions: ProjectActions = {
  newProject() {
    if (confirm('Start a new empty project? Unsaved changes will be lost (use Export first).')) {
      store.replaceProject(createEmptyProject());
      viewport.frameAll();
    }
  },
  loadDemo() {
    if (confirm('Replace the current project with the demo?')) {
      store.replaceProject(createDemoProject());
      viewport.frameAll();
    }
  },
  async importProject() {
    const [file] = await pickFiles('.json,application/json', false);
    if (!file) return;
    try {
      const p: unknown = JSON.parse(await file.text());
      if (!isProject(p)) throw new Error('not a project file');
      store.replaceProject(p);
      viewport.frameAll();
      store.log(`Imported project "${p.name}"`);
    } catch (err) {
      store.log(`Import error: ${(err as Error).message}`);
    }
  },
  exportProject() {
    download('project.json', JSON.stringify(store.project, null, 2));
  },
  runInTab() {
    try {
      localStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify({ project: store.project, sceneId: store.sceneId }));
      window.open('play.html?source=editor', '_blank');
    } catch {
      store.log('Run in tab error: project too large for browser storage – Export it and serve play.html with project.json');
    }
  },
};

mountToolbar($('toolbar'), store, viewport, actions);
mountHierarchy($('hierarchy'), store);
mountInspector($('inspector'), store);
mountAssets($('assets'), store);
mountConsole($('console'), store);

store.subscribe((reason) => {
  if (reason === 'play') document.body.classList.toggle('playing', store.playing);
});

let lastScene = store.sceneId;
store.subscribe(() => {
  if (store.sceneId !== lastScene) {
    lastScene = store.sceneId;
    viewport.frameAll();
  }
});
requestAnimationFrame(() => viewport.frameAll());

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyR: 'rect',
  KeyC: 'circle',
  KeyL: 'line',
  KeyP: 'player',
  KeyN: 'npc',
  KeyB: 'projectile',
};

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.code === 'F5' || (ctrl && e.code === 'Enter')) {
    e.preventDefault();
    viewport.togglePlay();
    return;
  }
  if (store.playing) {
    if (e.code === 'Escape') viewport.stop();
    return;
  }
  const sel = store.selection?.kind === 'entity' ? store.entity(store.selection.id) : undefined;
  if (ctrl && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (ctrl && e.code === 'KeyY') {
    e.preventDefault();
    store.redo();
  } else if (ctrl && e.code === 'KeyS') {
    e.preventDefault();
    store.save();
  } else if (ctrl && e.code === 'KeyD') {
    e.preventDefault();
    if (sel) duplicateEntity(store, sel.id);
  } else if ((e.code === 'Delete' || e.code === 'Backspace') && sel) {
    deleteEntity(store, sel.id);
  } else if (e.code.startsWith('Arrow') && sel) {
    e.preventDefault();
    const step = e.shiftKey ? 1 : store.scene.gridSize;
    const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0;
    const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0;
    store.commit(() => {
      const cur = store.entity(sel.id);
      if (cur) {
        cur.x += dx;
        cur.y += dy;
      }
    });
  } else if (e.code === 'Escape') {
    if (store.tool !== 'select') store.setTool('select');
    else store.select(null);
  } else if (e.code === 'KeyF' && !ctrl) {
    viewport.frameAll();
  } else if (!ctrl && !e.altKey && TOOL_KEYS[e.code]) {
    store.setTool(TOOL_KEYS[e.code]);
  }
});

// Debug handle for the browser console.
Object.assign(window, { __editor: { store, viewport } });
