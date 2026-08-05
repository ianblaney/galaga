# GALAGA

A Galaga-style formation shooter, rendered at the original arcade resolution
(224×288) on a plain 2D canvas. No game engine, no sprite assets, no runtime
dependencies — the sprites, font, sound and flight paths are all generated in
code.

```bash
npm install
npm run dev
```

## Controls

| Input | Action |
| --- | --- |
| `←` `→` / `A` `D` | Move |
| `SPACE` | Fire (also starts the game) |
| `P` | Pause |
| `M` | Mute |

### Touch

On coarse-pointer devices the game switches to touch controls automatically.

- **Slide a finger along the strip below the playfield.** Where your thumb sits
  on the strip is where the ship sits on the screen, end to end. Lift off and
  the ship holds station.
- **Firing is automatic.** There is no fire button, so there is nothing to hold
  and nothing to cover the screen with.
- Nothing on the playfield itself is a control — a thumb there would hide the
  dive you are trying to read. Tapping it only starts a game.
- Pause and mute sit off to the side, small, out of the way of a flying thumb.
- The playfield scales to fit the phone rather than snapping to whole pixels,
  so it fills the screen instead of wasting a third of it.
- A mouse never takes over steering, so desktop play is unchanged.

## What's implemented

**Formation entries.** Each stage sends five flights of eight along looping
entry paths before they settle into a 40-slot formation that sways and breathes
— faster and wider as its ranks thin out.

**Dive attacks.** An attack director pulls enemies out of formation on curved
dive paths. Bosses bring butterfly escorts. Anything that flies off the bottom
re-enters from the top and flies back to its slot.

**Tractor beam capture.** A boss Galaga occasionally breaks formation, hovers
above you and opens a tractor beam. Get caught and you lose a ship — it's towed
up and docked beneath the boss.

**Dual fighter.** Shoot that boss down *while it is diving* and your captured
fighter is freed; it flies back and docks alongside you for double width and
double firepower. Kill the boss while it sits in formation and the captive dies
with it — same as the arcade.

**Challenging stages.** Every fourth stage is a bonus round: 40 enemies trace
flight patterns without shooting. Hit all of them for a 10,000 point perfect
bonus.

**Scoring.** Enemies are worth double when diving. A boss is worth 400 diving
alone, 800 with one surviving escort, 1,600 with two. Extra ship at 20,000 and
every 70,000 after.

## Layout

| File | Role |
| --- | --- |
| `src/game.js` | Game state machine, entities, collisions, rendering |
| `src/paths.js` | Flight-path builder (`line`/`turn` pen) and the path library |
| `src/sprites.js` | Pixel-art sprites and the 5×7 bitmap font |
| `src/stars.js` | Blinking parallax starfield |
| `src/audio.js` | Synthesised WebAudio effects |

Flight paths are built by driving a pen — `line(d)` and `turn(radius, degrees)`
— which samples a point every 2px. Followers then walk the sample list at a
constant speed and read their sprite rotation from consecutive points.

## Testing

The game is exposed as `window.game`, which the headless tools drive directly.

```bash
npm run playtest            # bot plays for 70s, reports state + console errors
npm run playtest -- 200 god # longer run, lives topped up to reach later stages
npm run test:capture        # asserts the capture -> rescue -> dual chain
npm run test:touch          # touch controls + layout on phone viewports
```

Both write screenshots to `tools/shots/`. `playtest` also writes a
per-second `timeline.json`, which is how the stalled-dive bug below was found.

### Bugs these caught

- Dive paths that happened to end above the bottom edge left enemies frozen
  in place forever, so a stage could never be completed. Dives now re-enter on
  path exhaustion as well as on leaving the screen.
- The game-over screen went blank once its banner timed out, with no prompt and
  enemies frozen mid-swoop.
