# Course 1: Tower Defence

A first game, made only of blocks and coloured dots. Every lesson ends with something that plays.
The finished game is the **Tower Defence** project in the editor (and `td.html`); open it to compare.

Start with **New**, then set the level *Main* to **Top-down** and rename it *Map*.
New actors: **+ Actor ▾ → ▦ Blocks actor**. An actor without a picture is drawn as its collider
(*Body & collider* → Circle, radius) filled with its colour (*Visual* → Color).

## Lesson 1: dots

1. Make the actors *Yellow* (enemy, radius 8, yellow) and *Green* (tower, radius 12, green).
   Give them tags: `enemy` and `tower`.
2. Place one of each in the Map (drag from the Scenes dock), press ▶ Play. Nothing moves yet, and that's fine.

## Lesson 2: the road

1. Pick **〰 Path** (P). Click along the map to set the road's corners; double-click to finish.
   (Or press and drag to draw it freehand.) Name it *Road* in the inspector. The green dot is where it starts.
2. Yellow: *when I start → follow path Road at speed 60*. Play: the dot walks to the start of the road, then along it.
3. Add **+ Prop** `speed` and use it in the block, then change it per instance in the level.

## Lesson 3: towers shoot

1. **+ Projectile** in Assets: *Bullet*, white, radius 3, speed 400.
2. Green: **+ Prop** `range` (110) and `reload` (0.4).
   *when I start → show range circle (range) → forever { shoot Bullet at (nearest actor tagged enemy within (range)) · wait (reload) }*.
3. Yellow: **+ Prop** `health` (3). *when I start → set health to (health)*;
   *when I get hit → change health by (0 − hit damage) → if health < 1 then remove from level*.

## Lesson 4: waves

1. An actor *Spawner* (grey), placed just before the start of the road.
2. *every 2.5 seconds, from second 0 to 60 → spawn Yellow here.* Play.
3. Make it harder: another timer hat *every 1.5 seconds, from second 60 to 120*, a second enemy *Red*
   (bigger, slower, more health) with its own timer. Stack timers like stages of the game.

## Lesson 5: lives and the base

1. An actor *Base* (white) at the end of the road. **+ Variable ▾ → for the whole game**: `lives` = 10, shown on screen.
2. Base: *when (lives < 1) becomes true → game over*.
3. Yellow / Red, after *follow path*: *change game lives by −1 → remove from level*.
4. Spawner: *when game time reaches 180 seconds → win the game*.

## Lesson 6: money and building

1. Enemies drop a coin that is collected at once: **+ Prop** `reward`; when health < 1:
   *change game money by (reward) → pop up text (join + reward) here*.
2. Pick **⬠ Zone** (Z) and draw the places where towers may stand; name each one *Build*.
3. An actor *Shop* (hidden with *hide*): game variable `money` = 100, shown on screen.
   *when the mouse is clicked → if (mouse in zone Build) and not (actor tagged tower within 24 of the mouse)
   and (money ≥ 50) → spawn Green at the mouse, on the grid → change game money by −50*.
4. Extra: a second tower *Blue* that shoots a *Bomb* (projectile with a blast radius), chosen with keys 1 / 2.

## Ideas to go further

- A hero that walks with *move with arrow keys at speed 150* and *stay inside zone Hero area*.
- Towers that get faster (*change reload*) when money is spent on them.
- Next course: the same game with pictures (assets) instead of dots.
