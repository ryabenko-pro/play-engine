import type { ScriptError } from '../../collab/check';
import type { Choice, Conflict } from '../../collab/merge';
import type { Project } from '../../engine/types';
import type { Collab } from '../collab';
import type { LogSink, ProjectReader, ProjectWriter } from '../store';
import { h, openModal } from '../ui';

export type ShareStore = ProjectReader & ProjectWriter & LogSink;

/** Save: asks what was done and who helped, then saves (asking about clashes on the way). */
export function saveFlow(collab: Collab, store: ShareStore): void {
  if (collab.busy) return;
  const message = h('textarea', { placeholder: 'What did you change? (e.g. "Yellow enemies are faster")', maxLength: 300 });
  const helpers = collab.members.filter((m) => m.id !== collab.me.id);
  const boxes = helpers.map((m) => [m.id, h('input', { type: 'checkbox' })] as const);
  const body = [
    message,
    helpers.length ? h('p', {}, 'Who worked on it with you?') : null,
    helpers.length
      ? h('div', { class: 'coauthors' }, ...helpers.map((m, i) => h('label', {}, boxes[i][1], m.name)))
      : null,
  ];
  const close = openModal(`Save to “${collab.name}”`, body, [
    ['Cancel', () => close()],
    ['⬆ Save', () => {
      close();
      const coauthors = boxes.filter(([, box]) => box.checked).map(([id]) => id);
      void runSave(collab, store, message.value, coauthors, {});
    }, 'primary'],
  ]);
}

async function runSave(collab: Collab, store: ShareStore, message: string, coauthors: string[], choices: Record<string, Choice>): Promise<void> {
  try {
    const r = await collab.save(store.project, message, coauthors, choices, (p) => store.replaceProject(p, true));
    if (r.kind === 'saved') store.log(`Saved to “${collab.name}”: everyone gets it with ⬇ Get latest`);
    else if (r.kind === 'unchanged') store.log('Nothing to save: no changes since the last version');
    else if (r.kind === 'errors') showScriptErrors(r.errors);
    else if (r.kind === 'conflicts') {
      const more = await chooseConflicts(r.conflicts, 'Saving');
      if (more) await runSave(collab, store, message, coauthors, { ...choices, ...more });
    }
  } catch (err) {
    store.log(`Save error: ${(err as Error).message}`);
  }
}

/** Get latest: brings in what others saved, keeping my unsaved changes. */
export async function getLatestFlow(collab: Collab, store: ShareStore, choices: Record<string, Choice> = {}): Promise<void> {
  if (collab.busy) return;
  try {
    const r = await collab.getLatest(store.project, choices, (p: Project) => store.replaceProject(p, true));
    if (r.kind === 'updated') store.log('Got the latest version');
    else if (r.kind === 'current') store.log('You already have the latest version');
    else if (r.kind === 'conflicts') {
      const more = await chooseConflicts(r.conflicts, 'Getting the latest version');
      if (more) await getLatestFlow(collab, store, { ...choices, ...more });
    }
  } catch (err) {
    store.log(`Get latest error: ${(err as Error).message}`);
  }
}

export function showScriptErrors(errors: ScriptError[]): void {
  const close = openModal('Fix these scripts first', [
    h('p', {}, 'Others would get a game that doesn’t start. Your changes are still here; fix them and save again.'),
    h('ul', { class: 'script-errors' }, ...errors.map((e) => h('li', {}, h('b', {}, e.scene), `: ${e.error}`))),
  ], [['OK', () => close(), 'primary']]);
}

/** Asks which version of each clashing thing to keep. Resolves null when cancelled. */
export function chooseConflicts(conflicts: Conflict[], doing: string): Promise<Record<string, Choice> | null> {
  return new Promise((resolve) => {
    const choices: Record<string, Choice> = {};
    const ok = h('button', { class: 'primary', disabled: true }, 'Continue');
    const rows = conflicts.map((c) => {
      const side = (choice: Choice, title: string, value: unknown) => {
        const el = h('button', { class: 'conflict-side' }, h('small', {}, title), preview(value));
        el.addEventListener('click', () => {
          choices[c.path] = choice;
          for (const b of el.parentElement!.children) b.classList.toggle('chosen', b === el);
          ok.disabled = Object.keys(choices).length < conflicts.length;
        });
        return el;
      };
      return h('div', { class: 'conflict' },
        h('div', { class: 'conflict-title' }, c.label),
        h('div', { class: 'conflict-sides' }, side('mine', 'Mine', c.mine), side('theirs', 'Saved by others', c.theirs)),
      );
    });
    const all = (choice: Choice) => () => {
      for (const c of conflicts) choices[c.path] = choice;
      close();
      resolve(choices);
    };
    const close = openModal(
      `${doing}: ${conflicts.length === 1 ? 'one thing was' : `${conflicts.length} things were`} changed by you and by someone else`,
      [h('p', {}, 'Pick which one to keep for each.'), ...rows],
      [
        ['Cancel', () => (close(), resolve(null))],
        ['Keep all mine', all('mine')],
        ['Keep all theirs', all('theirs')],
        ok,
      ],
      () => resolve(null),
    );
    ok.addEventListener('click', () => (close(), resolve(choices)));
  });
}

/** A small look at a value: a colour, an image, some code or text. */
function preview(v: unknown): Node {
  if (v === undefined) return h('i', {}, 'deleted');
  if (typeof v === 'string') {
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return h('span', {}, h('span', { class: 'swatch', style: { background: v } }), v);
    if (v.startsWith('data:image/') || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)$/i.test(v)) return h('img', { src: v, alt: '' });
    if (v.includes('\n')) return h('pre', {}, v);
    return h('span', {}, v || '(empty)');
  }
  if (typeof v !== 'object' || v === null) return h('span', {}, String(v));
  const text = JSON.stringify(v, (_, x: unknown) => (typeof x === 'string' && x.startsWith('data:') ? '[image]' : x), 2);
  return h('pre', {}, text.length > 600 ? `${text.slice(0, 600)}…` : text);
}
