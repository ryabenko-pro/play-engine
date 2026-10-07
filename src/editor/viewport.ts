import { Camera, type Viewport as ViewportSize } from '../engine/camera';
import { FrameStats, now } from '../engine/debug';
import { pointInCollider, shapeCollider } from '../engine/collision';
import { createBlock, createInstance, createPath, createProjectileEntity, createZone } from '../engine/factory';
import { distToOutline, simplify, worldPoints } from '../engine/paths';
import { Game } from '../engine/game';
import { Input } from '../engine/input';
import { DEG2RAD, type Vec2, dist, pointInPolygon, rotate } from '../engine/math';
import {
  type PlacedEntity,
  expandLevel,
  findActorScene,
  formUsers,
  levelContains,
  lookOf,
  resolveInstance,
  sandboxProject,
} from '../engine/prefabs';
import { project } from '../engine/projection';
import { type ActorVisual, type Box, Renderer, entityOrderKey, inDrawOrder, shapeOutline, wobble } from '../engine/renderer';
import { type WorldBody, bodyShape, halfExtents, scaleShape, worldBody } from '../engine/runtime';
import type { ActorDef, ActorScene, ActorState, BlockEntity, Entity, InstanceEntity, LevelScene, PathEntity, PlacedBody, ShapeDef, ViewMode, ZoneEntity } from '../engine/types';
import { clone } from '../engine/util';
import { SCENE_DRAG_TYPE } from './panels/scenes';
import type {
  AssetCache,
  GestureWriter,
  Observable,
  LogSink,
  PlayState,
  ProjectReader,
  ProjectWriter,
  SceneSwitcher,
  ScriptCompiler,
  SelectionModel,
  Tool,
  ToolModel,
} from './store';

export type ViewportStore = Observable &
  ProjectReader &
  ProjectWriter &
  GestureWriter &
  SelectionModel &
  SceneSwitcher &
  ToolModel &
  PlayState &
  LogSink &
  AssetCache &
  ScriptCompiler;

type ShapeTool = Extract<Tool, 'rect' | 'circle' | 'line'>;
type MapTool = Extract<Tool, 'path' | 'zone'>;

/**
 * A path or zone being drawn. Clicks add points (double-click / Enter finishes, Esc cancels,
 * Backspace takes the last one back); pressing and dragging from the first point draws freehand.
 */
interface Drawing {
  tool: MapTool;
  points: Vec2[];
  /** The button is held: a drag now means freehand. */
  pressing: boolean;
  /** Screen point where the button went down. */
  down: Vec2;
  freehand: boolean;
}

const isMap = (e: Entity): e is PathEntity | ZoneEntity => e.type === 'path' || e.type === 'zone';
const MAP_EDITOR_COLOR = { path: '#ffd166', zone: '#7ee787' } as const;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; camX: number; camY: number }
  | { kind: 'move'; id: string; start: Vec2; grab: Vec2; moved: boolean }
  | { kind: 'handle'; id: string; handle: string; orig: Entity; moved: boolean }
  | { kind: 'collider'; sceneId: string; state: string | null; handle: 'resize' | 'move'; moved: boolean }
  | { kind: 'create'; tool: ShapeTool; start: Vec2; preview: BlockEntity };

interface Handle {
  id: string;
  p: Vec2;
}

const HANDLE_PX = 8;
const ACCENT = '#ffb347';
const COLLIDER_COLOR = 'rgba(120,220,255,0.9)';

function emptyShape(tool: ShapeTool): ShapeDef {
  if (tool === 'rect') return { kind: 'rect', w: 0, h: 0 };
  if (tool === 'circle') return { kind: 'circle', r: 0 };
  return { kind: 'line', x2: 0, y2: 0, thickness: 4 };
}

/** Editor-time look of an actor: facing right, animation and wobble running on the wall clock. */
function editorVisual(d: ActorDef, state: ActorState | undefined, body: WorldBody, seed = 0): ActorVisual {
  const t = performance.now() / 1000;
  return { facing: 1, anim: state?.animation ?? '', animTime: t, flash: 0, color: d.color, body, squash: wobble(d.wobble, t, seed) };
}

/** An actor definition at a position, with its scale applied to the sprite. */
function drawable(d: ActorDef, x: number, y: number) {
  return { x, y, spriteId: d.spriteId, spriteScale: d.spriteScale * d.scale, spriteOffsetY: d.spriteOffsetY * d.scale };
}

