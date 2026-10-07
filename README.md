# Engine

A small 2D game engine + scene editor, web-first (TypeScript, Canvas 2D, Vite).
The runtime has no editor dependencies, so the same code can later be wrapped
for desktop (Tauri / Electron) or mobile.

```bash
npm install
npm run dev        # editor at http://localhost:5173, player at /play.html
npm test           # engine tests (collision, physics, AI takeover, scripting)
npm run build      # dist/index.html (editor) + dist/play.html (game)
```

**Ship a game:** Export the project from the editor, then put `project.json` next to
`dist/play.html` and host the folder.

## Concepts

**Everything is code.** The engine provides mechanics (physics, collisions, projectiles, drawing,
input, queries). It never decides what an actor does: that lives in the actor's TypeScript.

- **Level scenes** hold the world: blocks, placed projectiles, and **instances** of actor scenes.
  They can be viewed in side view, top-down, or isometric. The world is a flat plane, and isometric is only how it is drawn.
- **Levels compose**: a level can be placed in another level, so rooms (with their enemies) make buildings and
  buildings make worlds. At play time the contents are flattened into the outer level, moved by the instance position.
  Nested names become paths (`Outpost/Lab/Mine`) and the instance's tags are added to everything inside. A level can't contain itself.
- **Actor scenes** (Hero, Grunt, Mine, …) are edited in isolation. A character, an NPC and an interactive
  object are the same thing; only their script differs.
  - *Body & collider*: used by `moveAndSlide()`, `world.overlaps()` and projectile hits.
  - *Visual*: a sprite, or the collider shape filled with `self.color`.
  - *Script*: one TypeScript module:
    ```ts
    export const props = { speed: 120 };        // tunable per instance in the level
    export function init(self: Actor, world: World) {}
    export function update(self: Actor, world: World, dt: number) {}
    export function onHit(self: Actor, world: World, hit: Hit) {} // return false = pass through
    ```
  - *States*: data only (animation + optional own collider). Scripts switch with `self.setState('run')`.
  - *Size & effects*: `scale` (sprite and every collider), `trail` (afterimages), `wobble` (squash and stretch).
  - *Forms*: other actor scenes this actor can switch into with `self.setForm('big', seconds?)`. The actor is the
    container (controls, lives, logic); a form scene supplies the rest while it is active:
    - its look: sprite, states with their colliders, scale, effects;
    - its props, laid over the container's (`{ speed: 340 }` makes the container's own movement code faster);
    - its hooks, run on top of the container's: `init` on every switch in, `update` after the container's, and
      `onHit` before it (set `hit.damage = 0` for immunity, or return false to let the hit pass).

    `'base'` is the actor's own look. Growing keeps the feet on the floor. ▶ Test in a form scene runs it inside its container.
- `actor.damage(amount, from?)` delivers a hit through the target's `onHit` hooks (form first), so traps and touch attacks
  respect immunity just like projectiles.
- **Instances** override the script's exported props (↺ reverts). Editing the actor scene updates every instance.
- The demo shows that nothing is built in:
  - the Hero reads the keyboard, and after 5 idle seconds its own script wanders (AI takeover);
  - Grunts patrol and chase in code;
  - the Mine (built from **blocks**) kills every actor tagged in its `victims` prop (default `player, enemy`) on touch, and changes colour
    when one is near;
  - Pills put whoever takes them into a form: *Hero · Small* (0.6×, fast, trail) or *Hero · Big* (1.6×, slow, wobbly,
    immune, own sprite). The Hero script has no idea pills exist;
  - the Platformer contains *Building · Outpost*, which is made of *Room · Guard post* and *Room · Lab*;
  - *Elements* (top-down) is an interactions playground: the Walker pushes crates on the grid (two at a time, not three),
    and fire, water, cold and heat come only from ⚗ Interactions rules. The Walker's script just takes damage, and the
    Crate (built from blocks) burns down.

### Maps: paths and zones

Two kinds of map geometry, drawn in a level with **〰 Path** (P) and **⬠ Zone** (Z):

- Click to add points (snapped to the grid), double-click or Enter to finish (a zone also by clicking its first point),
  Backspace takes the last point back, Esc cancels. Or press and drag to draw freehand: the stroke is simplified to a few points.
  Selected, every point has a handle; double-click a handle to delete the point. Paths can be reversed in the inspector.
