import { createImageAsset, createSpriteAsset } from './factory';
import { mixColors, toHex } from './graphics';
import type { ImageAsset, SpriteAnim, SpriteAsset } from './types';

/*
 * Placeholder art. Every name gets its own look (body shape, colour, eyes, extras),
 * always the same for the same name, so "Slime" and "Bat" are told apart at a glance
 * long before real graphics exist. Output is SVG (a plain string), so it works
 * without a DOM and is stored in the project like any imported image.
 *
 * Creatures come with the default state animations (idle, run, jump, fall, attack,
 * hurt, dead), so an actor using a stub animates as soon as its script calls setState().
 */

export type StubKind = 'creature' | 'item' | 'tile' | 'prop';

export interface StubOptions {
  /** What it is; picks the family of shapes. Default 'creature'. */
  kind?: StubKind;
  /** Frame size in px (square). Default 32 (tiles 32, items 24). */
  size?: number;
  /** Main colour (any CSS colour). Default: derived from the name. */
  color?: string;
  /** Short text drawn on items, tiles and props. Default: the name's first letter. '' for none. */
  label?: string;
  /** Mixed into the name's hash: same name, different seed → a different look. */
  seed?: string | number;
}

export interface StubArt {
  /** Complete SVG document: all frames side by side. */
  svg: string;
  width: number;
  height: number;
  frameW: number;
  frameH: number;
  animations: SpriteAnim[];
  /** Main colour as #rrggbb (handy for ActorDef.color, particles…). */
  color: string;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough to pick shapes. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

interface Palette {
  main: string;
  dark: string;
  light: string;
  accent: string;
}

function palette(r: Rand, color?: string): Palette {
  const hue = r() * 360;
  const sat = 0.55 + r() * 0.3;
  const given = color ? toHex(color) : null;
  if (given) {
    // A given colour: derive the shades by mixing towards black / white.
    const hex = (c: string) => toHex(c) ?? c;
    return { main: given, dark: hex(mixColors(given, '#000000', 0.5)), light: hex(mixColors(given, '#ffffff', 0.5)), accent: hslToHex((hue + 180) % 360, 0.8, 0.6) };
  }
  const main = hslToHex(hue, sat, 0.55);
  return { main, dark: hslToHex(hue, sat, 0.28), light: hslToHex(hue, sat * 0.8, 0.78), accent: hslToHex((hue + 150 + r() * 60) % 360, 0.85, 0.6) };
}

/** The main colour a name gets (same as stubArt(name).color without options). */
export function stubColor(name: string, seed?: string | number): string {
  return palette(rng(hash(seed === undefined ? name : `${name}#${seed}`))).main;
}

// ---------------------------------------------------------------------------
// Shapes (SVG path data in a frame of size s, centred at c)
// ---------------------------------------------------------------------------

const f1 = (n: number) => Math.round(n * 10) / 10;

function regular(cx: number, cy: number, r: number, sides: number, rot = -Math.PI / 2, inner = 0): string {
  const pts: string[] = [];
  const n = inner ? sides * 2 : sides;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const rr = inner && i % 2 ? inner : r;
    pts.push(`${f1(cx + Math.cos(a) * rr)},${f1(cy + Math.sin(a) * rr)}`);
  }
  return `M${pts.join('L')}Z`;
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  return `M${f1(x + r)},${f1(y)}H${f1(x + w - r)}Q${f1(x + w)},${f1(y)} ${f1(x + w)},${f1(y + r)}V${f1(y + h - r)}Q${f1(x + w)},${f1(y + h)} ${f1(x + w - r)},${f1(y + h)}H${f1(x + r)}Q${f1(x)},${f1(y + h)} ${f1(x)},${f1(y + h - r)}V${f1(y + r)}Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)}Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f1(cx - rx)},${f1(cy)}A${f1(rx)},${f1(ry)} 0 1 0 ${f1(cx + rx)},${f1(cy)}A${f1(rx)},${f1(ry)} 0 1 0 ${f1(cx - rx)},${f1(cy)}Z`;
}

