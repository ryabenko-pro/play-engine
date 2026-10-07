import { AssetStore } from '../engine/assets';
import { FrameStats, now } from '../engine/debug';
import { Game } from '../engine/game';
import { Input } from '../engine/input';
import { Renderer } from '../engine/renderer';
import { TouchControls } from '../engine/touch';
import type { Project, TouchLayout } from '../engine/types';

/**
 * Runs a project full-window on `canvas`: keyboard and mouse input, touch controls (the
 * project's `touch` layout, or `touch`; ?touch in the URL shows them with a mouse too),
 * resize, the frame loop, playing again after the game ended, and the debug overlay
 * (F3, or ?debug in the URL).
 */
export function runGame(canvas: HTMLCanvasElement, project: Project, sceneId = project.mainSceneId, zoom = 1.5, touch: TouchLayout | undefined = project.touch): Game {
  document.title = project.name;
  const assets = new AssetStore(project.assets);
  const input = new Input();
  input.attach();
  input.attachPointer(canvas);
  const newGame = () => new Game(project, sceneId, assets, input, { zoom, fit: true, onLog: (m) => console.log(m) });
  const first = newGame();
  let game = first;
  const params = new URLSearchParams(location.search);
  const controls = new TouchControls(input, params.has('touch') ? { ...touch, show: 'always' } : touch);
  controls.attach(canvas);
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

  // F3 toggles the debug overlay (FPS, simulation / render time %).
  const stats = new FrameStats();
  let debug = params.has('debug');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      debug = !debug;
    }
  });

  let last = performance.now();
  const loop = (t: number) => {
    const frameMs = t - last;
    last = t;
    if (game.restartRequested) game = newGame();
    const t0 = now();
    game.frame(frameMs / 1000);
    const t1 = now();
    game.render(renderer, vp, dpr);
    controls.draw(renderer.ctx, dpr, vp.width, vp.height);
    const { scriptMs, steps } = game.takeTimings();
    stats.add({ frameMs, simMs: t1 - t0, scriptMs, renderMs: now() - t1, steps });
    if (debug) stats.draw(renderer.ctx, dpr, vp.width, game.counts());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return first;
}
