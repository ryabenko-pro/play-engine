/** TypeScript sources of the demo actors. Everything they do is in here, nothing is built in. */

export const HERO_SCRIPT = `// Hero: keyboard control, shooting, idle AI takeover, death & respawn.
// It knows nothing about pills: its forms (Small, Big) change its look and props.
export const props = {
  speed: 220,
  jumpSpeed: 640,
  maxHealth: 5,
  team: 'player',
  projectile: 'Bolt',
  fireCooldown: 0.3,
  aiAfterIdle: 5, // seconds without input before the hero wanders on its own (0 = never)
};

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const JUMP = ['Space', 'ArrowUp', 'KeyW'];
const FIRE = ['KeyJ', 'KeyX'];

export function init(self: Actor, world: World) {
  const p = self.props as typeof props;
  self.health = p.maxHealth;
  self.data.cooldown = 0;
  self.data.aimX = 1;
  self.data.aimY = 0;
  world.camera.follow(self);
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  const side = world.view === 'side';
  if (self.alive && self.health <= 0) self.kill();
  if (!self.alive) return dead(self, world, dt);

  // 1. Decide: keyboard, or a simple wander AI after being idle.
  const input = world.input;
  const ai = p.aiAfterIdle > 0 && input.idleTime > p.aiAfterIdle;
  let mx = 0, my = 0, jump = false, fire = false;
  if (ai) {
    ({ mx, my, jump } = wander(self, world, dt));
  } else {
    mx = (input.isDown(...RIGHT) ? 1 : 0) - (input.isDown(...LEFT) ? 1 : 0);
    my = (input.isDown(...DOWN) ? 1 : 0) - (input.isDown(...UP) ? 1 : 0);
    jump = side && input.isDown(...JUMP);
    fire = input.isDown(...FIRE);
  }
  if (Math.abs(mx) > 0) self.facing = Math.sign(mx);

  // 2. Move.
  if (side) {
    self.vx += (mx * p.speed - self.vx) * Math.min(1, (self.grounded ? 14 : 7) * dt);
    self.vy = Math.min(self.vy + world.gravity * dt, 1600);
    if (jump && self.grounded) self.vy = -p.jumpSpeed;
  } else {
    // Isometric: "up" on screen is a diagonal in the world.
    if (world.view === 'isometric') [mx, my] = [my + mx / 2, my - mx / 2];
    const len = Math.hypot(mx, my);
    if (len > 0) {
      mx /= len;
      my /= len;
      self.data.aimX = mx;
      self.data.aimY = my;
    }
    self.vx += (mx * p.speed - self.vx) * Math.min(1, 18 * dt);
    self.vy += (my * p.speed - self.vy) * Math.min(1, 18 * dt);
  }
  self.moveAndSlide();
  if (self.y > world.bottom) self.kill();

  // 3. Shoot.
  self.data.cooldown = (self.data.cooldown as number) - dt;
  if (fire && (self.data.cooldown as number) <= 0) {
    const ax = side ? self.facing : (self.data.aimX as number);
    const ay = side ? 0 : (self.data.aimY as number);
    self.shoot(p.projectile, ax, ay);
    self.data.cooldown = p.fireCooldown;
    self.setState('attack');
  }

  // 4. Pick the state (animation + collider).
  const attacking = self.state === 'attack' && self.stateTime < Math.min(self.animationLength, 0.4);
  const hurting = self.state === 'hurt' && self.stateTime < 0.3;
  if (!attacking && !hurting) {
    if (side && !self.grounded) self.setState(self.vy < 0 ? 'jump' : 'fall');
    else self.setState(Math.hypot(self.vx, side ? 0 : self.vy) > 20 ? 'run' : 'idle');
  }

  // 5. HUD.
  world.hud.text('♥'.repeat(Math.max(0, self.health)), 12, 22, '#ff6b7a');
  if (ai) world.hud.text('AI in control – press any key', 12, 42, '#ffd166');
  if (self.form !== 'base') {
    const left = isFinite(self.formLeft) ? ' ' + Math.ceil(self.formLeft) + 's' : '';
    world.hud.text('Form: ' + self.form + left, 12, 62, '#9be3aa');
  }
  world.hud.text(side ? '←→ move · Space jump · J shoot' : 'arrows move · J shoot', 12, -12, 'rgba(255,255,255,0.45)');
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.alive) return false;
  if (hit.from && hit.from.props.team === self.props.team) return false; // no friendly fire
  if (hit.damage <= 0) return; // blocked (e.g. by a form): stops the projectile, no harm
  self.health -= hit.damage;
  self.flash(0.6);
  self.vx += Math.sign(self.x - hit.x) * 180;
  if (world.view === 'side') self.vy -= 160;
  if (self.health <= 0) self.kill();
  else self.setState('hurt');
}

function dead(self: Actor, world: World, dt: number) {
  if (self.state !== 'dead') {
    self.setState('dead');
    self.data.diedAt = world.time;
    world.burst(self.x, self.y, '#4da3ff', 24);
    world.log(self.name + ' died');
  }
  if (world.view === 'side') {
    self.vx *= 0.9;
    self.vy = Math.min(self.vy + world.gravity * dt, 1600);
    self.moveAndSlide();
  }
  if (world.time - (self.data.diedAt as number) > 1.5) {
    self.x = self.spawnX;
    self.y = self.spawnY;
    self.vx = self.vy = 0;
    self.setForm('base');
    self.health = (self.props as typeof props).maxHealth;
    self.revive();
    self.setState('idle');
    self.flash(1);
  }
}

function wander(self: Actor, world: World, dt: number) {
  const d = self.data;
  d.timer = ((d.timer as number) ?? 0) - dt;
  if ((d.timer as number) <= 0) {
    d.timer = 1 + Math.random() * 2;
    d.wx = [-1, 0, 1][Math.floor(Math.random() * 3)];
    d.wy = world.view === 'side' ? 0 : [-1, 0, 1][Math.floor(Math.random() * 3)];
  }
  let mx = d.wx as number;
  const my = d.wy as number;
  let jump = false;
  if (world.view === 'side' && mx !== 0) {
    if (self.hitWall === Math.sign(mx)) jump = true;
    else if (self.grounded && !world.groundAhead(self, mx)) d.wx = mx = -mx;
  }
  return { mx, my, jump };
}
`;

