import { migrateProject } from './migrate';
import type { ActorScene, Asset, ImageAsset, Interactions, LevelScene, Project, Scene } from './types';

/**
 * The project as a folder of files, for version control (git) and merging:
 *
 * ```
 * project.json               name, version, main level, scene and asset order, touch layout
 * interactions.json          kinds, elements, statuses, reactions (when the project has them)
 * levels/<name>.json         one level scene
 * actors/<name>/actor.json   one actor scene, without its code
 * actors/<name>/script.ts    its TypeScript (generated from blocks for block actors)
 * actors/<name>/blocks.json  its block program (block actors only)
 * assets/<name>.json         one asset; an image's data lives next to it in `file`
 * assets/<name>.png          the image itself (png, jpg, gif, webp, svg)
 * ```
 *
 * Everything but images is text, written the same way every time (sorted keys, fixed layout),
 * so a change touches only the lines it changes. Ids live inside the files: paths only follow
 * names to stay readable, and reading never depends on them.
 */
export type FileData = string | Uint8Array;
export type FileTree = Record<string, FileData>;

interface ProjectFile {
  name: string;
  version: number;
  mainSceneId: string;
  scenes: string[];
  assets: string[];
  touch?: Project['touch'];
}

/** Keys written first, in this order; the rest follow alphabetically. */
const LEADING_KEYS = ['id', 'type', 'kind', 'name', 'op'];
const LINE_WIDTH = 100;

export function projectToFiles(project: Project): FileTree {
  const files: FileTree = {};
  const p = migrateProject(JSON.parse(JSON.stringify(project)))!;
  const index: ProjectFile = {
    name: p.name,
    version: p.version,
    mainSceneId: p.mainSceneId,
    scenes: p.scenes.map((s) => s.id),
    assets: p.assets.map((a) => a.id),
    touch: p.touch,
  };
  files['project.json'] = formatJson(index);
  if (p.interactions) files['interactions.json'] = formatJson(p.interactions);

  const levels = p.scenes.filter((s): s is LevelScene => s.kind === 'level');
  for (const [s, name] of uniqueNames(levels)) files[`levels/${name}.json`] = formatJson(s);

  const actors = p.scenes.filter((s): s is ActorScene => s.kind === 'actor');
  for (const [s, name] of uniqueNames(actors)) {
    const { script, blocks, ...actor } = s.actor;
    const dir = `actors/${name}`;
    files[`${dir}/actor.json`] = formatJson({ ...s, actor });
    files[`${dir}/script.ts`] = script;
    if (blocks) files[`${dir}/blocks.json`] = formatJson(blocks);
  }

  for (const [a, name] of uniqueNames(p.assets)) {
    if (a.type === 'image') {
      const data = decodeDataUrl(a.src);
      if (data) {
        const { src: _, ...rest } = a;
        const file = `${name}.${data.ext}`;
        files[`assets/${name}.json`] = formatJson({ ...rest, file });
        files[`assets/${file}`] = data.content;
        continue;
      }
    }
    files[`assets/${name}.json`] = formatJson(a);
  }
  return files;
}

/** Reads a project folder back. Throws when it isn't one (or comes from a newer version). */
export function filesToProject(files: FileTree): Project {
  const index = parseJson<ProjectFile>(files, 'project.json');
  const scenes = new Map<string, Scene>();
  const assets = new Map<string, Asset>();

  for (const path of Object.keys(files).sort()) {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^levels\/[^/]+\.json$/))) {
      const s = parseJson<LevelScene>(files, path);
      scenes.set(s.id, s);
    } else if ((m = path.match(/^(actors\/[^/]+)\/actor\.json$/))) {
      const dir = m[1];
      const s = parseJson<ActorScene>(files, path);
      const script = files[`${dir}/script.ts`];
      s.actor.script = typeof script === 'string' ? script : '';
      if (files[`${dir}/blocks.json`] !== undefined) s.actor.blocks = parseJson(files, `${dir}/blocks.json`);
      scenes.set(s.id, s);
    } else if ((m = path.match(/^assets\/[^/]+\.json$/))) {
      const a = parseJson<Asset & { file?: string }>(files, path);
      if (a.type === 'image' && a.file !== undefined) {
        const data = files[`assets/${a.file}`];
        if (data === undefined) throw new Error(`${path}: missing image file assets/${a.file}`);
        const { file, ...rest } = a;
        (rest as ImageAsset).src = encodeDataUrl(file, data);
        assets.set(a.id, rest as ImageAsset);
      } else assets.set(a.id, a);
    }
  }

  const project: Record<string, unknown> = {
    name: index.name,
    version: index.version,
    assets: ordered(index.assets, assets),
    scenes: ordered(index.scenes, scenes),
    mainSceneId: index.mainSceneId,
  };
  if (files['interactions.json'] !== undefined) project.interactions = parseJson<Interactions>(files, 'interactions.json');
  if (index.touch) project.touch = index.touch;
  const p = migrateProject(project);
  if (!p) throw new Error('not a project folder (or from a newer version)');
  return p;
}

