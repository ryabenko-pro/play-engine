import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { createEmptyProject } from '../src/engine/factory';
import type { Project } from '../src/engine/types';
import { createAuraProject } from '../src/games/aura/project';
import { createTanksProject } from '../src/games/tanks/project';
import { createTowerDefenceProject } from '../src/games/td/project';
import { homePage, messagePage } from './pages';
import { BadRequest, type Instance, type SaveRequest, type User } from './instance';

/** Projects people can start from on the home page. */
export const TEMPLATES: Record<string, { label: string; make: () => Project }> = {
  empty: { label: 'Empty', make: createEmptyProject },
  td: { label: 'Tower Defence (course 1)', make: createTowerDefenceProject },
  tanks: { label: 'Tanks', make: createTanksProject },
  aura: { label: 'Aura', make: createAuraProject },
};

const COOKIE = 'ge_token';
const MAX_BODY = 64 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface ServerOptions {
  /** The built editor and player (vite build output). */
  staticDir: string;
  /** Served over https (PUBLIC_URL): the sign-in cookie is only sent over https. */
  secure?: boolean;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Routes:
 * - `/k/<token>`: a personal link; remembers who you are (cookie) and goes home.
 * - `/`: your projects, and a form to start one.
 * - `/p/<slug>/`: the editor on that project; `/p/<slug>/play.html` plays its latest version.
 * - `/api/…`: what the editor uses (JSON).
 */
export function createApp(instance: Instance, opts: ServerOptions): Server {
  return createServer((req, res) => {
    handle(instance, opts, req, res).catch((err: unknown) => {
      const status = err instanceof HttpError || err instanceof BadRequest ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'server error' : (err as Error).message });
      else res.end();
    });
  });
}

async function handle(instance: Instance, opts: ServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = decodeURIComponent(url.pathname);
  await instance.refresh();
  const user = authenticate(instance, req);

  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/k\/([\w-]+)$/))) {
    const who = instance.userByToken(m[1]);
    if (!who) return sendHtml(res, 404, messagePage('This link doesn’t work', 'Ask for a new personal link.'));
    res.setHeader('Set-Cookie', `${COOKIE}=${m[1]}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${opts.secure ? '; Secure' : ''}`);
    return redirect(res, '/');
  }
  if (path === '/') {
    if (!user) return sendHtml(res, 200, messagePage('Game engine', 'Open your personal link to start.'));
    return sendHtml(res, 200, homePage(user, instance.projectsOf(user), TEMPLATES));
  }
  if (path.startsWith('/api/')) return api(instance, user, req, res, path.slice(4));

  if ((m = path.match(/^\/p\/([^/]+)(\/.*)?$/))) {
    const [, slug, rest] = m;
    if (!user) return sendHtml(res, 401, messagePage('Who are you?', 'Open your personal link first.'));
    if (!instance.canAccess(user, slug)) return sendHtml(res, 404, messagePage('No such project', 'Or it isn’t shared with you.'));
    if (!rest) return redirect(res, `/p/${encodeURIComponent(slug)}/`);
    // The player loads ./project.json: the latest version, or ?v=<sha> for an older one.
    if (rest === '/project.json') {
      const v = url.searchParams.get('v');
      return sendJson(res, 200, v ? await instance.load(slug, v) : (await instance.latest(slug)).project);
    }
    return serveStatic(res, opts.staticDir, rest === '/' ? '/index.html' : rest);
  }
  return serveStatic(res, opts.staticDir, path);
}

