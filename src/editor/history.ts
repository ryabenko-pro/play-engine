import type { Asset, Interactions, Project, Scene } from '../engine/types';
import { clone } from '../engine/util';

/**
 * Undo/redo split like Godot: every scene has its own history, and changes that are
 * not confined to one scene (assets, adding/removing scenes, project settings) go to a
 * shared project history. Entries store only the parts that changed.
 */

/** Project-wide state that isn't inside a single scene. */
interface ProjectMeta {
  name: string;
  mainSceneId: string;
  order: string[];
  assets: Asset[];
  interactions: Interactions | undefined;
}

type Part =
  | { kind: 'scene'; id: string; index: number; scene: Scene | null }
  | { kind: 'meta'; meta: ProjectMeta };

interface Entry {
  seq: number;
  /** Set when undone: the most recently undone entry is redone first. */
  undoneAt: number;
  parts: Part[];
}

interface Stacks {
  undo: Entry[];
  redo: Entry[];
}

export interface Snapshot {
  scenes: Map<string, { json: string; scene: Scene; index: number }>;
  meta: ProjectMeta;
}

export const PROJECT_HISTORY = 'project';
const MAX_ENTRIES = 100;

function metaOf(p: Project): ProjectMeta {
  return { name: p.name, mainSceneId: p.mainSceneId, order: p.scenes.map((s) => s.id), assets: clone(p.assets), interactions: clone(p.interactions) };
}

/** Compares assets without serializing large data-URL sources (clone() shares those strings). */
function sameMeta(a: ProjectMeta, b: ProjectMeta): boolean {
  if (a.name !== b.name || a.mainSceneId !== b.mainSceneId || a.order.join() !== b.order.join()) return false;
  if (JSON.stringify(a.interactions) !== JSON.stringify(b.interactions)) return false;
  if (a.assets.length !== b.assets.length) return false;
  return a.assets.every((x, i) => {
    const y = b.assets[i];
    const src = (v: Asset) => (v.type === 'image' ? v.src : '');
    const rest = (v: Asset) => JSON.stringify({ ...v, src: undefined });
    return src(x) === src(y) && rest(x) === rest(y);
  });
}

export class SceneHistory {
  private stacks = new Map<string, Stacks>();
  private seq = 0;
  private undoCounter = 0;

  capture(p: Project): Snapshot {
    const scenes = new Map<string, { json: string; scene: Scene; index: number }>();
    p.scenes.forEach((s, index) => scenes.set(s.id, { json: JSON.stringify(s), scene: clone(s), index }));
    return { scenes, meta: metaOf(p) };
  }

  /** Records what changed between `before` and the current project. Returns the history key used, or null if nothing changed. */
  record(before: Snapshot, p: Project): string | null {
    const parts = this.diff(before, p);
    if (!parts.length) return null;
    const key = parts.length === 1 && parts[0].kind === 'scene' ? parts[0].id : PROJECT_HISTORY;
    const st = this.stack(key);
    st.undo.push({ seq: ++this.seq, undoneAt: 0, parts });
    if (st.undo.length > MAX_ENTRIES) st.undo.shift();
    st.redo = [];
    return key;
  }

  canUndo(sceneId: string): boolean {
    return !!this.pick(sceneId, 'undo');
  }

  canRedo(sceneId: string): boolean {
    return !!this.pick(sceneId, 'redo');
  }

  /** Undoes the most recent change of this scene or of the project. Returns false if there is none. */
  undo(p: Project, sceneId: string): boolean {
    const found = this.pick(sceneId, 'undo');
    if (!found) return false;
    const { key, entry } = found;
    this.stack(key).undo.pop();
    const current = this.currentParts(p, entry.parts);
    this.apply(p, entry.parts);
    this.stack(key).redo.push({ seq: entry.seq, undoneAt: ++this.undoCounter, parts: current });
    return true;
  }

  redo(p: Project, sceneId: string): boolean {
    const found = this.pick(sceneId, 'redo');
    if (!found) return false;
    const { key, entry } = found;
    this.stack(key).redo.pop();
    const current = this.currentParts(p, entry.parts);
    this.apply(p, entry.parts);
    this.stack(key).undo.push({ seq: entry.seq, undoneAt: 0, parts: current });
    return true;
  }

  clear(): void {
    this.stacks.clear();
  }

  /** Drops the history of a scene that no longer exists. */
  forget(sceneId: string): void {
    this.stacks.delete(sceneId);
  }

  private stack(key: string): Stacks {
    let s = this.stacks.get(key);
    if (!s) this.stacks.set(key, (s = { undo: [], redo: [] }));
    return s;
  }

  private pick(sceneId: string, which: 'undo' | 'redo'): { key: string; entry: Entry } | null {
    let best: { key: string; entry: Entry } | null = null;
    for (const key of [sceneId, PROJECT_HISTORY]) {
      const list = this.stacks.get(key)?.[which];
      const entry = list?.[list.length - 1];
      if (!entry) continue;
      const rank = which === 'undo' ? entry.seq : entry.undoneAt;
      const bestRank = best ? (which === 'undo' ? best.entry.seq : best.entry.undoneAt) : -1;
      if (rank > bestRank) best = { key, entry };
    }
    return best;
  }

  private diff(before: Snapshot, p: Project): Part[] {
    const parts: Part[] = [];
    const ids = new Set([...before.scenes.keys(), ...p.scenes.map((s) => s.id)]);
    for (const id of ids) {
      const was = before.scenes.get(id);
      const now = p.scenes.find((s) => s.id === id);
      if (was && now && was.json === JSON.stringify(now)) continue;
      parts.push({ kind: 'scene', id, index: was?.index ?? -1, scene: was ? was.scene : null });
    }
    if (!sameMeta(before.meta, metaOf(p))) parts.push({ kind: 'meta', meta: before.meta });
    return parts;
  }

  /** The current state of the same parts, to push on the opposite stack. */
  private currentParts(p: Project, parts: Part[]): Part[] {
    return parts.map((part): Part => {
      if (part.kind === 'meta') return { kind: 'meta', meta: metaOf(p) };
      const index = p.scenes.findIndex((s) => s.id === part.id);
      return { kind: 'scene', id: part.id, index, scene: index >= 0 ? clone(p.scenes[index]) : null };
    });
  }

  private apply(p: Project, parts: Part[]): void {
    for (const part of parts) {
      if (part.kind !== 'scene') continue;
      const i = p.scenes.findIndex((s) => s.id === part.id);
      if (!part.scene) {
        if (i >= 0) p.scenes.splice(i, 1);
      } else if (i >= 0) {
        p.scenes[i] = clone(part.scene);
      } else {
        p.scenes.splice(Math.min(Math.max(0, part.index), p.scenes.length), 0, clone(part.scene));
      }
    }
    for (const part of parts) {
      if (part.kind !== 'meta') continue;
      p.name = part.meta.name;
      p.mainSceneId = part.meta.mainSceneId;
      p.assets = clone(part.meta.assets);
      p.interactions = clone(part.meta.interactions);
      const rank = new Map(part.meta.order.map((id, i) => [id, i]));
      p.scenes.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    }
  }
}
