import type { Choice } from '../../collab/merge';
import type { Collab, Version } from '../collab';
import { h, openModal } from '../ui';
import { chooseConflicts, getLatestFlow, showScriptErrors, type ShareStore } from './share';

/**
 * Every saved version of a shared project: play it, undo it (a new version without its changes,
 * keeping later ones), or go back to it (a new version exactly like it). Nothing is ever lost.
 */
export function openHistory(collab: Collab, store: ShareStore): void {
  const list = h('ul', { class: 'versions' }, h('li', {}, 'Loading…'));
  const close = openModal(
    `History of “${collab.name}”`,
    [h('p', {}, 'Every save is kept. Undoing or going back makes a new version, so nothing is lost.'), list],
    [['Close', () => close()]],
    undefined,
    { wide: true },
  );
  collab
    .history()
    .then((versions) => list.replaceChildren(...versions.map((v, i) => row(v, i === 0))))
    .catch((err: Error) => list.replaceChildren(h('li', {}, `Can’t load the history: ${err.message}`)));

  const row = (v: Version, latest: boolean) => {
    const helpers = v.coauthors.map((c) => c.name);
    const act = (label: string, title: string, fn: () => void) => h('button', { class: 'small', title, onClick: fn }, label);
    return h('li', { class: `version ${latest ? 'current' : ''}` },
      h('div', { class: 'version-message' }, v.message || '(no message)'),
      h('div', { class: 'version-meta' }, `${v.author.name}${helpers.length ? ` with ${helpers.join(', ')}` : ''} · ${ago(v.time)}`),
      h('div', { class: 'version-things' }, ...things(v).map((t) => h('span', {}, t))),
      h('div', { class: 'version-actions' },
        act('▶ Play', 'Play the game as it was in this version', () => window.open(`play.html?v=${v.sha}`, '_blank')),
        v.parent ? act('↩ Undo', 'Take back what this save changed, keeping everything saved after it', () => confirmRewind('undo', v)) : null,
        latest ? null : act('⟲ Go back', 'Make the project exactly like this version again', () => confirmRewind('restore', v)),
      ),
    );
  };

  const confirmRewind = (kind: 'undo' | 'restore', v: Version) => {
    const text = kind === 'undo'
      ? 'This saves a new version without these changes. Everything saved after it stays.'
      : 'This saves a new version exactly like this one. Later changes go away, but stay in the history.';
    const ask = openModal(kind === 'undo' ? `Undo “${v.message}”?` : `Go back to “${v.message}”?`, [h('p', {}, text)], [
      ['Cancel', () => ask()],
      [kind === 'undo' ? '↩ Undo it' : '⟲ Go back', () => (ask(), close(), void rewind(collab, store, kind, v, {})), 'primary'],
    ]);
  };
}

async function rewind(collab: Collab, store: ShareStore, kind: 'undo' | 'restore', v: Version, choices: Record<string, Choice>): Promise<void> {
  try {
    const r = await collab.rewind(kind, v.sha, choices);
    if (r.kind === 'errors') return showScriptErrors(r.errors);
    if (r.kind === 'conflicts') {
      const more = await chooseConflicts(r.conflicts, 'Undoing');
      if (more) await rewind(collab, store, kind, v, { ...choices, ...more });
      return;
    }
    if (r.kind === 'unchanged') return store.log('Nothing changed: the project is already like that');
    store.log(kind === 'undo' ? `Undid “${v.message}”` : `Went back to “${v.message}”`);
    await getLatestFlow(collab, store);
  } catch (err) {
    store.log(`History error: ${(err as Error).message}`);
  }
}

/** What a version touched, from its files: "▦ map", "☺ yellow", "🖼 hero". */
function things(v: Version): string[] {
  if (!v.parent) return ['started the project'];
  const out = new Set<string>();
  for (const f of v.files) {
    const [dir, name = ''] = f.split('/');
    if (dir === 'levels') out.add(`▦ ${name.replace(/\.json$/, '')}`);
    else if (dir === 'actors') out.add(`☺ ${name}`);
    else if (dir === 'assets') out.add(`🖼 ${name.replace(/\.[^.]+$/, '')}`);
    else if (f === 'interactions.json') out.add('interactions');
    else out.add('project settings');
  }
  return [...out];
}

function ago(time: number): string {
  const s = Math.max(0, (Date.now() - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(time).toLocaleString();
}
