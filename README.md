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

## Features

- **Scenes** in three views: side view (gravity, jumping), top-down, and isometric.
  The world is always a flat plane, and isometric is only a projection, so you can switch a scene's view at any time.
- **Blocks:** rectangles (rotatable), circles, and lines. Each one can be solid or decorative, colored or textured, and given a wall height in isometric view.
- **Assets:** images (import or drag-drop), sprites (sheet grid + named animations, e.g. `0-3`),
  projectiles (speed, radius, lifetime, gravity, bounces, damage).
- **Characters:** player and NPC characters are the same kind of object. Keyboard input and AI brains both produce
  the same `Intent`. A player character with *AI takeover* > 0 is driven by its behavior after that many idle seconds, and
  any key hands control back.
- **Behaviors:** patrol, wander, chase & attack, or **TypeScript scripts** (transpiled in-browser with sucrase).
- **Editor:** tools (V/R/C/L/P/N/B), snapping (Alt bypasses), resize handles, undo/redo, duplicate (Ctrl+D),
  Play in viewport (F5 / Esc), run in a new tab, autosave to localStorage, JSON import/export.

## Layout

```
src/engine/      runtime, no DOM editor code
  types.ts       data model built from small interfaces (Positioned, Solid, Armed, Mortal…)
  runtime.ts     runtime state interfaces + RtCharacter
  game.ts        fixed-step simulation, physics resolution, projectiles, camera
  behaviors.ts   AI brains → Intent
  scripting.ts   script API interfaces (ScriptSelf, ScriptWorld…) + TS compiler
  collision.ts   SAT for convex polygons / circles / segments
  renderer.ts    Canvas 2D renderer shared by editor and game
src/editor/      editor UI; panels depend on narrow Store interfaces
src/player/      standalone runtime entry (play.html)
```

## Possible next steps

- Desktop builds via Tauri (the runtime needs no changes).
- Tilemaps, one-way platforms, character-vs-character collisions.
- Store assets in IndexedDB instead of localStorage (large images).
- Type-checking scripts in the editor (Monaco + the `ScriptSelf` / `ScriptWorld` typings).
