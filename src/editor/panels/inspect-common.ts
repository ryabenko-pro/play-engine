import { InteractionRules } from '../../engine/interactions';
import type { AssetType, KindDef } from '../../engine/types';
import type {
  AssetCache,
  Observable,
  ProjectReader,
  ProjectWriter,
  SceneSwitcher,
  ScriptCompiler,
  SelectionModel,
} from '../store';
import type { Options } from '../ui';

export type InspectorStore = Observable & ProjectReader & ProjectWriter & SelectionModel & SceneSwitcher & AssetCache & ScriptCompiler;

export const VIEWS: Options = [
  ['side', 'Side view'],
  ['topdown', 'Top-down'],
  ['isometric', 'Isometric'],
];

export function assetOptions(store: ProjectReader, type: AssetType, noneLabel = '— none —'): Options {
  return [['', noneLabel], ...store.project.assets.filter((a) => a.type === type).map((a) => [a.id, a.name] as const)];
}

export const orNull = (v: string): string | null => v || null;

export function projectKinds(store: ProjectReader): KindDef[] {
  return store.project.interactions?.kinds ?? [];
}

/** One line describing what a set of kinds does physically, e.g. "solid · pushable (weight 1) · gives off fire". */
export function kindSummary(store: ProjectReader, kinds: readonly string[]): string {
  const k = new InteractionRules(store.project.interactions).kindProps(kinds);
  const parts: string[] = [];
  if (k.solid) parts.push('solid');
  if (k.pushable) parts.push(`pushable (weight ${k.weight})`);
  if (k.strength) parts.push(`pushes up to weight ${k.strength}`);
  if (k.emits.length) parts.push(`gives off ${[...new Set(k.emits.map((e) => e.element))].join(', ')}`);
  return parts.join(' · ');
}
