import type { Choice, Conflict } from '../collab/merge';
import type { ScriptError } from '../collab/check';
import type { Project } from '../engine/types';

/**
 * The editor on a shared project (served at /p/<slug>/ by the sync server). The project lives
 * in a git repository on the server; this copy started from the version `base`.
 *
 * - Save: my changes are merged into the latest version and become a new version.
 * - Get latest: the latest version is merged into my unsaved changes.
 *
 * Unsaved work stays in this browser (autosave) with the version it started from, so it
 * survives reloads; others see it only once saved.
 */

export interface Member {
  id: string;
  name: string;
}

interface ProjectInfo {
  slug: string;
  name: string;
  me: Member;
  members: Member[];
  head: string;
  project: Project;
}

export type SaveOutcome =
  | { kind: 'saved' | 'unchanged' }
  | { kind: 'conflicts'; conflicts: Conflict[] }
  | { kind: 'errors'; errors: ScriptError[] };

/** Someone else with this project open right now. */
export interface Person extends Member {
  /** The scene open in their editor. */
  sceneId: string;
  /** Scenes they changed and haven't saved yet. */
  changed: string[];
}

export interface Claim {
  userId: string;
  name: string;
  at: number;
}

/** One saved version, newest first in the history. */
export interface Version {
  sha: string;
  parent: string | null;
  author: { name: string };
  coauthors: { name: string }[];
  time: number;
  message: string;
  files: string[];
}

/** What the scene list and tabs show about a scene: who is in it, who claimed it. */
export interface SceneMarks {
  people: { id: string; name: string; editing: boolean }[];
  claim: { name: string; mine: boolean } | null;
}

export type SyncOutcome = { kind: 'updated' | 'current' } | { kind: 'conflicts'; conflicts: Conflict[] };

