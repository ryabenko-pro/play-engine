import { emptyIntent, type Intent } from './intent';
import { normalize } from './math';
import type { BrainBody, BrainWorld, Targetable } from './runtime';
import { compileScript, type ScriptSelf, type ScriptTarget, type ScriptWorld } from './scripting';

/** A brain turns world state into an intent, once per fixed step. */
export type Brain = (dt: number) => Intent;

export function makeBrain(body: BrainBody, world: BrainWorld): Brain | null {
  switch (body.e.behavior) {
    case 'none':
      return null;
    case 'patrol':
      return patrol(body, world);
    case 'wander':
      return wander(body, world);
    case 'chase':
      return chase(body, world);
    case 'script':
      return scripted(body, world);
  }
}

function patrol(b: BrainBody, w: BrainWorld): Brain {
  let dir = 1;
  return () => {
    const i = emptyIntent();
    const range = b.e.behaviorRange || 100;
    if (b.hitWall === dir || b.blocked) dir = -dir;
    else if (w.view === 'side' && b.grounded && !w.groundAhead(b, dir)) dir = -dir;
    else if ((b.e.x - b.spawn.x) * dir > range) dir = -dir;
    i.moveX = dir;
    return i;
  };
}

function wander(b: BrainBody, w: BrainWorld): Brain {
  let timer = 0;
  let d = { x: 0, y: 0 };
  return (dt) => {
    const i = emptyIntent();
    const side = w.view === 'side';
    const range = b.e.behaviorRange || 150;
    timer -= dt;
    if (b.blocked) timer = 0;
    if (timer <= 0) {
      timer = 0.8 + Math.random() * 2;
      const home = { x: b.spawn.x - b.e.x, y: side ? 0 : b.spawn.y - b.e.y };
      if (Math.hypot(home.x, home.y) > range) d = normalize(home);
      else if (Math.random() < 0.3) d = { x: 0, y: 0 };
      else if (side) d = { x: Math.random() < 0.5 ? -1 : 1, y: 0 };
      else {
        const a = Math.random() * Math.PI * 2;
        d = { x: Math.cos(a), y: Math.sin(a) };
      }
    }
    if (side && d.x !== 0) {
      if (b.hitWall === Math.sign(d.x)) {
        if (b.grounded && Math.random() < 0.5) i.jump = true;
        else d = { x: -d.x, y: 0 };
      } else if (b.grounded && !w.groundAhead(b, Math.sign(d.x))) {
        d = { x: -d.x, y: 0 };
      }
    }
    i.moveX = d.x;
    i.moveY = d.y;
    return i;
  };
}

function chase(b: BrainBody, w: BrainWorld): Brain {
  const idle = wander(b, w);
  return (dt) => {
    const range = b.e.behaviorRange || 300;
    const t = w.nearestTarget(b, range);
    if (!t) return idle(dt);
    const i = emptyIntent();
    const dx = t.e.x - b.e.x;
    const dy = t.e.y - b.e.y;
    const armed = !!b.e.projectileId;
    const keep = armed ? range * 0.4 : 4;
    if (w.view === 'side') {
      if (Math.abs(dx) > keep) i.moveX = Math.sign(dx);
      if (i.moveX !== 0 && b.grounded && !w.groundAhead(b, i.moveX)) i.moveX = 0;
      if (b.grounded && (b.hitWall === Math.sign(dx) || (dy < -80 && Math.abs(dx) < 120))) i.jump = true;
      i.aimX = Math.sign(dx) || b.facing;
      i.shoot = armed && Math.abs(dy) < 40;
    } else {
      const d = Math.hypot(dx, dy) || 1;
      if (d > keep) {
        i.moveX = dx / d;
        i.moveY = dy / d;
      }
      i.aimX = dx / d;
      i.aimY = dy / d;
      i.shoot = armed;
    }
    return i;
  };
}

function toTarget(from: BrainBody, t: Targetable | null): ScriptTarget | null {
  if (!t) return null;
  return {
    x: t.e.x,
    y: t.e.y,
    name: t.e.name,
    team: t.e.team,
    tags: splitTags(t.e.tags),
    distance: Math.hypot(t.e.x - from.e.x, t.e.y - from.e.y),
  };
}

const splitTags = (tags: string): string[] =>
  tags
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function scripted(b: BrainBody, w: BrainWorld): Brain | null {
  const prefix = `[${b.e.name}]`;
  let fn;
  try {
    fn = compileScript(b.e.script);
  } catch (err) {
    w.log(`${prefix} script compile error: ${(err as Error).message}`);
    return null;
  }
  const api: ScriptWorld = {
    get time() {
      return w.time;
    },
    view: w.view,
    nearest: (team) => toTarget(b, w.nearestTarget(b, Infinity, team)),
    player: () => toTarget(b, w.player()),
    log: (...args) => w.log(`${prefix} ${args.map(String).join(' ')}`),
  };
  let failed = false;
  return (dt) => {
    const intent = emptyIntent();
    if (failed) return intent;
    const self: ScriptSelf = {
      x: b.e.x,
      y: b.e.y,
      vx: b.vx,
      vy: b.vy,
      grounded: b.grounded,
      hitWall: b.hitWall,
      facing: b.facing,
      name: b.e.name,
      team: b.e.team,
      tags: splitTags(b.e.tags),
      health: b.health,
      spawnX: b.spawn.x,
      spawnY: b.spawn.y,
    };
    try {
      fn(self, api, intent, dt, b.memory);
    } catch (err) {
      failed = true;
      w.log(`${prefix} script runtime error: ${(err as Error).message}`);
    }
    return intent;
  };
}