- A **path** (a road) is a named line. `self.followPath(name, speed)`, called every frame, walks the actor straight to the
  path's start, then along it, and returns true at the end (`self.pathDistance` says how far it got). It sets `vx / vy`,
  so `self.shootAt(projectile, target)` can aim ahead of it.
- A **zone** is a named area: `world.inZone(x, y, name)`. Several zones may share a name (all the places towers may be built).
- Blocks pick paths and zones by name; renaming one in the inspector renames it in every block program (as does renaming an actor scene for *spawn*).

### Game rules: spawning, game variables, mouse, the end

- `world.spawn(sceneName, x, y)` adds an actor scene at runtime (its `init` / *when I start* runs at once).
- `world.vars` are **game variables** shared by every actor (money, lives); `world.hud.watch(name)` keeps one on screen.
- `world.input.mouse` (world coordinates), `mouseDown`, `clicked`. A click / tap anywhere on the game counts.
- `world.endGame(won, message?)` freezes the game under a banner; Enter or a click plays again (`play.html` and the editor restart it).
- `world.popText(text, x, y, color)` floats text up ("+5"). Projectile assets have a **blast radius** (splash damage).
- Levels without a followed actor are fitted to the window by the standalone player.

### Interactions (optional module, hidden for now)

The editor hides this module (toolbar, kinds in inspectors, its blocks); projects keep the data and the engine still applies it.
Open the editor with `?modules=interactions` to show it. It will become a separate module rather than part of the core.

Deeper than "actor touches actor": the project describes **what things are** and the engine applies the rules
every step (⚗ Interactions in the toolbar). It borrows the idea of *Breath of the Wild*'s chemistry engine.

- **Kinds**: what something is (`creature`, `wood`, `crate`, `water`…). Actor scenes and level blocks pick their kinds
  in the inspector; `is()`, `world.find()` and `world.all()` match kinds like tags. A kind can be **solid** (blocks
  other actors and can be stood on), **pushable** with a **weight**, have a **strength**, and **give off elements**.
- **Elements**: what things give off (`fire`, `water`, `cold`, `heat`), to everything touching them or within a radius.
  A non-solid block with kinds is a **zone** (a pond, a fire pit, a snowfield). `world.emit(element, x, y, radius)`
  gives one off once (an explosion).
- **Statuses**: timed conditions (`burning`, `wet`, `chilled`, `exhausted`). A status can deal damage every few seconds
  (through `onHit`, with `hit.element` set, so scripts and forms can resist fire), give off elements itself (burning
  spreads fire), and **multiply props** while active (chilled: `speed ×0.5`). Every script that reads `props.speed` slows
  down without knowing why. Scripts use `addStatus` / `removeStatus` / `hasStatus` and the `onStatus` hook.
- **Reactions**: ordered rules `element reaches kind/status → add / remove status, particles`, with *stop* to skip later
  rules. The default library: fire sets creatures and wood burning (unless wet), water puts fire out and makes things wet,
  cold puts fire out and chills, heat dries and exhausts. Every new project starts with it; edit or reset it in the panel.
- **Grid pushing** (Sokoban-style): `self.gridMove(dx, dy, seconds?)` steps one cell of the level grid. Walking into
  pushable actors pushes the whole chain if its total weight ≤ the mover's strength and nothing solid is behind it.
  A `creature` (strength 2) pushes two crates (weight 1) but not three, and a boulder (weight 2) only on its own. In
  top-down / isometric levels, placed actors snap to cell centres.
- Blocks: the **Interact** category (step, start / stop a status, give off, "I am burning?") and the hats
  *when I start / stop ‹status›*.

### Mobile: touch controls, drawing in code, stub art

- **Touch controls**: on touch screens the player shows a floating joystick (it appears where the thumb lands on the
  left half) and buttons at the bottom right. They only feed the input: `world.input.stick` is the joystick
  (`{x, y}`, length ≤ 1), or arrows / WASD when it isn't touched, so the same script runs on desktop. The joystick
  also holds the arrow keys and each button holds a key (`isDown('Space')`), so keyboard-only scripts (Tanks) work
  on a phone unchanged. Layout per project: `project.touch = { buttons: [{ key: 'Space', label: 'A' }, { key: 'KeyJ' }] }`
  (`show: 'auto' | 'always' | 'never'`, `stick`, `arrows`). Add `?touch` to the URL to see and use them with a mouse.
