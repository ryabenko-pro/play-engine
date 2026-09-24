import { AssetStore } from '../engine/assets';
import { Game } from '../engine/game';
import { Input } from '../engine/input';
import { Renderer } from '../engine/renderer';
import type { Project } from '../engine/types';

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
    if (raw) return JSON.parse(raw) as PlayPayload;
  }
  const res = await fetch('./project.json');
  if (!res.ok) throw new Error(`project.json: HTTP ${res.status}`);
  return { project: (await res.json()) as Project };
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
  const { project } = payload;
  document.title = project.name;
  const assets = new AssetStore(project.assets);
  const input = new Input();
  input.attach();
  const game = new Game(project, payload.sceneId ?? project.mainSceneId, assets, input, {
    zoom: 1.5,
    onLog: (m) => console.log(m),
  });
  const renderer = new Renderer(canvas.getContext('2d')!, assets);
  const vp = { width: 0, height: 0 };
  let dpr = 1;
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    vp.width = window.innerWidth;
    vp.height = window.innerHeight;
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);
  };
  window.addEventListener('resize', resize);
  resize();
  status.remove();

  let last = performance.now();
  const loop = (t: number) => {
    game.frame((t - last) / 1000);
    last = t;
    game.render(renderer, vp, dpr);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
