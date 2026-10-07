import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { fileSlug, filesToProject, projectToFiles, type FileTree } from '../engine/files';
import type { Project } from '../engine/types';

/** Files kept as bytes; everything else in a project folder is UTF-8 text. */
const BINARY = /\.(png|jpe?g|gif|webp)$/i;
/** Fixed timestamp, so the same project always zips to the same bytes. */
const MTIME = new Date('2020-01-01T00:00:00Z');

/** The project folder (see engine/files.ts) zipped inside a folder named after the project. */
export function projectToZip(project: Project): Uint8Array {
  const root = fileSlug(project.name);
  const entries: Zippable = {};
  for (const [path, data] of Object.entries(projectToFiles(project))) {
    entries[`${root}/${path}`] = typeof data === 'string' ? strToU8(data) : [data, { level: 0 }];
  }
  return zipSync(entries, { mtime: MTIME });
}

/** Reads a zipped project folder, whether project.json is at the top or inside one folder. */
export function zipToProject(zip: Uint8Array): Project {
  const raw = unzipSync(zip);
  const top = Object.keys(raw).find((p) => /^([^/]+\/)?project\.json$/.test(p));
  if (!top) throw new Error('no project.json in the zip');
  const prefix = top.slice(0, -'project.json'.length);
  const files: FileTree = {};
  for (const [path, bytes] of Object.entries(raw)) {
    if (!path.startsWith(prefix) || path.endsWith('/')) continue;
    const rel = path.slice(prefix.length);
    files[rel] = BINARY.test(rel) ? bytes : strFromU8(bytes);
  }
  return filesToProject(files);
}
