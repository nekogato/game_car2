# Four-Wheel Drive Track Builder

## Concept

A browser-based 3D toy racing game where the player builds a mini 4WD-style track from modular parts, then launches a small car to test the route.

## Core Loop

1. Place track pieces on a snapped grid.
2. Rotate or erase pieces until the course feels right.
3. Press play to simulate a car driving through the created track.
4. Return to edit mode and improve the course.

## First Playable Scope

- Track pieces: start, straight, left curve, right curve, lane-change left, lane-change right, crossover lane-change, ramp, bridge.
- Editor controls: select part, rotate preview, place, erase, clear.
- Clicking an existing piece selects it; rotate then updates that placed piece and its saved/physics rotation.
- Track edits autosave to localStorage and reload after refresh.
- Test mode: car follows connected pieces from the start tile using cannon-es physics and a continuous sampled track centerline.
- Test mode supports 1-4 cars; each car has its own cannon-es body and can collide with the other cars.
- Track lane count is player-controlled from 1-3 lanes; lane count affects visual width, sideboard bounds, and per-car guide lanes.
- Camera: orbitable 3D scene with a readable top-down angle.
- Win condition: the car reaches the end of the generated path.

## Simplified Physics

- The car has speed, motor acceleration, drag, and a maximum speed.
- The configured start speed is only the launch impulse; it is not a permanent minimum speed while driving.
- A cannon-es physics body drives the car during test runs.
- Multiple cars are represented by separate cannon-es sphere bodies so car-to-car contact is resolved by the physics world.
- Each car gets a fixed lane path at launch; lane-change pieces smoothly move that path into the adjacent lane.
- Crossover lane-change pieces can swap outer lanes with a raised overpass path while the middle lane snakes aside.
- Loop raised-lane pieces follow crossover routing: lower lanes stay on the crossover underpass paths, while the raised crossover path becomes a short entry straight, one full vertical elliptical loop, then a short exit straight. Loop routes recover pressure rather than adding derail pressure.
- Loop raised-lane geometry uses fixed upward surface normals on straight portions and inward radial normals through the loop so the track surface faces the loop center without twisting.
- Loop raised-lane car guidance samples the same loop curve used by the visual mesh and uses 3D steering through the loop so cars follow the visible ring instead of a flat lane projection.
- Car body orientation keeps a continuous track-forward direction through loop transitions and uses the same look-at convention on flat and looped surfaces so entering a loop cannot visually flip the car 180 degrees.
- Cars relocalize to the nearest lane segment while driving, including during rollback, so slope, curve, and loop orientation are calculated from the car's current track position.
- Lane dividers are full-height sideboards and each car is physically constrained to its assigned lane.
- Curves are sampled as continuous quarter-circle arcs instead of center-point right angles.
- Uphill segments slow the car; downhill segments add speed.
- Curves build stability pressure when entered too fast, with light speed loss so fast cornering feels risky rather than heavily braked.
- Sideboard collision is calculated against the nearest sampled track segment; the car is pushed back inside the usable lane and loses lateral speed.
- Sideboard and active car collisions use the car's configured footprint rather than a tiny center point, with elongated car-to-car separation while driving.
- Closed tracks loop through the start piece instead of ending when the car returns to the start.
- Tire friction and small lateral wander make cars imperfectly track the centerline.
- Excess curve pressure makes the car leave the track.
- Very low speed can stall the car on a climb or stop it on track.
- Climb stalls keep the car physical and pushable; losing speed alone makes the car roll backward, while only unsupported side/top loop stalls fall without a forward launch after lingering too long.
- Car setup includes weight: heavier cars accelerate and steer more slowly and climb worse, but build derail pressure more slowly and tolerate more pressure before leaving the track.
- Default car setup values start at half of each setup control's maximum.

## Persistence

- Saved track key: `mini4wd.track.v1`.
- Every placement, erase, and clear writes the current track to localStorage.
- Refreshing the browser restores the saved track for continued editing.

## Art Direction

Clean tabletop toy style with plastic track pieces, a bright grid base, and a compact stylized mini 4WD car.
