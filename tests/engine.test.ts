import { describe, expect, it } from 'vitest';
import {
  AssetStore,
  Game,
  Input,
  collide,
  compileScript,
  createBlock,
  createCharacter,
  createProjectileAsset,
  createScene,
  parseFrames,
  project,
  shapeCollider,
  unproject,
  type Project,
  type Scene,
} from '../src/engine';

function projectWith(scene: Scene, assets: Project['assets'] = []): Project {
  return { version: 1, name: 't', assets, scenes: [scene], mainSceneId: scene.id };
}

function run(game: Game, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.step(1 / 60);
}

describe('collision', () => {
  it('pushes a box up out of the floor', () => {
    const floor = shapeCollider({ kind: 'rect', w: 200, h: 20 }, 0, 0);
    const box = shapeCollider({ kind: 'rect', w: 20, h: 20 }, 0, -18);
    const c = collide(box, floor)!;
    expect(c.ny).toBeCloseTo(-1);
    expect(c.depth).toBeCloseTo(2);
  });

  it('circle vs segment and vs rotated rect', () => {
    const seg = shapeCollider({ kind: 'line', x2: 100, y2: 0, thickness: 0 }, 0, 0);
    const c = collide({ type: 'circle', c: { x: 50, y: -8 }, r: 10 }, seg)!;
    expect(c.ny).toBeCloseTo(-1);
    expect(c.depth).toBeCloseTo(2);
    const slope = shapeCollider({ kind: 'rect', w: 200, h: 20 }, 0, 0, -30);
    expect(collide({ type: 'circle', c: { x: 0, y: -15 }, r: 10 }, slope)).not.toBeNull();
    expect(collide({ type: 'circle', c: { x: 0, y: -40 }, r: 10 }, slope)).toBeNull();
  });

  it('separated shapes do not collide', () => {
    expect(collide(shapeCollider({ kind: 'circle', r: 5 }, 0, 0), shapeCollider({ kind: 'circle', r: 5 }, 11, 0))).toBeNull();
  });
});

describe('assets & projection', () => {
  it('parses frame lists', () => {
    expect(parseFrames('0-3, 5 7-6')).toEqual([0, 1, 2, 3, 5, 7, 6]);
  });
  it('isometric projection round-trips', () => {
    const p = { x: 37, y: -12 };
    const back = unproject('isometric', project('isometric', p));
    expect(back.x).toBeCloseTo(37);
    expect(back.y).toBeCloseTo(-12);
  });
  it('compiles TypeScript scripts', () => {
    const fn = compileScript('const n: number = 1;\nintent.moveX = n as number;');
    const intent = { moveX: 0, moveY: 0, jump: false, shoot: false, aimX: 0, aimY: 0 };
    fn({} as never, {} as never, intent, 0, {});
    expect(intent.moveX).toBe(1);
  });
});

describe('game simulation', () => {
  const ground = () => createBlock({ kind: 'rect', w: 2000, h: 40 }, 0, 20); // top at y=0

  it('character falls and lands on the ground', () => {
    const scene = createScene('s', 'side');
    const hero = createCharacter('player', 0, -200);
    scene.entities.push(ground(), hero);
    const game = new Game(projectWith(scene), scene.id, new AssetStore(), new Input());
    run(game, 2);
    const c = game.chars[0];
    expect(c.grounded).toBe(true);
    expect(c.e.y).toBeCloseTo(-19, 0); // collider is 38 tall, ground top at 0
  });

  it('player moves right and jumps with keyboard', () => {
    const scene = createScene('s', 'side');
    scene.entities.push(ground(), createCharacter('player', 0, -19));
    const input = new Input();
    const game = new Game(projectWith(scene), scene.id, new AssetStore(), input);
    input.press('ArrowRight');
    input.press('Space');
    run(game, 0.2);
    const c = game.chars[0];
    expect(c.e.x).toBeGreaterThan(10);
    expect(c.e.y).toBeLessThan(-40);
  });

  it('patrolling NPC does not walk off its platform', () => {
    const scene = createScene('s', 'side');
    const npc = createCharacter('npc', 0, -19);
    npc.behaviorRange = 1000;
    scene.entities.push(createBlock({ kind: 'rect', w: 200, h: 40 }, 0, 20), npc);
    const game = new Game(projectWith(scene), scene.id, new AssetStore(), new Input());
    let minX = 0;
    let maxX = 0;
    for (let i = 0; i < 600; i++) {
      game.step(1 / 60);
      minX = Math.min(minX, game.chars[0].e.x);
      maxX = Math.max(maxX, game.chars[0].e.x);
    }
    expect(game.chars[0].grounded).toBe(true);
    expect(maxX).toBeGreaterThan(40);
    expect(minX).toBeLessThan(-40);
  });

  it('idle hero is taken over by AI and returned on input', () => {
    const scene = createScene('s', 'topdown');
    const hero = createCharacter('player', 0, 0);
    hero.idleTakeover = 1;
    hero.behavior = 'script';
    hero.script = 'intent.moveX = 1;';
    scene.entities.push(hero);
    const input = new Input();
    const game = new Game(projectWith(scene), scene.id, new AssetStore(), input);
    run(game, 0.5);
    expect(game.chars[0].aiActive).toBe(false);
    expect(game.chars[0].e.x).toBeCloseTo(0);
    run(game, 1);
    expect(game.chars[0].aiActive).toBe(true);
    expect(game.chars[0].e.x).toBeGreaterThan(20);
    input.press('ArrowLeft');
    game.step(1 / 60);
    expect(game.chars[0].aiActive).toBe(false);
  });

  it('projectiles damage characters of other teams', () => {
    const bolt = createProjectileAsset();
    const scene = createScene('s', 'topdown');
    const shooter = createCharacter('npc', 0, 0);
    shooter.behavior = 'chase';
    shooter.behaviorRange = 400;
    shooter.projectileId = bolt.id;
    shooter.speed = 0;
    const target = createCharacter('player', 150, 0);
    scene.entities.push(shooter, target);
    const game = new Game(projectWith(scene, [bolt]), scene.id, new AssetStore([bolt]), new Input());
    run(game, 1);
    expect(game.chars[1].health).toBeLessThan(target.maxHealth);
  });
});

describe('input', () => {
  it('a tap shorter than one step still returns control from the AI', () => {
    const scene = createScene('s', 'topdown');
    const hero = createCharacter('player', 0, 0);
    hero.idleTakeover = 0.5;
    scene.entities.push(hero);
    const input = new Input();
    const game = new Game(projectWith(scene), scene.id, new AssetStore(), input);
    run(game, 1);
    expect(game.chars[0].aiActive).toBe(true);
    input.press('KeyZ');
    input.release('KeyZ');
    game.step(1 / 60);
    expect(game.chars[0].aiActive).toBe(false);
  });
});