async function api(instance: Instance, user: User | undefined, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (!user) throw new HttpError(401, 'open your personal link first');
  const get = req.method === 'GET';
  const post = req.method === 'POST';
  if (post && !String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'JSON only');

  if (get && path === '/me') return sendJson(res, 200, { user: { id: user.id, name: user.name }, projects: instance.projectsOf(user) });
  if (post && path === '/projects') {
    const body = (await readJson(req)) as { name?: string; template?: string };
    const template = TEMPLATES[body.template ?? 'empty'];
    if (!template || !body.name?.trim()) throw new HttpError(400, 'a name and a known template, please');
    return sendJson(res, 200, await instance.addProject(body.name, template.make(), '*', user));
  }

  const m = path.match(/^\/p\/([^/]+)(\/.*)?$/);
  if (!m) throw new HttpError(404, 'no such API');
  const [, slug, rest = ''] = m;
  if (!instance.canAccess(user, slug)) throw new HttpError(404, 'no such project');
  const entry = instance.projects.find((p) => p.slug === slug)!;

  if (get && rest === '') {
    const { head, project } = await instance.latest(slug);
    const members = instance.membersOf(slug).map((u) => ({ id: u.id, name: u.name }));
    return sendJson(res, 200, { slug, name: entry.name, me: { id: user.id, name: user.name }, members, head, project });
  }
  if (get && rest === '/head') return sendJson(res, 200, { head: await instance.head(slug) });
  if (get && rest === '/history') return sendJson(res, 200, await instance.history(slug, 100));
  let v: RegExpMatchArray | null;
  if (get && (v = rest.match(/^\/v\/([0-9a-f]{40})$/))) return sendJson(res, 200, { head: v[1], project: await instance.load(slug, v[1]) });
  if (post && rest === '/sync') {
    const body = (await readJson(req)) as { base?: string; project?: unknown; choices?: SaveRequest['choices'] };
    const r = await instance.sync(slug, need(body.base, 'base'), body.project, body.choices ?? {});
    return sendJson(res, r.conflicts.length ? 409 : 200, r.conflicts.length ? { head: r.head, conflicts: r.conflicts } : { head: r.head, project: r.project });
  }
  if (post && rest === '/status') {
    const body = (await readJson(req)) as { sceneId?: string; changed?: string[] };
    return sendJson(res, 200, await instance.status(slug, user, { sceneId: body.sceneId, changed: Array.isArray(body.changed) ? body.changed : [] }));
  }
  if (post && rest === '/claim') {
    const body = (await readJson(req)) as { sceneId?: string; on?: boolean };
    return sendJson(res, 200, { claims: await instance.claim(slug, user, need(body.sceneId, 'sceneId'), body.on !== false) });
  }
  if (post && (rest === '/undo' || rest === '/restore')) {
    const body = (await readJson(req)) as { sha?: string; choices?: SaveRequest['choices'] };
    const sha = need(body.sha, 'sha');
    const r = rest === '/undo' ? await instance.undo(slug, user, sha, body.choices ?? {}) : await instance.restore(slug, user, sha);
    return sendJson(res, r.ok ? 200 : 409, r);
  }
  if (post && rest === '/save') {
    const body = (await readJson(req)) as Partial<SaveRequest>;
    const r = await instance.save(slug, user, {
      base: need(body.base, 'base'),
      project: body.project,
      message: String(body.message ?? ''),
      coauthors: Array.isArray(body.coauthors) ? body.coauthors.map(String) : [],
      choices: body.choices ?? {},
    });
    return sendJson(res, r.ok ? 200 : 409, r);
  }
  throw new HttpError(404, 'no such API');
}

function need(v: string | undefined, name: string): string {
  if (typeof v !== 'string' || !v) throw new HttpError(400, `${name} is missing`);
  return v;
}

function authenticate(instance: Instance, req: IncomingMessage): User | undefined {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/)?.[1];
  const cookie = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return instance.userByToken(bearer ?? cookie ?? '');
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'too big');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad JSON');
  }
}

async function serveStatic(res: ServerResponse, root: string, path: string): Promise<void> {
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root) + sep)) throw new HttpError(404, 'not found');
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    throw new HttpError(404, 'not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // Built assets have hashed names; pages must be fresh.
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(await readFile(file));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(302, { Location: to });
  res.end();
}
