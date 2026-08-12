# GALAGA

A Galaga-style formation shooter, played from the cockpit. The formation hangs
off in space ahead of you, dives come down the tunnel at your canopy, and the
tractor beam opens directly overhead. Everything is generated in code — the
sprites, font, sound, flight paths, ships, cockpit and nebula. No art assets.

```bash
npm install
npm run dev
```

The simulation underneath is the original one, still running in 224×288 arcade
pixels. `?flat` renders it that way, top-down on a plain 2D canvas, which is
also the automatic fallback if the browser has no WebGL.

## Controls

| Input | Action |
| --- | --- |
| `←` `→` / `A` `D` | Fly |
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
- **The control column in the cockpit moves with your thumb.** It reads how the
  ship actually moved rather than which input moved it, so the slide strip, the
  arrow keys and the headless bot all deflect it without any of them knowing
  the cockpit exists.

## The cockpit view

The 3D view is a *renderer*, not a rewrite. `game.js` still simulates the whole
thing in arcade pixels and knows nothing about any of it; `render3d/view3d.js`
reads its entities every frame and places geometry. So the formation entries,
the attack director, the tractor beam and the dual fighter are all the same
code that ran the cabinet version.

The mapping is the whole idea:

| Arcade | Cockpit |
| --- | --- |
| `x` | lateral offset — left stays left |
| `y` | how far up the windscreen, *and* how far away |

The catch is that those cannot be one flat plane. A plane containing the eye
projects to a single line, and the first cut of this drew all five formation
rows stacked exactly on top of each other. So a row gets an **elevation** and a
**distance** as separate functions of `y`: the top of the playfield sits high
and far, the player's own row sits on the coaming at arm's length, and the rows
in between spread across the glass the way they spread down the cabinet screen.
A dive therefore descends *and* closes, and a shot fired straight ahead still
hits whatever was directly above you.

Two things follow from losing the cabinet's top-down view, and both are handled
on the panel rather than by bending the simulation:

- **The tactical scope** on the left is the whole playfield, top-down, shrunk
  onto an instrument. Without it a dive from off the boresight arrives out of
  nowhere.
- **The drift ladder** on the windscreen HUD shows where along the playfield you
  actually are, which the cockpit otherwise hides completely.

Things sized for a 224px-wide screen do not survive being put a metre from your
eye. The tractor beam is a fifth of the playfield across, and at full length its
mouth lands behind the camera — drawn honestly it is a full-screen blue wash
with the boss lost somewhere inside it, so it is drawn stopping short. The
control column gets the opposite treatment: a real one sits between your knees,
50° below a fixed sightline and off the bottom of the frame, so it is mounted on
the front of the panel where you can watch it move.

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
| `src/game.js` | Game state machine, entities, collisions, flat rendering |
| `src/paths.js` | Flight-path builder (`line`/`turn` pen) and the path library |
| `src/sprites.js` | Pixel-art sprites and the 5×7 bitmap font |
| `src/stars.js` | Blinking parallax starfield (flat view) |
| `src/audio.js` | Synthesised WebAudio effects |
| `src/render3d/view3d.js` | Arcade coordinates → cockpit view; entity pools |
| `src/render3d/cockpit.js` | Canopy, panel, the moving stick, scope, HUD |
| `src/render3d/models.js` | Ships, tracers, blasts and the tractor cone |
| `src/render3d/backdrop.js` | Nebula shell, starfield, streaming near dust |
| `src/render3d/textures.js` | Baked nebula, star sprites, beam ramp |

The HUD, banners and title screen are still drawn by `game.js` onto the arcade
canvas, which sits over the 3D one as a transparent overlay — the same code
paints them in both views rather than a second implementation that can drift.

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
npm run shots:cockpit       # cockpit screenshots at the moments worth seeing
```

The first three read `window.game` rather than pixels, so they are unaffected by
which renderer is running. `shots:cockpit` is the visual one: it captures the
title, the formation assembling, a settled formation, a bank, a dive on the
boresight, a close pass, an open tractor beam, a shot in flight, the phone
layout with the stick deflected, and the `?flat` fallback. It fails the run on
any console error, and reports errors as they happen — a render error kills the
frame loop, so a later wait would otherwise hang with nothing to show for it.

Both write screenshots to `tools/shots/`. `playtest` also writes a
per-second `timeline.json`, which is how the stalled-dive bug below was found.

### Bugs these caught

- Dive paths that happened to end above the bottom edge left enemies frozen
  in place forever, so a stage could never be completed. Dives now re-enter on
  path exhaustion as well as on leaving the screen.
- The game-over screen went blank once its banner timed out, with no prompt and
  enemies frozen mid-swoop.
