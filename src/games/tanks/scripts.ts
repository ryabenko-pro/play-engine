/**
 * TypeScript sources of the Tanks actors. The engine only moves projectiles, draws and
 * answers queries; the rules of the game are all here.
 *
 * Actors talk through the Director's `data` (score, lives, spawn queue, round…).
 * Anything that stops tanks publishes its half size in `self.data.block`.
 * To restart, the Director bumps `data.round`; every actor then resets itself.
 */

/** Round sync, shared by every actor that has to reset on restart (each script defines `reset`). */
const SYNC = `
/** The Director (null if missing). Resets this actor when a new round starts. */
function sync(self: Actor, world: World): Actor | null {
  const g = world.find('director');
  if (g && self.data.round !== g.data.round) {
    self.data.round = g.data.round;
    reset(self, world, g);
  }
  return g;
}
`;

/** Grid movement shared by the Player and Enemy tanks. */
const TANK = `
const DIRS = ['up', 'right', 'down', 'left'];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const HALF = 13; // half of the tank's 26 px square footprint

function touching(o: Actor, x: number, y: number, half: number) {
  const b = o.data.block as number;
  return !!b && o.visible && Math.abs(o.x - x) < half + b && Math.abs(o.y - y) < half + b;
}

/** First obstacle at (x, y) that the tank doesn't already overlap (so it can always drive out). */
function blocker(self: Actor, world: World, x: number, y: number) {
  for (const o of world.all()) {
    if (o !== self && touching(o, x, y, HALF) && !touching(o, self.x, self.y, HALF)) return o;
  }
  return null;
}

/** Drives one step in a direction (0 up, 1 right, 2 down, 3 left). Returns false if blocked. */
function drive(self: Actor, world: World, dir: number, speed: number, dt: number) {
  if (dir % 2 !== (self.data.dir as number) % 2) {
    // Turning onto the other axis: snap to the 8 px grid so the tank fits corridors.
    const sx = dir % 2 === 0 ? Math.round(self.x / 8) * 8 : self.x;
    const sy = dir % 2 === 1 ? Math.round(self.y / 8) * 8 : self.y;
    if (!blocker(self, world, sx, sy)) {
      self.x = sx;
      self.y = sy;
    }
  }
  self.data.dir = dir;
  const size = self.props.arena as number;
  const x = Math.max(HALF, Math.min(size - HALF, self.x + DX[dir] * speed * dt));
  const y = Math.max(HALF, Math.min(size - HALF, self.y + DY[dir] * speed * dt));
  const moved = (x !== self.x || y !== self.y) && !blocker(self, world, x, y);
  if (moved) {
    self.x = x;
    self.y = y;
  }
  self.setState(DIRS[dir] + '-move');
  return moved;
}

function fire(self: Actor, projectile: string) {
  const d = self.data.dir as number;
  self.shoot(projectile, DX[d], DY[d]);
}

function explode(self: Actor, world: World) {
  self.data.phase = 'explode';
  self.data.block = 0;
  self.setState('explode');
  world.burst(self.x, self.y, '#ff8c1a', 24);
}
`;

