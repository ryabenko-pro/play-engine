import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scriptErrors, type ScriptError } from '../src/collab/check';
import { mergeProjects, type Choice, type Conflict } from '../src/collab/merge';
import { fileSlug, filesToProject, projectToFiles, type FileTree } from '../src/engine/files';
import { migrateProject } from '../src/engine/migrate';
import type { Project } from '../src/engine/types';
import { Repo, StaleHead, type CommitInfo, type Person } from './repo';

/**
 * One server, many projects. `data/instance.json` lists the people (each with a secret token:
 * their personal link) and the projects; each project is a bare git repository in
 * `data/projects/<slug>.git` whose branch main holds the project folder (see engine/files.ts).
 */

export interface User {
  id: string;
  name: string;
  /** The secret in the personal link /k/<token>. */
  token: string;
}

export interface ProjectEntry {
  slug: string;
  name: string;
  /** User ids allowed in, or '*' for everyone on this server. */
  members: '*' | string[];
}

/** Someone said they're working on a scene. */
export interface Claim {
  userId: string;
  name: string;
  at: number;
}

/** Someone counts as here this long after their editor last checked in. */
const PRESENCE_MS = 30_000;

interface InstanceFile {
  users: User[];
  projects: ProjectEntry[];
}

export interface SaveRequest {
  /** The commit the editor's copy started from. */
  base: string;
  project: unknown;
  message: string;
  coauthors: string[];
  choices: Record<string, Choice>;
}

export type SaveResult =
  | { ok: true; head: string; project: Project; saved: boolean }
  | { ok: false; head: string; conflicts: Conflict[] }
  | { ok: false; head: string; errors: ScriptError[] };

/** A request the editor got wrong (unknown project, bad data…). */
export class BadRequest extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class Instance {
  private projectCache = new Map<string, string>();
  private presence = new Map<string, Map<string, { sceneId: string; changed: string[]; at: number }>>();
  /** Modification time of instance.json when last read or written. */
  private loadedAt = 0;
  private locks = new Map<string, Promise<unknown>>();

  private constructor(
    readonly dir: string,
    private data: InstanceFile,
    /** Domain of the made-up e-mail addresses in commits (people have no real ones here). */
    readonly emailDomain = 'users.noreply.game-engine',
  ) {}

  static async open(dir: string): Promise<Instance> {
    await mkdir(join(dir, 'projects'), { recursive: true });
    const file = join(dir, 'instance.json');
    const data: InstanceFile = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { users: [], projects: [] };
    const instance = new Instance(dir, data);
    instance.loadedAt = existsSync(file) ? (await stat(file)).mtimeMs : 0;
    return instance;
  }

  /** Picks up people and projects added by the command line while the server runs. */
  async refresh(): Promise<void> {
    const file = join(this.dir, 'instance.json');
    const mtime = await stat(file).then((s) => s.mtimeMs, () => 0);
    if (mtime === this.loadedAt) return;
    this.data = JSON.parse(await readFile(file, 'utf8')) as InstanceFile;
    this.loadedAt = mtime;
  }

  get users(): readonly User[] {
    return this.data.users;
  }

  get projects(): readonly ProjectEntry[] {
    return this.data.projects;
  }

  // -------------------------------------------------------------------------
  // People and projects
  // -------------------------------------------------------------------------

  async addUser(name: string): Promise<User> {
    const user: User = { id: this.uniqueId(fileSlug(name), this.data.users.map((u) => u.id)), name: name.trim(), token: newToken() };
    this.data.users.push(user);
    await this.persist();
    return user;
  }

  /** A new personal link for someone (the old one stops working). */
  async resetToken(userId: string): Promise<User> {
    const user = this.user(userId);
    user.token = newToken();
    await this.persist();
    return user;
  }

  async removeUser(userId: string): Promise<void> {
    this.user(userId);
    this.data.users = this.data.users.filter((u) => u.id !== userId);
    for (const p of this.data.projects) if (p.members !== '*') p.members = p.members.filter((m) => m !== userId);
    await this.persist();
  }

  userByToken(token: string): User | undefined {
    return token ? this.data.users.find((u) => u.token === token) : undefined;
  }

  user(id: string): User {
    const u = this.data.users.find((x) => x.id === id);
    if (!u) throw new BadRequest(`no user "${id}"`, 404);
    return u;
  }

  async addProject(name: string, project: Project, members: '*' | string[] = '*', by?: User): Promise<ProjectEntry> {
    if (members !== '*') members.forEach((m) => this.user(m));
    const slug = this.uniqueId(fileSlug(name), this.data.projects.map((p) => p.slug));
    const repo = await Repo.init(this.repoDir(slug));
    const p = migrateProject(JSON.parse(JSON.stringify(project)));
    if (!p) throw new BadRequest('not a project');
    p.name = name.trim();
    const author = by ? this.person(by) : { name: 'Game engine', email: `server@${this.emailDomain}` };
    await repo.commit(projectToFiles(p), null, author, `Start ${p.name}`);
    const entry: ProjectEntry = { slug, name: p.name, members };
    this.data.projects.push(entry);
    await this.persist();
    return entry;
  }

