/*
 * Aura: a mobile-style demo of the touch joystick, procedural drawing and stub art.
 * Everything below is ordinary actor-script TypeScript (as written in the editor).
 */

/**
 * The hero: moves with input.stick (touch joystick or arrows / WASD). Orbs give power;
 * the aura around the hero is drawn in code: its size follows power, its colour follows
 * health, and its shape goes from a calm ring to a wavy blob to a spiky star.
 * A (Space) spends 3 power on a pulse that hurts nearby enemies; B (J) dashes.
 */
export const HERO_SCRIPT = `export const props = { speed: 140, maxHealth: 10, maxPower: 10, pulseCost: 3 };

const PULSE_TIME = 0.45;

function auraRadius(self: Actor): number {
  return 22 + (self.data.power as number) * 4;
}

export function init(self: Actor, world: World) {
  self.health = (self.props as typeof props).maxHealth;
  self.data.power = 0;
  self.data.pulse = 0;   // seconds left of the pulse wave
  self.data.hurt = 0;    // invulnerable after a hit
  self.data.dash = 0;
  self.data.dashCool = 0;
  world.camera.follow(self);
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  const d = self.data as { power: number; pulse: number; hurt: number; dash: number; dashCool: number };
  d.pulse = Math.max(0, d.pulse - dt);
  d.hurt = Math.max(0, d.hurt - dt);
  d.dash = Math.max(0, d.dash - dt);
  d.dashCool = Math.max(0, d.dashCool - dt);

  if (!self.alive) {
    self.vx = self.vy = 0;
    if (world.input.pressed('Space')) {
      self.revive();
      init(self, world);
      self.x = self.spawnX;
      self.y = self.spawnY;
    }
    return;
  }

  const s = world.input.stick;
  if (world.input.pressed('KeyJ') && d.dashCool <= 0 && (s.x || s.y)) {
    d.dash = 0.18;
    d.dashCool = 0.9;
  }
  const speed = p.speed * (d.dash > 0 ? 3.2 : 1);
  self.vx = s.x * speed;
  self.vy = s.y * speed;
  if (s.x) self.facing = s.x < 0 ? -1 : 1;
  self.moveAndSlide();
  self.setState(d.hurt > 0.6 ? 'hurt' : s.x || s.y ? 'run' : 'idle');

  for (const orb of world.all('orb')) {
    if (orb.visible && world.overlaps(self, orb)) {
      orb.visible = false;
      orb.data.away = 6;
      d.power = Math.min(p.maxPower, d.power + 1);
      world.burst(orb.x, orb.y, orb.color, 12);
    }
  }

  if (world.input.pressed('Space') && d.power >= p.pulseCost) {
    d.power -= p.pulseCost;
    d.pulse = PULSE_TIME;
    const reach = auraRadius(self) * 2.6;
    for (const e of world.all('enemy')) if (e.alive && world.distance(self, e) < reach) e.damage(2, self);
  }
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.alive || (self.data.hurt as number) > 0) return false;
  self.health -= hit.damage;
  self.data.hurt = 1;
  self.flash(1);
  if (self.health <= 0) {
    self.kill();
    self.setState('dead');
    world.burst(self.x, self.y, '#ff3b3b', 30);
  }
}

// --- Drawing ---------------------------------------------------------------

export function drawUnder(self: Actor, world: World, g: Graphics) {
  if (!self.alive) return;
  const p = self.props as typeof props;
  const power = self.data.power as number;
  const hp = Math.max(0, self.health / p.maxHealth);
  const r = auraRadius(self);
  const t = world.time;
  // Healthy: cool green. Hurt: hot red.
  const color = g.mix('#ff4040', '#40ffc0', hp);

  // Soft light on the ground.
  g.circle(0, 0, r * 1.5, { fill: g.radial(0, 0, r * 1.5, [[0, g.rgba(color, 0.4)], [1, g.rgba(color, 0)]]), blend: 'add' });

  const line = { stroke: color, width: 2, glow: 8, fill: g.rgba(color, 0.1) };
  if (power < 4) {
    // Calm: a breathing ring.
    g.circle(0, 0, r + Math.sin(t * 3) * 2, line);
  } else if (power < 8) {
    // Charged: a wavy blob.
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const k = r * (1 + 0.12 * Math.sin(t * 5 + i * 1.7));
      pts.push({ x: Math.cos(a) * k, y: Math.sin(a) * k });
    }
    g.smooth(pts, line);
  } else {
    // Full: a spinning star.
    g.regular(0, 0, r * 1.1, 9, { ...line, width: 2.5, join: 'round' }, t * 1.5, r * 0.7);
  }

  // Dash streak.
  if ((self.data.dash as number) > 0) g.line(-self.vx * 0.08, -self.vy * 0.08, 0, 0, { stroke: color, width: 10, cap: 'round', alpha: 0.5, blend: 'add' });

  // Pulse wave: an expanding ring that fades.
  const pulse = self.data.pulse as number;
  if (pulse > 0) {
    const k = 1 - pulse / PULSE_TIME;
    g.circle(0, 0, r + k * r * 1.6, { stroke: '#ffffff', width: 6 * (1 - k) + 1, alpha: 1 - k, glow: 16, glowColor: color });
  }
}

export function drawHud(self: Actor, world: World, g: Graphics) {
  const p = self.props as typeof props;
  const hp = Math.max(0, self.health / p.maxHealth);
  const power = self.data.power as number;
  const x = 16;
  const w = Math.min(180, world.hud.width * 0.4);

  // Health bar with a red → green gradient.
  g.rectangle(x, 16, w, 12, { fill: '#000a', stroke: '#fff5', width: 1 }, 6);
  if (hp > 0) g.rectangle(x, 16, w * hp, 12, { fill: g.linear(x, 0, x + w, 0, [[0, '#ff4040'], [1, '#40ffc0']]) }, 6);

  // Power: one cell per point, every pulseCost cells lights up as a charge.
  const cell = w / p.maxPower;
  for (let i = 0; i < p.maxPower; i++) {
    const on = i < power;
    g.rectangle(x + i * cell + 1, 34, cell - 2, 8, { fill: on ? '#ffd166' : '#ffffff22', glow: on ? 6 : 0 }, 2);
  }
  g.text('A: pulse (' + p.pulseCost + ')   B: dash', x, 60, { fill: '#ffffff99', size: 11 });

  if (!self.alive) {
    const cx = world.hud.width / 2;
    const cy = world.hud.height / 2;
    g.rectangle(cx - 130, cy - 40, 260, 80, { fill: '#000c', stroke: '#ff4040', width: 2 }, 12);
    g.text('You faded away', cx, cy - 6, { fill: '#fff', size: 22, bold: true, align: 'center' });
    g.text('press A to try again', cx, cy + 20, { fill: '#ffffffaa', size: 13, align: 'center' });
  }
}
`;

