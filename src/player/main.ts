import { migrateProject } from '../engine/migrate';
import type { Project } from '../engine/types';
import { runGame } from './run';

interface PlayPayload {
  project: Project;
  sceneId?: string;
}

/**
 * Standalone runtime. Loads the project either from the editor (?source=editor)
 * or from ./project.json next to play.html – that's the shippable build.
 */
async function loadPayload(): Promise<PlayPayload> {
  if (new URLSearchParams(location.search).get('source') === 'editor') {
    const raw = localStorage.getItem('ge.play');
    if (raw) {
      const payload = JSON.parse(raw) as { project: unknown; sceneId?: string };
      return { project: checked(migrateProject(payload.project)), sceneId: payload.sceneId };
    }
  }
  // ?v=<version>: an older version of a shared project (the sync server serves it).
  const v = new URLSearchParams(location.search).get('v');
  const res = await fetch(v ? `./project.json?v=${encodeURIComponent(v)}` : './project.json');
  if (!res.ok) throw new Error(`project.json: HTTP ${res.status}`);
  return { project: checked(migrateProject(await res.json())) };
}

function checked(p: Project | null): Project {
  if (!p) throw new Error('not a project file (or from a newer version)');
  return p;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const status = document.getElementById('status')!;
  let payload: PlayPayload;
  try {
    payload = await loadPayload();
  } catch (err) {
    status.textContent = `Could not load game: ${(err as Error).message}`;
    return;
  }
  status.remove();
  runGame(canvas, payload.project, payload.sceneId);
}

void main();
