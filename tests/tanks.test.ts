import { describe, expect, it } from 'vitest';
import { AssetStore, Game, Input, type Actor } from '../src/engine';
import { createTanksProject } from '../src/games/tanks/project';

function start() {
  const project = createTanksProject();
  const input = new Input();
  const logs: string[] = [];
  const game = new Game(project, project.mainSceneId, new AssetStore(project.assets), input, { onLog: (m) => logs.push(m) });
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) game.step(1 / 60);
  };
  const errors = () => logs.filter((l) => /error/i.test(l));
  return { game, input, logs, run, errors };
}

const director = (game: Game) => game.find('director')!;
const player = (game: Game) => game.find('player')!;
const live = (game: Game) => game.all('enemy').filter((e: Actor) => e.data.phase === 'live');

describe('tanks', () => {
  it('runs a stage without script errors and spawns enemies one by one', () => {
    const { game, run, errors } = start();
    run(0.5);
    expect(live(game)).toHaveLength(0);
    expect(player(game).data.phase).toBe('spawn');
    run(10);
    expect(errors()).toEqual([]);
    expect(live(game).length).toBeGreaterThanOrEqual(2);
    expect((director(game).data.queue as unknown[]).length).toBeLessThan(20);
  });

  it('drives the player with the keyboard and stops at bricks', () => {
    const { game, input, run } = start();
    run(1.2);
    const p = player(game);
    const y0 = p.y;
    input.press('ArrowUp');
    run(3);
    // Tile (4, 12) → up column 4 until the bricks of tile (4, 7): their bottom is at y 256, the tank's half size 13…
    expect(p.y).toBeGreaterThanOrEqual(269);
    expect(p.y).toBeLessThan(y0 - 100);
    expect(p.state).toBe('up-move');
    input.release('ArrowUp');
    input.press('ArrowLeft');
    run(2);
    // …then left into the brick pillar of tile (3, 8), whose right edge is at x 128.
    expect(p.x).toBeGreaterThanOrEqual(141);
    expect(p.x).toBeLessThan(144);
  });

  it('shells break bricks, and the director restarts everything on a new game', () => {
    const { game, input, run } = start();
    const bricks = () => game.all('brick').filter((b) => b.visible).length;
    run(1.2);
    const before = bricks();
    input.press('ArrowUp');
    run(3);
    input.release('ArrowUp');
    input.press('Space');
    run(1);
    input.release('Space');
    expect(bricks()).toBeLessThan(before);

    director(game).data.baseLost = true;
    run(0.1);
    expect(director(game).data.state).toBe('over');
    expect(game.find('banner')!.visible).toBe(true);
    run(2);
    input.press('Enter');
    run(0.1);
    expect(director(game).data.state).toBe('play');
    expect(bricks()).toBe(before);
    expect(player(game).x).toBe(player(game).spawnX);
  });

  it('enemy shells destroy the base (game over), and a carrier drops a bonus', () => {
    const { game, run } = start();
    run(1);
    const base = game.find('base')!;
    const e = game.all('enemy')[0];
    // Put a live enemy above the base, facing it: it fires at what is lined up ahead.
    Object.assign(e.data, { phase: 'live', block: 13, dir: 2, cooldown: 0, carrier: true, turnIn: 99 });
    e.visible = true;
    e.health = 5;
    e.x = base.x;
    e.y = base.y - 80;
    e.damage(0, player(game)); // hitting a carrier requests a bonus
    run(0.1);
    expect(game.find('bonus')!.visible).toBe(true);
    run(3);
    expect(base.state).toBe('dead');
    expect(director(game).data.state).toBe('over');
  });
});
