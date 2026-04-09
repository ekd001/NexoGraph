<p align="center">
  <img src="viewer/favicon.svg" width="48" height="48" alt="Nexograph">
</p>

<h1 align="center">Nexograph</h1>

<p align="center">
  <strong>Visualiseur interactif de collections et relations pour backends Node.js</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#scanner">Scanner</a> •
  <a href="#export">Export</a> •
  <a href="#shortcuts">Shortcuts</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-blue" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/github/actions/workflow/status/ekd001/NexoGraph/ci.yml?branch=develop&label=CI" alt="CI">
</p>

---

## What is Nexograph?

Nexograph scans your backend project, detects all database models (Mongoose, TypeORM, Prisma, Sequelize), and renders an interactive cartography of your collections and their relationships.

**No configuration needed.** Point it to a folder, click scan, explore.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-detect** | Scans `package.json` deps + file content to detect ORMs automatically |
| **4 ORMs** | Mongoose, TypeORM, Prisma, Sequelize parsers |
| **3 views** | Domain grid, Dagre hierarchical graph, Sortable list |
| **Search** | Real-time filtering with text highlight across all views |
| **Focus mode** | Double-click a node to zoom on it and its neighbors |
| **Domain filtering** | Click a domain in sidebar to isolate it |
| **Detail panel** | Fields, types, refs, enums, metrics for each collection |
| **PDF report** | Professional A4 document for your team (pdfmake, client-side) |
| **Export** | PNG, SVG, .nexo (project file), JSON |
| **Import** | Drag & drop .nexo or JSON to load a project |
| **File browser** | Visual folder navigator — no path to type |
| **Themes** | Dark (navy/blue) and Light (white/blue) |
| **i18n** | French and English |
| **Persistence** | Refresh doesn't lose your view (localStorage) |
| **Icons** | Lucide icon set throughout |

## Quick Start

```bash
# Clone
git clone https://github.com/ekd001/NexoGraph.git
cd NexoGraph

# Install
npm install

# Start
npm start
```

The browser opens at `http://localhost:3847`.

1. Click **"Nouveau Projet"** (or "New Project")
2. Type a name for your project
3. Navigate to your backend folder using the file browser
4. Click **"Scanner"**
5. Explore your collections

## Scanner

The scanner runs in **< 1 second** for typical projects. It:

1. Reads `package.json` to detect which ORMs are used
2. Collects files by suffix (`*.schema.ts`, `*.entity.ts`), by directory (`models/`, `schemas/`), and by content (files importing an ORM)
3. Parses each file with the appropriate parser
4. Detects relations via `ref:`, `@ManyToOne`, `@relation`, etc.
5. Groups collections by domain (inferred from directory structure)
6. Outputs a single JSON file

### Supported patterns

| ORM | Decorators | Classic |
|-----|-----------|---------|
| **Mongoose** | `@Schema()` + `@Prop()` | `new Schema({})` |
| **TypeORM** | `@Entity()` + `@Column()` + `@ManyToOne()` | — |
| **Prisma** | `model User { ... }` in `.prisma` files | — |
| **Sequelize** | `@Table()` + `@Column()` | `sequelize.define()` |

## Export

| Format | Use case |
|--------|----------|
| **PDF** | Professional report for your team — title page, domain overview, per-collection detail, relations table |
| **PNG** | Screenshot of the current view |
| **SVG** | Vector export of the diagram |
| **.nexo** | Project file — reimportable in another Nexograph instance |
| **JSON** | Raw scan data |

## Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+F` | Focus search bar |
| `Escape` | Deselect / Go back |
| `Double-click` | Focus on node + neighbors |
| `Mouse wheel` | Zoom in/out |
| `Click + drag` | Pan the canvas |

## Project Structure

```
nexograph/
├── scanner/              # Backend parser
│   ├── index.js          # Orchestrator
│   ├── detector.js       # ORM auto-detection
│   ├── domain-resolver.js# Domain classification
│   └── parsers/          # Per-ORM parsers
│       ├── mongoose.js
│       ├── typeorm.js
│       ├── prisma.js
│       ├── sequelize.js
│       └── utils.js
├── viewer/               # Frontend (vanilla JS)
│   ├── index.html
│   ├── style.css
│   ├── i18n.js
│   ├── app.js
│   ├── favicon.svg
│   ├── engine/
│   │   ├── layout.js     # Domain grid + Dagre graph
│   │   └── renderer.js   # Canvas rendering + interactions
│   ├── components/
│   │   ├── projects.js   # Home page + file browser
│   │   ├── detail.js     # Right panel
│   │   ├── toolbar.js    # Sidebar + toolbar + guide
│   │   └── export.js     # Export + PDF + Toast
│   └── themes/
│       ├── dark.css
│       └── light.css
├── server.js             # Express API + static server
├── projects/             # Scanned project JSONs (gitignored)
└── .github/workflows/
    ├── ci.yml            # Lint, check, test
    └── release.yml       # Tag → GitHub Release
```

## Contributing

1. Fork the repo
2. Create a branch from `develop`: `git checkout -b feat/my-feature develop`
3. Make your changes
4. Push and open a PR against `develop`
5. CI must pass before merge
6. `develop` → `main` via PR when ready to release

### Release

```bash
# On main, after merging develop
git tag v1.0.0
git push origin v1.0.0
```

The release workflow creates a GitHub Release with `.tar.gz` and `.zip` artifacts.

## Deployment

Nexograph can be deployed on **Vercel** as a demo/showcase. The scan and file browser only work locally — the deployed version supports **import** of `.nexo`/JSON files.

### Setup Vercel

1. Create a project on [vercel.com](https://vercel.com) linked to the repo
2. Add these secrets in GitHub repo settings (`Settings > Secrets > Actions`):
   - `VERCEL_TOKEN` — from [vercel.com/account/tokens](https://vercel.com/account/tokens)
   - `VERCEL_ORG_ID` — from `.vercel/project.json` after `npx vercel link`
   - `VERCEL_PROJECT_ID` — from `.vercel/project.json` after `npx vercel link`
3. Every merge to `main` triggers auto-deploy

### Local vs Hosted

| Feature | Local (`npm start`) | Vercel |
|---------|-------------------|--------|
| Scan projects | Yes | No |
| File browser | Yes | No |
| Import .nexo/JSON | Yes | Yes |
| All 3 views | Yes | Yes |
| Export PDF/PNG/SVG | Yes | Yes |
| Theme/Language | Yes | Yes |

## License

MIT
