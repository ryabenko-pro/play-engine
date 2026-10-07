import { describe, expect, it } from 'vitest';
import { mergeText } from '../src/collab/diff3';
import { mergeProjects } from '../src/collab/merge';
import { createActorScene, createInstance, createLevelScene, type ActorScene, type LevelScene, type Project } from '../src/engine';
import { createTowerDefenceProject } from '../src/games/td/project';

const lines = (...l: string[]) => l.map((s) => `${s}\n`).join('');

describe('mergeText', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');

  it('combines changes to different lines', () => {
    expect(mergeText(base, lines('A', 'b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'd', 'E'))).toBe(lines('A', 'b', 'c', 'd', 'E'));
  });

  it('combines insertions and deletions', () => {
    expect(mergeText(base, lines('a', 'b', 'x', 'c', 'd', 'e'), lines('a', 'b', 'c', 'e'))).toBe(lines('a', 'b', 'x', 'c', 'e'));
  });

  it('takes the same change made on both sides once', () => {
    expect(mergeText(base, lines('a', 'B', 'c', 'd', 'e'), lines('a', 'B', 'c', 'd', 'e'))).toBe(lines('a', 'B', 'c', 'd', 'e'));
  });

  it('refuses different changes to the same line', () => {
    expect(mergeText(base, lines('a', 'X', 'c', 'd', 'e'), lines('a', 'Y', 'c', 'd', 'e'))).toBeNull();
    expect(mergeText(base, lines('a', 'b', 'x', 'c', 'd', 'e'), lines('a', 'b', 'y', 'c', 'd', 'e'))).toBeNull();
  });

  it('keeps a missing final newline', () => {
    expect(mergeText('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toBe('A\nb\nC');
  });
});

/** A project with a level holding two instances of one actor. */
function setup() {
  const actor = createActorScene('Grunt');
  actor.actor.script = lines('export const props = { speed: 1 };', '', 'export function update(self) {', '  self.x += 1;', '}');
  const level = createLevelScene('Map', 'topdown');
  const a = createInstance(actor, 0, 0);
  const b = createInstance(actor, 100, 0);
  level.entities.push(a, b);
  const p: Project = { version: 4, name: 'P', assets: [], scenes: [level, actor], mainSceneId: level.id };
  return { p, ids: { level: level.id, actor: actor.id, a: a.id, b: b.id } };
}

const copy = (p: Project) => JSON.parse(JSON.stringify(p)) as Project;
const level = (p: Project, id: string) => p.scenes.find((s) => s.id === id) as LevelScene;
const actor = (p: Project, id: string) => p.scenes.find((s) => s.id === id) as ActorScene;
const entity = (p: Project, lv: string, id: string) => level(p, lv).entities.find((e) => e.id === id)!;

describe('mergeProjects', () => {
  it('merges edits to different entities and different fields of one entity', () => {
    const { p, ids } = setup();
    const mine = copy(p);
    const theirs = copy(p);
    entity(mine, ids.level, ids.a).x = 50;
    entity(theirs, ids.level, ids.a).y = 70;
    entity(theirs, ids.level, ids.b).name = 'Boss';
    actor(mine, ids.actor).actor.color = '#ff0000';
    const { project, conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(entity(project, ids.level, ids.a)).toMatchObject({ x: 50, y: 70 });
    expect(entity(project, ids.level, ids.b).name).toBe('Boss');
    expect(actor(project, ids.actor).actor.color).toBe('#ff0000');
  });

  it('keeps entities and scenes added on both sides, and deletions', () => {
    const { p, ids } = setup();
    const mine = copy(p);
    const theirs = copy(p);
    const extra = createActorScene('Tower');
    mine.scenes.push(extra);
    const placed = createInstance(extra, 5, 5);
    level(mine, ids.level).entities.push(placed);
    const other = createActorScene('Enemy');
    theirs.scenes.push(other);
    level(theirs, ids.level).entities = level(theirs, ids.level).entities.filter((e) => e.id !== ids.b);
    const { project, conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(project.scenes.map((s) => s.name)).toEqual(['Map', 'Grunt', 'Tower', 'Enemy']);
    expect(level(project, ids.level).entities.map((e) => e.id)).toEqual([ids.a, placed.id]);
  });

  it('merges one script edited on different lines', () => {
    const { p, ids } = setup();
    const mine = copy(p);
    const theirs = copy(p);
    const a = actor(mine, ids.actor).actor;
    a.script = a.script.replace('speed: 1', 'speed: 2');
    const t = actor(theirs, ids.actor).actor;
    t.script = t.script.replace('self.x += 1', 'self.x += 3');
    const { project, conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(actor(project, ids.actor).actor.script).toContain('speed: 2');
    expect(actor(project, ids.actor).actor.script).toContain('self.x += 3');
  });

  it('reports a clash with a readable label, and applies the choice', () => {
    const { p, ids } = setup();
    const mine = copy(p);
    const theirs = copy(p);
    actor(mine, ids.actor).actor.color = '#ff0000';
    actor(theirs, ids.actor).actor.color = '#00ff00';
    const { project, conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts).toEqual([
      { path: `scenes[${ids.actor}].actor.color`, label: 'Grunt › color', base: p.scenes[1].kind === 'actor' && (p.scenes[1] as ActorScene).actor.color, mine: '#ff0000', theirs: '#00ff00' },
    ]);
    expect(actor(project, ids.actor).actor.color).toBe('#00ff00');
    const chosen = mergeProjects(p, mine, theirs, { [conflicts[0].path]: 'mine' });
    expect(chosen.conflicts).toEqual([]);
    expect(actor(chosen.project, ids.actor).actor.color).toBe('#ff0000');
  });

  it('reports deleted on one side but changed on the other', () => {
    const { p, ids } = setup();
    const mine = copy(p);
    const theirs = copy(p);
    level(mine, ids.level).entities = level(mine, ids.level).entities.filter((e) => e.id !== ids.a);
    entity(theirs, ids.level, ids.a).x = 9;
    const { conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ path: `scenes[${ids.level}].entities[${ids.a}]`, mine: undefined, label: 'Map › Grunt' });
    const kept = mergeProjects(p, mine, theirs, { [conflicts[0].path]: 'mine' });
    expect(level(kept.project, ids.level).entities.map((e) => e.id)).toEqual([ids.b]);
  });

  it('merges block programs by block and regenerates their script', () => {
    const p = createTowerDefenceProject();
    const yellow = p.scenes.find((s) => s.name === 'Yellow') as ActorScene;
    const mine = copy(p);
    const theirs = copy(p);
    const my = actor(mine, yellow.id).actor.blocks!;
    my.vars.push({ name: 'armor', value: 2, prop: true });
    const their = actor(theirs, yellow.id).actor.blocks!;
    their.stacks[0].x = 300;
    const { project, conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts).toEqual([]);
    const merged = actor(project, yellow.id).actor;
    expect(merged.blocks!.stacks[0].x).toBe(300);
    expect(merged.blocks!.vars.map((v) => v.name)).toContain('armor');
    expect(merged.script).toContain('armor: 2');
  });

  it('treats an image changed on both sides as a clash: one of them is kept', () => {
    const { p } = setup();
    p.assets.push({ id: 'img_1', type: 'image', name: 'Hero', src: 'data:image/png;base64,AAAA', width: 1, height: 1 });
    const mine = copy(p);
    const theirs = copy(p);
    (mine.assets[0] as { src: string }).src = 'data:image/png;base64,BBBB';
    (theirs.assets[0] as { src: string }).src = 'data:image/png;base64,CCCC';
    const { conflicts } = mergeProjects(p, mine, theirs);
    expect(conflicts.map((c) => c.label)).toEqual(['Hero › src']);
  });
});