export const DIRECTOR_SCRIPT = `// Director: invisible referee. Owns the score, lives, enemy queue and game flow.
export const props = {
  enemies: 20, // tanks per stage
  lives: 2, // spare lives
  spawnEvery: 2.5, // seconds between enemy arrivals
  zoom: 0, // camera zoom; 0 = keep the player's
};

export function init(self: Actor, world: World) {
  self.visible = false;
  world.camera.follow(self);
  const zoom = (self.props as typeof props).zoom;
  if (zoom > 0) world.camera.zoom = zoom;
  start(self, world, true);
}

/** Starts a stage. fresh = a new game (score, lives and upgrades reset). */
function start(self: Actor, world: World, fresh: boolean) {
  const p = self.props as typeof props;
  const d = self.data;
  if (fresh) {
    d.stage = 1;
    d.score = 0;
    d.lives = p.lives;
  }
  d.fresh = fresh;
  d.round = ((d.round as number) || 0) + 1;
  d.queue = makeQueue(d.stage as number, p.enemies);
  d.kills = 0;
  d.nextSpawn = world.time + 1;
  d.spawnIdx = 0;
  d.state = 'play';
  d.stateAt = world.time;
  d.baseLost = false;
  d.playerLost = false;
  d.bonus = false;
  d.freezeUntil = 0;
  d.paused = false;
  world.log('Stage ' + d.stage);
}

/** Which enemy forms arrive, in order. Later stages bring more armour. Tanks 4, 11, 18 carry a bonus. */
function makeQueue(stage: number, n: number) {
  const weights: Record<string, number> = { base: Math.max(2, 12 - stage * 2), fast: 2 + stage, power: 1 + stage, armor: stage * 2 - 1 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const queue = [];
  for (let i = 0; i < n; i++) {
    let r = Math.random() * total;
    let form = 'base';
    for (const k in weights) {
      r -= weights[k];
      if (r < 0) { form = k; break; }
    }
    queue.push({ form, carrier: i % 7 === 3 });
  }
  return queue;
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  const d = self.data;
  const input = world.input;
  if (d.state === 'play') {
    if (input.pressed('KeyP', 'Escape')) d.paused = !d.paused;
    if (d.baseLost || d.playerLost) {
      d.state = 'over';
      d.stateAt = world.time;
      world.log('Game over, score ' + d.score);
    } else if ((d.kills as number) >= p.enemies) {
      d.state = 'clear';
      d.stateAt = world.time;
    }
  } else {
    const waited = world.time - (d.stateAt as number);
    const go = waited > 1.5 && input.pressed('Enter', 'Space');
    if (d.state === 'over' && go) start(self, world, true);
    if (d.state === 'clear' && (go || waited > 5)) {
      d.stage = (d.stage as number) + 1;
      start(self, world, false);
    }
  }
  hud(self, world);
}

function hud(self: Actor, world: World) {
  const p = self.props as typeof props;
  const d = self.data;
  const hud = world.hud;
  const left = p.enemies - (d.kills as number);
  hud.text('STAGE ' + d.stage, 16, 24, '#ffd166');
  hud.text('ENEMIES ' + '■'.repeat(Math.min(left, 20)) + ' ' + left, 16, 44, '#e6ebf0');
  hud.text('LIVES   ' + '♥'.repeat(Math.max(0, d.lives as number)), 16, 64, '#ff6b7a');
  hud.text('SCORE   ' + d.score, 16, 84, '#9be3aa');
  if (world.time < (d.freezeUntil as number)) hud.text('ENEMIES FROZEN ' + Math.ceil((d.freezeUntil as number) - world.time), 16, 104, '#7fe6ff');
  const hint = d.state === 'play' ? 'arrows / WASD move · Space / J fire · P pause' : 'Enter: ' + (d.state === 'over' ? 'new game' : 'next stage');
  hud.text(hint, 16, -16, 'rgba(255,255,255,0.6)');
}
`;

