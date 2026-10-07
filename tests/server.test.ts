import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/http';
import { Instance } from '../server/instance';
import type { ActorScene, LevelScene, Project } from '../src/engine';
import { createTowerDefenceProject } from '../src/games/td/project';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ge-server-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const instance = await Instance.open(dir);
  const ana = await instance.addUser('Ana');
  const ben = await instance.addUser('Ben');
  const entry = await instance.addProject('Tower Defence', createTowerDefenceProject());
  const start = await instance.latest(entry.slug);
  return { instance, ana, ben, slug: entry.slug, start };
}

const copy = (p: Project) => JSON.parse(JSON.stringify(p)) as Project;
const actorNamed = (p: Project, name: string) => p.scenes.find((s) => s.name === name) as ActorScene;
const map = (p: Project) => p.scenes.find((s) => s.kind === 'level') as LevelScene;

describe('instance', () => {
  it('starts a project as a git repository with one version', async () => {
    const { instance, slug, start } = await setup();
    expect(start.head).toMatch(/^[0-9a-f]{40}$/);
    expect(start.project.name).toBe('Tower Defence');
    const history = await instance.history(slug);
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe('Start Tower Defence');
    expect(Object.keys(await instance.files(slug, start.head))).toContain('actors/yellow/blocks.json');
  });

  it('saves with co-authors, and merges two people saving from the same version', async () => {
    const { instance, ana, ben, slug, start } = await setup();
    const anas = copy(start.project);
    map(anas).entities[0].x += 5;
    const r1 = await instance.save(slug, ana, { base: start.head, project: anas, message: 'Move the grass', coauthors: [ben.id], choices: {} });
    expect(r1).toMatchObject({ ok: true, saved: true });

    const bens = copy(start.project);
    actorNamed(bens, 'Yellow').actor.color = '#ffffff';
    const r2 = await instance.save(slug, ben, { base: start.head, project: bens, message: 'White enemy', coauthors: [], choices: {} });
    expect(r2.ok).toBe(true);
    const latest = await instance.latest(slug);
    expect(map(latest.project).entities[0].x).toBe(map(start.project).entities[0].x + 5);
    expect(actorNamed(latest.project, 'Yellow').actor.color).toBe('#ffffff');

    const history = await instance.history(slug);
    expect(history.map((c) => c.message)).toEqual(['White enemy', 'Move the grass', 'Start Tower Defence']);
    expect(history[1].author.name).toBe('Ana');
    expect(history[1].coauthors).toEqual([{ name: 'Ben', email: `ben@${instance.emailDomain}` }]);
  });

  it('asks about clashes, then saves with the choice', async () => {
    const { instance, ana, ben, slug, start } = await setup();
    const anas = copy(start.project);
    actorNamed(anas, 'Yellow').actor.color = '#ff0000';
    await instance.save(slug, ana, { base: start.head, project: anas, message: 'Red', coauthors: [], choices: {} });

    const bens = copy(start.project);
    actorNamed(bens, 'Yellow').actor.color = '#0000ff';
    const r = await instance.save(slug, ben, { base: start.head, project: bens, message: 'Blue', coauthors: [], choices: {} });
    expect(r.ok).toBe(false);
    const conflicts = 'conflicts' in r ? r.conflicts : [];
    expect(conflicts.map((c) => [c.label, c.mine, c.theirs])).toEqual([['Yellow › color', '#0000ff', '#ff0000']]);

    const again = await instance.save(slug, ben, { base: start.head, project: bens, message: 'Blue', coauthors: [], choices: { [conflicts[0].path]: 'mine' } });
    expect(again.ok).toBe(true);
    expect(actorNamed((await instance.latest(slug)).project, 'Yellow').actor.color).toBe('#0000ff');
  });

  it('refuses a script that does not compile, and saves nothing for no changes', async () => {
    const { instance, ana, slug, start } = await setup();
    const broken = copy(start.project);
    const yellow = actorNamed(broken, 'Yellow');
    delete yellow.actor.blocks;
    yellow.actor.script = 'export function update(self) {';
    const r = await instance.save(slug, ana, { base: start.head, project: broken, message: 'x', coauthors: [], choices: {} });
    expect(r).toMatchObject({ ok: false, errors: [{ scene: 'Yellow' }] });

    const same = await instance.save(slug, ana, { base: start.head, project: start.project, message: 'x', coauthors: [], choices: {} });
    expect(same).toMatchObject({ ok: true, saved: false, head: start.head });
  });

  it('gets the latest version merged into unsaved work', async () => {
    const { instance, ana, slug, start } = await setup();
    const anas = copy(start.project);
    actorNamed(anas, 'Red').actor.color = '#123456';
    await instance.save(slug, ana, { base: start.head, project: anas, message: 'x', coauthors: [], choices: {} });
    const mine = copy(start.project);
    actorNamed(mine, 'Green').actor.color = '#654321';
    const r = await instance.sync(slug, start.head, mine);
    expect(r.conflicts).toEqual([]);
    expect(r.head).not.toBe(start.head);
    expect(actorNamed(r.project, 'Red').actor.color).toBe('#123456');
    expect(actorNamed(r.project, 'Green').actor.color).toBe('#654321');
  });
});

