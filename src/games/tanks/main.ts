import { runGame } from '../../player/run';
import { createTanksProject } from './project';

/** Tanks, standalone: the project is built in code and run by the regular player. */
document.getElementById('status')?.remove();
const project = createTanksProject();
// Fit the 416 px arena (plus room for the HUD) into the window.
const zoom = Math.min(window.innerHeight / 460, window.innerWidth / 760);
runGame(document.getElementById('game') as HTMLCanvasElement, project, project.mainSceneId, zoom);