export const PLAYER_SCRIPT = `// Player tank: keyboard control, lives, upgrades (stars), shield after spawning.
export const props = {
  speed: 88,
  cooldown: 0.45, // seconds between shots
  shield: 3, // seconds of shield after spawning
  arena: 416, // playfield size in pixels
  team: 'player',
};

const KEYS = [['ArrowUp', 'KeyW'], ['ArrowRight', 'KeyD'], ['ArrowDown', 'KeyS'], ['ArrowLeft', 'KeyA']];
const FIRE = ['Space', 'KeyJ', 'KeyX'];
${TANK}${SYNC}
function reset(self: Actor, world: World, g: Actor) {
  if (g.data.fresh) self.data.stars = 0;
  respawn(self);
}

function respawn(self: Actor) {
  self.x = self.spawnX;
  self.y = self.spawnY;
  self.visible = true;
  self.data.dir = 0;
  self.data.phase = 'spawn';
  self.data.block = HALF;
  self.data.cooldown = 0;
  self.setForm('base');
  self.setState('spawn');
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  const g = sync(self, world);
  if (!g || g.data.paused) return;
  const phase = self.data.phase;

  if (phase === 'spawn') {
    if (self.stateTime > 1) {
      self.data.phase = 'live';
      self.setForm('shield', p.shield);
      self.setState('up');
    }
    return;
  }
  if (phase === 'explode') {
    if (self.stateTime > 0.6) {
      self.visible = false;
      self.data.phase = 'dead';
      self.data.deadAt = world.time;
    }
    return;
  }
  if (phase === 'dead') {
    if (g.data.state === 'play' && world.time - (self.data.deadAt as number) > 1) {
      if ((g.data.lives as number) > 0) {
        g.data.lives = (g.data.lives as number) - 1;
        respawn(self);
      } else {
        g.data.playerLost = true;
      }
    }
    return;
  }
  if (g.data.state !== 'play') return self.setState(DIRS[self.data.dir as number]);

  // Steer: the most recently pressed direction wins while it is held.
  const input = world.input;
  KEYS.forEach((keys, i) => {
    if (input.pressed(...keys)) self.data.lastDir = i;
  });
  let dir = self.data.lastDir as number;
  if (dir === undefined || !input.isDown(...KEYS[dir])) dir = KEYS.findIndex((keys) => input.isDown(...keys));
  if (dir >= 0) drive(self, world, dir, p.speed, dt);
  else self.setState(DIRS[self.data.dir as number]);

  // Fire. Stars: 1 = fast shells, 2 = double rate, 3 = heavy shells that break steel.
  const stars = (self.data.stars as number) || 0;
  self.data.cooldown = (self.data.cooldown as number) - dt;
  if (input.isDown(...FIRE) && (self.data.cooldown as number) <= 0) {
    fire(self, stars >= 3 ? 'Heavy shell' : stars >= 1 ? 'Fast shell' : 'Shell');
    self.data.cooldown = stars >= 2 ? p.cooldown / 2 : p.cooldown;
  }
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (self.data.phase !== 'live') return false;
  if (hit.from && hit.from.props.team === self.props.team) return false;
  if (hit.damage <= 0) return; // shielded: the shell stops, no harm
  self.data.stars = 0;
  explode(self, world);
}
`;

export const PLAYER_SHIELD_SCRIPT = `// Player · Shield: a form of the Player. Blocks every shell while it lasts.
export const props = {};

export function onHit(self: Actor, world: World, hit: Hit) {
  hit.damage = 0;
}
`;

