import type { SceneMarks } from '../collab';
import { h, type MenuItem } from '../ui';

/** Who else is in the shared project, for the scene list and the tabs. */
export interface PresenceView {
  marks(sceneId: string): SceneMarks;
  /** "I'm working on this" on or off (taking it over when someone else claimed it). */
  setClaim(sceneId: string, on: boolean): void;
  subscribe(fn: () => void): void;
}

/** A steady colour per person. */
export function personColor(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 62%)`;
}

/** Little markers after a scene's name: a dot per person in it (✎ = unsaved changes there) and the claim. */
export function sceneMarks(m: SceneMarks): HTMLElement[] {
  const out: HTMLElement[] = m.people.map((p) =>
    h('span', {
      class: `person ${p.editing ? 'editing' : ''}`,
      style: { background: personColor(p.id) },
      title: p.editing ? `${p.name} is changing this (not saved yet)` : `${p.name} is looking at this`,
    }, p.editing ? `${p.name[0]}✎` : p.name[0]),
  );
  if (m.claim) {
    out.push(h('span', {
      class: `claim ${m.claim.mine ? 'mine' : ''}`,
      title: m.claim.mine ? 'You said you’re working on this' : `${m.claim.name} is working on this: talk to them before changing it`,
    }, `⚑ ${m.claim.mine ? 'you' : m.claim.name}`));
  }
  return out;
}

/** A warning for the scene being edited, when someone else claimed it or is changing it too. */
export function sceneNotice(m: SceneMarks): string | null {
  if (m.claim && !m.claim.mine) return `⚑ ${m.claim.name} is working on this. Talk to ${m.claim.name} before changing it, or your changes may clash.`;
  const editing = m.people.filter((p) => p.editing).map((p) => p.name);
  if (editing.length) return `✎ ${editing.join(' and ')} ${editing.length > 1 ? 'are' : 'is'} changing this too (not saved yet).`;
  return null;
}

export function claimMenu(view: PresenceView, sceneId: string): MenuItem[] {
  const c = view.marks(sceneId).claim;
  if (!c) return [['⚑ I’m working on this', () => view.setClaim(sceneId, true), 'Tell the others you are working on this scene']];
  if (c.mine) return [['⚑ I’m done with this', () => view.setClaim(sceneId, false), 'Let the others work on it']];
  return [
    [`⚑ Take over from ${c.name}`, () => view.setClaim(sceneId, true), `${c.name} said they are working on it: ask them first`],
    ['⚑ Nobody is working on this', () => view.setClaim(sceneId, false), `Remove ${c.name}’s claim`],
  ];
}
