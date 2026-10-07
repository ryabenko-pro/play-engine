import { findActorScene } from '../../engine/prefabs';
import type { ActorScene, BlockProgram } from '../../engine/types';
import { clone } from '../../engine/util';
import { setBlocks } from '../blocks/codegen';
import { BlockWorkspace, type MenuContext } from '../blocks/workspace';
import type { Observable, PlayState, ProjectReader, ProjectWriter, ScriptCompiler, SelectionModel } from '../store';
import { highlightHtml } from '../highlight';
import { h } from '../ui';

export type ScriptEditorStore = Observable & ProjectReader & ProjectWriter & SelectionModel & PlayState & ScriptCompiler;

export interface TestRunner {
  togglePlay(): void;
}

export const API_REFERENCE = `// Module hooks (all optional)
export const props = { … }          // tunable per instance
export function init(self, world)
export function update(self, world, dt)
export function onHit(self, world, hit)  // return false = pass through
                                         // no onHit = projectiles ignore you
export function onStatus(self, world, status, added)
export function drawUnder(self, world, g) // behind sprite
export function draw(self, world, g)      // over sprite
export function drawHud(self, world, g)   // screen px
// In a form scene the same hooks run on top of the
// container's: init on every switch in, update after,
// onHit before (set hit.damage = 0 → immune).
// Its props are laid over the container's props.

// self: Actor
id name tags kinds is(tagOrKind)
x y spawnX spawnY
vx vy grounded hitWall moveAndSlide()
color facing visible flash(seconds)
state stateTime animationLength setState(name)
health alive kill() revive() destroy()
shoot(projectileName, dirX, dirY)
damage(amount, from?)   // runs onHit hooks; false = ignored
form formTime formLeft scale
setForm(name, seconds?) // 'base' = own look
statuses hasStatus(s) statusLeft(s)
addStatus(s, seconds?) removeStatus(s)
gridMove(dx, dy, seconds?) moving
  // one grid cell; pushes chains ≤ strength
props data  // props include status modifiers

// world: World
time view gravity bottom gridSize
input.isDown(...codes) input.pressed(...codes)
input.idleTime
input.stick       // {x, y}: touch joystick or arrows/WASD
find(tag) all(tag?) nearest(from, tag?)
distance(a, b) overlaps(a, b) groundAhead(a, dir)
burst(x, y, color, count?) log(...args)
emit(element, x, y, radius)  // e.g. an explosion
camera.follow(actor) camera.zoom
hud.text(text, x, y, color?)   // y < 0: from bottom
hud.width hud.height           // screen px

// g: Graphics (draw hooks; origin at the actor)
circle(x, y, r, style) oval(x, y, rx, ry, style)
rectangle(x, y, w, h, style, radius?)
line(x1, y1, x2, y2, style) polygon(points, style)
regular(x, y, r, sides, style, rot?, inner?) // star
smooth(points, style)  // closed curve through them
text(str, x, y, {fill, size, align, bold})
beginPath() moveTo lineTo quadraticCurveTo
bezierCurveTo arc arcTo ellipse rect roundRect
closePath() fill(style) stroke(style, width?)
save() restore() translate rotate scale alpha(a)
// style: '#f80' or { fill, stroke, width, alpha,
//   glow, glowColor, dash, blend: 'add' | … }
radial(x, y, r, [[0, c1], [1, c2]]) linear(…)
mix(a, b, t) rgba(c, a) hsl(h, s, l, a?)

// hit: Hit
damage from x y element  // element: from a status

// world: game
vars            // game variables, shared by every actor
spawn(sceneName, x, y)  // → Actor | null; its init runs now
endGame(won, message?) ended   // banner; Enter/click replays
path(name) → { points, length } | null
inZone(x, y, zoneName)
popText(text, x, y, color?)    // floats up, fades
input.mouse {x, y}  input.mouseDown  input.clicked
hud.watch(varName)  // shows world.vars[name]

// self: paths & aiming
followPath(pathName, speed) // call every frame; true at end
pathDistance
shootAt(projectileName, target, aimAhead = true)

// Key codes: 'ArrowLeft' 'KeyA' 'Space' 'KeyJ' …
// Tip: const p = self.props as typeof props;`;

/** Line number of a sucrase error like "Unexpected token (12:4)". */
function errorLine(msg: string): number | null {
  const m = /\((\d+):\d+\)/.exec(msg);
  return m ? Number(m[1]) : null;
}