export const GRUNT_SCRIPT = `// Grunt: patrols; with sight > 0 it chases its target and attacks.
export const props = {
  speed: 80,
  maxHealth: 3,
  team: 'enemy',
  patrolRange: 60, // how far from the spawn point it walks
  sight: 0, // > 0: chase targets closer than this
  target: 'player', // tag to hunt
  projectile: '', // e.g. 'Bolt' or 'Grenade'; empty = touch attack only
  fireCooldown: 1.5,
};

export function init(self: Actor, world: World) {
  self.health = (self.props as typeof props).maxHealth;
  self.data.dir = 1;
  self.data.cooldown = 0;
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  const side = world.view === 'side';
  if (!self.alive) return dead(self, world, dt);
  self.data.cooldown = (self.data.cooldown as number) - dt;
  const ready = (self.data.cooldown as number) <= 0;

  let mx = 0, my = 0, jump = false;
  const target = world.find(p.target);
  const dist = target ? world.distance(self, target) : Infinity;

  if (target && p.sight > 0 && dist < p.sight) {
    // Chase & attack.
    const dx = target.x - self.x, dy = target.y - self.y;
    const keep = p.projectile ? p.sight * 0.4 : 4;
    self.facing = Math.sign(dx) || self.facing;
    if (side) {
      if (Math.abs(dx) > keep) mx = Math.sign(dx);
      if (mx && self.grounded && !world.groundAhead(self, mx)) mx = 0;
      jump = self.grounded && self.hitWall === Math.sign(dx);
      if (p.projectile && ready && Math.abs(dy) < 40) fire(self, p, Math.sign(dx), 0);
    } else {
      if (dist > keep) [mx, my] = [dx / dist, dy / dist];
      if (p.projectile && ready) fire(self, p, dx / dist, dy / dist);
    }
  } else {
    // Patrol: turn at walls, ledges and the end of the range.
    let dir = self.data.dir as number;
    if (self.hitWall === dir) dir = -dir;
    else if (side && self.grounded && !world.groundAhead(self, dir)) dir = -dir;
    else if ((self.x - self.spawnX) * dir > p.patrolRange) dir = -dir;
    self.data.dir = dir;
    mx = dir;
    self.facing = dir;
  }

  // Touch attack: goes through the target's onHit, so its forms can block it.
  if (target && ready && world.overlaps(self, target)) {
    target.damage(1, self);
    self.data.cooldown = 1;
  }

  // Move.
  if (side) {
    self.vx += (mx * p.speed - self.vx) * Math.min(1, 10 * dt);
    self.vy = Math.min(self.vy + world.gravity * dt, 1600);
    if (jump) self.vy = -560;
  } else {
    self.vx += (mx * p.speed - self.vx) * Math.min(1, 10 * dt);
    self.vy += (my * p.speed - self.vy) * Math.min(1, 10 * dt);
  }
  self.moveAndSlide();
  if (self.y > world.bottom) self.destroy();

  const attacking = self.state === 'attack' && self.stateTime < Math.min(self.animationLength, 0.4);
  const hurting = self.state === 'hurt' && self.stateTime < 0.3;
  if (!attacking && !hurting) {
    if (side && !self.grounded) self.setState(self.vy < 0 ? 'jump' : 'fall');
    else self.setState(Math.hypot(self.vx, side ? 0 : self.vy) > 20 ? 'run' : 'idle');
  }
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.alive) return false;
  if (hit.from && hit.from.props.team === self.props.team) return false;
  self.health -= hit.damage;
  self.flash(0.4);
  self.vx += Math.sign(self.x - hit.x) * 180;
  if (self.health <= 0) self.kill();
  else self.setState('hurt');
}

function fire(self: Actor, p: typeof props, dx: number, dy: number) {
  self.shoot(p.projectile, dx, dy);
  self.data.cooldown = p.fireCooldown;
  self.setState('attack');
}

function dead(self: Actor, world: World, dt: number) {
  if (self.state !== 'dead') {
    self.setState('dead');
    world.log(self.name + ' was defeated');
  }
  if (world.view === 'side') {
    self.vx *= 0.9;
    self.vy = Math.min(self.vy + world.gravity * dt, 1600);
    self.moveAndSlide();
  }
  if (self.stateTime > 1.2) {
    world.burst(self.x, self.y, '#ff6b5a', 24);
    self.destroy();
  }
}
`;