  async setMembers(slug: string, members: '*' | string[]): Promise<void> {
    if (members !== '*') members.forEach((m) => this.user(m));
    this.entry(slug).members = members;
    await this.persist();
  }

  canAccess(user: User, slug: string): boolean {
    const p = this.data.projects.find((x) => x.slug === slug);
    return !!p && (p.members === '*' || p.members.includes(user.id));
  }

  projectsOf(user: User): ProjectEntry[] {
    return this.data.projects.filter((p) => this.canAccess(user, p.slug));
  }

  membersOf(slug: string): User[] {
    const p = this.entry(slug);
    return p.members === '*' ? [...this.data.users] : this.data.users.filter((u) => p.members.includes(u.id));
  }

  person(user: User): Person {
    return { name: user.name, email: `${user.id}@${this.emailDomain}` };
  }

  // -------------------------------------------------------------------------
  // Project versions
  // -------------------------------------------------------------------------

  async head(slug: string): Promise<string> {
    const head = await this.repo(slug).head();
    if (!head) throw new BadRequest(`project "${slug}" has no versions`, 500);
    return head;
  }

  async latest(slug: string): Promise<{ head: string; project: Project }> {
    const head = await this.head(slug);
    return { head, project: await this.load(slug, head) };
  }

  async load(slug: string, sha: string): Promise<Project> {
    const key = `${slug}@${sha}`;
    let json = this.projectCache.get(key);
    if (!json) {
      const repo = this.repo(slug);
      if (!(await repo.hasCommit(sha))) throw new BadRequest(`unknown version ${sha}`, 404);
      json = JSON.stringify(filesToProject(await repo.read(sha)));
      if (this.projectCache.size > 30) this.projectCache.delete(this.projectCache.keys().next().value!);
      this.projectCache.set(key, json);
    }
    return JSON.parse(json) as Project;
  }

  async files(slug: string, sha: string): Promise<FileTree> {
    return this.repo(slug).read(sha);
  }

  history(slug: string, limit?: number): Promise<CommitInfo[]> {
    return this.repo(slug).log(limit);
  }

  /**
   * "Get latest": my copy (started from `base`) merged with the newest version, without saving.
   * Conflicts are returned for the editor to ask about; `choices` answers them.
   */
  async sync(slug: string, base: string, mine: unknown, choices: Record<string, Choice> = {}) {
    const { head, project } = await this.latest(slug);
    const merged = await this.merge(slug, base, normalize(mine), head, project, choices);
    return { head, ...merged };
  }

  /** "Save": my copy merged with the newest version and committed as a new version of main. */
  async save(slug: string, user: User, req: SaveRequest): Promise<SaveResult> {
    const mine = normalize(req.project);
    const coauthors = [...new Set(req.coauthors)].filter((id) => id !== user.id).map((id) => this.person(this.user(id)));
    const message = req.message.trim() || 'Changes';
    return this.locked(slug, async () => {
      const { head, project: theirs } = await this.latest(slug);
      const { project, conflicts } = await this.merge(slug, req.base, mine, head, theirs, req.choices ?? {});
      if (conflicts.length) return { ok: false, head, conflicts };
      return this.commitOnHead(slug, user, head, theirs, project, message, coauthors);
    });
  }

  /**
   * "Undo this save": takes back what one version changed, keeping everything saved after it
   * (a three-way merge from that version to its parent, laid over the latest version).
   */
  async undo(slug: string, user: User, sha: string, choices: Record<string, Choice> = {}): Promise<SaveResult> {
    return this.locked(slug, async () => {
      const [commit] = (await this.repo(slug).log(1, sha)).filter((c) => c.sha === sha);
      if (!commit) throw new BadRequest(`unknown version ${sha}`, 404);
      if (!commit.parent) throw new BadRequest('the first version can’t be undone');
      const { head, project: theirs } = await this.latest(slug);
      const { project, conflicts } = mergeProjects(await this.load(slug, sha), await this.load(slug, commit.parent), theirs, choices);
      if (conflicts.length) return { ok: false, head, conflicts };
      return this.commitOnHead(slug, user, head, theirs, project, `Undo “${firstLine(commit.message)}”`, []);
    });
  }

  /** "Go back to this version": a new version with exactly the project as it was then. */
  async restore(slug: string, user: User, sha: string): Promise<SaveResult> {
    return this.locked(slug, async () => {
      const [commit] = await this.repo(slug).log(1, sha);
      if (!commit || commit.sha !== sha) throw new BadRequest(`unknown version ${sha}`, 404);
      const { head, project: theirs } = await this.latest(slug);
      const when = new Date(commit.time).toISOString().slice(0, 16).replace('T', ' ');
      return this.commitOnHead(slug, user, head, theirs, await this.load(slug, sha), `Back to “${firstLine(commit.message)}” (${when} UTC)`, []);
    });
  }