/** Items in the listed order; ones the list doesn't know (added by someone else) go last, by id. */
function ordered<T extends { id: string }>(order: string[], items: Map<string, T>): T[] {
  const listed = order.filter((id) => items.has(id)).map((id) => items.get(id)!);
  const seen = new Set(order);
  const rest = [...items.values()].filter((i) => !seen.has(i.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return [...listed, ...rest];
}

function parseJson<T>(files: FileTree, path: string): T {
  const text = files[path];
  if (text === undefined) throw new Error(`missing ${path}`);
  if (typeof text !== 'string') throw new Error(`${path} is not a text file`);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

/** A readable file name for a scene or asset name: "Hero · Big" → "hero-big". Letters of any script stay. */
export function fileSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'unnamed';
}

/** Names that share a slug all get their id appended, so files never clash (on case-insensitive disks too). */
function uniqueNames<T extends { id: string; name: string }>(items: T[]): [T, string][] {
  const count = new Map<string, number>();
  for (const i of items) count.set(fileSlug(i.name), (count.get(fileSlug(i.name)) ?? 0) + 1);
  return items.map((i) => {
    const slug = fileSlug(i.name);
    return [i, count.get(slug)! > 1 ? `${slug}-${fileSlug(i.id)}` : slug];
  });
}

// ---------------------------------------------------------------------------
// Images: data URLs ↔ files
// ---------------------------------------------------------------------------

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

/** An image data URL as a file (SVG as text, the rest as bytes); null for ordinary URLs or unknown types. */
function decodeDataUrl(src: string): { ext: string; content: FileData } | null {
  const m = src.match(/^data:([^;,]+)((?:;[^;,]*)*),(.*)$/s);
  if (!m) return null;
  const ext = EXT_BY_MIME[m[1].toLowerCase()];
  if (!ext) return null;
  const base64 = /;base64$/i.test(m[2]);
  if (ext === 'svg') return { ext, content: base64 ? new TextDecoder().decode(fromBase64(m[3])) : decodeURIComponent(m[3]) };
  return { ext, content: base64 ? fromBase64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])) };
}

function encodeDataUrl(file: string, data: FileData): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`assets/${file}: unknown image type`);
  if (ext === 'svg') {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return `data:${mime};base64,${toBase64(bytes)}`;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Stable JSON
// ---------------------------------------------------------------------------

/**
 * JSON written the same way every time: keys sorted (id, type, kind, name first), a value on one
 * line when it fits, otherwise one entry per line. Ends with a newline.
 */
export function formatJson(value: unknown): string {
  return `${format(value, '')}\n`;
}

function format(v: unknown, indent: string): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  const inner = indent + '  ';
  const isArray = Array.isArray(v);
  const entries: string[] = isArray
    ? (v as unknown[]).map((x) => format(x, inner))
    : sortedKeys(v as Record<string, unknown>).map((k) => `${JSON.stringify(k)}: ${format((v as Record<string, unknown>)[k], inner)}`);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  if (!entries.length) return open + close;
  const flat = isArray ? `[${entries.join(', ')}]` : `{ ${entries.join(', ')} }`;
  if (!flat.includes('\n') && indent.length + flat.length <= LINE_WIDTH && !hasDeepNesting(v)) return flat;
  return `${open}\n${entries.map((e) => inner + e).join(',\n')}\n${indent}${close}`;
}

/** Keeps objects holding objects that hold objects multi-line, so nested data diffs per entry. */
function hasDeepNesting(v: object): boolean {
  return Object.values(v).some((x) => x !== null && typeof x === 'object' && Object.values(x).some((y) => y !== null && typeof y === 'object'));
}

function sortedKeys(o: Record<string, unknown>): string[] {
  const keys = Object.keys(o).filter((k) => o[k] !== undefined);
  const lead = LEADING_KEYS.filter((k) => keys.includes(k));
  return [...lead, ...keys.filter((k) => !LEADING_KEYS.includes(k)).sort()];
}