export const ENEMY_SCRIPT = `// Enemy tank: waits for a slot in the Director's queue, spawns, roams toward the base, shoots.
// Its type comes from the queue as a form (fast, power, armor), which overrides these props.
export const props = {
  speed: 48,
  hp: 1,
  points: 100,
  projectile: 'Shell',
  fireRate: 1.4, // average seconds between random shots
  arena: 416,
  team: 'enemy',
};
${TANK}${SYNC}
function reset(self: Actor) {
  hide(self);
}

function hide(self: Actor) {
  self.visible = false;
  self.data.phase = 'wait';
  self.data.block = 0;
  self.setForm('base');
}

export function update(self: Actor, world: World, dt: number) {
  const g = sync(self, world);
  if (!g || g.data.paused) return;
  const phase = self.data.phase;
  if (phase === 'wait') return trySpawn(self, world, g);
  if (phase === 'spawn') {
    if (self.stateTime > 1) {
      self.data.phase = 'live';
      self.setState('down');
    }
    return;
  }
  if (phase === 'explode') {
    if (self.stateTime > 0.5) hide(self);
    return;
  }
  if (g.data.state === 'play') think(self, world, g, dt);
}

/** Takes the next tank from the queue when the Director allows it and a spawn point is free. */
function trySpawn(self: Actor, world: World, g: Actor) {
  const d = g.data;
  const queue = d.queue as { form: string; carrier: boolean }[];
  if (d.state !== 'play' || !queue.length || world.time < (d.nextSpawn as number)) return;
  const spawns = world.all('spawn');
  if (!spawns.length) return;
  const at = spawns[(d.spawnIdx as number) % spawns.length];
  d.spawnIdx = (d.spawnIdx as number) + 1;
  if (world.all('tank').some((t) => touching(t, at.x, at.y, HALF))) return; // occupied: try the next point
  const next = queue.shift()!;
  d.nextSpawn = world.time + (g.props.spawnEvery as number);
  self.setForm(next.form);
  self.health = self.props.hp as number;
  self.data.carrier = next.carrier;
  self.data.dir = 2;
  self.data.turnIn = 0;
  self.data.stuck = 0;
  self.data.cooldown = 1;
  self.data.phase = 'spawn';
  self.data.block = HALF;
  self.x = at.x;
  self.y = at.y;
  self.visible = true;
  self.setState('spawn');
}

function think(self: Actor, world: World, g: Actor, dt: number) {
  const p = self.props as typeof props;
  const d = self.data;
  if (d.carrier && world.time > ((d.blinkAt as number) || 0)) {
    self.flash(0.4); // bonus carriers blink
    d.blinkAt = world.time + 0.6;
  }
  if (world.time < (g.data.freezeUntil as number)) return self.setState(DIRS[d.dir as number]);

  // Move; turn now and then, or soon after bumping into something.
  const moved = drive(self, world, d.dir as number, p.speed, dt);
  d.stuck = moved ? 0 : (d.stuck as number) + dt;
  d.turnIn = (d.turnIn as number) - dt;
  if ((d.turnIn as number) <= 0 || (d.stuck as number) > 0.25) choose(self, world);

  // Shoot at whatever is lined up in front, and at random (that also clears bricks).
  d.cooldown = (d.cooldown as number) - dt;
  if ((d.cooldown as number) > 0) return;
  const player = world.find('player');
  const targets = [world.find('base'), player && player.data.phase === 'live' ? player : null];
  if (targets.some((t) => t && ahead(self, t)) || Math.random() < dt / p.fireRate) {
    fire(self, p.projectile);
    d.cooldown = 0.7;
  }
}

/** Is the target in the tank's line of fire? */
function ahead(self: Actor, t: Actor) {
  const d = self.data.dir as number;
  const dx = t.x - self.x, dy = t.y - self.y;
  return d % 2 === 0 ? Math.abs(dx) < 10 && Math.sign(dy) === DY[d] : Math.abs(dy) < 10 && Math.sign(dx) === DX[d];
}

/** New heading: mostly toward the base, sometimes the player, sometimes at random. */
function choose(self: Actor, world: World) {
  const d = self.data;
  const r = Math.random();
  const t = r < 0.45 ? world.find('base') : r < 0.65 ? world.find('player') : null;
  let dir = Math.floor(Math.random() * 4);
  if (t) {
    const dx = t.x - self.x, dy = t.y - self.y;
    const horizontal = Math.random() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy) + 1);
    dir = horizontal ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
  }
  if ((d.stuck as number) > 0 && dir === d.dir) dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
  d.dir = dir;
  d.stuck = 0;
  d.turnIn = 1 + Math.random() * 3;
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (self.data.phase !== 'live') return false;
  if (hit.from && hit.from.props.team === self.props.team) return false; // shells pass through allies
  const g = world.find('director');
  if (self.data.carrier) {
    self.data.carrier = false;
    if (g) g.data.bonus = true;
  }
  self.health -= hit.damage;
  self.flash(0.25);
  if (self.health > 0) return;
  if (g) {
    g.data.kills = (g.data.kills as number) + 1;
    g.data.score = (g.data.score as number) + (self.props.points as number);
  }
  explode(self, world);
}
`;

export const ENEMY_FAST_SCRIPT = `// Enemy · Fast: a form of the Enemy. Quick but fragile.
export const props = { speed: 104, points: 200 };
`;

export const ENEMY_POWER_SCRIPT = `// Enemy · Power: a form of the Enemy. Fires fast shells more often.
export const props = { speed: 60, points: 300, projectile: 'Fast shell', fireRate: 0.8 };
`;

export const ENEMY_ARMOR_SCRIPT = `// Enemy · Armor: a form of the Enemy. Slow, takes four hits.
export const props = { speed: 42, hp: 4, points: 400 };
`;

export const BRICK_SCRIPT = `// Brick: stops tanks and shells; a shell clears a tank-wide strip of bricks.
export const props = {};
${SYNC}
function reset(self: Actor) {
  self.visible = true;
  self.data.block = 8;
}

export function update(self: Actor, world: World) {
  sync(self, world);
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.visible) return false; // already gone: let shells through
  const dir = hit.from ? (hit.from.data.dir as number) : undefined;
  if (dir === undefined) return breakBrick(self);
  const vertical = dir % 2 === 0;
  for (const b of world.all('brick')) {
    // Same row (or column) as this brick, within half a tank of the shell's line.
    const along = vertical ? b.y - self.y : b.x - self.x;
    const across = vertical ? b.x - hit.x : b.y - hit.y;
    if (b.visible && Math.abs(along) < 1 && Math.abs(across) < 16) breakBrick(b);
  }
}

function breakBrick(b: Actor) {
  b.visible = false;
  b.data.block = 0;
}
`;