function initialState(d: ActorDef): ActorState | undefined {
  return d.states.find((s) => s.name === d.initialState) ?? d.states[0];
}

/** The collider being shown/edited in the character view: the state's own body, or the shared base collider. */
interface EditedBody {
  body: PlacedBody;
  /** State that owns the body, or null for the base collider. */
  state: string | null;
}

/** Shows / hides the FPS and frame-time overlay. */
export interface DebugToggle {
  readonly debug: boolean;
  toggleDebug(): void;
}

const DEBUG_KEY = 'ge.debug';

export class EditorViewport implements ViewportSize, DebugToggle {
  readonly canvas = document.createElement('canvas');
  readonly camera = new Camera();
  width = 0;
  height = 0;
  private dpr = 1;
  private renderer: Renderer;
  private drag: Drag | null = null;
  private drawing: Drawing | null = null;
  private mouse: Vec2 = { x: 0, y: 0 };
  private spaceDown = false;
  private hitboxes = new Map<string, Box>();
  /** The open level with nested levels expanded, in draw order (for picking). */
  private placed: PlacedEntity[] = [];
  private game: Game | null = null;
  private input = new Input();
  private last = performance.now();
  private editCamera = { x: 0, y: 0, zoom: 1 };
  private stats = new FrameStats();
  /** Camera of each scene, restored when its tab becomes active again. */
  private cameras = new Map<string, { x: number; y: number; zoom: number }>();
  private shownScene: string | null = null;
  debug = readDebugPref();

  constructor(
    private readonly host: HTMLElement,
    private readonly store: ViewportStore,
  ) {
    host.append(this.canvas);
    this.renderer = new Renderer(this.canvas.getContext('2d')!, store.assets);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindEvents();
    store.subscribe(() => {
      // A half-drawn path / zone is dropped when the tool or the scene changes.
      if (this.drawing && (this.store.tool !== this.drawing.tool || !this.store.level)) this.drawing = null;
      this.syncScene();
    });
    // First framing waits for the layout so the viewport has its real size.
    requestAnimationFrame(() => this.syncScene());
    requestAnimationFrame(this.loop);
  }

  /** On tab switch: remember the old scene's camera, restore (or frame) the new one. */
  private syncScene(): void {
    const id = this.store.sceneId;
    if (id === this.shownScene || this.game) return;
    if (this.shownScene) this.cameras.set(this.shownScene, { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom });
    this.shownScene = id;
    const saved = this.cameras.get(id);
    if (saved) Object.assign(this.camera, saved);
    else this.frameAll();
  }

  private get view(): ViewMode {
    const s = this.store.scene;
    return s.kind === 'level' ? s.view : s.previewView;
  }