- **Drawing in code**: three optional hooks get `g`, a canvas-like `Graphics`:
  `drawUnder(self, world, g)` (behind the sprite) and `draw` (in front) draw in world units with the origin at the actor;
  `drawHud` draws in screen pixels (`world.hud.width / height`). Paths (`moveTo`, `lineTo`, `quadraticCurveTo`,
  `bezierCurveTo`, `arc`, `ellipse`, `rect`, `roundRect` → `fill` / `stroke`), shapes (`circle`, `rectangle`, `oval`,
  `line`, `polygon`, `regular` incl. stars, `smooth` closed curves, `text`), styles
  `{ fill, stroke, width, alpha, glow, dash, blend: 'add' }`, gradients (`g.radial`, `g.linear`) and colour helpers
  (`g.mix(a, b, t)`, `g.rgba`, `g.hsl`). Hooks run once per rendered frame and should only draw. Forms' draw hooks
  run after the container's.
- **Stub art** (`stubSprite(name, { kind, size, color, label, seed })`): generated SVG placeholders, always the same
  for the same name and different between names. Creatures come with the default state animations (idle, run, jump,
  fall, attack, hurt, dead); items bob; tiles work as block textures; props are crates, rocks, trees…
  In the editor: actor → *Visual* → 🎲 creature / item / prop / tile (clicking again draws the next variant). Swap the
  image for real art later; the sprite and animations stay.
- **Aura demo** (`aura.html`, or **Aura** in the editor): a top-down arena where every look is a stub. The hero's aura
  is drawn by its script: its size follows power (orbs), its colour goes from green to red with health, and its shape
  goes from a ring to a wavy blob to a spinning star. A pulses, B dashes. The health and power bars are `drawHud`.

## Working together: the sync server

One server hosts many projects for a group (a class, a club, friends). Each person gets a **personal link**, and each project
is a **git repository** on the server. Everyone works on the latest version; nothing is ever lost.

```bash
npm run build                                   # editor + server (dist/, dist-server/server.js)
npm run server -- user add "Ana"                # prints Ana's personal link
npm run server -- project add "Tower Defence" --template td   # or --from project.zip, --members ana,ben
npm run server -- serve --url https://games.example.org       # --port, --data (default ./data)
```

Or with Docker: `docker run -d -p 8080:8080 -v game-engine-data:/data -e PUBLIC_URL=… game-engine`, then
`docker exec <container> engine-server user add "Ana"`. The server needs Node 22+ and `git`. People and links
are kept in `data/instance.json`, and projects in `data/projects/<slug>.git`.

- **Personal links** (`/k/<token>`) sign people in, with no accounts or passwords. `user reset <id>` replaces a lost link,
  and `project members <slug> ana,ben` limits a project to some people (by default everyone on the server is in it).
- The **home page** lists your projects. Start a new one from a template, open it at `/p/<slug>/`, or play its latest
  version at `/p/<slug>/play.html`.
- In a shared project the toolbar shows **⬆ Save** and **⬇ Get latest** instead of New / Import:
  - *Save* asks what you changed and who helped. Helpers become `Co-authored-by` in the commit. Your changes are merged
    into the latest version, which becomes a new version (a commit on `main`).
  - *Get latest* merges what others saved into your copy and keeps your unsaved changes. The button lights up when
    someone has saved.
  - *🕘 History* lists every saved version: who saved it (and who helped), when, and what it touched. **▶ Play** runs
    that version (`play.html?v=<version>`). **↩ Undo** takes back what one save changed and keeps everything saved after
    it, asking if later saves changed the same things. **⟲ Go back** makes the project exactly like an old version again.
    Both create a new version, so nothing is lost.
- **Who is where**: every few seconds each editor tells the server which scene it has open and which scenes it changed
  without saving. In the Scenes list and the tabs, a coloured initial shows who is in a scene (with ✎ for unsaved
  changes there). The active tab warns when someone else is changing the same scene.