/** A lumpy closed curve through `n` points around the centre. */
function blob(r: Rand, cx: number, cy: number, rad: number, n: number): string {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = 0.8 + r() * 0.3;
    return { x: cx + Math.cos(a) * rad * k, y: cy + Math.sin(a) * rad * k };
  });
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(pts[n - 1], pts[0]);
  let d = `M${f1(start.x)},${f1(start.y)}`;
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    d += `Q${f1(pts[i].x)},${f1(pts[i].y)} ${f1(m.x)},${f1(m.y)}`;
  }
  return `${d}Z`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function labelText(text: string, cx: number, cy: number, size: number, fill: string): string {
  if (!text) return '';
  return `<text x="${f1(cx)}" y="${f1(cy)}" font-family="system-ui,sans-serif" font-weight="700" font-size="${f1(size)}" text-anchor="middle" dominant-baseline="central" fill="${fill}">${esc(text)}</text>`;
}

const path = (d: string, fill: string, stroke = 'none', width = 0) =>
  `<path d="${d}" fill="${fill}"${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${f1(width)}" stroke-linejoin="round"` : ''}/>`;

// ---------------------------------------------------------------------------
// Creatures
// ---------------------------------------------------------------------------

type BodyKind = 'round' | 'box' | 'blob' | 'tri' | 'hex' | 'egg';
type Eyes = 'two' | 'one' | 'wide' | 'angry' | 'sleepy';
type Extra = 'none' | 'horns' | 'antenna' | 'ears' | 'spikes' | 'crest' | 'wings';

interface CreatureGenes {
  body: BodyKind;
  eyes: Eyes;
  extra: Extra;
  pal: Palette;
  /** Body proportions: width and height as a fraction of the frame. */
  bw: number;
  bh: number;
  belly: boolean;
  legs: boolean;
  blobPath: string;
}

/** Pose of one animation frame. */
interface Pose {
  /** Vertical offset (px, + down). */
  dy: number;
  /** Squash: > 0 wider and flatter. */
  sq: number;
  /** Leg phase, -1..1. */
  leg: number;
  lean: number;
  mouth: 'closed' | 'open' | 'o';
  eyes: 'open' | 'shut' | 'x';
  tint?: string;
  rot?: number;
}

const POSES: Array<[anim: string, poses: Pose[], fps: number, loop: boolean]> = [
  ['idle', [{ dy: 0, sq: 0, leg: 0, lean: 0, mouth: 'closed', eyes: 'open' }, { dy: 0.5, sq: 0.05, leg: 0, lean: 0, mouth: 'closed', eyes: 'open' }], 3, true],
  [
    'run',
    [
      { dy: -1, sq: -0.04, leg: 1, lean: 0.08, mouth: 'closed', eyes: 'open' },
      { dy: 0, sq: 0.03, leg: 0, lean: 0.08, mouth: 'closed', eyes: 'open' },
      { dy: -1, sq: -0.04, leg: -1, lean: 0.08, mouth: 'closed', eyes: 'open' },
      { dy: 0, sq: 0.03, leg: 0, lean: 0.08, mouth: 'closed', eyes: 'open' },
    ],
    10,
    true,
  ],
  ['jump', [{ dy: -2, sq: -0.12, leg: 0.6, lean: 0, mouth: 'o', eyes: 'open' }], 1, false],
  ['fall', [{ dy: -1, sq: -0.06, leg: -0.6, lean: 0, mouth: 'o', eyes: 'open' }], 1, false],
  ['attack', [{ dy: 0, sq: 0.08, leg: 0.4, lean: 0.18, mouth: 'open', eyes: 'open' }, { dy: 0, sq: -0.02, leg: 0.4, lean: 0.25, mouth: 'open', eyes: 'open' }], 8, false],
  ['hurt', [{ dy: 0, sq: 0.1, leg: 0, lean: -0.15, mouth: 'o', eyes: 'shut', tint: '#ff3b3b' }], 1, false],
  ['dead', [{ dy: 2, sq: 0.25, leg: 0, lean: 0, mouth: 'closed', eyes: 'x', rot: 90 }], 1, false],
];

function creatureGenes(r: Rand, s: number, color?: string): CreatureGenes {
  const body = pick<BodyKind>(r, ['round', 'box', 'blob', 'tri', 'hex', 'egg']);
  const bw = 0.55 + r() * 0.25;
  const bh = 0.5 + r() * 0.25;
  return {
    body,
    eyes: pick<Eyes>(r, ['two', 'two', 'one', 'wide', 'angry', 'sleepy']),
    extra: pick<Extra>(r, ['none', 'horns', 'antenna', 'ears', 'spikes', 'crest', 'wings']),
    pal: palette(r, color),
    bw,
    bh,
    belly: r() < 0.5,
    legs: body !== 'blob' && r() < 0.75,
    blobPath: blob(r, s / 2, s / 2, (s * Math.min(bw, bh)) / 2, 7),
  };
}

function bodyPath(g: CreatureGenes, s: number, w: number, h: number, cx: number, cy: number): string {
  switch (g.body) {
    case 'round':
      return ellipse(cx, cy, w / 2, h / 2);
    case 'box':
      return roundRect(cx - w / 2, cy - h / 2, w, h, s * 0.12);
    case 'tri':
      return `M${f1(cx)},${f1(cy - h / 2)}Q${f1(cx + w * 0.7)},${f1(cy + h / 2)} ${f1(cx + w / 2)},${f1(cy + h / 2)}H${f1(cx - w / 2)}Q${f1(cx - w * 0.7)},${f1(cy + h / 2)} ${f1(cx)},${f1(cy - h / 2)}Z`;
    case 'hex':
      return regular(cx, cy, Math.min(w, h) / 2 + 1, 6, 0);
    case 'egg':
      return `M${f1(cx)},${f1(cy - h / 2)}C${f1(cx + w * 0.55)},${f1(cy - h / 2)} ${f1(cx + w / 2)},${f1(cy + h / 2)} ${f1(cx)},${f1(cy + h / 2)}C${f1(cx - w / 2)},${f1(cy + h / 2)} ${f1(cx - w * 0.55)},${f1(cy - h / 2)} ${f1(cx)},${f1(cy - h / 2)}Z`;
    case 'blob':
      return g.blobPath;
  }
}

function extraSvg(g: CreatureGenes, s: number, w: number, h: number, cx: number, top: number): string {
  const { dark, accent, main } = g.pal;
  const sw = Math.max(1, s / 24);
  switch (g.extra) {
    case 'horns':
      return [-1, 1].map((k) => path(`M${f1(cx + k * w * 0.25)},${f1(top + 2)}L${f1(cx + k * w * 0.42)},${f1(top - s * 0.14)}L${f1(cx + k * w * 0.1)},${f1(top + 1)}Z`, '#f2e8d5', dark, sw)).join('');
    case 'antenna':
      return [-1, 1]
        .map((k) => `<path d="M${f1(cx + k * w * 0.12)},${f1(top + 1)}Q${f1(cx + k * w * 0.2)},${f1(top - s * 0.08)} ${f1(cx + k * w * 0.3)},${f1(top - s * 0.14)}" fill="none" stroke="${dark}" stroke-width="${f1(sw)}"/><circle cx="${f1(cx + k * w * 0.3)}" cy="${f1(top - s * 0.14)}" r="${f1(s * 0.05)}" fill="${accent}"/>`)
        .join('');
    case 'ears':
      return [-1, 1].map((k) => path(regular(cx + k * w * 0.3, top + 1, s * 0.11, 3, -Math.PI / 2 + k * 0.3), main, dark, sw)).join('');
    case 'spikes':
      return [-0.25, 0, 0.25].map((k) => path(regular(cx + k * w, top + 1, s * 0.08, 3), accent, dark, sw * 0.8)).join('');
    case 'crest':
      return path(ellipse(cx, top, w * 0.12, s * 0.1), accent, dark, sw);
    case 'wings':
      return [-1, 1].map((k) => path(`M${f1(cx + k * w * 0.4)},${f1(top + h * 0.35)}Q${f1(cx + k * w * 0.85)},${f1(top - s * 0.05)} ${f1(cx + k * w * 0.75)},${f1(top + h * 0.6)}Z`, g.pal.light, dark, sw)).join('');
    case 'none':
      return '';
  }
}

function eyesSvg(g: CreatureGenes, pose: Pose, s: number, w: number, cx: number, ey: number): string {
  const er = s * (g.eyes === 'wide' ? 0.1 : 0.075);
  const xs = g.eyes === 'one' ? [cx] : [cx - w * 0.2, cx + w * 0.2];
  const sw = Math.max(1, s / 22);
  return xs
    .map((x) => {
      const r = g.eyes === 'one' ? er * 1.5 : er;
      if (pose.eyes === 'x') {
        const d = r * 0.8;
        return `<path d="M${f1(x - d)},${f1(ey - d)}L${f1(x + d)},${f1(ey + d)}M${f1(x + d)},${f1(ey - d)}L${f1(x - d)},${f1(ey + d)}" stroke="#1a1a1a" stroke-width="${f1(sw)}" stroke-linecap="round"/>`;
      }
      if (pose.eyes === 'shut' || g.eyes === 'sleepy') {
        return `<path d="M${f1(x - r)},${f1(ey)}Q${f1(x)},${f1(ey + r * 0.9)} ${f1(x + r)},${f1(ey)}" fill="none" stroke="#1a1a1a" stroke-width="${f1(sw)}" stroke-linecap="round"/>`;
      }
      const brow = g.eyes === 'angry' ? `<path d="M${f1(x - r * 1.2)},${f1(ey - r * 1.6)}L${f1(x + r * 1.2)},${f1(ey - r * (x < cx ? 0.7 : 2.3))}" stroke="#1a1a1a" stroke-width="${f1(sw)}" stroke-linecap="round"/>` : '';
      return `<circle cx="${f1(x)}" cy="${f1(ey)}" r="${f1(r)}" fill="#fff"/><circle cx="${f1(x + r * 0.3)}" cy="${f1(ey)}" r="${f1(r * 0.5)}" fill="#1a1a1a"/>${brow}`;
    })
    .join('');
}

function mouthSvg(pose: Pose, s: number, cx: number, my: number): string {
  const sw = Math.max(1, s / 24);
  if (pose.mouth === 'open') return path(ellipse(cx + s * 0.03, my, s * 0.09, s * 0.06), '#3a0d12');
  if (pose.mouth === 'o') return path(ellipse(cx, my, s * 0.04, s * 0.05), '#3a0d12');
  return `<path d="M${f1(cx - s * 0.07)},${f1(my)}Q${f1(cx)},${f1(my + s * 0.05)} ${f1(cx + s * 0.07)},${f1(my)}" fill="none" stroke="#1a1a1a" stroke-width="${f1(sw)}" stroke-linecap="round"/>`;
}

function creatureFrame(g: CreatureGenes, pose: Pose, s: number): string {
  const w = s * g.bw * (1 + pose.sq);
  const h = s * g.bh * (1 - pose.sq);
  const feet = s * 0.92;
  const legH = g.legs ? s * 0.1 : 0;
  const cx = s / 2;
  const cy = feet - legH - h / 2 + pose.dy;
  const top = cy - h / 2;
  const sw = Math.max(1, s / 20);
  const parts: string[] = [];
  if (g.legs) {
    for (const k of [-1, 1]) {
      const lx = cx + k * w * 0.22 + pose.leg * k * s * 0.05;
      parts.push(`<path d="M${f1(lx)},${f1(cy + h * 0.35)}L${f1(lx + pose.leg * k * s * 0.04)},${f1(feet + pose.dy * 0.3)}" stroke="${g.pal.dark}" stroke-width="${f1(s * 0.08)}" stroke-linecap="round"/>`);
    }
  }
  parts.push(extraSvg(g, s, w, h, cx, top));
  // The blob is pre-computed for the neutral pose: squash it with a transform instead.
  const body = g.body === 'blob' ? `<g transform="translate(${f1(cx)} ${f1(cy)}) scale(${f1(1 + pose.sq)} ${f1(1 - pose.sq)}) translate(${f1(-s / 2)} ${f1(-s / 2)})">${path(g.blobPath, pose.tint ?? g.pal.main, g.pal.dark, sw)}</g>` : path(bodyPath(g, s, w, h, cx, cy), pose.tint ?? g.pal.main, g.pal.dark, sw);
  parts.push(body);
  if (g.belly) parts.push(path(ellipse(cx, cy + h * 0.18, w * 0.25, h * 0.2), g.pal.light));
  // Face looks right (sprites are mirrored for facing left).
  const fx = cx + w * 0.08;
  parts.push(eyesSvg(g, pose, s, w, fx, cy - h * 0.12));
  parts.push(mouthSvg(pose, s, fx, cy + h * 0.15));
  const lean = pose.lean * 30;
  const rot = pose.rot ?? 0;
  const tf = [lean ? `skewX(${f1(-lean)})` : '', rot ? `rotate(${rot} ${f1(cx)} ${f1(feet - s * 0.2)})` : ''].filter(Boolean).join(' ');
  // Skew around the feet line so they stay planted.
  return tf ? `<g transform="translate(0 ${f1(feet)}) ${tf} translate(0 ${f1(-feet)})">${parts.join('')}</g>` : parts.join('');
}

// ---------------------------------------------------------------------------
// Items, tiles, props (one frame plus a tiny idle animation for items)
// ---------------------------------------------------------------------------

function itemFrame(r: Rand, pal: Palette, s: number, label: string): (frame: number) => string {
  const shape = pick(r, ['gem', 'coin', 'potion', 'heart', 'star', 'orb'] as const);
  const sw = Math.max(1, s / 16);
  const c = s / 2;
  return (frame) => {
    const dy = frame ? -s * 0.04 : 0;
    const y = c + dy;
    let body: string;
    switch (shape) {
      case 'gem':
        body = path(`M${f1(c)},${f1(y - s * 0.4)}L${f1(c + s * 0.35)},${f1(y - s * 0.1)}L${f1(c)},${f1(y + s * 0.4)}L${f1(c - s * 0.35)},${f1(y - s * 0.1)}Z`, pal.main, pal.dark, sw) + path(`M${f1(c)},${f1(y - s * 0.4)}L${f1(c + s * 0.12)},${f1(y - s * 0.1)}L${f1(c)},${f1(y + s * 0.3)}L${f1(c - s * 0.12)},${f1(y - s * 0.1)}Z`, pal.light);
        break;
      case 'coin':
        body = path(ellipse(c, y, s * (frame ? 0.25 : 0.38), s * 0.38), pal.main, pal.dark, sw);
        break;
      case 'potion':
        body = path(roundRect(c - s * 0.08, y - s * 0.42, s * 0.16, s * 0.16, 1), pal.light, pal.dark, sw) + path(ellipse(c, y + s * 0.08, s * 0.3, s * 0.3), pal.main, pal.dark, sw);
        break;
      case 'heart':
        body = path(`M${f1(c)},${f1(y + s * 0.38)}C${f1(c - s * 0.6)},${f1(y - s * 0.05)} ${f1(c - s * 0.25)},${f1(y - s * 0.5)} ${f1(c)},${f1(y - s * 0.15)}C${f1(c + s * 0.25)},${f1(y - s * 0.5)} ${f1(c + s * 0.6)},${f1(y - s * 0.05)} ${f1(c)},${f1(y + s * 0.38)}Z`, pal.main, pal.dark, sw);
        break;
      case 'star':
        body = path(regular(c, y, s * 0.42, 5, -Math.PI / 2, s * 0.18), pal.main, pal.dark, sw);
        break;
      case 'orb':
        body = path(ellipse(c, y, s * 0.36, s * 0.36), pal.main, pal.dark, sw) + path(ellipse(c - s * 0.12, y - s * 0.12, s * 0.08, s * 0.08), '#ffffffcc');
        break;
    }
    return body + labelText(label, c, y + s * 0.02, s * 0.32, '#ffffff');
  };
}

function tileFrame(r: Rand, pal: Palette, s: number, label: string): string {
  const pattern = pick(r, ['bricks', 'dots', 'stripes', 'checker', 'plain', 'cross'] as const);
  const parts = [`<rect width="${s}" height="${s}" fill="${pal.main}"/>`];
  const q = s / 4;
  switch (pattern) {
    case 'bricks':
      for (let row = 0; row < 4; row++) {
        parts.push(`<path d="M0,${f1(row * q)}H${s}" stroke="${pal.dark}" stroke-width="1"/>`);
        for (let x = row % 2 ? q : 0; x < s; x += s / 2) parts.push(`<path d="M${f1(x)},${f1(row * q)}V${f1(row * q + q)}" stroke="${pal.dark}" stroke-width="1"/>`);
      }
      break;
    case 'dots':
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) parts.push(`<circle cx="${f1(q / 2 + i * q)}" cy="${f1(q / 2 + j * q)}" r="${f1(q * 0.18)}" fill="${pal.light}"/>`);
      break;
    case 'stripes':
      for (let i = -s; i < s; i += q) parts.push(`<path d="M${f1(i)},${s}L${f1(i + s)},0" stroke="${pal.dark}" stroke-width="${f1(q * 0.35)}"/>`);
      break;
    case 'checker':
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) parts.push(`<rect x="${f1((i * s) / 2)}" y="${f1((j * s) / 2)}" width="${f1(s / 2)}" height="${f1(s / 2)}" fill="${pal.dark}"/>`);
      break;
    case 'cross':
      parts.push(`<path d="M0,0L${s},${s}M${s},0L0,${s}" stroke="${pal.dark}" stroke-width="${f1(s / 10)}"/>`);
      break;
    case 'plain':
      break;
  }
  parts.push(`<rect x="0.5" y="0.5" width="${s - 1}" height="${s - 1}" fill="none" stroke="${pal.light}" stroke-opacity="0.6"/>`);
  parts.push(labelText(label, s / 2, s / 2, s * 0.4, '#ffffffcc'));
  return parts.join('');
}

function propFrame(r: Rand, pal: Palette, s: number, label: string): string {
  const shape = pick(r, ['crate', 'barrel', 'rock', 'tree', 'sign', 'pillar'] as const);
  const sw = Math.max(1, s / 20);
  const c = s / 2;
  let body: string;
  switch (shape) {
    case 'crate':
      body = path(roundRect(s * 0.1, s * 0.15, s * 0.8, s * 0.8, 2), pal.main, pal.dark, sw) + `<path d="M${f1(s * 0.1)},${f1(s * 0.15)}L${f1(s * 0.9)},${f1(s * 0.95)}M${f1(s * 0.9)},${f1(s * 0.15)}L${f1(s * 0.1)},${f1(s * 0.95)}" stroke="${pal.dark}" stroke-width="${f1(sw)}"/>`;
      break;
    case 'barrel':
      body = path(roundRect(s * 0.2, s * 0.1, s * 0.6, s * 0.85, s * 0.2), pal.main, pal.dark, sw) + `<path d="M${f1(s * 0.2)},${f1(s * 0.35)}H${f1(s * 0.8)}M${f1(s * 0.2)},${f1(s * 0.7)}H${f1(s * 0.8)}" stroke="${pal.dark}" stroke-width="${f1(sw)}"/>`;
      break;
    case 'rock':
      body = path(blob(r, c, s * 0.6, s * 0.36, 6), pal.main, pal.dark, sw);
      break;
    case 'tree':
      body = path(roundRect(c - s * 0.07, s * 0.55, s * 0.14, s * 0.4, 1), '#7a5230', '#3e2914', sw) + path(blob(r, c, s * 0.38, s * 0.33, 8), pal.main, pal.dark, sw);
      break;
    case 'sign':
      body = `<path d="M${f1(c)},${f1(s * 0.5)}V${f1(s * 0.95)}" stroke="${pal.dark}" stroke-width="${f1(s * 0.08)}"/>` + path(roundRect(s * 0.12, s * 0.12, s * 0.76, s * 0.42, 2), pal.main, pal.dark, sw);
      break;
    case 'pillar':
      body = path(roundRect(s * 0.28, s * 0.05, s * 0.44, s * 0.9, 2), pal.main, pal.dark, sw) + `<path d="M${f1(s * 0.4)},${f1(s * 0.12)}V${f1(s * 0.88)}M${f1(s * 0.6)},${f1(s * 0.12)}V${f1(s * 0.88)}" stroke="${pal.dark}" stroke-width="${f1(sw * 0.7)}"/>`;
      break;
  }
  return body + labelText(label, c, shape === 'sign' ? s * 0.33 : s * 0.55, s * 0.3, '#ffffff');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generates the placeholder art for a name. Pure and deterministic. */
export function stubArt(name: string, opts: StubOptions = {}): StubArt {
  const kind = opts.kind ?? 'creature';
  const s = Math.max(8, Math.round(opts.size ?? (kind === 'item' ? 24 : 32)));
  const r = rng(hash(opts.seed === undefined ? name : `${name}#${opts.seed}`));
  const label = opts.label ?? (name.trim()[0]?.toUpperCase() ?? '');
  const frames: string[] = [];
  const animations: SpriteAnim[] = [];
  let color: string;

  if (kind === 'creature') {
    const g = creatureGenes(r, s, opts.color);
    color = g.pal.main;
    for (const [anim, poses, fps, loop] of POSES) {
      const first = frames.length;
      for (const p of poses) frames.push(creatureFrame(g, p, s));
      animations.push({ name: anim, frames: poses.length > 1 ? `${first}-${frames.length - 1}` : `${first}`, fps, loop });
    }
  } else {
    const pal = palette(r, opts.color);
    color = pal.main;
    if (kind === 'item') {
      const draw = itemFrame(r, pal, s, label);
      frames.push(draw(0), draw(1));
      animations.push({ name: 'idle', frames: '0-1', fps: 3, loop: true });
    } else {
      frames.push(kind === 'tile' ? tileFrame(r, pal, s, label) : propFrame(r, pal, s, label));
      animations.push({ name: 'idle', frames: '0', fps: 1, loop: true });
    }
  }

  const width = s * frames.length;
  const body = frames
    .map((f, i) => `<svg x="${i * s}" y="0" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" overflow="hidden">${f}</svg>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${s}" viewBox="0 0 ${width} ${s}">${body}</svg>`;
  return { svg, width, height: s, frameW: s, frameH: s, animations, color };
}

export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Placeholder image + sprite assets for a name. Add both to `project.assets` and use
 * `sprite.id` as an actor's spriteId (creature animations match the default states).
 */
export function stubSprite(name: string, opts: StubOptions = {}): { image: ImageAsset; sprite: SpriteAsset; color: string } {
  const art = stubArt(name, opts);
  const image = createImageAsset(`${name} (stub).svg`, svgDataUrl(art.svg), art.width, art.height);
  const sprite = createSpriteAsset(name, image);
  Object.assign(sprite, { frameW: art.frameW, frameH: art.frameH, originX: 0.5, originY: 0.5, animations: art.animations });
  return { image, sprite, color: art.color };
}