  private get gridSize(): number {
    return this.store.level?.gridSize ?? 16;
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

  play(quiet = false): void {
    if (this.game) return;
    const scene = this.store.scene;
    let proj = clone(this.store.project);
    let levelId = scene.id;
    // A form scene is tested inside the actor that uses it.
    const asForm = scene.kind === 'actor' ? formUsers(proj, scene.id)[0] : undefined;
    if (asForm) ({ project: proj, levelId } = sandboxProject(proj, asForm.container, asForm.form));
    else if (scene.kind === 'actor') ({ project: proj, levelId } = sandboxProject(proj, scene));
    this.editCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
    this.input.attach();
    this.input.attachPointer(this.canvas);
    const sandbox = scene.kind === 'actor';
    this.game = new Game(proj, levelId, this.store.assets, this.input, {
      zoom: sandbox ? 1.5 : Math.max(1, this.camera.zoom),
      cameraAt: sandbox ? { x: 0, y: -60 } : { x: this.camera.x, y: this.camera.y },
      onLog: (m) => this.store.log(m),
      scripts: this.store.scripts,
    });
    if (!quiet) this.store.log(
      asForm
        ? `▶ Testing "${scene.name}" as form '${asForm.form}' of "${asForm.container.name}"`
        : sandbox
          ? `▶ Testing "${scene.name}" in a sandbox`
          : `▶ Playing "${scene.name}"`,
    );
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
    const character = this.store.actorScene;
    if (character) {
      const h = halfExtents(scaleShape(character.actor.collider, character.actor.scale));
      const r = Math.max(60, h.y * 3);
      const c = project(this.view, { x: 0, y: 0 });
      this.camera.fit(c.x - r * 1.5, c.y - r * 1.2, c.x + r * 1.5, c.y + r * 0.8, this, 20);
      return;
    }
    const level = this.store.level;
    const ents = level ? expandLevel(this.store.project, level).map((x) => x.e) : [];
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
      else if (isMap(e)) worldPoints(e).forEach(addPt);
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
    const g = this.gridSize || 1;
    return Math.round(v / g) * g;
  }

  private snapPoint(p: Vec2, ev: MouseEvent): Vec2 {
    return { x: this.snapValue(p.x, ev), y: this.snapValue(p.y, ev) };
  }

  /**
   * Where a new instance goes: actors in top-down / isometric levels snap to cell centres
   * (where grid movement puts them), everything else to grid points.
   */
  private instancePoint(sceneId: string, p: Vec2, ev: MouseEvent): Vec2 {
    const actor = this.store.project.scenes.find((s) => s.id === sceneId)?.kind === 'actor';
    if (!actor || this.view === 'side' || !this.store.snap || ev.altKey) return this.snapPoint(p, ev);
    const g = this.gridSize || 1;
    return { x: (Math.floor(p.x / g) + 0.5) * g, y: (Math.floor(p.y / g) + 0.5) * g };
  }

  // ---------------------------------------------------------------------------
  // Picking & handles (level mode)
  // ---------------------------------------------------------------------------

  /** Top-level entity under the cursor; clicking anything inside a placed room picks the room. */
  private pick(level: LevelScene, s: Vec2, w: Vec2): Entity | null {
    const proj = this.camera.toProjected(s, this);
    const tol = 6 / this.camera.zoom;
    const inBox = (b: Box | undefined) => !!b && proj.x >= b.x && proj.x <= b.x + b.w && proj.y >= b.y && proj.y <= b.y + b.h;
    for (const { e, owner } of [...this.placed].reverse()) {
      let hit = false;
      if (e.type === 'path') {
        hit = distToOutline(w, worldPoints(e), false) <= e.width / 2 + tol;
      } else if (e.type === 'zone') {
        const pts = worldPoints(e);
        hit = (pts.length > 2 && pointInPolygon(w, pts)) || distToOutline(w, pts, true) <= tol;
      } else if (e.type === 'block') {
        hit = pointInCollider(w, shapeCollider(e.shape, e.x, e.y, e.rotation), tol);
        if (!hit && this.view === 'isometric' && e.height > 0) {
          const top = shapeOutline(e).map((p) => {
            const q = project(this.view, p);
            return { x: q.x, y: q.y - e.height };
          });
          hit = top.length > 2 && pointInPolygon(proj, top);
        }
      } else {
        hit = inBox(this.hitboxes.get(e.id));
      }
      if (hit) return level.entities.find((x) => x.id === owner) ?? null;
    }
    return null;
  }

  private handlesOf(e: Entity): Handle[] {
    if (isMap(e)) return worldPoints(e).map((p, i) => ({ id: `p${i}`, p }));
    if (e.type !== 'block') return [];
    const s = e.shape;
    if (s.kind === 'rect') return shapeOutline(e).map((p, i) => ({ id: `c${i}`, p }));
    if (s.kind === 'circle') return [{ id: 'r', p: { x: e.x + s.r, y: e.y } }];
    return [
      { id: 'a', p: { x: e.x, y: e.y } },
      { id: 'b', p: { x: e.x + s.x2, y: e.y + s.y2 } },
    ];
  }

  private handleAt(handles: Handle[], s: Vec2): string | null {
    for (const hd of handles) if (dist(this.toScreen(hd.p), s) <= HANDLE_PX) return hd.id;
    return null;
  }

  private applyHandle(d: Extract<Drag, { kind: 'handle' }>, w: Vec2, ev: MouseEvent): void {
    const e = this.store.entity(d.id);
    const orig = d.orig;
    if (e && isMap(e)) {
      const i = Number(d.handle.slice(1));
      const p = this.snapPoint(w, ev);
      if (e.points[i]) e.points[i] = { x: p.x - e.x, y: p.y - e.y };
      return;
    }
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

  /** State selected in the Scene tree of the open character scene, if any. */
  private selectedState(scene: ActorScene): ActorState | undefined {
    const sel = this.store.selection;
    const name = sel?.kind === 'part' && sel.id.startsWith('state:') ? sel.id.slice(6) : scene.actor.initialState;
    return scene.actor.states.find((s) => s.name === name);
  }

  private editedBody(scene: ActorScene): EditedBody {
    const st = this.selectedState(scene);
    if (st?.body) return { body: st.body, state: st.name };
    return { body: { shape: scene.actor.collider, offsetX: 0, offsetY: 0 }, state: null };
  }

  /** Character mode: resize handle at the collider corner; move handle at its centre for state bodies (side view). */
  private colliderHandles(scene: ActorScene): Handle[] {
    const { body, state } = this.editedBody(scene);
    const wb = worldBody(this.view, { x: 0, y: 0 }, body.shape, state ? body : null, 1, scene.actor.scale);
    const b = wb.shape;
    const handles: Handle[] = [{ id: 'resize', p: { x: wb.x + (b.kind === 'rect' ? b.w / 2 : b.r), y: wb.y + (b.kind === 'rect' ? b.h / 2 : 0) } }];
    if (state && this.view === 'side') handles.push({ id: 'move', p: { x: wb.x, y: wb.y } });
    return handles;
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
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('dragover', (e) => {
      if (this.store.level && e.dataTransfer?.types.includes(SCENE_DRAG_TYPE)) e.preventDefault();
    });
    c.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData(SCENE_DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      this.placeInstance(id, this.instancePoint(id, this.toWorld(this.localPoint(e)), e));
    });
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

  private placeInstance(sceneId: string, p: Vec2): void {
    const scene = this.store.project.scenes.find((s) => s.id === sceneId);
    const level = this.store.level;
    if (!scene || !level) return;
    if (scene.kind === 'level' && levelContains(this.store.project, scene.id, level.id)) {
      this.store.log(`Can't place "${scene.name}" in "${level.name}": it would contain itself.`);
      return;
    }
    const inst = createInstance(scene, p.x, p.y);
    this.store.commit(() => this.store.level?.entities.push(inst));
    this.store.select({ kind: 'entity', id: inst.id });
  }

  private onDown(ev: PointerEvent): void {
    this.canvas.focus();
    if (this.game) return;
    this.canvas.setPointerCapture(ev.pointerId);
    const s = this.localPoint(ev);
    const w = this.toWorld(s);
    const pan = () => (this.drag = { kind: 'pan', sx: s.x, sy: s.y, camX: this.camera.x, camY: this.camera.y });
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceDown)) return void pan();
    if (ev.button !== 0) return;

    const character = this.store.actorScene;
    if (character) {
      const handle = this.handleAt(this.colliderHandles(character), s);
      if (handle === 'resize' || handle === 'move') {
        this.store.beginGesture();
        this.drag = { kind: 'collider', sceneId: character.id, state: this.editedBody(character).state, handle, moved: false };
      } else {
        pan();
      }
      return;
    }

    const level = this.store.level;
    if (!level) return;
    const tool = this.store.tool;
    if (tool === 'select') {
      const sel = this.store.selection?.kind === 'entity' ? this.store.entity(this.store.selection.id) : undefined;
      const handle = sel && this.handleAt(this.handlesOf(sel), s);
      if (sel && handle) {
        this.store.beginGesture();
        this.drag = { kind: 'handle', id: sel.id, handle, orig: clone(sel), moved: false };
        return;
      }
      const hit = this.pick(level, s, w);
      if (hit) {
        this.store.select({ kind: 'entity', id: hit.id });
        this.store.beginGesture();
        this.drag = { kind: 'move', id: hit.id, start: { x: hit.x, y: hit.y }, grab: w, moved: false };
      } else {
        this.store.select(null);
        pan();
      }
      return;
    }

    const p = this.snapPoint(w, ev);
    if (tool === 'path' || tool === 'zone') return this.drawDown(tool, s, p);
    if (tool === 'rect' || tool === 'circle' || tool === 'line') {
      this.drag = { kind: 'create', tool, start: p, preview: createBlock(emptyShape(tool), p.x, p.y) };
    } else if (tool === 'instance') {
      const id = this.store.instanceSceneId;
      if (id) this.placeInstance(id, this.instancePoint(id, w, ev));
    } else {
      const firstProjectile = this.store.project.assets.find((a) => a.type === 'projectile')?.id ?? null;
      const e = createProjectileEntity(p.x, p.y, firstProjectile);
      this.store.commit(() => this.store.level?.entities.push(e));
      this.store.select({ kind: 'entity', id: e.id });
    }
  }

