import type { BlockNode, Project } from '../../engine/types';
import { blockDef, type MenuSource } from './catalog';
import { isNode, setBlocks } from './codegen';

/**
 * Renames a name chosen in block dropdowns of one kind ('path', 'zone', 'scene') in every
 * block actor of the project, and regenerates their scripts. Returns the number of slots changed.
 */
export function renameInBlocks(p: Project, menu: MenuSource, from: string, to: string): number {
  if (from === to) return 0;
  let n = 0;
  const walk = (node: BlockNode) => {
    const def = blockDef(node.op);
    for (const [slot, v] of Object.entries(node.args)) {
      if (isNode(v)) walk(v);
      else if (def?.slots?.[slot]?.menu === menu && v === from) {
        node.args[slot] = to;
        n++;
      }
    }
    for (const list of Object.values(node.stacks ?? {})) list.forEach(walk);
  };
  for (const s of p.scenes) {
    if (s.kind !== 'actor' || !s.actor.blocks) continue;
    const before = n;
    for (const stack of s.actor.blocks.stacks) stack.blocks.forEach(walk);
    if (n !== before) setBlocks(s, s.actor.blocks);
  }
  return n;
}
