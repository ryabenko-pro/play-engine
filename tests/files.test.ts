import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  createActorScene,
  createEmptyProject,
  createImageAsset,
  fileSlug,
  filesToProject,
  formatJson,
  migrateProject,
  projectToFiles,
  stubSprite,
  type Project,
} from '../src/engine';
import { projectToZip, zipToProject } from '../src/editor/project-zip';
import { createAuraProject } from '../src/games/aura/project';
import { createTanksProject } from '../src/games/tanks/project';
import { createTowerDefenceProject } from '../src/games/td/project';

/** A 1×1 PNG. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const plain = (p: Project) => JSON.parse(JSON.stringify(p)) as Project;
/** What loading any saved project gives (old projects gain the default interactions). */
const loaded = (p: Project) => migrateProject(plain(p));

function withImages(): Project {
  const p = createEmptyProject();
  p.assets.push(createImageAsset('Hero sheet', PNG, 1, 1));
  p.assets.push(createImageAsset('Tree', stubSprite('Tree', { kind: 'prop' }).image.src, 32, 32));
  p.assets.push(createImageAsset('Remote', 'https://example.com/a.png', 8, 8));
  return p;
}

const projects: [string, () => Project][] = [
  ['empty + images', withImages],
  ['tower defence (blocks)', createTowerDefenceProject],
  ['tanks', createTanksProject],
  ['aura', createAuraProject],
];

describe('project folder', () => {
  for (const [name, make] of projects) {
    it(`round-trips ${name}`, () => {
      const p = make();
      const files = projectToFiles(p);
      expect(plain(filesToProject(files))).toEqual(loaded(p));
      // Writing what was read gives the same files, byte for byte.
      expect(projectToFiles(filesToProject(files))).toEqual(files);
    });
  }

  it('lays out one file per scene, script and asset', () => {
    const files = projectToFiles(createTowerDefenceProject());
    const paths = Object.keys(files);
    expect(paths).toContain('project.json');
    expect(paths).toContain('levels/map.json');
    expect(paths).toContain('actors/yellow/actor.json');
    expect(paths).toContain('actors/yellow/script.ts');
    expect(paths).toContain('actors/yellow/blocks.json');
    expect(files['actors/yellow/actor.json']).not.toContain('"script"');
  });

  it('stores images as image files', () => {
    const files = projectToFiles(withImages());
    expect(files['assets/hero-sheet.png']).toBeInstanceOf(Uint8Array);
    expect(files['assets/hero-sheet.json']).toContain('"file": "hero-sheet.png"');
    expect(files['assets/tree.svg']).toMatch(/^<svg/);
    expect(files['assets/remote.json']).toContain('https://example.com/a.png');
  });

  it('gives clashing names distinct files', () => {
    const p = createEmptyProject();
    const a = createActorScene('Enemy');
    const b = createActorScene('enemy!');
    p.scenes.push(a, b);
    const paths = Object.keys(projectToFiles(p));
    expect(paths).toContain(`actors/enemy-${fileSlug(a.id)}/actor.json`);
    expect(paths).toContain(`actors/enemy-${fileSlug(b.id)}/actor.json`);
    expect(plain(filesToProject(projectToFiles(p)))).toEqual(plain(p));
  });

  it('keeps names in any alphabet readable', () => {
    expect(fileSlug('Герой · Большой')).toBe('герой-большой');
    expect(fileSlug('***')).toBe('unnamed');
  });

  it('reads scenes added by someone else even when the order list misses them', () => {
    const p = createEmptyProject();
    const files = projectToFiles(p);
    const extra = createActorScene('Newcomer');
    const { script, blocks: _, ...actor } = extra.actor;
    files['actors/newcomer/actor.json'] = formatJson({ ...extra, actor });
    files['actors/newcomer/script.ts'] = script;
    const read = filesToProject(files);
    expect(read.scenes.map((s) => s.name)).toEqual([...p.scenes.map((s) => s.name), 'Newcomer']);
  });

  it('explains what is wrong with a broken folder', () => {
    const files = projectToFiles(createEmptyProject());
    expect(() => filesToProject({})).toThrow('missing project.json');
    files['levels/main.json'] = '{ oops';
    expect(() => filesToProject(files)).toThrow('levels/main.json');
  });

  it('formats JSON stably: sorted keys, short values on one line', () => {
    expect(formatJson({ b: 1, name: 'x', a: [1, 2], id: 'q', o: { y: 2, x: 1 } })).toBe(
      '{ "id": "q", "name": "x", "a": [1, 2], "b": 1, "o": { "x": 1, "y": 2 } }\n',
    );
    const long = formatJson({ points: Array.from({ length: 30 }, (_, i) => ({ x: i, y: i })) });
    expect(long.split('\n').length).toBeGreaterThan(30);
  });
});

describe('zipped project folder', () => {
  it('round-trips, images included, and zips the same project to the same bytes', () => {
    const p = withImages();
    const zip = projectToZip(p);
    expect(plain(zipToProject(zip))).toEqual(loaded(p));
    expect(projectToZip(p)).toEqual(zip);
    expect(Object.keys(unzipSync(zip))).toContain('untitled/assets/hero-sheet.png');
  });

  it('reads a zip with project.json at the top', () => {
    const files = projectToFiles(createTowerDefenceProject());
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
    expect(zipToProject(zip).name).toBe('Tower Defence');
    expect(() => zipToProject(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow('no project.json');
  });
});
