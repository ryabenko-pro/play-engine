import type { SpriteFrames } from '../../engine/assets';
import type { Animations, SpriteSheet } from '../../engine/types';
import { h } from '../ui';

export interface SpritePreview {
  el: HTMLElement;
  setAnim(name: string): void;
}

/** Sprite sheet with frame grid + live animation playback. Stops itself when detached. */
export function spritePreview(sprite: SpriteSheet & Animations, frames: SpriteFrames): SpritePreview {
  const sheet = h('canvas', { class: 'sheet' });
  const anim = h('canvas', { class: 'anim', width: 112, height: 112 });
  const label = h('div', { class: 'note' });
  const el = h('div', { class: 'sprite-preview' }, sheet, h('div', { class: 'anim-box' }, anim, label));
  let current = sprite.animations[0]?.name ?? '';
  const t0 = performance.now();

  const drawSheet = () => {
    const first = frames.frameRect(sprite, 0);
    if (!first) return false;
    const img = first.img;
    const scale = Math.min(4, 268 / img.naturalWidth);
    sheet.width = Math.round(img.naturalWidth * scale);
    sheet.height = Math.round(img.naturalHeight * scale);
    const ctx = sheet.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, sheet.width, sheet.height);
    ctx.strokeStyle = 'rgba(255,179,71,0.7)';
    ctx.fillStyle = '#ffb347';
    ctx.font = '9px monospace';
    const cols = Math.max(1, Math.floor(img.naturalWidth / sprite.frameW));
    const rows = Math.max(1, Math.floor(img.naturalHeight / sprite.frameH));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * sprite.frameW * scale;
        const y = r * sprite.frameH * scale;
        ctx.strokeRect(x + 0.5, y + 0.5, sprite.frameW * scale - 1, sprite.frameH * scale - 1);
        ctx.fillText(String(r * cols + c), x + 2, y + 9);
      }
    }
    return true;
  };

  let sheetDrawn = false;
  const tick = () => {
    if (!el.isConnected) return;
    if (!sheetDrawn) sheetDrawn = drawSheet();
    const t = (performance.now() - t0) / 1000;
    const idx = frames.frameAt(sprite, current, t);
    const fr = frames.frameRect(sprite, idx);
    const ctx = anim.getContext('2d')!;
    ctx.clearRect(0, 0, anim.width, anim.height);
    if (fr) {
      const s = Math.max(1, Math.floor(Math.min(anim.width / fr.sw, anim.height / fr.sh)));
      const dx = (anim.width - fr.sw * s) / 2;
      const dy = (anim.height - fr.sh * s) / 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, fr.sw * s, fr.sh * s);
      ctx.strokeStyle = '#78dcff';
      const ox = dx + sprite.originX * fr.sw * s;
      const oy = dy + sprite.originY * fr.sh * s;
      ctx.beginPath();
      ctx.moveTo(ox - 5, oy);
      ctx.lineTo(ox + 5, oy);
      ctx.moveTo(ox, oy - 5);
      ctx.lineTo(ox, oy + 5);
      ctx.stroke();
    }
    label.textContent = current ? `${current} · frame ${idx}` : 'no animations';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { el, setAnim: (n) => (current = n) };
}
