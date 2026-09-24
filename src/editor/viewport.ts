import { Camera, type Viewport as ViewportSize } from '../engine/camera';
import { pointInCollider, shapeCollider } from '../engine/collision';
import { createBlock, createCharacter, createProjectileEntity } from '../engine/factory';
import { Game } from '../engine/game';
import { Input } from '../engine/input';
import { DEG2RAD, type Vec2, dist, pointInPolygon, rotate } from '../engine/math';
import { project } from '../engine/projection';
import { type Box, Renderer, entityOrderKey, inDrawOrder, shapeOutline } from '../engine/renderer';
import type { BlockEntity, Entity, ShapeDef } from '../engine/types';
import { clone } from '../engine/util';
import type {
  AssetCache,
  GestureWriter,
  LogSink,
  PlayState,
  ProjectReader,
  ProjectWriter,
  SelectionModel,
  Tool,
  ToolModel,
} from './store';

export type ViewportStore = ProjectReader &
  ProjectWriter &
  GestureWriter &
  SelectionModel &
  ToolModel &
  PlayState &
  LogSink &
  AssetCache;

type ShapeTool = Extract<Tool, 'rect' | 'circle' | 'line'>;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; camX: number; camY: number }
  | { kind: 'move'; id: string; start: Vec2; grab: Vec2; moved: boolean }
  | { kind: 'handle'; id: string; handle: string; orig: Entity; moved: boolean }
  | { kind: 'create'; tool: ShapeTool; start: Vec2; preview: BlockEntity };

interface Handle {
  id: string;
  p: Vec2;
}

const HANDLE_PX = 8;
const ACCENT = '#ffb347';

function emptyShape(tool: ShapeTool): ShapeDef {
  if (tool === 'rect') return { kind: 'rect', w: 0, h: 0 };
  if (tool === 'circle') return { kind: 'circle', r: 0 };
  return { kind: 'line', x2: 0, y2: 0, thickness: 4 };
}

export class EditorViewport implements ViewportSize {
  readonly canvas = document.createElement('canvas');
  readonly camera = new Camera();
  width = 0;
  height = 0;
  private dpr = 1;
  private renderer: Renderer;
  private drag: Drag | null = null;
  private mouse: Vec2 = { x: 0, y: 0 };
  private spaceDown = false;
  private hitboxes = new Map<string, Box>();
  private game: Game | null = null;
  private input = new Input();
  private last = performance.now();
  private editCamera = { x: 0, y: 0, zoom: 1 };

  constructor(
    private readonly host: HTMLElement,
    private readonly store: ViewportStore,
  ) {
    host.append(this.canvas);
    this.renderer = new Renderer(this.canvas.getContext('2d')!, store.assets);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindEvents();
    requestAnimationFrame(this.loop);
  }

