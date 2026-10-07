import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FileTree } from '../src/engine/files';

const BRANCH = 'refs/heads/main';

export interface Person {
  name: string;
  email: string;
}

export interface CommitInfo {
  sha: string;
  /** null for the first version. */
  parent: string | null;
  /** Paths it added, changed or removed. */
  files: string[];
  author: Person;
  coauthors: Person[];
  time: number;
  message: string;
}

/** Saving lost a race: the branch moved since `parent` was read. */
export class StaleHead extends Error {}

/** A bare git repository holding one project folder on the branch main. */
export class Repo {
  constructor(readonly dir: string) {}

  static async init(dir: string): Promise<Repo> {
    await mkdir(dir, { recursive: true });
    const repo = new Repo(dir);
    await repo.git(['init', '--bare', '--quiet', '--initial-branch=main']);
    return repo;
  }

  get exists(): boolean {
    return existsSync(join(this.dir, 'HEAD'));
  }

  /** The latest commit of main, or null for an empty repository. */
  async head(): Promise<string | null> {
    const r = await this.run(['rev-parse', '--verify', '--quiet', BRANCH], undefined, true);
    return r.code === 0 ? r.out.toString().trim() : null;
  }

  async hasCommit(sha: string): Promise<boolean> {
    if (!/^[0-9a-f]{40}$/.test(sha)) return false;
    return (await this.run(['cat-file', '-e', `${sha}^{commit}`], undefined, true)).code === 0;
  }

  /** Every file of the project at a commit. */
  async read(sha: string): Promise<FileTree> {
    const list = (await this.git(['ls-tree', '-r', '-z', sha])).toString().split('\0').filter(Boolean);
    const entries = list.map((line) => {
      const [meta, path] = line.split('\t');
      return { sha: meta.split(' ')[2], path };
    });
    if (!entries.length) return {};
    const out = await this.git(['cat-file', '--batch'], entries.map((e) => e.sha).join('\n') + '\n');
    const files: FileTree = {};
    let pos = 0;
    for (const e of entries) {
      const nl = out.indexOf(0x0a, pos);
      const size = Number(out.subarray(pos, nl).toString().split(' ')[2]);
      const content = out.subarray(nl + 1, nl + 1 + size);
      pos = nl + 1 + size + 1;
      files[e.path] = BINARY.test(e.path) ? new Uint8Array(content) : content.toString('utf8');
    }
    return files;
  }

  /**
   * Commits the files as the whole project on top of `parent` (null: the first commit) and moves
   * main there, unless main moved meanwhile (StaleHead). Returns the new commit.
   */
  async commit(files: FileTree, parent: string | null, author: Person, message: string, coauthors: Person[] = []): Promise<string> {
    const work = await mkdtemp(join(tmpdir(), 'ge-commit-'));
    try {
      const tree = join(work, 'tree');
      for (const [path, data] of Object.entries(files)) {
        const file = join(tree, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, data);
      }
      await mkdir(tree, { recursive: true });
      const env = { GIT_INDEX_FILE: join(work, 'index'), GIT_WORK_TREE: tree };
      await this.git(['add', '--all', '--force', '.'], undefined, env, tree);
      const treeSha = (await this.git(['write-tree'], undefined, env)).toString().trim();
      const trailers = coauthors.map((c) => `Co-authored-by: ${c.name} <${c.email}>`);
      const body = trailers.length ? `${message.trim()}\n\n${trailers.join('\n')}\n` : `${message.trim()}\n`;
      const who = {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      };
      const sha = (await this.git(['commit-tree', '--no-gpg-sign', treeSha, ...(parent ? ['-p', parent] : [])], body, who)).toString().trim();
      // Compare-and-swap: fails if main is no longer at parent.
      const r = await this.run(['update-ref', BRANCH, sha, parent ?? ''], undefined, true);
      if (r.code !== 0) throw new StaleHead('the project changed while saving');
      return sha;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** Versions newest first, from `from` (default: main), with the files each one changed. */
  async log(limit = 50, from: string = BRANCH): Promise<CommitInfo[]> {
    if (!(await this.head())) return [];
    if (from !== BRANCH && !(await this.hasCommit(from))) return [];
    const out = (
      await this.git(['log', `-n${limit}`, '--name-only', '--no-renames', '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B%x1d', from])
    ).toString();
    return out
      .split('\x1e')
      .filter((r) => r.trim())
      .map((r) => {
        const [head, names = ''] = r.split('\x1d');
        const [sha, parents, name, email, time, body] = head.split('\x1f');
        const coauthors: Person[] = [];
        const message = body
          .split('\n')
          .filter((line) => {
            const m = line.match(/^Co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/i);
            if (m) coauthors.push({ name: m[1], email: m[2] });
            return !m;
          })
          .join('\n')
          .trim();
        const files = names.split('\n').map((f) => f.trim()).filter(Boolean);
        return { sha, parent: parents.split(' ')[0] || null, author: { name, email }, coauthors, time: Number(time) * 1000, message, files };
      });
  }

  private async git(args: string[], input?: string, env: Record<string, string> = {}, cwd?: string): Promise<Buffer> {
    const r = await this.run(args, input, false, env, cwd);
    return r.out;
  }

  private run(args: string[], input: string | undefined, allowFail: boolean, env: Record<string, string> = {}, cwd?: string): Promise<{ code: number; out: Buffer }> {
    return new Promise((resolve, reject) => {
      // Files are stored exactly as written, whatever the host's git config says.
      const p = spawn('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], {
        cwd: cwd ?? this.dir,
        env: { ...process.env, GIT_DIR: this.dir, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...env },
        // No input: no stdin pipe, which git may close before we write (EPIPE).
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      p.stdout!.on('data', (d: Buffer) => out.push(d));
      p.stderr!.on('data', (d: Buffer) => err.push(d));
      p.on('error', reject);
      p.on('close', (code) => {
        if (code !== 0 && !allowFail) reject(new Error(`git ${args[0]}: ${Buffer.concat(err).toString().trim()}`));
        else resolve({ code: code ?? 1, out: Buffer.concat(out) });
      });
      if (p.stdin) {
        // Git exiting before reading all input fails the command through its exit code; the
        // write error itself must not crash the server.
        p.stdin.on('error', () => {});
        p.stdin.end(input);
      }
    });
  }
}

/** Same rule as the zip reader: images other than SVG are bytes, everything else text. */
const BINARY = /\.(png|jpe?g|gif|webp)$/i;
