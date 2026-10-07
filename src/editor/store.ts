import { AssetStore } from '../engine/assets';
import { migrateProject } from '../engine/migrate';
import { ScriptCache } from '../engine/scripting';
import type { ActorScene, Asset, Entity, LevelScene, Project, Scene } from '../engine/types';
import { SceneHistory, type Snapshot } from './history';

export type Tool = 'select' | 'rect' | 'circle' | 'line' | 'instance' | 'projectile' | 'path' | 'zone';

/**
 * - entity: an object in the open level
 * - asset: an asset
 * - part: a part of the open actor scene: 'body' | 'visual' | 'script' | 'state:<name>'
 * - null: the open scene itself
 */
export type Selection = { kind: 'entity' | 'asset' | 'part'; id: string } | null;

/** Why listeners are notified; lets panels skip work they don't care about. */
export type ChangeReason = 'change' | 'gesture' | 'selection' | 'tool' | 'play' | 'log' | 'status' | 'assets-loaded';

const STORAGE_KEY = 'ge.project.v3';
const TABS_KEY = 'ge.tabs.v1';

// ---------------------------------------------------------------------------
// Small interfaces consumed by panels
// ---------------------------------------------------------------------------

export interface Observable {
  subscribe(fn: (reason: ChangeReason) => void): () => void;
}

export interface ProjectReader {
  readonly project: Project;
  readonly scene: Scene;
  /** The open scene if it is a level. */
  readonly level: LevelScene | null;
  /** The open scene if it is an actor scene. */
  readonly actorScene: ActorScene | null;
  /** Entity of the open level. */
  entity(id: string): Entity | undefined;
  asset(id: string): Asset | undefined;
}

export interface ProjectWriter {
  /** Mutate the project as one undoable step. */
  commit(mutate: (p: Project) => void): void;
  /** keepView: stay on the open tabs (another version of the same project). */
  replaceProject(p: Project, keepView?: boolean): void;
}

/** For continuous edits (dragging): many mutations, one undo step. */
export interface GestureWriter {
  beginGesture(): void;
  gestureUpdate(): void;
  endGesture(changed: boolean): void;
}