  private get view() {
    return this.store.scene.view;
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  // ---------------------------------------------------------------------------
  // Play mode
  // ---------------------------------------------------------------------------

  play(): void {
    if (this.game) return;
    this.editCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
    this.input.attach();
    this.game = new Game(clone(this.store.project), this.store.scene.id, this.store.assets, this.input, {
      zoom: Math.max(1, this.camera.zoom),
      onLog: (m) => this.store.log(m),
    });
    this.store.log(`▶ Playing "${this.store.scene.name}"`);
    this.store.setPlaying(true);
    this.canvas.focus();
  }

  stop(): void {
    if (!this.game) return;
    this.game = null;
    this.input.detach();
    Object.assign(this.camera, this.editCamera);
    this.store.log('■ Stopped');
    this.store.setPlaying(false);
  }

  togglePlay(): void {
    if (this.game) this.stop();
    else this.play();
  }

  // ---------------------------------------------------------------------------
  // Camera helpers
  // ---------------------------------------------------------------------------

  frameAll(): void {
    const ents = this.store.scene.entities;
    if (!ents.length) {
      Object.assign(this.camera, { x: 0, y: 0, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const addPt = (p: Vec2) => {
      const s = project(this.view, p);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    };
    for (const e of ents) {
      if (e.type === 'block') shapeOutline(e).forEach(addPt);
      else {
        addPt({ x: e.x - 24, y: e.y - 24 });
        addPt({ x: e.x + 24, y: e.y + 24 });
      }
    }
    this.camera.fit(minX, minY, maxX, maxY, this);
  }

  private localPoint(ev: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private toWorld(s: Vec2): Vec2 {
    return this.camera.screenToWorld(this.view, s, this);
  }

  private toScreen(w: Vec2): Vec2 {
    return this.camera.toScreen(project(this.view, w), this);
  }

  private snapValue(v: number, ev: MouseEvent): number {
    if (!this.store.snap || ev.altKey) return Math.round(v);
    const g = this.store.scene.gridSize || 1;
    return Math.round(v / g) * g;
  }

  private snapPoint(p: Vec2, ev: MouseEvent): Vec2 {
    return { x: this.snapValue(p.x, ev), y: this.snapValue(p.y, ev) };
  }

  // ---------------------------------------------------------------------------
  // Picking & handles
  // ---------------------------------------------------------------------------

  private pick(s: Vec2, w: Vec2): Entity | null {
    const proj = this.camera.toProjected(s, this);
    const tol = 6 / this.camera.zoom;
    const ordered = inDrawOrder(this.store.scene.entities, (e) => entityOrderKey(this.view, e)).reverse();
    for (const e of ordered) {
      if (e.type === 'block') {
        if (pointInCollider(w, shapeCollider(e.shape, e.x, e.y, e.rotation), tol)) return e;
        if (this.view === 'isometric' && e.height > 0) {
          const top = shapeOutline(e).map((p) => {
            const q = project(this.view, p);
            return { x: q.x, y: q.y - e.height };
          });
          if (top.length > 2 && pointInPolygon(proj, top)) return e;
        }
      } else {
        const b = this.hitboxes.get(e.id);
        if (b && proj.x >= b.x && proj.x <= b.x + b.w && proj.y >= b.y && proj.y <= b.y + b.h) return e;
      }
    }
    return null;
  }

  private handlesOf(e: Entity): Handle[] {
    if (e.type !== 'block') return [];
    const s = e.shape;
    if (s.kind === 'rect') return shapeOutline(e).map((p, i) => ({ id: `c${i}`, p }));
    if (s.kind === 'circle') return [{ id: 'r', p: { x: e.x + s.r, y: e.y } }];
    return [
      { id: 'a', p: { x: e.x, y: e.y } },
      { id: 'b', p: { x: e.x + s.x2, y: e.y + s.y2 } },
    ];
  }

  private handleAt(e: Entity, s: Vec2): string | null {
    for (const hd of this.handlesOf(e)) if (dist(this.toScreen(hd.p), s) <= HANDLE_PX) return hd.id;
    return null;
  }

  private applyHandle(d: Extract<Drag, { kind: 'handle' }>, w: Vec2, ev: MouseEvent): void {
    const e = this.store.entity(d.id);
    const orig = d.orig;
    if (!e || e.type !== 'block' || orig.type !== 'block') return;
    const p = this.snapPoint(w, ev);
    if (e.shape.kind === 'rect' && orig.shape.kind === 'rect') {
      const signs = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ][Number(d.handle.slice(1))];
      const rad = orig.rotation * DEG2RAD;
      const mouse = orig.rotation === 0 ? p : w;
      const local = rotate({ x: mouse.x - orig.x, y: mouse.y - orig.y }, -rad);
      const opp = { x: (-signs[0] * orig.shape.w) / 2, y: (-signs[1] * orig.shape.h) / 2 };
      e.shape.w = Math.max(2, Math.abs(local.x - opp.x));
      e.shape.h = Math.max(2, Math.abs(local.y - opp.y));
      const c = rotate({ x: (local.x + opp.x) / 2, y: (local.y + opp.y) / 2 }, rad);
      e.x = orig.x + c.x;
      e.y = orig.y + c.y;
    } else if (e.shape.kind === 'circle') {
      e.shape.r = Math.max(2, this.snapValue(dist(w, e), ev));
    } else if (e.shape.kind === 'line' && orig.shape.kind === 'line') {
      if (d.handle === 'a') {
        const end = { x: orig.x + orig.shape.x2, y: orig.y + orig.shape.y2 };
        e.x = p.x;
        e.y = p.y;
        e.shape.x2 = end.x - p.x;
        e.shape.y2 = end.y - p.y;
      } else {
        e.shape.x2 = p.x - e.x;
        e.shape.y2 = p.y - e.y;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private bindEvents(): void {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement === c) {
        this.spaceDown = true;
        if (!this.game) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  }

  private onDown(ev: PointerEvent): void {
    this.canvas.focus();
    if (this.game) return;
    this.canvas.setPointerCapture(ev.pointerId);
    const s = this.localPoint(ev);
    const w = this.toWorld(s);
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', sx: s.x, sy: s.y, camX: this.camera.x, camY: this.camera.y };
      return;
    }
    if (ev.button !== 0) return;
    const tool = this.store.tool;

    if (tool === 'select') {
      const sel = this.store.selection?.kind === 'entity' ? this.store.entity(this.store.selection.id) : undefined;
      const handle = sel && this.handleAt(sel, s);
      if (sel && handle) {
        this.store.beginGesture();
        this.drag = { kind: 'handle', id: sel.id, handle, orig: clone(sel), moved: false };
        return;
      }
      const hit = this.pick(s, w);
      if (hit) {
        this.store.select({ kind: 'entity', id: hit.id });
        this.store.beginGesture();
        this.drag = { kind: 'move', id: hit.id, start: { x: hit.x, y: hit.y }, grab: w, moved: false };
      } else {
        this.store.select(null);
        this.drag = { kind: 'pan', sx: s.x, sy: s.y, camX: this.camera.x, camY: this.camera.y };
      }
      return;
    }

    const p = this.snapPoint(w, ev);
    if (tool === 'rect' || tool === 'circle' || tool === 'line') {
      this.drag = { kind: 'create', tool, start: p, preview: createBlock(emptyShape(tool), p.x, p.y) };
      return;
    }

    const assets = this.store.project.assets;
    const firstProjectile = assets.find((a) => a.type === 'projectile')?.id ?? null;
    const e =
      tool === 'projectile' ? createProjectileEntity(p.x, p.y, firstProjectile) : createCharacter(tool, p.x, p.y);
    if (this.view === 'isometric' && e.type === 'character') {
      e.collider = { kind: 'circle', r: 12 };
      e.spriteOffsetY = -22;
    }
    this.store.commit(() => this.store.scene.entities.push(e));
    this.store.select({ kind: 'entity', id: e.id });
  }

  private onMove(ev: PointerEvent): void {
    const s = this.localPoint(ev);
    this.mouse = s;
    const d = this.drag;
    if (!d) return;
    const w = this.toWorld(s);
    switch (d.kind) {
      case 'pan':
        this.camera.x = d.camX - (s.x - d.sx) / this.camera.zoom;
        this.camera.y = d.camY - (s.y - d.sy) / this.camera.zoom;
        break;
      case 'move': {
        const e = this.store.entity(d.id);
        if (!e) break;
        const x = d.start.x + this.snapValue(w.x - d.grab.x, ev);
        const y = d.start.y + this.snapValue(w.y - d.grab.y, ev);
        if (x !== e.x || y !== e.y) {
          e.x = x;
          e.y = y;
          d.moved = true;
          this.store.gestureUpdate();
        }
        break;
      }
      case 'handle':
        this.applyHandle(d, w, ev);
        d.moved = true;
        this.store.gestureUpdate();
        break;
      case 'create': {
        const p = this.snapPoint(w, ev);
        const pv = d.preview;
        const sh = pv.shape;
        if (sh.kind === 'rect') {
          pv.x = (d.start.x + p.x) / 2;
          pv.y = (d.start.y + p.y) / 2;
          sh.w = Math.abs(p.x - d.start.x);
          sh.h = Math.abs(p.y - d.start.y);
        } else if (sh.kind === 'circle') {
          sh.r = dist(d.start, w);
          if (this.store.snap && !ev.altKey) sh.r = this.snapValue(sh.r, ev);
        } else {
          sh.x2 = p.x - d.start.x;
          sh.y2 = p.y - d.start.y;
        }
        break;
      }
    }
  }

  private onUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(ev.pointerId)) this.canvas.releasePointerCapture(ev.pointerId);
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'handle') this.store.endGesture(d.moved);
    if (d.kind === 'create') {
      const pv = d.preview;
      const sh = pv.shape;
      const g = this.store.scene.gridSize || 32;
      // A click without dragging creates a default-sized shape.
      if (sh.kind === 'rect' && (sh.w < 2 || sh.h < 2)) Object.assign(sh, { w: g * 4, h: g });
      if (sh.kind === 'circle' && sh.r < 2) sh.r = g;
      if (sh.kind === 'line' && Math.hypot(sh.x2, sh.y2) < 2) sh.x2 = g * 4;
      this.store.commit(() => this.store.scene.entities.push(pv));
      this.store.select({ kind: 'entity', id: pv.id });
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    if (this.game) return;
    const s = this.localPoint(ev);
    const before = this.camera.toProjected(s, this);
    this.camera.zoom = Math.max(0.1, Math.min(8, this.camera.zoom * Math.exp(-ev.deltaY * 0.0015)));
    const after = this.camera.toProjected(s, this);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private loop = (t: number): void => {
    const dt = (t - this.last) / 1000;
    this.last = t;
    if (this.game) {
      this.game.frame(dt);
      this.game.render(this.renderer, this, this.dpr);
    } else {
      this.drawEditor();
    }
    requestAnimationFrame(this.loop);
  };

  private drawEditor(): void {
    const r = this.renderer;
    const scene = this.store.scene;
    r.view = scene.view;
    r.begin(this, this.dpr, this.camera, scene.background);
    r.drawGrid(scene.gridSize, this.camera, this);

    this.hitboxes.clear();
    for (const e of inDrawOrder(scene.entities, (x) => entityOrderKey(scene.view, x))) {
      if (e.type === 'block') r.drawBlock(e);
      else if (e.type === 'character') this.hitboxes.set(e.id, r.drawCharacter(e));
      else this.hitboxes.set(e.id, r.drawProjectileEntity(e));
    }
    if (this.drag?.kind === 'create') r.drawBlock(this.drag.preview, true);
    this.drawSelection();
    this.drawHud();
  }

  private strokeWorld(pts: Vec2[], closed: boolean): void {
    const ctx = this.renderer.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = project(this.view, p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  private drawSelection(): void {
    const sel = this.store.selection;
    if (sel?.kind !== 'entity') return;
    const e = this.store.entity(sel.id);
    if (!e) return;
    const ctx = this.renderer.ctx;
    const z = this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 / z;

    if (e.type === 'block') {
      this.strokeWorld(shapeOutline(e), e.shape.kind !== 'line');
    } else {
      const b = this.hitboxes.get(e.id);
      if (b) ctx.strokeRect(b.x - 2 / z, b.y - 2 / z, b.w + 4 / z, b.h + 4 / z);
    }

    if (e.type === 'character') {
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.strokeStyle = 'rgba(120,220,255,0.9)';
      ctx.lineWidth = 1 / z;
      const col = shapeCollider(e.collider, e.x, e.y);
      if (col.type === 'poly') this.strokeWorld(col.pts, true);
      else this.strokeWorld(shapeOutline({ x: e.x, y: e.y, rotation: 0, shape: { kind: 'circle', r: col.r } }), true);
      if (e.behavior !== 'none' && e.behavior !== 'script' && (e.control === 'npc' || e.idleTakeover > 0)) {
        ctx.strokeStyle = 'rgba(255,209,102,0.35)';
        if (e.behavior === 'patrol') {
          this.strokeWorld([{ x: e.x - e.behaviorRange, y: e.y }, { x: e.x + e.behaviorRange, y: e.y }], false);
        } else {
          this.strokeWorld(shapeOutline({ x: e.x, y: e.y, rotation: 0, shape: { kind: 'circle', r: e.behaviorRange } }), true);
        }
      }
    }
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / z;
    const hs = HANDLE_PX / z;
    for (const hd of this.handlesOf(e)) {
      const q = project(this.view, hd.p);
      ctx.fillRect(q.x - hs / 2, q.y - hs / 2, hs, hs);
      ctx.strokeRect(q.x - hs / 2, q.y - hs / 2, hs, hs);
    }
  }

  private drawHud(): void {
    const ctx = this.renderer.ctx;
    this.renderer.screen(this.dpr);
    const w = this.toWorld(this.mouse);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${this.view}  ·  ${Math.round(w.x)}, ${Math.round(w.y)}  ·  ${Math.round(this.camera.zoom * 100)}%  ·  wheel zoom · right/middle drag pan · Alt = no snap`,
      10,
      this.height - 10,
    );
  }
}
