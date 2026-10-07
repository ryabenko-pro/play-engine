import { createBlock, createInstance, createLevelScene } from './factory';
import type { ActorDef, ActorEntity, ActorScene, Entity, InstanceEntity, LevelScene, Project, Scene } from './types';
import { clone } from './util';

export interface SceneLookup {
  readonly scenes: readonly Scene[];
}

export function findActorScene(lookup: SceneLookup, id: string): ActorScene | undefined {
  const s = lookup.scenes.find((x) => x.id === id);
  return s?.kind === 'actor' ? s : undefined;
}

export function findLevel(lookup: SceneLookup, id: string): LevelScene | undefined {
  const s = lookup.scenes.find((x) => x.id === id);
  return s?.kind === 'level' ? s : undefined;
}

export function mergeTags(a: string, b: string): string {
  return [...new Set([...a.split(','), ...b.split(',')].map((t) => t.trim()).filter(Boolean))].join(', ');
}

/** Instance placement + scene definition → a concrete actor (deep copy). Props stay as overrides. */
export function resolveInstance(lookup: SceneLookup, inst: InstanceEntity): ActorEntity | null {
  const scene = findActorScene(lookup, inst.sceneId);
  if (!scene) return null;
  const def = clone(scene.actor);
  return {
    ...def,
    id: inst.id,
    name: inst.name,
    x: inst.x,
    y: inst.y,
    tags: mergeTags(def.tags, inst.tags),
    props: { ...inst.props },
    form: inst.form,
    sceneId: scene.id,
  };
}

/** Name of an actor's own look, which every actor has. */
export const BASE_FORM = 'base';

/** The actor scene implementing one of a container's forms. */
export function findFormScene(lookup: SceneLookup, container: ActorDef, form: string | undefined): ActorScene | undefined {
  if (!form || form === BASE_FORM) return undefined;
  const ref = container.forms.find((f) => f.name === form);
  return ref ? findActorScene(lookup, ref.sceneId) : undefined;
}

/** What an actor looks like in a form: the form scene's definition, or its own. */
export function lookOf(lookup: SceneLookup, container: ActorDef, form: string | undefined): ActorDef {
  return findFormScene(lookup, container, form)?.actor ?? container;
}

/** Actor scenes that use `sceneId` as one of their forms. */
export function formUsers(lookup: SceneLookup, sceneId: string): { container: ActorScene; form: string }[] {
  const out: { container: ActorScene; form: string }[] = [];
  for (const s of lookup.scenes) {
    if (s.kind !== 'actor') continue;
    for (const f of s.actor.forms) if (f.sceneId === sceneId) out.push({ container: s, form: f.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nested levels: rooms → buildings → worlds
// ---------------------------------------------------------------------------

/** An entity of a level after nested levels are expanded. */
export interface PlacedEntity {
  /** The entity itself (top level), or a moved copy with a path id (nested). */
  e: Entity;
  /** Id of the top-level entity it belongs to (itself, or the level instance containing it). */
  owner: string;
  /** 0 for the level's own entities. */
  depth: number;
}

const MAX_NESTING = 16;

/** Does `sceneId` contain `targetId` (itself or through nested level instances)? */
export function levelContains(lookup: SceneLookup, sceneId: string, targetId: string, seen = new Set<string>()): boolean {
  if (sceneId === targetId) return true;
  const level = findLevel(lookup, sceneId);
  if (!level || seen.has(sceneId)) return false;
  seen.add(sceneId);
  return level.entities.some((e) => e.type === 'instance' && levelContains(lookup, e.sceneId, targetId, seen));
}

/**
 * Flattens a level: instances of other levels are replaced by their contents, moved by the
 * instance position. Nested ids and names become paths ("Room 1/Guard"), and the instance's
 * tags are added to everything inside. Cycles and missing scenes are skipped (reported via `warn`).
 */
export function expandLevel(lookup: SceneLookup, level: LevelScene, warn: (msg: string) => void = () => {}): PlacedEntity[] {
  const out: PlacedEntity[] = [];
  const walk = (entities: readonly Entity[], chain: string[], nested: InstanceEntity[]) => {
    for (const e of entities) {
      const top = nested[0];
      const inner = e.type === 'instance' ? findLevel(lookup, e.sceneId) : undefined;
      if (!inner) {
        out.push({ e: nested.length ? placeCopy(e, nested) : e, owner: (top ?? e).id, depth: nested.length });
        continue;
      }
      if (e.type !== 'instance') continue;
      if (chain.includes(inner.id) || chain.length > MAX_NESTING) {
        warn(`${e.name}: "${inner.name}" contains itself, skipped`);
        continue;
      }
      walk(inner.entities, [...chain, inner.id], [...nested, e]);
    }
  };
  walk(level.entities, [level.id], []);
  return out;
}

/** Copy of a nested entity in the coordinates of the outermost level. */
function placeCopy(e: Entity, path: readonly InstanceEntity[]): Entity {
  const c = clone(e);
  for (const inst of path) {
    c.x += inst.x;
    c.y += inst.y;
    if (inst.tags) c.tags = mergeTags(c.tags, inst.tags);
  }
  c.id = [...path.map((i) => i.id), e.id].join('/');
  c.name = [...path.map((i) => i.name), e.name].join('/');
  return c;
}

/** A throwaway level for play-testing an actor scene on its own (optionally in one of its forms). */
export function sandboxLevel(scene: ActorScene, form?: string): LevelScene {
  const level = createLevelScene(`${scene.name} (test)`, scene.previewView);
  const side = scene.previewView === 'side';
  level.entities.push(
    Object.assign(createBlock({ kind: 'rect', w: 1400, h: side ? 60 : 1000 }, 0, side ? 30 : 0), {
      name: 'Floor',
      color: '#3b4a3f',
      solid: side,
    }),
  );
  if (side) {
    level.entities.push(
      Object.assign(createBlock({ kind: 'rect', w: 160, h: 20 }, 220, -110), { color: '#8a6d4b' }),
      Object.assign(createBlock({ kind: 'rect', w: 40, h: 300 }, -700, -150), { color: '#5a6b7d' }),
      Object.assign(createBlock({ kind: 'rect', w: 40, h: 300 }, 700, -150), { color: '#5a6b7d' }),
    );
  } else {
    for (const [x, y, w, h] of [
      [0, -510, 1040, 20],
      [0, 510, 1040, 20],
      [-510, 0, 20, 1040],
      [510, 0, 20, 1040],
    ]) {
      level.entities.push(Object.assign(createBlock({ kind: 'rect', w, h }, x, y), { color: '#7a8699', height: 32 }));
    }
  }
  const half = scene.actor.collider.kind === 'rect' ? scene.actor.collider.h / 2 : scene.actor.collider.r;
  level.entities.push(Object.assign(createInstance(scene, 0, side ? -half - 1 : 0), { form }));
  return level;
}

/** Project copy with the sandbox level added, ready to hand to Game. */
export function sandboxProject(project: Project, scene: ActorScene, form?: string): { project: Project; levelId: string } {
  const level = sandboxLevel(scene, form);
  return { project: { ...project, scenes: [...project.scenes, level] }, levelId: level.id };
}