/** The project slug when the editor is opened from the sync server. */
export function sharedSlug(): string | null {
  const m = location.pathname.match(/^\/p\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}

/** How often the editor tells where it is and hears about the others and new versions. */
const POLL_MS = 5_000;

export class Collab {
  /** The version my copy is based on. */
  base: string;
  /** The newest version on the server, as last checked. */
  latest: string;
  busy = false;
  /** Others with the project open. */
  people: Person[] = [];
  /** Scene id → who said they are working on it. */
  claims: Record<string, Claim> = {};
  private baseJson: string;
  private baseScenes = new Map<string, string>();
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  private where: (() => { sceneId: string; project: Project }) | null = null;
  /** The last status heard, to skip re-rendering when nothing changed. */
  private lastStatus = '';
  private listeners = new Set<() => void>();

  private constructor(
    readonly slug: string,
    readonly name: string,
    readonly me: Member,
    readonly members: Member[],
    base: string,
    baseProject: Project,
    latest: string,
  ) {
    this.base = base;
    this.baseJson = JSON.stringify(baseProject);
    this.baseScenes = sceneJson(baseProject);
    this.latest = latest;
  }

  /** Keys under which the store keeps this project's draft and tabs. */
  static keys(slug: string) {
    return { project: `ge.shared.${slug}.project`, tabs: `ge.shared.${slug}.tabs`, base: `ge.shared.${slug}.base` };
  }

  /** Connects to the server; returns the project to edit (my unsaved draft, or the latest version). */
  static async open(slug: string, draft: Project | null): Promise<{ collab: Collab; project: Project }> {
    const info = await api<ProjectInfo>(`/api/p/${encodeURIComponent(slug)}`);
    const keys = Collab.keys(slug);
    const draftBase = localStorage.getItem(keys.base);
    if (draft && draftBase && draftBase !== info.head) {
      // Unsaved work from an older version: keep it, and Get latest when ready.
      const base = await api<{ project: Project }>(`/api/p/${encodeURIComponent(slug)}/v/${draftBase}`).catch(() => null);
      if (base) {
        const collab = new Collab(slug, info.name, info.me, info.members, draftBase, base.project, info.head);
        return { collab, project: draft };
      }
    }
    const collab = new Collab(slug, info.name, info.me, info.members, info.head, info.project, info.head);
    collab.rememberBase();
    // A draft on the latest version is still my unsaved work.
    return { collab, project: draft && draftBase === info.head ? draft : info.project };
  }

  get behind(): boolean {
    return this.latest !== this.base;
  }

  /** Whether my copy differs from the version it started from. */
  dirty(project: Project): boolean {
    return JSON.stringify(project) !== this.baseJson;
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Scenes of my copy that differ from the version it started from (new ones included). */
  changedScenes(project: Project): string[] {
    return project.scenes.filter((s) => this.baseScenes.get(s.id) !== JSON.stringify(s)).map((s) => s.id);
  }

  /**
   * Every few seconds while the page is visible (and soon after a change): tells the server
   * where I am, and hears where the others are, what they claimed, and whether there is a new version.
   */
  startPolling(where: () => { sceneId: string; project: Project }): void {
    this.where = where;
    const check = () => {
      if (document.visibilityState === 'visible') void this.checkIn();
    };
    setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    void this.checkIn();
  }

  /** Something changed here (another scene, an edit): check in soon. */
  nudge(): void {
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => void this.checkIn(), 1000);
  }

  async checkIn(): Promise<void> {
    if (!this.where || this.busy) return;
    const { sceneId, project } = this.where();
    try {
      const r = await api<{ head: string; people: Person[]; claims: Record<string, Claim> }>(`${this.url}/status`, {
        sceneId,
        changed: this.changedScenes(project),
      });
      const status = JSON.stringify([r.head, r.people, r.claims]);
      if (status === this.lastStatus) return;
      this.lastStatus = status;
      this.latest = r.head;
      this.people = r.people;
      this.claims = r.claims;
      this.emit();
    } catch {
      // Offline for a moment: try again later.
    }
  }

  marks(sceneId: string): SceneMarks {
    const c = this.claims[sceneId];
    return {
      people: this.people
        .filter((p) => p.sceneId === sceneId || p.changed.includes(sceneId))
        .map((p) => ({ id: p.id, name: p.name, editing: p.changed.includes(sceneId) })),
      claim: c ? { name: c.name, mine: c.userId === this.me.id } : null,
    };
  }

  /** "I'm working on this" / let go. Soft: taking over someone's claim is allowed. */
  async claim(sceneId: string, on: boolean): Promise<void> {
    const r = await api<{ claims: Record<string, Claim> }>(`${this.url}/claim`, { sceneId, on });
    this.claims = r.claims;
    this.lastStatus = '';
    this.emit();
  }

  history(): Promise<Version[]> {
    return api<Version[]>(`${this.url}/history`);
  }

  /** "Undo this save" or "Go back to this version" as a new version (asking about clashes for undo). */
  async rewind(kind: 'undo' | 'restore', sha: string, choices: Record<string, Choice> = {}): Promise<SaveOutcome> {
    return this.during(async () => {
      const r = await api<{ ok: boolean; saved?: boolean; conflicts?: Conflict[]; errors?: ScriptError[] }>(`${this.url}/${kind}`, { sha, choices }, [409]);
      if (r.conflicts) return { kind: 'conflicts', conflicts: r.conflicts };
      if (r.errors) return { kind: 'errors', errors: r.errors };
      if (!r.ok) throw new Error('the project changed meanwhile: try again');
      return { kind: r.saved ? 'saved' : 'unchanged' };
    });
  }

  /** Merges the latest version into my copy. `apply` receives the new project. */
  async getLatest(mine: Project, choices: Record<string, Choice>, apply: (p: Project) => void): Promise<SyncOutcome> {
    return this.during(async () => {
      if (!this.dirty(mine)) {
        const { head, project } = await api<ProjectInfo>(this.url);
        if (head === this.base) return { kind: 'current' };
        this.moveTo(head, project);
        apply(project);
        return { kind: 'updated' };
      }
      const r = await api<{ head: string; project?: Project; conflicts?: Conflict[] }>(`${this.url}/sync`, { base: this.base, project: mine, choices }, [409]);
      if (r.conflicts) return { kind: 'conflicts', conflicts: r.conflicts };
      if (r.head === this.base) return { kind: 'current' };
      const theirs = await api<{ project: Project }>(`${this.url}/v/${r.head}`);
      this.moveTo(r.head, theirs.project);
      apply(r.project!);
      return { kind: 'updated' };
    });
  }

  /** Saves my copy as a new version. `apply` receives the saved project (with others' changes merged in). */
  async save(mine: Project, message: string, coauthors: string[], choices: Record<string, Choice>, apply: (p: Project) => void): Promise<SaveOutcome> {
    return this.during(async () => {
      const r = await api<{ ok: boolean; head: string; saved?: boolean; project?: Project; conflicts?: Conflict[]; errors?: ScriptError[] }>(
        `${this.url}/save`,
        { base: this.base, project: mine, message, coauthors, choices },
        [409],
      );
      if (r.conflicts) return { kind: 'conflicts', conflicts: r.conflicts };
      if (r.errors) return { kind: 'errors', errors: r.errors };
      if (!r.ok || !r.project) throw new Error('the project changed while saving: try again');
      this.moveTo(r.head, r.project);
      apply(r.project);
      return { kind: r.saved ? 'saved' : 'unchanged' };
    });
  }

  private get url(): string {
    return `/api/p/${encodeURIComponent(this.slug)}`;
  }

  private moveTo(head: string, project: Project): void {
    this.base = head;
    this.latest = head;
    this.baseJson = JSON.stringify(project);
    this.baseScenes = sceneJson(project);
    this.rememberBase();
    this.nudge();
  }

  private rememberBase(): void {
    try {
      localStorage.setItem(Collab.keys(this.slug).base, this.base);
    } catch {
      // Storage full: the draft can't be kept either.
    }
  }

  private async during<T>(fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.emit();
    try {
      return await fn();
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function sceneJson(p: Project): Map<string, string> {
  return new Map(p.scenes.map((s) => [s.id, JSON.stringify(s)]));
}

/** GET (or POST with a body) JSON; statuses in `accept` return their body instead of throwing. */
async function api<T>(url: string, body?: unknown, accept: number[] = []): Promise<T> {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && !accept.includes(res.status)) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
