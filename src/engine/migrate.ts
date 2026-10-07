import { createDefaultInteractions } from './interactions';
import type { ActorDef, Project } from './types';

/** Oldest saved format this build can still open. */
const OLDEST = 3;

/**
 * Upgrades a parsed project file to the current format, in place. Returns null if
 * it isn't a project. v3 → v4: actors gained forms and effects (scale, trail, wobble).
 * Projects without interactions get the default library (fire, water, cold, heat).
 */
export function migrateProject(raw: unknown): Project | null {
  const o = raw as { version?: unknown; scenes?: unknown; assets?: unknown } | null;
  if (!o || typeof o.version !== 'number' || o.version < OLDEST || o.version > 4) return null;
  if (!Array.isArray(o.scenes) || !o.scenes.length || !Array.isArray(o.assets)) return null;
  const p = raw as Project;
  for (const s of p.scenes) {
    if (s.kind !== 'actor') continue;
    const a = s.actor as Partial<ActorDef>;
    a.forms ??= [];
    a.scale ??= 1;
    a.trail ??= 0;
    a.wobble ??= 0;
  }
  p.interactions ??= createDefaultInteractions();
  p.version = 4;
  return p;
}