describe('history', () => {
  it('lists versions with the files they changed', async () => {
    const { instance, ana, slug, start } = await setup();
    const p = copy(start.project);
    actorNamed(p, 'Yellow').actor.color = '#000000';
    await instance.save(slug, ana, { base: start.head, project: p, message: 'Black', coauthors: [], choices: {} });
    const [last, first] = await instance.history(slug);
    expect(last.files).toEqual(['actors/yellow/actor.json']);
    expect(last.parent).toBe(start.head);
    expect(first.parent).toBeNull();
  });

  it('undoes one save and keeps the saves after it', async () => {
    const { instance, ana, ben, slug, start } = await setup();
    const a = copy(start.project);
    actorNamed(a, 'Yellow').actor.color = '#000000';
    const r1 = await instance.save(slug, ana, { base: start.head, project: a, message: 'Black yellow', coauthors: [], choices: {} });
    const b = copy((await instance.latest(slug)).project);
    actorNamed(b, 'Red').actor.color = '#00ff00';
    await instance.save(slug, ben, { base: r1.head, project: b, message: 'Green red', coauthors: [], choices: {} });

    const undone = await instance.undo(slug, ben, r1.head);
    expect(undone).toMatchObject({ ok: true, saved: true });
    const latest = (await instance.latest(slug)).project;
    expect(actorNamed(latest, 'Yellow').actor.color).toBe(actorNamed(start.project, 'Yellow').actor.color);
    expect(actorNamed(latest, 'Red').actor.color).toBe('#00ff00');
    expect((await instance.history(slug))[0]).toMatchObject({ message: 'Undo “Black yellow”', author: { name: 'Ben' } });
    await expect(instance.undo(slug, ben, start.head)).rejects.toThrow('first version');
  });

  it('asks before undoing something changed again later', async () => {
    const { instance, ana, slug, start } = await setup();
    const a = copy(start.project);
    actorNamed(a, 'Yellow').actor.color = '#000000';
    const r1 = await instance.save(slug, ana, { base: start.head, project: a, message: 'Black', coauthors: [], choices: {} });
    const b = copy(a);
    actorNamed(b, 'Yellow').actor.color = '#333333';
    await instance.save(slug, ana, { base: r1.head, project: b, message: 'Grey', coauthors: [], choices: {} });
    const r = await instance.undo(slug, ana, r1.head);
    expect('conflicts' in r && r.conflicts.map((c) => c.label)).toEqual(['Yellow › color']);
  });

  it('goes back to an old version as a new version', async () => {
    const { instance, ana, slug, start } = await setup();
    const a = copy(start.project);
    actorNamed(a, 'Yellow').actor.color = '#000000';
    a.scenes = a.scenes.filter((s) => s.name !== 'Red');
    await instance.save(slug, ana, { base: start.head, project: a, message: 'Oops', coauthors: [], choices: {} });
    const r = await instance.restore(slug, ana, start.head);
    expect(r).toMatchObject({ ok: true, saved: true });
    expect((await instance.latest(slug)).project).toEqual(start.project);
    expect((await instance.history(slug)).length).toBe(3);
  });
});