  private onDoubleClick(ev: MouseEvent): void {
    const level = this.store.level;
    if (this.game || !level) return;
    const s = this.localPoint(ev);
    if (this.store.tool === 'path' || this.store.tool === 'zone') return;
    // Double-clicking a point of the selected path / zone deletes it.
    const sel = this.store.selection?.kind === 'entity' ? this.store.entity(this.store.selection.id) : undefined;
    const handle = sel && isMap(sel) ? this.handleAt(this.handlesOf(sel), s) : null;
    if (sel && isMap(sel) && handle) {
      const i = Number(handle.slice(1));
      if (sel.points.length <= (sel.type === 'path' ? 2 : 3)) return void this.store.log(`A ${sel.type} needs at least ${sel.type === 'path' ? 2 : 3} points.`);
      const id = sel.id;
      this.store.commit(() => {
        const e = this.store.entity(id);
        if (e && isMap(e)) e.points.splice(i, 1);
      });
      return;
    }
    const hit = this.pick(level, s, this.toWorld(s));
    if (hit?.type === 'instance') this.store.setScene(hit.sceneId);
  }

  private onMove(ev: PointerEvent): void {
    const s = this.localPoint(ev);
    this.mouse = s;
    if (this.drawing) return this.drawMove(s, ev);
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
      case 'collider': {
        const def = findActorScene(this.store.project, d.sceneId)?.actor;
        const stateBody = d.state ? def?.states.find((x) => x.name === d.state)?.body : null;
        const col = stateBody ? stateBody.shape : def?.collider;
        if (!col) break;
        const side = this.view === 'side';
        // Handles are drawn at the actor's scale; the data stays unscaled.
        const k = def?.scale || 1;
        if (d.handle === 'move' && stateBody) {
          stateBody.offsetX = Math.round(w.x / k);
          stateBody.offsetY = Math.round(w.y / k);
        } else {
          // Resize around the collider centre.
          const lx = (w.x - (stateBody && side ? stateBody.offsetX * k : 0)) / k;
          const ly = (w.y - (stateBody && side ? stateBody.offsetY * k : 0)) / k;
          const round = (v: number) => Math.max(2, Math.round(v));
          if (col.kind === 'rect' && side) {
            col.w = round(Math.abs(lx) * 2);
            col.h = round(Math.abs(ly) * 2);
          } else if (col.kind === 'rect') {
            col.w = round(Math.hypot(lx, ly) * 2); // footprint radius = w / 2
          } else {
            col.r = round(Math.hypot(lx, ly));
          }
        }
        d.moved = true;
        this.store.gestureUpdate();
        break;
      }
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
    if (this.drawing) {
      if (this.canvas.hasPointerCapture(ev.pointerId)) this.canvas.releasePointerCapture(ev.pointerId);
      this.drawing.pressing = false;
      if (this.drawing.freehand) this.finishDrawing();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(ev.pointerId)) this.canvas.releasePointerCapture(ev.pointerId);
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'handle' || d.kind === 'collider') this.store.endGesture(d.moved);
    if (d.kind === 'create') {
      const pv = d.preview;
      const sh = pv.shape;
      const g = this.gridSize || 32;
      // A click without dragging creates a default-sized shape.
      if (sh.kind === 'rect' && (sh.w < 2 || sh.h < 2)) Object.assign(sh, { w: g * 4, h: g });
      if (sh.kind === 'circle' && sh.r < 2) sh.r = g;
      if (sh.kind === 'line' && Math.hypot(sh.x2, sh.y2) < 2) sh.x2 = g * 4;
      this.store.commit(() => this.store.level?.entities.push(pv));
      this.store.select({ kind: 'entity', id: pv.id });
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing paths and zones
  // ---------------------------------------------------------------------------

  private drawDown(tool: MapTool, s: Vec2, p: Vec2): void {
    const d = this.drawing;
    if (!d || d.tool !== tool) {
      this.drawing = { tool, points: [p], pressing: true, down: s, freehand: false };
      return;
    }
    const near = (q: Vec2) => dist(this.toScreen(q), s) <= HANDLE_PX;
    // Clicking the last point (or the same spot) again, as in a double-click, finishes; for a zone, so does clicking the first one.
    const again = dist(s, d.down) <= HANDLE_PX;
    if (again || near(d.points[d.points.length - 1]) || (tool === 'zone' && d.points.length >= 3 && near(d.points[0]))) return this.finishDrawing();
    d.points.push(p);
    d.pressing = true;
    d.down = s;
  }

  private drawMove(s: Vec2, ev: PointerEvent): void {
    const d = this.drawing!;
    if (!d.pressing) return;
    // Dragging right away from the first point: freehand, a point every few px.
    if (!d.freehand && d.points.length === 1 && dist(s, d.down) > 6) {
      d.freehand = true;
      d.points = [this.toWorld(d.down)];
    }
    if (!d.freehand) return;
    const w = this.toWorld(s);
    const last = d.points[d.points.length - 1];
    if (dist(w, last) * this.camera.zoom >= 6) d.points.push(ev.altKey ? w : { x: Math.round(w.x), y: Math.round(w.y) });
  }

  /** Keys while drawing a path / zone; returns true when the key was used. */
  drawKey(e: KeyboardEvent): boolean {
    const d = this.drawing;
    if (!d) return false;
    if (e.code === 'Enter') this.finishDrawing();
    else if (e.code === 'Escape') this.drawing = null;
    else if (e.code === 'Backspace' || e.code === 'Delete') {
      d.points.pop();
      if (!d.points.length) this.drawing = null;
    } else return false;
    e.preventDefault();
    return true;
  }

  private finishDrawing(): void {
    const d = this.drawing;
    const level = this.store.level;
    this.drawing = null;
    if (!d || !level) return;
    let pts = d.freehand ? simplify(d.points, 1.5 / Math.min(1, this.camera.zoom)) : d.points;
    pts = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5);
    const need = d.tool === 'path' ? 2 : 3;
    if (pts.length < need) return void this.store.log(`A ${d.tool} needs at least ${need} points: click to add them, or press and drag to draw.`);
    const taken = new Set(level.entities.map((e) => e.name));
    const base = d.tool === 'path' ? 'Path' : 'Zone';
    let n = 1;
    while (taken.has(`${base} ${n}`)) n++;
    const e = d.tool === 'path' ? createPath(`${base} ${n}`, pts) : createZone(`${base} ${n}`, pts);
    this.store.commit(() => this.store.level?.entities.push(e));
    this.store.select({ kind: 'entity', id: e.id });
  }

