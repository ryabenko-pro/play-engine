import { transform } from 'sucrase';
import type { Project } from '../engine/types';

export interface ScriptError {
  sceneId: string;
  scene: string;
  error: string;
}

/**
 * Scripts that don't compile, among those that differ from `before` (all of them without it),
 * so a broken script someone else saved earlier doesn't block an unrelated save.
 * Only parses: nothing is run, so this is safe on a server.
 */
export function scriptErrors(project: Project, before?: Project): ScriptError[] {
  const old = new Map(before?.scenes.map((s) => [s.id, s.kind === 'actor' ? s.actor.script : null]));
  const errors: ScriptError[] = [];
  for (const s of project.scenes) {
    if (s.kind !== 'actor' || old.get(s.id) === s.actor.script) continue;
    try {
      transform(s.actor.script, { transforms: ['typescript', 'imports'] });
    } catch (err) {
      errors.push({ sceneId: s.id, scene: s.name, error: (err as Error).message });
    }
  }
  return errors;
}