export const MINE_SCRIPT = `// Mine: kills any victim that touches it, changes colour when one is near.
export const props = {
  victims: 'player, enemy', // comma-separated tags of the actors it kills
  damage: 999, // dealt through the victim's onHit, so an immune form survives it
  warnRadius: 110, // "near" distance in pixels
  calmColor: '#5c6b7a',
  warnColor: '#ff5a4d',
};

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  const tags = p.victims.split(',').map((t) => t.trim()).filter(Boolean);
  let near = false;

  for (const other of world.all()) {
    if (other === self || !other.alive || !tags.some((t) => other.is(t))) continue;

    // Touch: kill immediately (unless the victim ignores the hit).
    if (world.overlaps(self, other) && other.damage(p.damage, self) && !other.alive) {
      world.burst(self.x, self.y, p.warnColor, 30);
      world.log(self.name + ' killed ' + other.name);
    }

    // Proximity: remember that someone is close.
    if (world.distance(self, other) < p.warnRadius) near = true;
  }

  self.color = near ? p.warnColor : p.calmColor;
}
`;

export const PILL_SCRIPT = `// Pill: puts the actor that touches it into one of its forms for a while.
// The pill only names the form; what the form does is up to the actor's form scene.
export const props = {
  form: 'small', // a form of the taker's actor scene (the Hero has 'small' and 'big')
  seconds: 8, // how long the form lasts (0 = until something changes it)
  takers: 'player', // tags that can pick it up
  respawn: 12, // seconds until it comes back (0 = gone for good)
  color: '#4dd0ff',
};

export function init(self: Actor, world: World) {
  self.color = (self.props as typeof props).color;
  self.data.phase = Math.random() * 6;
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  if (!self.visible) {
    if (p.respawn > 0 && world.time > (self.data.back as number)) self.visible = true;
    return;
  }
  if (world.view === 'side') self.y = self.spawnY + Math.sin(world.time * 3 + (self.data.phase as number)) * 4;

  const tags = p.takers.split(',').map((t) => t.trim()).filter(Boolean);
  for (const other of world.all()) {
    if (other === self || !other.alive || !tags.some((t) => other.is(t))) continue;
    if (!world.overlaps(self, other)) continue;
    if (!other.setForm(p.form, p.seconds)) continue; // it has no such form
    world.burst(self.x, self.y, p.color, 20);
    world.log(other.name + ' took ' + self.name + ': ' + p.form);
    if (p.respawn > 0) {
      self.visible = false;
      self.data.back = world.time + p.respawn;
    } else {
      self.destroy();
    }
    break;
  }
}
`;

