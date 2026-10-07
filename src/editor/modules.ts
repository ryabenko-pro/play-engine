/**
 * Optional editor modules. A disabled module is hidden from the editor (toolbar, inspectors,
 * block palette); projects keep its data and the engine still runs it, so nothing breaks.
 * Turn one on for a session with the URL, e.g. `?modules=interactions`.
 */
export interface EditorModules {
  /** Kinds, elements, statuses and reactions (fire, water…): ⚗ Interactions. */
  readonly interactions: boolean;
}

function requested(): Set<string> {
  try {
    return new Set((new URLSearchParams(location.search).get('modules') ?? '').split(',').map((s) => s.trim()));
  } catch {
    return new Set();
  }
}

const on = requested();

export const modules: EditorModules = {
  interactions: on.has('interactions'),
};
