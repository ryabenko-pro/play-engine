import type { Entity } from '../../engine/types';

export interface TreeOptions {
  /** Group children by type (one group per placed scene, then paths, zones, blocks, projectiles). */
  group: boolean;
  /** Sort by name instead of scene order. */
  sortByName: boolean;
}

export interface TreeGroup {
  key: string;
  label: string;
  icon: string;
  items: Entity[];
}

const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Arranges a level's children for the Scene tree. Without grouping the result is a
 * single unlabeled group. Only affects display, never the scene's own order.
 */
export function arrangeEntities(
  entities: readonly Entity[],
  sceneName: (sceneId: string) => string | undefined,
  opts: TreeOptions,
  isLevel: (sceneId: string) => boolean = () => false,
): TreeGroup[] {
  const sorted = opts.sortByName ? [...entities].sort(byName) : [...entities];
  if (!opts.group) return [{ key: 'all', label: '', icon: '', items: sorted }];

  const actors = new Map<string, TreeGroup>();
  const blocks: TreeGroup = { key: 'blocks', label: 'Blocks', icon: '▭', items: [] };
  const projectiles: TreeGroup = { key: 'projectiles', label: 'Projectiles', icon: '➤', items: [] };
  const paths: TreeGroup = { key: 'paths', label: 'Paths', icon: '〰', items: [] };
  const zones: TreeGroup = { key: 'zones', label: 'Zones', icon: '⬠', items: [] };
  for (const e of sorted) {
    if (e.type === 'block') blocks.items.push(e);
    else if (e.type === 'projectile') projectiles.items.push(e);
    else if (e.type === 'path') paths.items.push(e);
    else if (e.type === 'zone') zones.items.push(e);
    else {
      const key = `scene:${e.sceneId}`;
      let g = actors.get(key);
      if (!g) actors.set(key, (g = { key, label: sceneName(e.sceneId) ?? 'Missing scene', icon: isLevel(e.sceneId) ? '▦' : '☺', items: [] }));
      g.items.push(e);
    }
  }
  const actorGroups = [...actors.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return [...actorGroups, paths, zones, blocks, projectiles].filter((g) => g.items.length);
}