/** Stores a block program and the script generated from it, as one undo step. */
export function saveBlocks(store: ProjectWriter, sceneId: string, prog: BlockProgram): void {
  store.commit((p) => {
    const s = findActorScene(p, sceneId);
    if (s) setBlocks(s, clone(prog));
  });
}

function menuContext(store: ProjectReader, scene: ActorScene): MenuContext {
  const p = store.project;
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const named = (type: 'path' | 'zone') => uniq(p.scenes.flatMap((s) => (s.kind === 'level' ? s.entities.filter((e) => e.type === type).map((e) => e.name) : [])));
  return {
    states: scene.actor.states.map((s) => s.name),
    forms: scene.actor.forms.map((f) => f.name),
    projectiles: p.assets.filter((a) => a.type === 'projectile').map((a) => a.name),
    statuses: p.interactions?.statuses.map((s) => s.name) ?? [],
    elements: p.interactions?.elements ?? [],
    kinds: p.interactions?.kinds.map((k) => k.name) ?? [],
    scenes: uniq(p.scenes.filter((s) => s.kind === 'actor').map((s) => s.name)),
    paths: named('path'),
    zones: named('zone'),
    globals: uniq(p.scenes.flatMap((s) => (s.kind === 'actor' && s.id !== scene.id ? (s.actor.blocks?.vars ?? []).filter((v) => v.global).map((v) => v.name) : []))),
  };
}

/**
 * Full-size editor for the open actor scene's behaviour, over the viewport; shown
 * while the Script part is selected (hidden during play). Code actors get the
 * TypeScript editor; block actors get the block workspace, with the generated
 * code viewable (read-only) in the Code tab. Blocks can be converted to code,
 * never the other way round (the kind is chosen when the actor is created).
 */
