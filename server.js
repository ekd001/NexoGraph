/**
 * server.js — Serveur Nexograph
 *
 * Responsabilites :
 *   - Servir l'interface du viewer (fichiers statiques)
 *   - API REST pour scanner, lister, importer, exporter, supprimer des projets
 *   - Ouvrir automatiquement le navigateur au demarrage
 *
 * API :
 *   GET    /api/projects              → Liste des projets scannes
 *   GET    /api/projects/:filename    → Donnees completes d'un projet
 *   POST   /api/scan                  → Scanner un nouveau projet { projectPath, projectName }
 *   POST   /api/import                → Importer un projet depuis un JSON/xflow
 *   DELETE /api/projects/:filename    → Supprimer un projet
 *
 * Demarrage :
 *   npm start → lance le serveur sur le port 3847, ouvre le navigateur
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { scan } = require('./scanner');

const app = express();
const PORT = process.env.PORT || 3847;
const PROJECTS_DIR = path.join(__dirname, 'projects');

// ── Middleware ────────────────────────────────
app.use(express.json({ limit: '50mb' }));          // Import de gros projets
app.use(express.static(path.join(__dirname, 'viewer'))); // Fichiers statiques du viewer

// ── Garantir que le dossier projects/ existe ──
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// ── Validation filename (securite anti path-traversal) ──
function isValidFilename(name) {
  return /^[a-z0-9][a-z0-9\-]*\.json$/i.test(name) && !name.includes('..');
}

function validateFilename(req, res, next) {
  if (!isValidFilename(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  next();
}

// ─────────────────────────────────────────────────────────
// API : NAVIGUER DANS LES DOSSIERS
// ─────────────────────────────────────────────────────────

/**
 * GET /api/browse?path=/home/user
 * Liste les sous-dossiers d'un chemin donne.
 * Retourne aussi le chemin parent pour remonter.
 * Securite : empeche l'acces aux fichiers, ne liste que les dossiers.
 */
app.get('/api/browse', (req, res) => {
  if (process.env.VERCEL) {
    return res.status(400).json({ error: 'File browsing is only available in local mode. Use "npm start" locally.' });
  }
  const targetPath = req.query.path || require('os').homedir();
  const absPath = path.resolve(targetPath);

  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'Path not found' });
  }

  try {
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => {
        // Only directories, skip hidden dirs and system dirs
        if (!e.isDirectory()) return false;
        if (e.name.startsWith('.')) return false;
        if (['node_modules', 'dist', 'build', '__pycache__', '.git'].includes(e.name)) return false;
        return true;
      })
      .map(e => ({
        name: e.name,
        path: path.join(absPath, e.name),
        // Check if it looks like a project (has package.json)
        isProject: fs.existsSync(path.join(absPath, e.name, 'package.json')),
      }))
      .sort((a, b) => {
        // Projects first, then alphabetical
        if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({
      current: absPath,
      parent: path.dirname(absPath),
      hasParent: absPath !== path.dirname(absPath), // false at root /
      dirs,
      // Check if current dir itself is a project
      isProject: fs.existsSync(path.join(absPath, 'package.json')),
    });
  } catch (err) {
    res.status(403).json({ error: 'Access denied' });
  }
});

// ─────────────────────────────────────────────────────────
// API : LISTER LES PROJETS
// ─────────────────────────────────────────────────────────

/**
 * GET /api/projects
 * Retourne la liste des projets scannes avec leurs metadonnees.
 * Ne charge pas les collections en detail (juste les stats).
 */
app.get('/api/projects', (req, res) => {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    const projects = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf-8'));
        return {
          filename: f,
          name: data.project.name,
          path: data.project.path,
          scannedAt: data.project.scannedAt,
          stats: data.project.stats,
        };
      } catch {
        return null; // Fichier JSON corrompu → ignorer
      }
    }).filter(Boolean);

    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// API : CHARGER UN PROJET
// ─────────────────────────────────────────────────────────

/**
 * GET /api/projects/:filename
 * Retourne les donnees completes d'un projet (collections, relations, domaines).
 */
app.get('/api/projects/:filename', validateFilename, (req, res) => {
  const filePath = path.join(PROJECTS_DIR, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Projet introuvable' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Fichier projet corrompu' });
  }
});

// ─────────────────────────────────────────────────────────
// API : SCANNER UN PROJET
// ─────────────────────────────────────────────────────────

/**
 * POST /api/scan
 * Body : { projectPath: "/absolute/path", projectName: "Mon Projet" }
 *
 * Lance le scan du projet, sauvegarde le resultat en JSON,
 * et retourne les stats du scan.
 */
app.post('/api/scan', async (req, res) => {
  if (process.env.VERCEL) {
    return res.status(400).json({ error: 'Scanning is only available in local mode. Use "npm start" locally.' });
  }
  const { projectPath, projectName } = req.body;

  if (!projectPath || !projectName) {
    return res.status(400).json({
      error: 'Champs requis : projectPath (chemin du projet) et projectName (nom a afficher)',
    });
  }

  try {
    const result = await scan(projectPath, projectName);

    // Sauvegarder le resultat
    const filename = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    fs.writeFileSync(
      path.join(PROJECTS_DIR, filename),
      JSON.stringify(result, null, 2)
    );

    res.json({
      success: true,
      filename,
      stats: result.project.stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// API : IMPORTER UN PROJET
// ─────────────────────────────────────────────────────────

/**
 * POST /api/import
 * Body : contenu JSON complet d'un projet (format Nexograph ou .xflow)
 *
 * Permet d'importer un projet exporte depuis une autre instance.
 */
app.post('/api/import', (req, res) => {
  const data = req.body;

  // Validation minimale du format
  if (!data.project || !data.collections) {
    return res.status(400).json({
      error: 'Format invalide. Le JSON doit contenir "project" et "collections".',
    });
  }

  try {
    const filename = data.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    fs.writeFileSync(
      path.join(PROJECTS_DIR, filename),
      JSON.stringify(data, null, 2)
    );

    res.json({ success: true, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// API : SUPPRIMER UN PROJET
// ─────────────────────────────────────────────────────────

/**
 * DELETE /api/projects/:filename
 * Supprime un projet scanne.
 */
app.delete('/api/projects/:filename', validateFilename, (req, res) => {
  const filePath = path.join(PROJECTS_DIR, req.params.filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────
// SPA FALLBACK
// ─────────────────────────────────────────────────────────

/** Toute route non-API renvoie l'index.html du viewer */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

// ─────────────────────────────────────────────────────────
// DEMARRAGE
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// EXPORT + DEMARRAGE
// ─────────────────────────────────────────────────────────

// Export for Vercel serverless
module.exports = app;

// Only start the listener in local mode (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log('  ┌──────────────────────────────────────┐');
    console.log('  │                                      │');
    console.log('  │         N E X O G R A P H            │');
    console.log('  │      Collections Visualizer          │');
    console.log('  │                                      │');
    console.log(`  │   ${url}              │`);
    console.log('  │                                      │');
    console.log('  └──────────────────────────────────────┘');
    console.log('');

    try {
      const open = (await import('open')).default;
      open(url);
    } catch {
      console.log(`  Ouvrez ${url} dans votre navigateur.`);
    }
  });
}