- **⚑ I'm working on this** (right-click a scene or its tab) claims a scene, e.g. "Ana does the Yellow enemy, Ben the
  towers". Claims are soft locks: everyone sees them and gets a warning in that scene, but nobody is blocked, and anyone can
  take over or clear a claim (a kid who went home doesn't hold things up). They last until released, and are kept in
  `data/projects/<slug>.claims.json`.
  - Unsaved work stays in your browser, with the version it started from, until you save.
- **Merging** (`src/collab/merge.ts`) understands the project: scenes, entities, assets and blocks are matched by id, and
  states, variables and kinds by name. Two people editing different things, or different fields of the same thing,
  never clash. Scripts merge line by line, like git. Block actors' scripts are rebuilt from the merged blocks.
- A **clash** is the same thing changed differently by two people (the same colour, the same script lines, the same
  image, or something deleted by one and changed by the other). The editor shows both and you pick one.
- **Nobody breaks the game for everyone**: a save whose scripts don't compile is refused, with the errors shown. The
  server only parses scripts and never runs them.
- Development: run the server on :8080 and `npm run dev`, which forwards `/api`, `/k/` and `project.json` to it
  (`SYNC_SERVER=` for another address), then open your link and `/p/<slug>/` on the dev server.

## Course 1: Tower Defence (blocks only)

`td.html` (or **Tower Defence** in the editor) is the first project of a game development course for kids: every actor is
made of blocks and drawn as a plain coloured dot (`src/games/td/project.ts`; the lessons are in `docs/course-1-tower-defence.md`).

- *Map*: a top-down level with the path **Road** and five zones named **Build**.
- *Yellow* / *Red* enemies: props health, speed, reward. *when I start → follow path Road → change game lives by −1 → remove*.
  Hit: lose health; at 0 the coin is collected at once (*change game money by reward*, a "+5" pops up).
- *Green* / *Blue* towers (heroes): props range and reload; they show their range and shoot white dots (*Bullet*, or *Bomb*
  with a blast radius) at the nearest enemy in range.
- *Spawner*: the waves are timer hats, *every 2.5 seconds, from second 0 to 60 → spawn Yellow here*, then faster with reds;
  *when game time reaches 180 seconds → win the game*.
- *Base* keeps the game variable lives (*when lives < 1 → game over*); the invisible *Shop* keeps money: keys 1 / 2 choose
  a tower, a click on a Build zone that isn't taken and is affordable builds it on the grid.

## Example game: Tanks

`tanks.html` (or the **Tanks** button in the editor) is a Battle City–style game built only from engine features:
a top-down level plus actor scenes whose TypeScript does everything (`src/games/tanks/`). Defend the eagle and
destroy 20 enemy tanks per stage; arrows/WASD move, Space/J fire, P pause, Enter restarts.

- *Director* (invisible): score, lives, the enemy queue, stage flow. Other actors talk to it through its `data`,
  and it restarts a stage by bumping `data.round` (every actor then resets itself).
- *Player* / *Enemy* tanks share grid movement; anything that publishes `data.block` (bricks, steel, water, tanks,
  the base) stops them. Enemy types (*fast*, *power*, *armor*) and the player's spawn shield are **forms**.
- *Brick* clears a tank-wide strip when shot, *Steel* only breaks under heavy shells, *Water* stops tanks but not shells.
- Blinking enemies drop a *Bonus*: helmet (shield), star (better shells), grenade, extra tank, clock (freeze).
- Sprites are drawn on canvases at startup, so the game needs no image files.

## Editor

- Scene tabs (like Godot): every scene opens in its own tab above the viewport. Each tab keeps its own **undo history**,
  selection and camera, so undo in one scene never reverts another. Project-wide changes (assets, adding or removing scenes)
  go to a shared history that any tab can undo. Middle-click or × closes a tab.
- Scenes dock: open scenes, create a level or actor, drag an actor into a level (or use *Place actor…*).
  Double-click an instance to open its scene. The Scene tree can group children by type (⊞: one group per actor scene,
  then blocks and projectiles) and sort them by name (A–Z); both are view-only.
- Script workspace: selecting *Script* opens a full code editor over the viewport, with syntax colours (the scheme is the
  `--tk-*` CSS variables in `src/editor/style.css`). It shows live compile errors with the
  line highlighted, and has an API reference panel. Ctrl+S saves, and F5 saves and tests.
- **Script or blocks**: *+ Actor ▾* asks how the new actor is programmed: TypeScript, or Scratch-like **blocks**
  (new forms follow their container). A block actor can be converted to code later, but code never turns back into blocks.
  Drag blocks from the palette (Events, Motion, Looks, Actions, Control, Sensing, Operators, Variables) into stacks, C-block mouths and slots;
  drop them back on the palette to delete them. Right-click a block to duplicate or delete it, or the empty canvas to clean
  up. Drag the empty canvas to scroll.
  - The blocks compile to an ordinary TypeScript script (see the *Code* tab), so the engine and `play.html` know nothing
    about them. *Convert to code* keeps that TypeScript and drops the blocks (Undo brings them back).
  - Scratch's timing: every hat (*when I start*, *every N seconds from second A to B*, *when the mouse is clicked*, *when key pressed*, *when ‹condition› becomes true*,
    *when I get hit*) starts a script that runs as a thread. `wait` pauses it, loops take one pass per frame, and
    several scripts run side by side. *for each other actor tagged* runs all its passes in one frame.
  - *Variables* live in `self.data` (other actors, including code ones, can read them); *game* variables (+ Variable ▾ →
    for the whole game) in `world.vars`, shared by every actor, with a checkbox to show them on screen. *Props* are the exported
    `props`: tunable per instance and overridden by forms.
  - The **Game** category: spawn an actor (here, at the mouse, on the grid), pop-up text, game over, win.
  - Adding a block means adding one entry (look, slots and generated code) in `src/editor/blocks/catalog.ts`.