  /** The path / zone being drawn, with a rubber band to the mouse. */
  private drawDrawing(): void {
    const d = this.drawing;
    if (!d) return;
    const pts = d.freehand || d.pressing ? d.points : [...d.points, this.snapPoint(this.toWorld(this.mouse), new MouseEvent('move'))];
    const ctx = this.renderer.ctx;
    const z = this.camera.zoom;
    ctx.save();
    if (d.tool === 'path') this.renderer.drawPath(pts, 28, MAP_EDITOR_COLOR.path, 0.5);
    else this.renderer.drawZone(pts, MAP_EDITOR_COLOR.zone);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([]);
    this.strokeWorld(pts, d.tool === 'zone');
    ctx.restore();
    if (!d.freehand) this.drawHandles(d.points.map((p, i) => ({ id: String(i), p })));
  }

  /** Editor look of a path / zone: always visible (faint when hidden in game), with its name and, for paths, start and end. */
  private drawMap(e: PathEntity | ZoneEntity): Box {
    const r = this.renderer;
    const ctx = r.ctx;
    const z = this.camera.zoom;
    const pts = worldPoints(e);
    const alpha = e.visible ? 1 : 0.4;
    if (e.type === 'path') r.drawPath(pts, e.width, e.color, alpha);
    else r.drawZone(pts, e.color, alpha);
    const sp = pts.map((p) => project(this.view, p));
    if (e.type === 'path' && sp.length) {
      for (const [q, c] of [[sp[0], '#3fb950'], [sp[sp.length - 1], '#f85149']] as const) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6 / z, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
      }
    }
    const xs = sp.map((q) => q.x);
    const ys = sp.map((q) => q.y);
    const pad = e.type === 'path' ? e.width / 2 : 0;
    const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    ctx.save();
    ctx.font = `${12 / z}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const at = e.type === 'path' ? sp[0] : { x: box.x + 4 / z, y: box.y + 14 / z };
    ctx.fillText(`${e.type === 'path' ? '〰' : '⬠'} ${e.name}`, at.x + (e.type === 'path' ? 9 / z : 0), at.y - (e.type === 'path' ? 9 / z : 0));
    ctx.restore();
    return box;
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

  toggleDebug(): void {
    this.debug = !this.debug;
    try {
      localStorage.setItem(DEBUG_KEY, this.debug ? '1' : '');
    } catch {
      // A view preference; ignore storage failures.
    }
  }

  private loop = (t: number): void => {
    const frameMs = t - this.last;
    this.last = t;
    let simMs = 0;
    let scriptMs = 0;
    let steps = 0;
    const t0 = now();
    if (this.game?.restartRequested) {
      // Play again after "game over" / "you win": a fresh game from the same start.
      this.game = null;
      this.input.detach();
      Object.assign(this.camera, this.editCamera);
      this.play(true);
    }
    if (this.game) {
      this.game.frame(frameMs / 1000);
      simMs = now() - t0;
      ({ scriptMs, steps } = this.game.takeTimings());
    }
    const t1 = now();
    if (this.game) this.game.render(this.renderer, this, this.dpr);
    else {
      const level = this.store.level;
      const actor = this.store.actorScene;
      if (level) this.drawLevel(level);
      else if (actor) this.drawActorScene(actor);
    }
    const renderMs = now() - t1;
    this.stats.add({ frameMs, simMs, scriptMs, renderMs, steps });
    if (this.debug) this.stats.draw(this.renderer.ctx, this.dpr, this.width, this.game?.counts());
    requestAnimationFrame(this.loop);
  };

  private drawLevel(level: LevelScene): void {
    const r = this.renderer;
    r.view = level.view;
    r.begin(this, this.dpr, this.camera, level.background);
    r.drawGrid(level.gridSize, this.camera, this);

    this.hitboxes.clear();
    this.placed = inDrawOrder(expandLevel(this.store.project, level), (x) => entityOrderKey(level.view, x.e));
    // Placed levels (rooms, buildings) are outlined by the bounds of their contents.
    const rooms = new Map<string, Box>();
    for (const { e, owner, depth } of this.placed) {
      let box: Box | null = null;
      if (e.type === 'block') {
        r.drawBlock(e);
        if (depth) box = this.blockBox(e);
      } else if (isMap(e)) {
        box = this.drawMap(e);
        if (!depth) box = null;
      } else if (e.type === 'projectile') box = r.drawProjectileEntity(e);
      else box = this.drawInstance(e);
      if (box) this.hitboxes.set(e.id, box);
      if (depth && box) rooms.set(owner, union(rooms.get(owner), box));
    }
    for (const [id, box] of rooms) {
      this.hitboxes.set(id, box);
      this.drawRoomFrame(box, level.entities.find((x) => x.id === id)?.name ?? '');
    }
    if (this.drag?.kind === 'create') r.drawBlock(this.drag.preview, true);
    this.drawSelection();
    this.drawDrawing();
    const tool = this.store.tool;
    const hint =
      tool === 'path' || tool === 'zone'
        ? `${tool}: click to add points (double-click or Enter to finish${tool === 'zone' ? ', or click the first point' : ''}) · or press and drag to draw freehand · Backspace undoes a point · Esc cancels`
        : 'wheel zoom · right/middle drag pan · Alt = no snap · double-click an instance to edit its scene';
    this.drawHud(`${level.view}  ·  ${hint}`);
  }

  /** An actor instance as it starts: its initial form's look, initial state, scale and wobble. */
  private drawInstance(e: InstanceEntity): Box {
    const a = resolveInstance(this.store.project, e);
    if (!a) return this.drawMissing(e);
    const look = lookOf(this.store.project, a, a.form);
    const st = initialState(look);
    const body = worldBody(this.view, a, look.collider, st?.body ?? null, 1, look.scale);
    return this.renderer.drawActor(drawable(look, a.x, a.y), editorVisual(look, st, body, a.x));
  }

  private blockBox(e: BlockEntity): Box {
    const lift = this.view === 'isometric' ? Math.max(0, e.height) : 0;
    const pts = shapeOutline(e).map((p) => project(this.view, p));
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const pad = e.shape.kind === 'line' ? e.shape.thickness / 2 : 0;
    const minY = Math.min(...ys) - lift - pad;
    return { x: Math.min(...xs) - pad, y: minY, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) + pad - minY };
  }

  private drawRoomFrame(b: Box, name: string): void {
    const ctx = this.renderer.ctx;
    const z = this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(199,139,255,0.45)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect(b.x - 4 / z, b.y - 4 / z, b.w + 8 / z, b.h + 8 / z);
    ctx.fillStyle = 'rgba(199,139,255,0.8)';
    ctx.font = `${11 / z}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`▦ ${name}`, b.x - 4 / z, b.y - 8 / z);
    ctx.restore();
  }

  private drawMissing(p: Vec2): Box {
    const ctx = this.renderer.ctx;
    const q = project(this.view, p);
    ctx.strokeStyle = '#e5534b';
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.strokeRect(q.x - 12, q.y - 12, 24, 24);
    return { x: q.x - 12, y: q.y - 12, w: 24, h: 24 };
  }

  private drawActorScene(scene: ActorScene): void {
    const r = this.renderer;
    const ctx = r.ctx;
    const d = scene.actor;
    const view = scene.previewView;
    const z = this.camera.zoom;
    r.view = view;
    r.begin(this, this.dpr, this.camera, '#20242c');
    r.drawGrid(16, this.camera, this);

    // Ground reference (feet of the base collider) so the pivot and state bodies are easy to judge.
    const half = halfExtents(bodyShape(view, scaleShape(d.collider, d.scale)));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    if (view === 'side') {
      ctx.beginPath();
      ctx.moveTo(-400, half.y);
      ctx.lineTo(400, half.y);
      ctx.stroke();
    }
    ctx.restore();

    // Which animation to show: the selected state, else the initial state.
    const state = this.selectedState(scene);
    const edited = this.editedBody(scene);
    const wb = worldBody(view, { x: 0, y: 0 }, edited.body.shape, edited.state ? edited.body : null, 1, d.scale);
    r.drawActor(drawable(d, 0, 0), editorVisual(d, state, wb));

    // Collider (the state's own, or the shared body) + pivot.
    ctx.save();
    ctx.strokeStyle = edited.state ? '#c78bff' : COLLIDER_COLOR;
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 3 / z]);
    const col = shapeCollider(wb.shape, wb.x, wb.y);
    this.strokeWorld(col.type === 'poly' ? col.pts : shapeOutline({ x: wb.x, y: wb.y, rotation: 0, shape: { kind: 'circle', r: col.r } }), true);
    ctx.restore();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    ctx.moveTo(-6 / z, 0);
    ctx.lineTo(6 / z, 0);
    ctx.moveTo(0, -6 / z);
    ctx.lineTo(0, 6 / z);
    ctx.stroke();
    this.drawHandles(this.colliderHandles(scene));

    // Label.
    r.screen(this.dpr);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = ACCENT;
    ctx.fillText(state ? `State: ${state.name}   ·   animation: ${state.animation || '—'}` : '', 12, 22);
    ctx.fillStyle = edited.state ? '#c78bff' : COLLIDER_COLOR;
    ctx.fillText(edited.state ? `Collider: own collider of "${edited.state}"` : 'Collider: shared body collider', 12, 40);
    this.drawHud(`${view} preview  ·  corner handle resizes the collider, centre handle moves a state collider · ▶ Test to play it`);
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

  private drawHandles(handles: Handle[]): void {
    const ctx = this.renderer.ctx;
    const z = this.camera.zoom;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([]);
    const hs = HANDLE_PX / z;
    for (const hd of handles) {
      const q = project(this.view, hd.p);
      ctx.fillRect(q.x - hs / 2, q.y - hs / 2, hs, hs);
      ctx.strokeRect(q.x - hs / 2, q.y - hs / 2, hs, hs);
    }
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
    } else if (isMap(e)) {
      this.strokeWorld(worldPoints(e), e.type === 'zone');
    } else {
      const b = this.hitboxes.get(e.id);
      if (b) ctx.strokeRect(b.x - 2 / z, b.y - 2 / z, b.w + 4 / z, b.h + 4 / z);
    }

    const a = e.type === 'instance' ? resolveInstance(this.store.project, e) : null;
    if (a) {
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.strokeStyle = COLLIDER_COLOR;
      ctx.lineWidth = 1 / z;
      const look = lookOf(this.store.project, a, a.form);
      const b = worldBody(this.view, a, look.collider, initialState(look)?.body ?? null, 1, look.scale);
      const col = shapeCollider(b.shape, b.x, b.y);
      if (col.type === 'poly') this.strokeWorld(col.pts, true);
      else this.strokeWorld(shapeOutline({ x: b.x, y: b.y, rotation: 0, shape: { kind: 'circle', r: col.r } }), true);
    }
    ctx.restore();
    this.drawHandles(this.handlesOf(e));
  }

  private drawHud(hint: string): void {
    const ctx = this.renderer.ctx;
    this.renderer.screen(this.dpr);
    const w = this.toWorld(this.mouse);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(w.x)}, ${Math.round(w.y)}  ·  ${Math.round(this.camera.zoom * 100)}%  ·  ${hint}`, 10, this.height - 10);
  }
}

function union(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function readDebugPref(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}
