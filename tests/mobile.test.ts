import { describe, expect, it } from 'vitest';
import {
  AssetStore,
  CanvasGraphics,
  Game,
  Input,
  Renderer,
  createActorScene,
  createInstance,
  createLevelScene,
  mixColors,
  parseColor,
  placeButtons,
  stickArrows,
  stickVector,
  stubArt,
  stubSprite,
  touchMetrics,
  withAlpha,
  type Project,
} from '../src/engine';
import { createAuraProject } from '../src/games/aura/project';

/** A 2D context that records calls (method name + args) and ignores everything else. */
function recordingCtx() {
  const calls: Array<[string, unknown[]]> = [];
  const state: Record<string | symbol, unknown> = {};
  const gradient = { addColorStop: (...a: unknown[]) => calls.push(['addColorStop', a]) };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getTransform') return () => ({ a: 2, b: 0 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a: unknown[]) => (calls.push([k, a]), gradient);
      if (k === 'measureText') return () => ({ width: 10 });
      return (...a: unknown[]) => calls.push([String(k), a]);
    },
    set(t, k, v) {
      t[k] = v;
      calls.push([`=${String(k)}`, [v]]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const names = () => calls.map((c) => c[0]);
  return { ctx, calls, names };
}

describe('stub art', () => {
  it('is deterministic per name and different between names', () => {
    expect(stubArt('Slime').svg).toBe(stubArt('Slime').svg);
    expect(stubArt('Slime').svg).not.toBe(stubArt('Bat').svg);
    expect(stubArt('Slime', { seed: 2 }).svg).not.toBe(stubArt('Slime').svg);
    const names = ['Slime', 'Bat', 'Golem', 'Ghost', 'Knight', 'Wizard', 'Frog', 'Robot'];
    expect(new Set(names.map((n) => stubArt(n).color)).size).toBe(names.length);
  });

  it('gives creatures the default state animations, one frame strip', () => {
    const art = stubArt('Hero', { size: 40 });
    expect(art.animations.map((a) => a.name)).toEqual(['idle', 'run', 'jump', 'fall', 'attack', 'hurt', 'dead']);
    const frames = art.animations.flatMap((a) => a.frames.split('-').map(Number));
    expect(Math.max(...frames) + 1).toBe(art.width / art.frameW);
    expect(art.height).toBe(40);
    expect(art.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="')).toBe(true);
  });

  it('makes items, tiles and props, honours colour and label', () => {
    for (const kind of ['item', 'tile', 'prop'] as const) {
      const art = stubArt('Thing', { kind, color: '#3366ff', label: 'Q' });
      expect(art.color).toBe('#3366ff');
      expect(art.svg).toContain('>Q</text>');
      expect(art.svg).toContain('#3366ff');
    }
    expect(stubArt('<&>', { kind: 'item' }).svg).toContain('&lt;');
  });

  it('creates linked image + sprite assets', () => {
    const { image, sprite } = stubSprite('Bat');
    expect(image.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(sprite.imageId).toBe(image.id);
    expect(sprite.frameW).toBe(32);
    expect(image.width).toBe(sprite.frameW * 12);
  });
});

describe('colours', () => {
  it('parses and mixes', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0, 1]);
    expect(parseColor('#00ff0080')?.[3]).toBeCloseTo(0.5, 2);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(parseColor('hsl(0, 100%, 50%)')?.slice(0, 3).map(Math.round)).toEqual([255, 0, 0]);
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
    expect(mixColors('#ff0000', '#0000ff', 2)).toBe('rgb(0,0,255)');
    expect(withAlpha('#ffffff', 0.25)).toBe('rgba(255,255,255,0.25)');
  });
});