/** Undo/redo of the active scene (plus project-wide changes), like Godot's per-scene history. */
export interface History {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface SceneSwitcher {
  readonly sceneId: string;
  /** Opens the scene in a tab (or activates its tab). */
  setScene(id: string): void;
}

export interface SceneTabs extends SceneSwitcher {
  readonly openScenes: readonly string[];
  closeScene(id: string): void;
}

export interface SelectionModel {
  readonly selection: Selection;
  select(sel: Selection): void;
}

export interface ToolModel {
  readonly tool: Tool;
  /** Actor scene placed by the 'instance' tool. */
  readonly instanceSceneId: string | null;
  snap: boolean;
  setTool(t: Tool, instanceSceneId?: string): void;
}

export interface PlayState {
  readonly playing: boolean;
  setPlaying(v: boolean): void;
}

export interface LogSink {
  log(msg: string): void;
}

export interface LogSource {
  readonly logs: readonly string[];
  clearLogs(): void;
}

export interface StatusLine {
  readonly status: string;
}

export interface Persistence {
  save(): void;
}

export interface AssetCache {
  readonly assets: AssetStore;
}

export interface ScriptCompiler {
  /** Compiled actor scripts, shared by the editor (props, errors) and play mode. */
  readonly scripts: ScriptCache;
}

export interface StorageKeys {
  project: string;
  tabs: string;
}

export class Store
  implements
    Observable,
    ProjectReader,
    ProjectWriter,
    GestureWriter,
    History,
    SceneTabs,
    SelectionModel,
    ToolModel,
    PlayState,
    LogSink,
    LogSource,
    StatusLine,
    Persistence,
    AssetCache,
    ScriptCompiler
{
  project: Project;
  sceneId: string;
  selection: Selection = null;
  tool: Tool = 'select';
  instanceSceneId: string | null = null;
  snap = true;
  playing = false;
  status = '';
  logs: string[] = [];
  readonly assets: AssetStore;
  readonly scripts = new ScriptCache();

  openScenes: string[] = [];

  private history = new SceneHistory();
  private pending: Snapshot | null = null;
  /** Selection of each open tab, restored when switching back. */
  private selections = new Map<string, Selection>();
  private listeners = new Set<(reason: ChangeReason) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Where autosave and open tabs are kept (a shared project keeps its own). */
  private readonly keys: StorageKeys;

  constructor(project: Project, keys: StorageKeys = { project: STORAGE_KEY, tabs: TABS_KEY }) {
    this.keys = keys;
    this.project = project;
    this.sceneId = project.mainSceneId;
    this.assets = new AssetStore(project.assets, () => this.emit('assets-loaded'));
    this.restoreTabs();
    this.fixSceneId();
  }

  static load(key = STORAGE_KEY): Project | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return migrateProject(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  get scene(): Scene {
    return this.project.scenes.find((s) => s.id === this.sceneId) ?? this.project.scenes[0];
  }

  get level(): LevelScene | null {
    const s = this.scene;
    return s.kind === 'level' ? s : null;
  }

  get actorScene(): ActorScene | null {
    const s = this.scene;
    return s.kind === 'actor' ? s : null;
  }

  entity(id: string): Entity | undefined {
    return this.level?.entities.find((e) => e.id === id);
  }

  asset(id: string): Asset | undefined {
    return this.project.assets.find((a) => a.id === id);
  }

  subscribe(fn: (reason: ChangeReason) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason: ChangeReason): void {
    for (const fn of this.listeners) fn(reason);
  }

  commit(mutate: (p: Project) => void): void {
    const before = this.history.capture(this.project);
    mutate(this.project);
    this.history.record(before, this.project);
    this.afterChange();
  }

  beginGesture(): void {
    this.pending = this.history.capture(this.project);
  }

  gestureUpdate(): void {
    this.emit('gesture');
  }

  endGesture(changed: boolean): void {
    if (changed && this.pending) {
      this.history.record(this.pending, this.project);
      this.afterChange();
    }
    this.pending = null;
  }

  undo(): void {
    if (this.history.undo(this.project, this.sceneId)) this.afterChange();
  }

  redo(): void {
    if (this.history.redo(this.project, this.sceneId)) this.afterChange();
  }

  canUndo(): boolean {
    return this.history.canUndo(this.sceneId);
  }

  canRedo(): boolean {
    return this.history.canRedo(this.sceneId);
  }

  replaceProject(p: Project, keepView = false): void {
    this.project = p;
    if (!keepView) {
      this.sceneId = p.mainSceneId;
      this.openScenes = [p.mainSceneId];
      this.selections.clear();
      this.selection = null;
    }
    this.history.clear();
    this.afterChange();
  }

  setScene(id: string): void {
    if (!this.project.scenes.some((s) => s.id === id)) return;
    if (id === this.sceneId && this.openScenes.includes(id)) return;
    this.selections.set(this.sceneId, this.selection);
    if (!this.openScenes.includes(id)) {
      // Open next to the active tab, like Godot.
      const at = this.openScenes.indexOf(this.sceneId);
      this.openScenes.splice(at < 0 ? this.openScenes.length : at + 1, 0, id);
    }
    this.sceneId = id;
    this.selection = this.selections.get(id) ?? null;
    if (!this.selectionExists()) this.selection = null;
    this.saveTabs();
    this.emit('change');
  }

  closeScene(id: string): void {
    const i = this.openScenes.indexOf(id);
    if (i < 0 || this.openScenes.length <= 1) return;
    this.openScenes.splice(i, 1);
    this.selections.delete(id);
    if (id === this.sceneId) {
      this.sceneId = '';
      this.setScene(this.openScenes[Math.min(i, this.openScenes.length - 1)]);
    } else {
      this.saveTabs();
      this.emit('change');
    }
  }

  select(sel: Selection): void {
    this.selection = sel;
    this.emit('selection');
  }

  setTool(t: Tool, instanceSceneId?: string): void {
    this.tool = t;
    if (instanceSceneId) this.instanceSceneId = instanceSceneId;
    this.emit('tool');
  }

  setPlaying(v: boolean): void {
    this.playing = v;
    this.emit('play');
  }

  log(msg: string): void {
    this.logs.push(msg);
    if (this.logs.length > 200) this.logs.shift();
    this.emit('log');
  }

  clearLogs(): void {
    this.logs = [];
    this.emit('log');
  }

  save(): void {
    clearTimeout(this.saveTimer);
    try {
      localStorage.setItem(this.keys.project, JSON.stringify(this.project));
      this.setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch {
      this.setStatus('Autosave failed (browser storage full) – use Export');
    }
  }

  private setStatus(s: string): void {
    this.status = s;
    this.emit('status');
  }

  /** Keeps tabs pointing at existing scenes; the active scene always has a tab. */
  private fixSceneId(): void {
    const exists = (id: string) => this.project.scenes.some((s) => s.id === id);
    for (const id of this.openScenes) if (!exists(id)) this.selections.delete(id);
    this.openScenes = this.openScenes.filter(exists);
    if (!exists(this.sceneId)) this.sceneId = this.openScenes[0] ?? this.project.mainSceneId;
    if (!exists(this.sceneId)) this.sceneId = this.project.scenes[0].id;
    if (!this.openScenes.includes(this.sceneId)) this.openScenes.push(this.sceneId);
  }

  private restoreTabs(): void {
    try {
      const t = JSON.parse(localStorage.getItem(this.keys.tabs) ?? 'null') as { open?: string[]; active?: string } | null;
      if (t?.open) this.openScenes = t.open;
      if (t?.active) this.sceneId = t.active;
    } catch {
      // No saved tabs: start with the main scene.
    }
  }

  private saveTabs(): void {
    try {
      localStorage.setItem(this.keys.tabs, JSON.stringify({ open: this.openScenes, active: this.sceneId }));
    } catch {
      // Tabs are a convenience; ignore storage failures.
    }
  }

  private selectionExists(): boolean {
    const sel = this.selection;
    if (!sel) return true;
    if (sel.kind === 'entity') return !!this.entity(sel.id);
    if (sel.kind === 'asset') return !!this.asset(sel.id);
    const actor = this.actorScene?.actor;
    if (!actor) return false;
    return !sel.id.startsWith('state:') || actor.states.some((s) => `state:${s.name}` === sel.id);
  }

  private afterChange(): void {
    this.fixSceneId();
    this.saveTabs();
    this.assets.sync(this.project.assets);
    if (!this.selectionExists()) this.selection = null;
    this.emit('change');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }
}

/** Removes an asset and clears every reference to it. */
export function removeAsset(p: Project, id: string): void {
  p.assets = p.assets.filter((a) => a.id !== id);
  for (const a of p.assets) {
    if (a.type === 'sprite' && a.imageId === id) a.imageId = null;
    if (a.type === 'projectile' && a.spriteId === id) a.spriteId = null;
  }
  for (const s of p.scenes) {
    if (s.kind === 'actor') {
      if (s.actor.spriteId === id) s.actor.spriteId = null;
      continue;
    }
    for (const e of s.entities) {
      if (e.type === 'block' && e.textureId === id) e.textureId = null;
      if (e.type === 'projectile' && e.projectileId === id) e.projectileId = null;
    }
  }
}

/** Number of instances of a scene (actor or level) across all levels. */
export function instanceUsage(p: Project, sceneId: string): number {
  let n = 0;
  for (const s of p.scenes) if (s.kind === 'level') n += s.entities.filter((e) => e.type === 'instance' && e.sceneId === sceneId).length;
  return n;
}

/** Removes a scene; instances of it are removed from every level, and forms using it from every actor. */
export function removeScene(p: Project, id: string): void {
  p.scenes = p.scenes.filter((s) => s.id !== id);
  for (const s of p.scenes) {
    if (s.kind === 'level') s.entities = s.entities.filter((e) => e.type !== 'instance' || e.sceneId !== id);
    else s.actor.forms = s.actor.forms.filter((f) => f.sceneId !== id);
  }
  if (p.mainSceneId === id) p.mainSceneId = p.scenes.find((s) => s.kind === 'level')?.id ?? p.scenes[0]?.id ?? '';
}