export const STEEL_SCRIPT = `// Steel: stops tanks and shells. Only heavy shells (damage 2+) break it.
export const props = {};
${SYNC}
function reset(self: Actor) {
  self.visible = true;
  self.data.block = 8;
}

export function update(self: Actor, world: World) {
  sync(self, world);
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.visible) return false;
  if (hit.damage >= 2) {
    self.visible = false;
    self.data.block = 0;
  }
}
`;

export const WATER_SCRIPT = `// Water: tanks can't cross it, shells fly over (no onHit).
export function init(self: Actor) {
  self.data.block = 8;
}
`;

export const BASE_SCRIPT = `// Base: lose it and the game is over. Any shell destroys it, even your own.
export const props = {};
${SYNC}
function reset(self: Actor) {
  self.setState('idle');
  self.data.block = 16;
}

export function update(self: Actor, world: World) {
  sync(self, world);
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (self.state === 'dead') return false;
  self.setState('dead');
  world.burst(self.x, self.y, '#ff8c1a', 40);
  const g = world.find('director');
  if (g) g.data.baseLost = true;
}
`;

export const SPAWN_SCRIPT = `// Spawn point: an invisible marker where enemies arrive (the Enemy script looks for 'spawn').
export function init(self: Actor) {
  self.visible = false;
}
`;

export const BONUS_SCRIPT = `// Bonus: appears when a blinking enemy is hit. The player drives over it to take it.
export const props = {
  lifetime: 15, // seconds on the field
  arena: 416,
  points: 500,
};

const KINDS = ['helmet', 'star', 'grenade', 'tank', 'clock'];
${SYNC}
function reset(self: Actor) {
  self.visible = false;
}

export function update(self: Actor, world: World) {
  const p = self.props as typeof props;
  const g = sync(self, world);
  if (!g || g.data.paused) return;
  if (g.data.bonus) {
    g.data.bonus = false;
    appear(self, world);
  }
  if (!self.visible) return;
  const left = (self.data.until as number) - world.time;
  if (left <= 0) return reset(self);
  if (left < 4 && world.time > ((self.data.blinkAt as number) || 0)) {
    self.flash(0.3); // about to vanish
    self.data.blinkAt = world.time + 0.5;
  }

  const player = world.find('player');
  if (!player || player.data.phase !== 'live') return;
  if (Math.abs(player.x - self.x) > 20 || Math.abs(player.y - self.y) > 20) return;
  take(self, world, g, player);
  g.data.score = (g.data.score as number) + p.points;
  world.burst(self.x, self.y, '#ffffff', 20);
  reset(self);
}

function appear(self: Actor, world: World) {
  const p = self.props as typeof props;
  const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
  const cells = p.arena / 32;
  // Anywhere but the bottom rows, where the base is.
  self.x = 16 + Math.floor(Math.random() * cells) * 32;
  self.y = 16 + Math.floor(Math.random() * (cells - 3)) * 32;
  self.data.kind = kind;
  self.data.until = world.time + p.lifetime;
  self.setState(kind);
  self.visible = true;
  self.data.blinkAt = 0;
  world.log('Bonus: ' + kind);
}

function take(self: Actor, world: World, g: Actor, player: Actor) {
  const kind = self.data.kind;
  if (kind === 'helmet') player.setForm('shield', 10);
  if (kind === 'star') player.data.stars = Math.min(3, ((player.data.stars as number) || 0) + 1);
  if (kind === 'tank') g.data.lives = (g.data.lives as number) + 1;
  if (kind === 'clock') g.data.freezeUntil = world.time + 10;
  if (kind === 'grenade') {
    for (const e of world.all('enemy')) if (e.data.phase === 'live') e.damage(99, player);
  }
}
`;

export const BANNER_SCRIPT = `// Banner: big message in the middle of the arena (game over, stage clear, paused).
export function update(self: Actor, world: World) {
  const g = world.find('director');
  const d = g ? g.data : {};
  const shown = d.paused ? 'paused' : d.state === 'over' || d.state === 'clear' ? d.state : '';
  self.visible = !!shown;
  if (shown) self.setState(shown as string);
}
`;
