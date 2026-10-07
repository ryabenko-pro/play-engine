import { createEmptyProject } from '../engine/factory';
import { isTypingTarget } from '../engine/input';
import { createDemoProject } from './demo';
import { createAuraProject } from '../games/aura/project';
import { createTanksProject } from '../games/tanks/project';
import { createTowerDefenceProject } from '../games/td/project';
import { mountAssets } from './panels/assets';
import { mountConsole } from './panels/console';
import { mountHierarchy } from './panels/hierarchy';
import { deleteEntity, duplicateEntity } from './panels/inspect-level';
import { mountInspector } from './panels/inspector';
import { mountInteractions } from './panels/interactions';
import { mountScenes } from './panels/scenes';
import { mountScriptEditor } from './panels/script-editor';
import { mountTabs } from './panels/tabs';
import { mountToolbar, type ProjectActions, type SharedControls } from './panels/toolbar';
import { fileSlug } from '../engine/files';
import { migrateProject } from '../engine/migrate';
import { projectToZip, zipToProject } from './project-zip';
import { Store, type Tool } from './store';
import { Collab, sharedSlug } from './collab';
import { openHistory } from './panels/history';
import type { PresenceView } from './panels/presence';
import { getLatestFlow, saveFlow } from './panels/share';
import { download, h, pickFiles } from './ui';
import { EditorViewport } from './viewport';
import './style.css';

export const PLAY_STORAGE_KEY = 'ge.play';

const $ = (id: string) => document.getElementById(id)!;

/** Opened from the sync server (/p/<slug>/): a shared project, saved as versions for everyone. */
const slug = sharedSlug();
let collab: Collab | null = null;
let store: Store;
if (slug) {
  const keys = Collab.keys(slug);
  try {
    const opened = await Collab.open(slug, Store.load(keys.project));
    collab = opened.collab;
    store = new Store(opened.project, keys);
    document.title = `${collab.name} · Engine`;
  } catch (err) {
    document.body.replaceChildren(h('p', { class: 'fatal' }, `Can’t open the project: ${(err as Error).message}. `, h('a', { href: '/' }, 'All projects')));
    throw err;
  }
} else store = new Store(Store.load() ?? createDemoProject());
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
  loadTanks() {
    if (confirm('Replace the current project with the Tanks game?')) {
      store.replaceProject(createTanksProject());
      viewport.frameAll();
    }
  },
  loadTowerDefence() {
    if (confirm('Replace the current project with the Tower Defence course project (made only of blocks)?')) {
      store.replaceProject(createTowerDefenceProject());
      viewport.frameAll();
    }
  },
  loadAura() {
    if (confirm('Replace the current project with the Aura demo (touch controls, drawn aura, stub art)?')) {
      store.replaceProject(createAuraProject());
      viewport.frameAll();
    }
  },
  async importProject() {
    const [file] = await pickFiles('.json,application/json,.zip,application/zip', false);
    if (!file) return;
    try {
      const p = /\.zip$/i.test(file.name)
        ? zipToProject(new Uint8Array(await file.arrayBuffer()))
        : migrateProject(JSON.parse(await file.text()));
      if (!p) throw new Error('not a project file (or from a newer version)');
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
  exportFolder() {
    download(`${fileSlug(store.project.name)}.zip`, projectToZip(store.project) as Uint8Array<ArrayBuffer>, 'application/zip');
  },
  runInTab() {
    try {
      if (!store.level) return;
      localStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify({ project: store.project, sceneId: store.sceneId }));
      window.open('play.html?source=editor', '_blank');
    } catch {
      store.log('Run in tab error: project too large for browser storage – Export it and serve play.html with project.json');
    }
  },
};

const interactions = mountInteractions($('viewport'), store);
const shared: SharedControls | undefined = collab ? sharedControls(collab) : undefined;
const renderToolbar = mountToolbar($('toolbar'), store, viewport, actions, { interactions }, shared);
const presence: PresenceView | undefined = collab ? presenceView(collab) : undefined;
if (collab) {
  const c = collab;
  c.subscribe(() => renderToolbar());
  c.startPolling(() => ({ sceneId: store.sceneId, project: store.project }));
  store.subscribe((reason) => {
    if (reason === 'change') c.nudge();
  });
}

function presenceView(c: Collab): PresenceView {
  return {
    marks: (id) => c.marks(id),
    setClaim: (id, on) => void c.claim(id, on).catch((err: Error) => store.log(`Claim error: ${err.message}`)),
    subscribe: (fn) => c.subscribe(fn),
  };
}

function sharedControls(c: Collab): SharedControls {
  return {
    name: c.name,
    me: c.me.name,
    get busy() {
      return c.busy;
    },
    get behind() {
      return c.behind;
    },
    dirty: () => c.dirty(store.project),
    save: () => saveFlow(c, store),
    getLatest: () => void getLatestFlow(c, store),
    history: () => openHistory(c, store),
  };
}
mountScenes($('scenes'), store, presence);
mountTabs($('tabs'), store, presence);
mountHierarchy($('tree'), store);
mountInspector($('inspector'), store);
mountAssets($('assets'), store);
mountConsole($('console'), store);
mountScriptEditor($('viewport'), store, viewport);

store.subscribe((reason) => {
  if (reason === 'play') document.body.classList.toggle('playing', store.playing);
});


const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyR: 'rect',
  KeyC: 'circle',
  KeyL: 'line',
  KeyB: 'projectile',
  KeyP: 'path',
  KeyZ: 'zone',
};

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.code === 'F3') {
    e.preventDefault();
    viewport.toggleDebug();
    renderToolbar();
    return;
  }
  if (e.code === 'F5' || (ctrl && e.code === 'Enter')) {
    e.preventDefault();
    viewport.togglePlay();
    return;
  }
  if (store.playing) {
    if (e.code === 'Escape') viewport.stop();
    return;
  }
  if (viewport.drawKey(e)) return;
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
    const step = e.shiftKey ? 1 : (store.level?.gridSize ?? 16);
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
