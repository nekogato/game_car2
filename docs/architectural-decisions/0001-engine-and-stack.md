# ADR 0001: Engine And Stack

## Status

Accepted

## Decision

Use Three.js with plain JavaScript for the first playable prototype.

## Context

The requested game depends on 3D track placement, camera orbiting, and simple animated car movement. Three.js gives enough 3D control without requiring a full native engine.

## Consequences

- The prototype can run in a browser with a small local server.
- The first version uses CDN-hosted Three.js instead of an npm build.
- If the game grows, the code should move into a Vite project with separate `src/core`, `src/systems`, `src/gameplay`, and `src/ui` modules.

