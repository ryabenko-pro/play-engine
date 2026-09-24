import { AssetStore } from '../engine/assets';
import type { Asset, Entity, Project, Scene } from '../engine/types';
import { clone } from '../engine/util';

export type Tool = 'select' | 'rect' | 'circle' | 'line' | 'player' | 'npc' | 'projectile';
export type Selection = { kind: 'entity' | 'asset'; id: string } | null;

/** Why listeners are notified; lets panels skip work they don't care about. */
export type ChangeReason = 'change' | 'gesture' | 'selection' | 'tool' | 'play' | 'log' | 'status' | 'assets-loaded';

const STORAGE_KEY = 'ge.project.v1';
const MAX_UNDO = 100;

// ---------------------------------------------------------------------------
// Small interfaces consumed by panels
// ---------------------------------------------------------------------------

export interface Observable {
  subscribe(fn: (reason: ChangeReason) => void): () => void;
}

export interface ProjectReader {
  readonly project: Project;
  readonly scene: Scene;
  entity(id: string): Entity | undefined;
  asset(id: string): Asset | undefined;
}

export interface ProjectWriter {
  /** Mutate the project as one undoable step. */
  commit(mutate: (p: Project) => void): void;
  replaceProject(p: Project): void;
}

/** For continuous edits (dragging): many mutations, one undo step. */
export interface GestureWriter {
  beginGesture(): void;
  gestureUpdate(): void;
  endGesture(changed: boolean): void;
}

export interface History {
  undo(): void;
  redo(): void;
}

export interface SceneSwitcher {
  readonly sceneId: string;
  setScene(id: string): void;
}

export interface SelectionModel {
  readonly selection: Selection;
  select(sel: Selection): void;
}

export interface ToolModel {
  readonly tool: Tool;
  snap: boolean;
  setTool(t: Tool): void;
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

export class Store
  implements
    Observable,
    ProjectReader,
    ProjectWriter,
    GestureWriter,
    History,
    SceneSwitcher,
    SelectionModel,
    ToolModel,
    PlayState,
    LogSink,
    LogSource,
    StatusLine,
    Persistence,
    AssetCache
{
  project: Project;
  sceneId: string;
  selection: Selection = null;
  tool: Tool = 'select';
  snap = true;
  playing = false;
  status = '';
  logs: string[] = [];
  readonly assets: AssetStore;

  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private pending: Project | null = null;
  private listeners = new Set<(reason: ChangeReason) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(project: Project) {
    this.project = project;
    this.sceneId = project.mainSceneId;
    this.assets = new AssetStore(project.assets, () => this.emit('assets-loaded'));
    this.fixSceneId();
  }

  static load(): Project | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as Project;
      return isProject(p) ? p : null;
    } catch {
      return null;
    }
  }

  get scene(): Scene {
    return this.project.scenes.find((s) => s.id === this.sceneId) ?? this.project.scenes[0];
  }

  entity(id: string): Entity | undefined {
    return this.scene.entities.find((e) => e.id === id);
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
    this.pushUndo(clone(this.project));
    mutate(this.project);
    this.afterChange();
  }

  beginGesture(): void {
    this.pending = clone(this.project);
  }

  gestureUpdate(): void {
    this.emit('gesture');
  }

  endGesture(changed: boolean): void {
    if (changed && this.pending) {
      this.pushUndo(this.pending);
      this.afterChange();
    }
    this.pending = null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(clone(this.project));
    this.project = prev;
    this.afterChange();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.project));
    this.project = next;
    this.afterChange();
  }

  replaceProject(p: Project): void {
    this.project = p;
    this.sceneId = p.mainSceneId;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.afterChange();
  }

  setScene(id: string): void {
    this.sceneId = id;
    this.selection = null;
    this.emit('change');
  }

  select(sel: Selection): void {
    this.selection = sel;
    this.emit('selection');
  }

  setTool(t: Tool): void {
    this.tool = t;
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
      this.setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch {
      this.setStatus('Autosave failed (browser storage full) – use Export');
    }
  }

  private setStatus(s: string): void {
    this.status = s;
    this.emit('status');
  }

  private pushUndo(snapshot: Project): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  private fixSceneId(): void {
    if (!this.project.scenes.some((s) => s.id === this.sceneId)) this.sceneId = this.project.scenes[0].id;
  }

  private afterChange(): void {
    this.fixSceneId();
    this.assets.sync(this.project.assets);
    const sel = this.selection;
    if (sel && !(sel.kind === 'entity' ? this.entity(sel.id) : this.asset(sel.id))) this.selection = null;
    this.emit('change');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }
}

export function isProject(p: unknown): p is Project {
  const o = p as Project;
  return !!o && o.version === 1 && Array.isArray(o.scenes) && o.scenes.length > 0 && Array.isArray(o.assets);
}

/** Removes an asset and clears every reference to it. */
export function removeAsset(p: Project, id: string): void {
  p.assets = p.assets.filter((a) => a.id !== id);
  for (const a of p.assets) {
    if (a.type === 'sprite' && a.imageId === id) a.imageId = null;
    if (a.type === 'projectile' && a.spriteId === id) a.spriteId = null;
  }
  for (const s of p.scenes) {
    for (const e of s.entities) {
      if (e.type === 'block' && e.textureId === id) e.textureId = null;
      if (e.type === 'character') {
        if (e.spriteId === id) e.spriteId = null;
        if (e.projectileId === id) e.projectileId = null;
      }
      if (e.type === 'projectile' && e.projectileId === id) e.projectileId = null;
    }
  }
}
