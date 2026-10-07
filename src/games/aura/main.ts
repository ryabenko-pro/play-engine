import { runGame } from '../../player/run';
import { createAuraProject } from './project';

/** Aura, standalone: open on a phone, or add ?touch to see the touch controls with a mouse. */
document.getElementById('status')?.remove();
const project = createAuraProject();
// About 420 world px across the shorter side of the screen, phone or desktop.
const zoom = Math.max(0.8, Math.min(window.innerWidth, window.innerHeight) / 420);
runGame(document.getElementById('game') as HTMLCanvasElement, project, project.mainSceneId, zoom);
