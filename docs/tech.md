# Tech Stack

## Runtime

- Single-page browser game.
- Three.js via ESM import map from jsDelivr.
- cannon-es via ESM import map from jsDelivr for lightweight browser physics.
- Browser localStorage for edit-session persistence.
- Plain JavaScript, HTML, and CSS.

## Reasoning

This first prototype avoids a build step so the game can run from a simple local HTTP server. The code still uses modular sections inside `index.html` so it can later be split into `src/` if the project grows.

## Local Run

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
