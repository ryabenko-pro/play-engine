import { runGame } from '../../player/run';
import { createTowerDefenceProject } from './project';

/** Tower Defence, standalone: the course project, played full-window. */
document.getElementById('status')?.remove();
const project = createTowerDefenceProject();
// Nothing is followed by the camera, so the player fits the whole map in the window.
runGame(document.getElementById('game') as HTMLCanvasElement, project);
