# GALAGA

A Galaga-style formation shooter, played from the cockpit — or from behind the
ship, if you would rather watch it fly. The formation hangs off in space ahead
of you, dives come down the tunnel at your canopy, and the tractor beam opens
directly overhead. Everything is generated in code — the sprites, font, sound,
flight paths, ships, cockpit, Viper and nebula. No art assets.

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
| `V` | Swap view — cockpit / outside |
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
- Pause, mute and the view swap sit off to the side, small, out of the way of a
  flying thumb.
- The playfield scales to fit the phone rather than snapping to whole pixels,
  so it fills the screen instead of wasting a third of it.
- A mouse never takes over steering, so desktop play is unchanged.
- **The control column in the cockpit moves with your thumb.** It reads how the
  ship actually moved rather than which input moved it, so the slide strip, the
  arrow keys and the headless bot all deflect it without any of them knowing
  the cockpit exists.

## The two views

Same renderer, same rig, eye at a different station on it.

**The cockpit** is the default: the eye is bolted to the airframe, the panel and
the tactical scope do the work, and the ship you are flying is the frame you are
looking through.

**Outside** (`V`, or `?chase`) slides the eye back behind the tail, and the ship
appears — a Colonial Viper Mark II, lifted whole out of the galactica-fps
project next door, exterior only. There it carried a cockpit interior of its
own; here the interior is this project's `cockpit.js`, built in the camera's
frame at a scale of its own, so only the hull came across.

The Viper is scaled by measuring its own wingspan and matching it to the arcade
fighter — 15 arcade pixels, which is what makes a dual fighter fly beside its
wingman rather than through it, since the simulation puts the pair 8px either
side of the ship's x. It hangs off the rig rather than off the field, so it
slides, pitches and banks with the eye and needs no arcade mapping of its own.

Two things change when the eye leaves the canopy:

- **The roll moves onto the ship.** In the cockpit the bank *is* the roll of the
  world, because the eye is part of the airframe. Outside it is not, so the
  camera keeps a fraction of the bank and the ship takes the rest — a camera
  that rolls fully with the ship shows a level ship over a tilting starfield,
  which is the one thing a chase view exists to avoid.
- **The ship gets its own key light.** The scene is lit for craft that carry
  their own emission, and the Viper carries none: under those lights alone its
  eggshell paint reads as gunmetal. The key is a point light over the camera's
  shoulder, bounded by its falloff so it reaches the ship and the odd close pass
  and stops well short of the formation.

The panel, the scope and the drift ladder are the cockpit's, so outside you fly
on what you can see — which is the trade the view is for.

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
entry paths before they settle into a 40-slot formation. It sways — wider as its
ranks thin out — and once the whole stage has arrived it starts to breathe,
opening and closing about its centre. From stage 2 the incoming flights take the
odd shot on their way in.

**Dive attacks.** An attack director pulls enemies out of formation. A dive is
aimed at where you are when it launches, so standing still is never safe, and
each type flies it its own way: bees make a direct run and, more often as the
stages go on, loop right in front of you; butterflies weave; bosses sweep wide.
A boss's escorts, and a diver's wingmate, fly the leader's own line from their
own slot, so they come down as one formation. Anything that flies off the
bottom re-enters from the top and flies back to its slot.

**Respawn.** A new ship waits until the dives already in flight have played out,
with `READY` up, and nothing new launches while you are gone — so you are never
born into an attack.

**Tractor beam capture.** A boss Galaga occasionally breaks formation, hovers
above you and opens a tractor beam. Get caught and you lose a ship — it's towed
up and docked beneath the boss.

**Dual fighter.** Shoot that boss down *while it is diving* and your captured
fighter is freed; it flies back and docks alongside you for double width and
double firepower. A hit on the pair costs only the fighter that was hit, not a
life. Kill the boss while it sits in formation and the captive dies with it —
same as the arcade.

**Challenging stages.** Every fourth stage is a bonus round: 40 enemies trace
flight patterns without shooting, drawn from four shapes and their mirrors, in
an order that shifts each round. Hit all of them for a 10,000 point perfect
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
| `src/render3d/viper.js` | The player's ship, seen from outside |
| `src/render3d/viperSkin.js` | Baked panel seams, fasteners and weathering |
| `src/render3d/models.js` | Ships, tracers, blasts and the tractor cone |
| `src/render3d/particles.js` | Kill debris, attack-run exhaust, enemy shot tails |
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
npm run test:capture        # capture -> rescue -> dual, half-loss, respawn hold
npm run test:touch          # touch controls + layout on phone viewports
npm run shots:cockpit       # cockpit screenshots at the moments worth seeing
```

The first three read `window.game` rather than pixels, so they are unaffected by
which renderer is running. `shots:cockpit` is the visual one: it captures the
title, the formation assembling, a settled formation, a bank, the ship from
outside — level, banked, and doubled up — a dive on the boresight, a close pass,
an open tractor beam, a shot in flight, the phone layout with the stick
deflected, and the `?flat` fallback. It fails the run on
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