/**
 * Enemies: wander, chase the hero when close, and hurt it on touch. Each enemy scene
 * has its own stub look; props make them faster or tougher. They respawn after dying.
 */
export const ENEMY_SCRIPT = `export const props = { speed: 55, sight: 200, health: 3 };

export function init(self: Actor, world: World) {
  self.health = (self.props as typeof props).health;
  self.data.turn = 0;
  self.data.away = 0;
}

export function update(self: Actor, world: World, dt: number) {
  const p = self.props as typeof props;
  if (!self.alive) {
    self.data.away = (self.data.away as number) - dt;
    if ((self.data.away as number) <= 0) {
      self.x = self.spawnX;
      self.y = self.spawnY;
      self.revive();
      self.visible = true;
      init(self, world);
      self.flash(0.6);
    }
    return;
  }
  const hero = world.find('player');
  if (hero && world.distance(self, hero) < p.sight) {
    const dx = hero.x - self.x;
    const dy = hero.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    self.vx = (dx / d) * p.speed;
    self.vy = (dy / d) * p.speed;
    if (world.overlaps(self, hero)) hero.damage(1, self);
  } else {
    // Wander: pick a new direction now and then.
    self.data.turn = (self.data.turn as number) - dt;
    if ((self.data.turn as number) <= 0) {
      const a = Math.random() * Math.PI * 2;
      self.vx = Math.cos(a) * p.speed * 0.5;
      self.vy = Math.sin(a) * p.speed * 0.5;
      self.data.turn = 1 + Math.random() * 2;
    }
  }
  if (self.vx) self.facing = self.vx < 0 ? -1 : 1;
  self.moveAndSlide();
  self.setState('run');
}

export function onHit(self: Actor, world: World, hit: Hit) {
  if (!self.alive) return false;
  self.health -= hit.damage;
  self.flash(0.3);
  if (self.health <= 0) {
    self.kill();
    self.visible = false;
    self.data.away = 4;
    world.burst(self.x, self.y, self.color, 24);
  }
}

// Health pips over the head, drawn in code.
export function draw(self: Actor, world: World, g: Graphics) {
  const max = (self.props as typeof props).health;
  if (self.health >= max) return;
  for (let i = 0; i < max; i++) g.circle((i - (max - 1) / 2) * 7, -30, 2.5, i < self.health ? '#ff6b6b' : '#ffffff33');
}
`;

/** Orbs: bob, glow, and come back a while after being taken. */
export const ORB_SCRIPT = `export function update(self: Actor, world: World, dt: number) {
  if (!self.visible) {
    self.data.away = (self.data.away as number) - dt;
    if ((self.data.away as number) <= 0) self.visible = true;
  }
}

export function drawUnder(self: Actor, world: World, g: Graphics) {
  const k = 0.5 + 0.5 * Math.sin(world.time * 4 + self.spawnX);
  g.circle(0, 0, 14 + k * 4, { fill: g.radial(0, 0, 18, [[0, g.rgba(self.color, 0.6)], [1, g.rgba(self.color, 0)]]), blend: 'add' });
}
`;

/** Scenery: no behaviour. */
export const SCENERY_SCRIPT = `// Decoration only.
`;
