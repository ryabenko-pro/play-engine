import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { zipToProject } from '../src/editor/project-zip';
import { migrateProject } from '../src/engine/migrate';
import type { Project } from '../src/engine/types';
import { TEMPLATES, createApp } from './http';
import { Instance } from './instance';

const HELP = `Game engine server: shared projects for a group, stored in git.

  serve                             run the server
  user add <name>                   add a person and print their personal link
  user list                         people and their links
  user reset <id>                   a new link for someone (the old one stops working)
  user remove <id>
  project add <name> [--template empty|td|tanks|aura] [--from project.json|project.zip] [--members ana,ben]
  project list
  project members <slug> <ana,ben | *>

Options (or environment variables):
  --data <dir>     DATA_DIR    where people and project repositories live (default ./data)
  --port <n>       PORT        (default 8080)
  --host <addr>    HOST        (default 0.0.0.0)
  --url <url>      PUBLIC_URL  how people reach the server, for links (default http://localhost:<port>)
  --static <dir>   STATIC_DIR  the built editor (default: dist next to this server)
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      data: { type: 'string', default: process.env.DATA_DIR ?? './data' },
      port: { type: 'string', default: process.env.PORT ?? '8080' },
      host: { type: 'string', default: process.env.HOST ?? '0.0.0.0' },
      url: { type: 'string', default: process.env.PUBLIC_URL },
      static: { type: 'string', default: process.env.STATIC_DIR ?? resolve(import.meta.dirname, '../dist') },
      template: { type: 'string' },
      from: { type: 'string' },
      members: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, sub, ...args] = positionals;
  if (values.help || !cmd) return void console.log(HELP);

  const instance = await Instance.open(resolve(values.data));
  const publicUrl = (values.url ?? `http://localhost:${values.port}`).replace(/\/$/, '');
  const link = (token: string) => `${publicUrl}/k/${token}`;

  if (cmd === 'serve') {
    createApp(instance, { staticDir: resolve(values.static), secure: publicUrl.startsWith('https:') }).listen(Number(values.port), values.host, () => {
      console.log(`Serving ${instance.projects.length} project(s) for ${instance.users.length} people at ${publicUrl}`);
      if (!instance.users.length) console.log('Nobody can sign in yet: add someone with "user add <name>".');
    });
    return;
  }

  if (cmd === 'user') {
    if (sub === 'add' && args[0]) {
      const u = await instance.addUser(args.join(' '));
      return void console.log(`${u.name} (${u.id}): ${link(u.token)}`);
    }
    if (sub === 'list') return void instance.users.forEach((u) => console.log(`${u.id}\t${u.name}\t${link(u.token)}`));
    if (sub === 'reset' && args[0]) {
      const u = await instance.resetToken(args[0]);
      return void console.log(`${u.name} (${u.id}): ${link(u.token)}`);
    }
    if (sub === 'remove' && args[0]) return void (await instance.removeUser(args[0]));
  }

  if (cmd === 'project') {
    if (sub === 'add' && args[0]) {
      const members = values.members ? values.members.split(',').map((s) => s.trim()) : '*';
      const p = await instance.addProject(args.join(' '), await startingPoint(values.template, values.from), members);
      return void console.log(`${p.name}: ${publicUrl}/p/${p.slug}/`);
    }
    if (sub === 'list') {
      return void instance.projects.forEach((p) => console.log(`${p.slug}\t${p.name}\t${p.members === '*' ? 'everyone' : p.members.join(', ')}`));
    }
    if (sub === 'members' && args[0] && args[1]) {
      return void (await instance.setMembers(args[0], args[1] === '*' ? '*' : args[1].split(',').map((s) => s.trim())));
    }
  }
  console.log(HELP);
  process.exitCode = 1;
}

async function startingPoint(template: string | undefined, from: string | undefined): Promise<Project> {
  if (from) {
    const data = await readFile(from);
    const p = /\.zip$/i.test(from) ? zipToProject(new Uint8Array(data)) : migrateProject(JSON.parse(data.toString('utf8')));
    if (!p) throw new Error(`${from}: not a project`);
    return p;
  }
  const t = TEMPLATES[template ?? 'empty'];
  if (!t) throw new Error(`unknown template "${template}" (${Object.keys(TEMPLATES).join(', ')})`);
  return t.make();
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