  /** Checks the scripts and commits the project on top of head (nothing when it is the same). */
  private async commitOnHead(slug: string, user: User, head: string, theirs: Project, project: Project, message: string, coauthors: Person[]): Promise<SaveResult> {
    const errors = scriptErrors(project, theirs);
    if (errors.length) return { ok: false, head, errors };
    const files = projectToFiles(project);
    if (sameFiles(files, projectToFiles(theirs))) return { ok: true, head, project: theirs, saved: false };
    try {
      const sha = await this.repo(slug).commit(files, head, this.person(user), message, coauthors);
      return { ok: true, head: sha, project: await this.load(slug, sha), saved: true };
    } catch (err) {
      if (err instanceof StaleHead) throw new BadRequest('the project changed while saving: try again', 409);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Who is where: presence (live, in memory) and claims (kept until released)
  // -------------------------------------------------------------------------

  /**
   * Notes where someone is (the scene open in their editor, the scenes they changed but haven't
   * saved) and returns everyone else's, with the claims and the latest version.
   */
  async status(slug: string, user: User, here: { sceneId?: string; changed?: string[] }) {
    let people = this.presence.get(slug);
    if (!people) this.presence.set(slug, (people = new Map()));
    const now = Date.now();
    people.set(user.id, { sceneId: String(here.sceneId ?? ''), changed: (here.changed ?? []).map(String).slice(0, 500), at: now });
    for (const [id, p] of people) if (now - p.at > PRESENCE_MS) people.delete(id);
    const others = [...people]
      .filter(([id]) => id !== user.id)
      .map(([id, p]) => ({ id, name: this.data.users.find((u) => u.id === id)?.name ?? id, sceneId: p.sceneId, changed: p.changed }));
    return { head: await this.head(slug), people: others, claims: await this.claims(slug) };
  }

  async claims(slug: string): Promise<Record<string, Claim>> {
    this.entry(slug);
    const file = this.claimsFile(slug);
    const raw = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Record<string, Omit<Claim, 'name'>>) : {};
    // Names follow the people list (renames, removed people).
    return Object.fromEntries(
      Object.entries(raw).flatMap(([sceneId, c]) => {
        const u = this.data.users.find((x) => x.id === c.userId);
        return u ? [[sceneId, { ...c, name: u.name }]] : [];
      }),
    );
  }

  /** "I'm working on this" (on) or let go (off). Claims are soft: anyone may take one over. */
  async claim(slug: string, user: User, sceneId: string, on: boolean): Promise<Record<string, Claim>> {
    return this.locked(`${slug}:claims`, async () => {
      const claims = await this.claims(slug);
      if (on) claims[sceneId] = { userId: user.id, name: user.name, at: Date.now() };
      else delete claims[sceneId];
      const stored = Object.fromEntries(Object.entries(claims).map(([id, { userId, at }]) => [id, { userId, at }]));
      await writeFile(this.claimsFile(slug), JSON.stringify(stored, null, 2) + '\n');
      return claims;
    });
  }

  private claimsFile(slug: string): string {
    return join(this.dir, 'projects', `${slug}.claims.json`);
  }

  private async merge(slug: string, base: string, mine: Project, head: string, theirs: Project, choices: Record<string, Choice>) {
    if (base === head) return { project: mine, conflicts: [] as Conflict[] };
    return mergeProjects(await this.load(slug, base), mine, theirs, choices);
  }

  // -------------------------------------------------------------------------

  private entry(slug: string): ProjectEntry {
    const p = this.data.projects.find((x) => x.slug === slug);
    if (!p) throw new BadRequest(`no project "${slug}"`, 404);
    return p;
  }

  private repo(slug: string): Repo {
    this.entry(slug);
    return new Repo(this.repoDir(slug));
  }

  private repoDir(slug: string): string {
    return join(this.dir, 'projects', `${slug}.git`);
  }

  /** One save at a time per project. */
  private locked<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(slug) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(slug, next.catch(() => {}));
    return next;
  }

  private uniqueId(base: string, taken: string[]): string {
    let id = base;
    for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
    return id;
  }

  private async persist(): Promise<void> {
    const file = join(this.dir, 'instance.json');
    await writeFile(`${file}.tmp`, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    this.loadedAt = (await stat(file)).mtimeMs;
  }
}

const firstLine = (s: string) => s.split('\n')[0];

function newToken(): string {
  return randomBytes(18).toString('base64url');
}

/** A project sent by an editor, checked and in the stored form. */
function normalize(raw: unknown): Project {
  const p = migrateProject(JSON.parse(JSON.stringify(raw ?? null)));
  if (!p) throw new BadRequest('not a project (or from a newer version)');
  try {
    return filesToProject(projectToFiles(p));
  } catch (err) {
    throw new BadRequest(`broken project: ${(err as Error).message}`);
  }
}

function sameFiles(a: FileTree, b: FileTree): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'string' || typeof y === 'string') return x === y;
    return y !== undefined && x.length === y.length && x.every((v, i) => v === y[i]);
  });
}