export const HERO_SMALL_SCRIPT = `// Hero · Small: a form of the Hero. Tiny (scale), quick, leaves a trail.
// These props are laid over the Hero's while the form is active; the Hero's own
// movement code simply reads self.props.speed and gets the faster value.
export const props = {
  speed: 340,
  jumpSpeed: 700,
};

export function init(self: Actor, world: World) {
  world.burst(self.x, self.y, '#4dd0ff', 16);
}
`;

export const HERO_BIG_SCRIPT = `// Hero · Big: a form of the Hero. Huge, slow, wobbly, and immune to damage.
export const props = {
  speed: 130,
  jumpSpeed: 560,
  fireCooldown: 0.6,
};

export function init(self: Actor, world: World) {
  world.burst(self.x, self.y, '#ffb347', 24);
}

// Runs before the Hero's onHit. Zero damage = the hit is blocked but still stops
// projectiles; returning false instead would let them fly through.
export function onHit(self: Actor, world: World, hit: Hit) {
  hit.damage = 0;
  self.flash(0.1);
}
`;

export const WALKER_SCRIPT = `// Walker: steps on the level grid and pushes crates (its kind 'creature' gives it strength 2:
// two crates at once, not three). Fire, water, cold and heat are rules in ⚗ Interactions;
// the Walker only takes the damage and lets its statuses slow it down (they scale props.speed).
export const props = {
  speed: 7, // cells per second (chilled / exhausted lower it)
  maxHealth: 5,
};

const MOVES: Array<[number, number, string[]]> = [
  [1, 0, ['ArrowRight', 'KeyD']],
  [-1, 0, ['ArrowLeft', 'KeyA']],
  [0, -1, ['ArrowUp', 'KeyW']],
  [0, 1, ['ArrowDown', 'KeyS']],
];

export function init(self: Actor, world: World) {
  self.health = (self.props as typeof props).maxHealth;
  world.camera.follow(self);
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  world.hud.text('Health ' + self.health + (self.statuses.length ? '   · ' + self.statuses.join(', ') : ''), 10, 20);
  world.hud.text('Arrows / WASD. Push crates (two at a time), try the fire, the pond, the snow and the hot sand.', 10, -12, '#8a93a3');
  if (!self.alive) {
    if (world.time > (self.data.respawnAt as number)) respawn(self, p);
    return;
  }
  if (!self.moving) {
    for (const [dx, dy, keys] of MOVES) {
      if (world.input.isDown(...keys) && self.gridMove(dx, dy, 1 / p.speed)) break;
    }
  }
  self.setState(self.moving ? 'run' : 'idle');
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.alive) return false;
  self.health -= hit.damage;
  self.flash(0.3);
  if (self.health > 0) return;
  self.kill();
  self.visible = false;
  world.burst(self.x, self.y, '#ff7a2e', 30);
  world.log(self.name + (hit.element === 'fire' ? ' burned' : ' died'));
  self.data.respawnAt = world.time + 1.5;
}

function respawn(self: Actor, p: typeof props) {
  for (const s of self.statuses) self.removeStatus(s);
  self.x = self.spawnX;
  self.y = self.spawnY;
  self.health = p.maxHealth;
  self.visible = true;
  self.revive();
}
`;