describe('touch joystick', () => {
  it('has a dead zone and clamps to length 1', () => {
    expect(stickVector(5, 0, 100)).toEqual({ x: 0, y: 0 });
    const full = stickVector(300, 400, 100);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1);
    expect(full.x).toBeCloseTo(0.6);
    const half = stickVector(0, -57.5, 100, 0.15);
    expect(half.y).toBeCloseTo(-0.5);
  });

  it('maps to arrow keys', () => {
    expect(stickArrows({ x: -0.9, y: 0.1 })).toEqual(['ArrowLeft']);
    expect(stickArrows({ x: 0.7, y: -0.7 })).toEqual(['ArrowRight', 'ArrowUp']);
  });

  it('places buttons on screen without overlap', () => {
    for (const [w, h] of [[390, 844], [844, 390], [1280, 800]]) {
      const btns = placeButtons(['Space', 'KeyJ', 'KeyK', 'KeyL'].map((key) => ({ key })), w, h);
      expect(btns.map((b) => b.label)).toEqual(['A', 'B', 'C', 'D']);
      for (const b of btns) {
        expect(b.x - b.r).toBeGreaterThan(w / 2);
        expect(b.x + b.r).toBeLessThanOrEqual(w);
        expect(b.y + b.r).toBeLessThanOrEqual(h);
      }
      for (let i = 0; i < btns.length; i++)
        for (let j = i + 1; j < btns.length; j++) expect(Math.hypot(btns[i].x - btns[j].x, btns[i].y - btns[j].y)).toBeGreaterThan(btns[i].r + btns[j].r);
      expect(touchMetrics(w, h).stickR).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('Graphics', () => {
  it('draws shapes with fill, stroke, gradients and glow', () => {
    const { ctx, calls, names } = recordingCtx();
    const g = new CanvasGraphics(ctx);
    g.run(10, 20, (g) => {
      g.circle(0, 0, 5, { fill: g.radial(0, 0, 5, [[0, '#fff'], [1, '#fff0']]), stroke: '#f00', width: 3, glow: 4, blend: 'add' });
    });
    const n = names();
    expect(n).toContain('arc');
    expect(n).toContain('createRadialGradient');
    expect(n.indexOf('fill')).toBeLessThan(n.indexOf('stroke'));
    expect(calls.find((c) => c[0] === 'translate')?.[1]).toEqual([10, 20]);
    expect(calls.find((c) => c[0] === '=shadowBlur')?.[1]).toEqual([8]); // glow 4 × transform scale 2
    expect(calls.find((c) => c[0] === '=globalCompositeOperation')?.[1]).toEqual(['lighter']);
    expect(calls.find((c) => c[0] === '=lineWidth')?.[1]).toEqual([3]);
  });

  it('a bare colour fills; stroke() turns a fill style into an outline', () => {
    const { ctx, names, calls } = recordingCtx();
    const g = new CanvasGraphics(ctx);
    g.rectangle(0, 0, 4, 4, '#0f0');
    expect(names()).toContain('fill');
    expect(names()).not.toContain('stroke');
    g.beginPath().moveTo(0, 0).bezierCurveTo(1, 1, 2, 2, 3, 3).stroke({ fill: '#00f' }, 2);
    expect(calls.filter((c) => c[0] === '=strokeStyle').at(-1)?.[1]).toEqual(['#00f']);
  });

  it('closes saves a script left open', () => {
    const { ctx, names } = recordingCtx();
    const g = new CanvasGraphics(ctx);
    g.run(0, 0, (g) => {
      g.save().translate(5, 5).save().rotate(1);
    });
    expect(names().filter((n) => n === 'save').length).toBe(names().filter((n) => n === 'restore').length);
    g.restore(); // unbalanced restore from a script is ignored
    expect(names().filter((n) => n === 'save').length).toBe(names().filter((n) => n === 'restore').length);
  });
});

function oneActor(script: string): { game: Game; input: Input; logs: string[] } {
  const level = createLevelScene('L', 'topdown');
  const scene = createActorScene('A');
  scene.actor.script = script;
  level.entities.push(createInstance(scene, 0, 0));
  const project: Project = { version: 4, name: 't', assets: [], scenes: [level, scene], mainSceneId: level.id };
  const input = new Input();
  const logs: string[] = [];
  return { game: new Game(project, level.id, new AssetStore([]), input, { onLog: (m) => logs.push(m) }), input, logs };
}

describe('scripts', () => {
  it('read input.stick from the joystick, else from the keyboard', () => {
    const { game, input } = oneActor(`export function update(self, world) { self.data.s = { ...world.input.stick }; }`);
    const s = () => game.actors[0].data.s as { x: number; y: number };
    game.step(1 / 60);
    expect(s()).toEqual({ x: 0, y: 0 });
    input.press('ArrowRight');
    input.press('KeyS');
    game.step(1 / 60);
    expect(s().x).toBeCloseTo(Math.SQRT1_2);
    expect(s().y).toBeCloseTo(Math.SQRT1_2);
    input.setStick(-0.3, 0);
    game.step(1 / 60);
    expect(s()).toEqual({ x: -0.3, y: 0 });
    expect(game.input.idleTime).toBe(0);
  });

  it('draw hooks run around the sprite and the HUD on top', () => {
    const { game } = oneActor(`
      export function drawUnder(self, world, g) { g.circle(0, 0, 1, '#a00001'); }
      export function draw(self, world, g) { g.circle(0, 0, 1, '#a00002'); }
      export function drawHud(self, world, g) { g.text(world.hud.width + 'x' + world.hud.height, 0, 0, '#a00003'); }
    `);
    const { ctx, calls } = recordingCtx();
    game.render(new Renderer(ctx, new AssetStore([])), { width: 320, height: 200 }, 1);
    const fills = calls.filter((c) => c[0] === '=fillStyle').map((c) => c[1][0]);
    const under = fills.indexOf('#a00001');
    const over = fills.indexOf('#a00002');
    const hud = fills.indexOf('#a00003');
    expect(under).toBeGreaterThanOrEqual(0);
    // The sprite-less actor body is filled between the two hooks.
    expect(fills.slice(under + 1, over).length).toBeGreaterThan(0);
    expect(hud).toBeGreaterThan(over);
    expect(calls.find((c) => c[0] === 'fillText')?.[1][0]).toBe('320x200');
  });

  it('a throwing draw hook stops that script, not the frame', () => {
    const { game, logs } = oneActor(`export function draw(self, world, g) { throw new Error('boom'); }`);
    const { ctx } = recordingCtx();
    const r = new Renderer(ctx, new AssetStore([]));
    game.render(r, { width: 10, height: 10 }, 1);
    game.render(r, { width: 10, height: 10 }, 1);
    expect(logs).toEqual(['[A] draw() error: boom (script stopped)']);
  });
});

describe('Aura demo', () => {
  it('runs, moves the hero with the stick and draws without errors', () => {
    const project = createAuraProject();
    const input = new Input();
    const logs: string[] = [];
    const game = new Game(project, project.mainSceneId, new AssetStore(project.assets), input, { onLog: (m) => logs.push(m) });
    const hero = game.find('player')!;
    const x0 = hero.x;
    input.setStick(1, 0);
    for (let i = 0; i < 60; i++) game.step(1 / 60);
    expect(hero.x).toBeGreaterThan(x0 + 60);
    // Power drives the aura shape: go through all three shapes and the pulse.
    const { ctx } = recordingCtx();
    const r = new Renderer(ctx, new AssetStore(project.assets));
    for (const power of [0, 5, 10]) {
      hero.data.power = power;
      game.render(r, { width: 390, height: 844 }, 3);
    }
    input.press('Space');
    game.step(1 / 60);
    expect(hero.data.power).toBe(7);
    game.render(r, { width: 390, height: 844 }, 3);
    expect(logs).toEqual([]);
  });
});
