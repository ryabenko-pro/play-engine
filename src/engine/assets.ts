import type { Animations, Asset, AssetOf, AssetType, SpriteAnim, SpriteSheet } from './types';

export interface AssetLookup {
  get<T extends AssetType>(id: string | null | undefined, type: T): AssetOf<T> | undefined;
  list<T extends AssetType>(type: T): AssetOf<T>[];
}

export interface ImageProvider {
  /** Returns the image only once it is decoded and drawable. */
  image(id: string | null | undefined): HTMLImageElement | undefined;
}

export interface FrameRect {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface SpriteFrames {
  frameAt(sprite: Animations, anim: string, time: number): number;
  /** Seconds for one pass of the animation (Infinity if it has no frames or fps). */
  animDuration(sprite: Animations, anim: string): number;
  frameRect(sheet: SpriteSheet, index: number): FrameRect | null;
}

/** Parses "0-3, 5, 7-6" into [0,1,2,3,5,7,6]. */
export function parseFrames(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(/[,\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const step = a <= b ? 1 : -1;
      for (let i = a; out.length < 1000; i += step) {
        out.push(i);
        if (i === b) break;
      }
    } else {
      const n = Number(part);
      if (Number.isInteger(n) && n >= 0) out.push(n);
    }
  }
  return out;
}

export function findAnim(sprite: Animations, name: string): SpriteAnim | undefined {
  return sprite.animations.find((a) => a.name === name) ?? sprite.animations[0];
}

export class AssetStore implements AssetLookup, ImageProvider, SpriteFrames {
  private assets = new Map<string, Asset>();
  private images = new Map<string, { src: string; img: HTMLImageElement }>();
  private frameCache = new Map<string, number[]>();

  constructor(
    assets: Asset[] = [],
    private onImageLoad?: () => void,
  ) {
    this.sync(assets);
  }

  sync(list: Asset[]): void {
    this.assets.clear();
    for (const a of list) {
      this.assets.set(a.id, a);
      if (a.type !== 'image' || typeof Image === 'undefined') continue;
      const existing = this.images.get(a.id);
      if (existing && existing.src === a.src) continue;
      const img = new Image();
      img.onload = () => this.onImageLoad?.();
      img.src = a.src;
      this.images.set(a.id, { src: a.src, img });
    }
  }

  get<T extends AssetType>(id: string | null | undefined, type: T): AssetOf<T> | undefined {
    if (!id) return undefined;
    const a = this.assets.get(id);
    return a && a.type === type ? (a as AssetOf<T>) : undefined;
  }

  list<T extends AssetType>(type: T): AssetOf<T>[] {
    return [...this.assets.values()].filter((a): a is AssetOf<T> => a.type === type);
  }

  image(id: string | null | undefined): HTMLImageElement | undefined {
    if (!id) return undefined;
    const img = this.images.get(id)?.img;
    return img && img.complete && img.naturalWidth > 0 ? img : undefined;
  }

  private frames(anim: SpriteAnim): number[] {
    let f = this.frameCache.get(anim.frames);
    if (!f) {
      f = parseFrames(anim.frames);
      this.frameCache.set(anim.frames, f);
    }
    return f;
  }

  frameAt(sprite: Animations, anim: string, time: number): number {
    const a = findAnim(sprite, anim);
    if (!a) return 0;
    const frames = this.frames(a);
    if (!frames.length) return 0;
    let i = Math.floor(time * Math.max(0, a.fps));
    i = a.loop ? i % frames.length : Math.min(i, frames.length - 1);
    return frames[i];
  }

  animDuration(sprite: Animations, anim: string): number {
    const a = findAnim(sprite, anim);
    if (!a || a.fps <= 0) return Infinity;
    const n = this.frames(a).length;
    return n ? n / a.fps : Infinity;
  }

  frameRect(sheet: SpriteSheet, index: number): FrameRect | null {
    const img = this.image(sheet.imageId);
    if (!img || sheet.frameW <= 0 || sheet.frameH <= 0) return null;
    const cols = Math.max(1, Math.floor(img.naturalWidth / sheet.frameW));
    const rows = Math.max(1, Math.floor(img.naturalHeight / sheet.frameH));
    const total = cols * rows;
    const i = ((index % total) + total) % total;
    return { img, sx: (i % cols) * sheet.frameW, sy: Math.floor(i / cols) * sheet.frameH, sw: sheet.frameW, sh: sheet.frameH };
  }
}