export function mountScriptEditor(host: HTMLElement, store: ScriptEditorStore, runner: TestRunner): void {
  const gutter = h('div', { class: 'gutter' });
  const code = h('textarea', { class: 'code', spellcheck: false, wrap: 'off' });
  // Coloured copy of the code drawn behind the (transparent-text) textarea.
  const colors = h('pre', { class: 'code-colors', 'aria-hidden': 'true' });
  const status = h('span', { class: 'status' });
  const title = h('strong', {});
  const api = h('pre', { class: 'api-ref' }, API_REFERENCE);
  const apiToggle = h('button', { class: 'small', title: 'Show / hide the API reference' }, 'API');
  const kind = h('span', { class: 'scene-kind char' });
  const blocksTab = h('button', { class: 'small', title: 'Edit the blocks', onClick: () => setView('blocks') }, 'Blocks');
  const codeTab = h('button', { class: 'small', title: 'The TypeScript generated from the blocks (read-only)', onClick: () => setView('code') }, 'Code');
  const tabs = h('span', { class: 'se-tabs' }, blocksTab, codeTab);
  const toCode = h('button', { class: 'small', title: 'Keep the generated TypeScript and edit it as code from now on', onClick: () => convertToCode() }, '{ } Convert to code');
  const saveBtn = h('button', { class: 'small', title: 'Save (Ctrl+S)', onClick: () => save() }, 'Save');
  const codeBody = h('div', { class: 'se-body' }, gutter, h('div', { class: 'code-wrap' }, colors, code), api);
  const workspace = new BlockWorkspace((prog) => {
    if (!sceneId) return;
    savedBlocks = JSON.stringify(prog);
    saveBlocks(store, sceneId, prog);
  });
  const root = h(
    'div',
    { class: 'script-editor', hidden: true },
    h('div', { class: 'se-header' },
      kind, title, tabs, status,
      h('span', { class: 'spacer' }),
      toCode, apiToggle, saveBtn,
      h('button', { class: 'small play', title: 'Save and test (F5)', onClick: () => (save(), runner.togglePlay()) }, '▶ Test'),
    ),
    codeBody,
    workspace.el,
  );
  host.append(root);

  let sceneId: string | null = null;
  let saved = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Blocks + menus last shown in the workspace, to reload only on outside changes (undo…). */
  let savedBlocks = '';
  let shownMenus = '';
  let view: 'blocks' | 'code' = 'blocks';

  const setView = (v: typeof view) => {
    view = v;
    sync();
  };

  const convertToCode = () => {
    const actor = store.actorScene;
    if (!actor || !confirm(`Convert "${actor.name}" to code? The blocks are removed and you keep editing the generated TypeScript (Undo brings the blocks back).`)) return;
    store.commit((p) => {
      const s = findActorScene(p, actor.id);
      if (s) delete s.actor.blocks;
    });
    view = 'blocks';
  };

  apiToggle.addEventListener('click', () => api.toggleAttribute('hidden'));

  const dirty = () => code.value !== saved;

  const renderColors = () => {
    colors.innerHTML = highlightHtml(code.value);
    syncScroll();
  };

  const syncScroll = () => {
    colors.scrollTop = code.scrollTop;
    colors.scrollLeft = code.scrollLeft;
    gutter.scrollTop = code.scrollTop;
  };

  const renderGutter = () => {
    const lines = code.value.split('\n').length;
    const err = store.scripts.get(code.value);
    const bad = err.ok ? null : errorLine(err.error);
    gutter.replaceChildren(...Array.from({ length: lines }, (_, i) => h('div', { class: i + 1 === bad ? 'bad' : '' }, String(i + 1))));
    gutter.scrollTop = code.scrollTop;
  };

  const renderStatus = () => {
    const r = store.scripts.get(code.value);
    status.className = `status ${r.ok ? 'ok' : 'err'}`;
    status.textContent = (r.ok ? '✓ compiles' : `✕ ${r.error}`) + (dirty() ? '  · unsaved' : '');
  };

  const save = () => {
    if (!sceneId || !dirty() || code.readOnly) return;
    const id = sceneId;
    const src = code.value;
    saved = src;
    store.commit((p) => {
      const s = findActorScene(p, id);
      if (s) s.actor.script = src;
    });
    renderStatus();
  };

  const load = (id: string, source: string) => {
    sceneId = id;
    saved = source;
    code.value = source;
    renderColors();
    renderGutter();
    renderStatus();
  };

  const sync = () => {
    const actor = store.actorScene;
    const visible = !!actor && store.selection?.kind === 'part' && store.selection.id === 'script' && !store.playing;
    if (!visible) {
      if (!root.hidden) save();
      root.hidden = true;
      return;
    }
    title.textContent = actor.name;
    const switched = actor.id !== sceneId;
    const blocks = actor.actor.blocks;
    const showBlocks = !!blocks && view === 'blocks';
    kind.textContent = blocks ? '▦ Blocks' : '{ } Script';
    tabs.hidden = !blocks;
    blocksTab.classList.toggle('active', showBlocks);
    codeTab.classList.toggle('active', !!blocks && !showBlocks);
    toCode.hidden = !blocks;
    apiToggle.hidden = showBlocks;
    saveBtn.hidden = !!blocks;
    codeBody.hidden = showBlocks;
    workspace.el.hidden = !showBlocks;
    code.readOnly = !!blocks;

    if (blocks) {
      const json = JSON.stringify(blocks);
      const menus = JSON.stringify(menuContext(store, actor));
      if (switched || json !== savedBlocks || menus !== shownMenus) {
        savedBlocks = json;
        shownMenus = menus;
        workspace.load(clone(blocks), JSON.parse(menus) as MenuContext);
      }
    }
    // Reload unless the user has unsaved edits of this same scene (generated code always reloads).
    if (switched || (actor.actor.script !== saved && (!dirty() || blocks))) load(actor.id, actor.actor.script);
    const wasHidden = root.hidden;
    root.hidden = false;
    if (wasHidden && !showBlocks) code.focus();
  };

  code.addEventListener('input', () => {
    renderColors();
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderGutter();
      renderStatus();
    }, 250);
    if (gutter.childElementCount !== code.value.split('\n').length) renderGutter();
  });
  code.addEventListener('scroll', syncScroll);
  code.addEventListener('blur', save);
  code.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (code.readOnly && !ctrl && (e.key === 'Tab' || e.key === 'Enter')) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
    } else if (e.key === 'Enter' && !ctrl) {
      // Keep the current line's indentation.
      e.preventDefault();
      const before = code.value.slice(0, code.selectionStart);
      const indent = /[ \t]*/.exec(before.slice(before.lastIndexOf('\n') + 1))![0];
      const extra = /[{([]\s*$/.test(before) ? '  ' : '';
      code.setRangeText('\n' + indent + extra, code.selectionStart, code.selectionEnd, 'end');
      code.dispatchEvent(new Event('input'));
    } else if (ctrl && e.code === 'KeyS') {
      e.preventDefault();
      save();
    } else if (e.code === 'F5' || (ctrl && e.code === 'Enter')) {
      e.preventDefault();
      save();
      runner.togglePlay();
    }
  });

  store.subscribe((reason) => {
    if (reason === 'change' || reason === 'selection' || reason === 'play') sync();
  });
  sync();
}