describe('presence and claims', () => {
  it('shows others where everyone is and what they changed', async () => {
    const { instance, ana, ben, slug, start } = await setup();
    const yellow = actorNamed(start.project, 'Yellow').id;
    await instance.status(slug, ana, { sceneId: yellow, changed: [yellow] });
    const seen = await instance.status(slug, ben, { sceneId: map(start.project).id });
    expect(seen.head).toBe(start.head);
    expect(seen.people).toEqual([{ id: 'ana', name: 'Ana', sceneId: yellow, changed: [yellow] }]);
    expect((await instance.status(slug, ana, {})).people.map((p) => p.name)).toEqual(['Ben']);
  });

  it('keeps claims until released, across restarts', async () => {
    const { instance, ana, ben, slug, start } = await setup();
    const yellow = actorNamed(start.project, 'Yellow').id;
    await instance.claim(slug, ana, yellow, true);
    const reopened = await Instance.open(dir);
    expect(await reopened.claims(slug)).toEqual({ [yellow]: { userId: 'ana', name: 'Ana', at: expect.any(Number) } });
    // Soft: someone else may take it over.
    await reopened.claim(slug, ben, yellow, true);
    expect((await reopened.claims(slug))[yellow].name).toBe('Ben');
    await reopened.claim(slug, ben, yellow, false);
    expect(await reopened.claims(slug)).toEqual({});
  });
});

describe('http', () => {
  async function serve() {
    const s = await setup();
    const server = createApp(s.instance, { staticDir: join(dir, 'static') });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { ...s, server, base };
  }

  it('signs in with a personal link and works on a project', async () => {
    const { server, base, ana, ben, slug, start } = await serve();
    try {
      const link = await fetch(`${base}/k/${ana.token}`, { redirect: 'manual' });
      expect(link.status).toBe(302);
      const cookie = link.headers.get('set-cookie')!.split(';')[0];
      const headers = { cookie, 'content-type': 'application/json' };

      expect((await fetch(`${base}/api/me`)).status).toBe(401);
      const me = await (await fetch(`${base}/api/me`, { headers })).json();
      expect(me.user.name).toBe('Ana');
      expect(me.projects.map((p: { slug: string }) => p.slug)).toEqual([slug]);

      const p = await (await fetch(`${base}/api/p/${slug}`, { headers })).json();
      expect(p.head).toBe(start.head);
      expect(p.members.map((m: { name: string }) => m.name)).toEqual(['Ana', 'Ben']);

      const edited = copy(p.project);
      actorNamed(edited, 'Blue').actor.color = '#00ffff';
      const save = await fetch(`${base}/api/p/${slug}/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ base: p.head, project: edited, message: 'Cyan', coauthors: [ben.id] }),
      });
      expect(save.status).toBe(200);
      const saved = await save.json();
      expect(saved.saved).toBe(true);

      const played = await (await fetch(`${base}/p/${slug}/project.json`, { headers })).json();
      expect(actorNamed(played, 'Blue').actor.color).toBe('#00ffff');
      expect((await fetch(`${base}/api/p/${slug}/save`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    } finally {
      server.close();
    }
  });

  it('lets in people added from the command line while it runs', async () => {
    const { server, base, slug } = await serve();
    try {
      const cli = await Instance.open(dir);
      const cy = await cli.addUser('Cy');
      const res = await fetch(`${base}/api/p/${slug}`, { headers: { authorization: `Bearer ${cy.token}` } });
      expect(res.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('keeps projects to their members', async () => {
    const { server, base, instance, ben, slug } = await serve();
    try {
      await instance.setMembers(slug, ['ana']);
      const res = await fetch(`${base}/api/p/${slug}`, { headers: { authorization: `Bearer ${ben.token}` } });
      expect(res.status).toBe(404);
      expect((await fetch(`${base}/k/nope`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