- Actor view: shows the actor alone, plays the selected state's animation, and lets you drag the collider handles.
  **▶ Test** runs it in a sandbox level.
- Level tools: V select, R rect, C circle, L line, B projectile, with snapping (Alt bypasses) and resize handles.
- Undo/redo, duplicate (Ctrl+D), Play (F5 / Esc), run the level in a new tab, autosave, JSON import/export.
- **Project folder** (Export ▾ → *Project folder (.zip)*, Import takes it back): the project as text files for git,
  one per level, actor (`actor.json`, `script.ts`, `blocks.json`) and asset, with images as real image files.
  Keys are sorted and the layout is fixed, so a change shows up as a small diff. Ids live inside the files, and
  file names follow scene names (`src/engine/files.ts`). This is the format the shared repository for kids will use.
- Debug overlay (🐞 or F3, also in `play.html`, or `play.html?debug`): FPS, frame time, and how each frame splits into
  simulation (with the scripts' share), render and idle, plus a graph of the last 120 frames against the 60 fps budget.
- Assets: images, sprites (sheet grid + named animations like `0-3`), projectiles (fired by name: `self.shoot('Bolt', dx, dy)`).

## Layout

```
src/engine/      runtime, no DOM editor code
  types.ts       data model built from small interfaces (Positioned, Solid, Armed, Mortal…)
  scripting.ts   script API (Actor, World, Hit… as small interfaces), TS module compiler + cache
  runtime.ts     RtActor (implements Actor), colliders per view/state
  game.ts        fixed-step loop running script hooks; physics, projectiles, queries (implements World)
  prefabs.ts     instance resolution, sandbox level for testing
  states.ts      current state holder (data only)
  collision.ts   SAT for convex polygons / circles / segments
  interactions.ts kinds, statuses, emissions, reactions (the "chemistry"), default library
  grid.ts        grid movement and chain pushing
  renderer.ts    Canvas 2D renderer shared by editor and game
  graphics.ts    Graphics API for the scripts' draw hooks, colour helpers
  touch.ts       on-screen joystick + buttons (feed an Input)
  stubs.ts       placeholder sprite generator (SVG)
src/editor/      editor UI; panels depend on narrow Store interfaces
  blocks/        block editor: catalog (block definitions), codegen (blocks → TS), workspace (drag & drop UI)
src/player/      standalone runtime entry (play.html); run.ts is the shared frame loop
src/games/tanks/ example game: project builder, actor scripts, sprites (tanks.html)
```

## Possible next steps

- Desktop builds via Tauri (the runtime needs no changes).
- Projectiles as scenes; forms layered on top of each other (stacking buffs).
- Monaco editor with real type-checking and autocomplete against the `Actor` / `World` typings.
- Actor-to-actor events (onTouch / signals).
- Interactions: statuses on blocks (a wooden bridge that burns), transformations (water freezes into ice),
  continuous (non-grid) pushing for platformers.
- Tilemaps, one-way platforms.
- Store assets in IndexedDB instead of localStorage (large images).

## License

[MIT](LICENSE)
