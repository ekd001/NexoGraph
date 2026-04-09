/**
 * detector.js — Auto-detection de la stack technique d'un projet
 *
 * Responsabilite :
 *   Analyser un projet pour determiner quels ORMs/frameworks sont utilises
 *   et collecter TOUS les fichiers susceptibles de contenir des definitions
 *   de models/schemas/entities, quel que soit leur nommage.
 *
 * Strategie de detection des fichiers (3 passes) :
 *   1. Par suffixe : *.schema.ts, *.model.ts, *.entity.ts
 *   2. Par dossier : tout fichier dans models/, schemas/, entities/
 *   3. Par contenu : tout fichier .ts/.js qui importe un ORM connu
 *
 * Les 3 passes sont combinees et dedupliquees pour ne rien rater.
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

/** Dossiers et fichiers a ignorer systematiquement */
const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.spec.*',
  '**/*.test.*',
  '**/*.d.ts',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/seeds/**',         // Seed scripts ne sont pas des models
  '**/seed.*',           // Fichiers de seed individuels
  '**/fixtures/**',      // Donnees de test
  '**/migration*/**',    // Migrations SQL
  '**/*indexer*',        // Indexeurs (search-engine etc.)
  '**/*seeder*',         // Seeders
];

/**
 * Signatures d'import qui identifient chaque ORM.
 * Si un fichier contient l'une de ces chaines, il est candidat.
 */
const ORM_SIGNATURES = {
  mongoose: [
    '@Schema',
    'new Schema(',
    'new mongoose.Schema(',
    'mongoose.model(',
    'from \'mongoose\'',
    'from "mongoose"',
    'require(\'mongoose\')',
    '@nestjs/mongoose',
  ],
  typeorm: [
    '@Entity',
    '@Column',
    '@ManyToOne',
    '@OneToMany',
    '@OneToOne',
    '@ManyToMany',
    'from \'typeorm\'',
    'from "typeorm"',
    'require(\'typeorm\')',
  ],
  prisma: [
    'model ',      // dans un .prisma
    'datasource ',
    'generator ',
  ],
  sequelize: [
    '@Table',
    'Model.init(',
    'sequelize.define(',
    'from \'sequelize\'',
    'from "sequelize"',
    'from \'sequelize-typescript\'',
  ],
};

// ─────────────────────────────────────────────────────────
// DETECTION DE LA STACK
// ─────────────────────────────────────────────────────────

/**
 * Detecte les ORMs utilises dans le projet.
 *
 * Approche :
 *   1. Lire les dependances de package.json (+ sous-packages monorepo)
 *   2. Pour chaque ORM connu, verifier si la dep existe
 *   3. Fallback : scanner les fichiers pour detecter les imports
 *
 * @param {string} projectPath — Chemin absolu du projet
 * @returns {Array<{id: string, parser: string}>} — ORMs detectes
 */
async function detectStack(projectPath) {
  const stacks = [];
  const deps = readAllDeps(projectPath);

  // Verifier chaque ORM via les dependances
  if (deps.has('mongoose') || deps.has('@nestjs/mongoose')) {
    stacks.push({ id: 'mongoose', parser: 'mongoose' });
  }

  if (deps.has('typeorm') || deps.has('@nestjs/typeorm')) {
    stacks.push({ id: 'typeorm', parser: 'typeorm' });
  }

  if (deps.has('prisma') || deps.has('@prisma/client')) {
    stacks.push({ id: 'prisma', parser: 'prisma' });
  }

  if (deps.has('sequelize') || deps.has('sequelize-typescript')) {
    stacks.push({ id: 'sequelize', parser: 'sequelize' });
  }

  // Fallback : si aucun ORM detecte via deps, on scanne les fichiers
  if (stacks.length === 0) {
    const detected = await detectByFileContent(projectPath);
    stacks.push(...detected);
  }

  return stacks;
}

/**
 * Fallback : lit quelques fichiers pour detecter les imports ORM
 * quand package.json ne suffit pas (ex: monorepo sans root deps).
 */
async function detectByFileContent(projectPath) {
  const stacks = [];
  const candidates = await glob('**/*.{ts,js}', {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
  });

  // Echantillonner max 50 fichiers pour rester rapide
  const sample = candidates.slice(0, 50);
  const detected = new Set();

  for (const filePath of sample) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const [orm, signatures] of Object.entries(ORM_SIGNATURES)) {
      if (detected.has(orm)) continue;
      if (signatures.some(sig => content.includes(sig))) {
        detected.add(orm);
        stacks.push({ id: orm, parser: orm });
      }
    }
    // Stop early si on a tout trouve
    if (detected.size === Object.keys(ORM_SIGNATURES).length) break;
  }

  return stacks;
}

// ─────────────────────────────────────────────────────────
// COLLECTE DES FICHIERS
// ─────────────────────────────────────────────────────────

/**
 * Collecte TOUS les fichiers susceptibles de contenir des models
 * pour chaque stack detectee.
 *
 * 3 passes combinees :
 *   Pass 1 — Suffixe : *.schema.ts, *.entity.ts, etc.
 *   Pass 2 — Dossier : tout fichier dans models/, schemas/, entities/
 *   Pass 3 — Contenu : fichiers qui importent l'ORM meme sans convention de nommage
 *
 * @param {string} projectPath — Chemin absolu du projet
 * @param {Array} stacks — ORMs detectes
 * @returns {Object} — Map parser → liste de fichiers absolus (dedupliques)
 */
async function collectFiles(projectPath, stacks) {
  const result = {};

  for (const stack of stacks) {
    const allFiles = new Set();

    // ── Pass 1 : par suffixe de fichier ──
    const suffixPatterns = getSuffixPatterns(stack.parser);
    for (const pattern of suffixPatterns) {
      const files = await glob(pattern, { cwd: projectPath, ignore: IGNORE, absolute: true });
      files.forEach(f => allFiles.add(f));
    }

    // ── Pass 2 : par dossier connu ──
    const dirPatterns = getDirPatterns(stack.parser);
    for (const pattern of dirPatterns) {
      const files = await glob(pattern, { cwd: projectPath, ignore: IGNORE, absolute: true });
      files.forEach(f => allFiles.add(f));
    }

    // ── Pass 3 : par contenu (import de l'ORM) ──
    // On scanne les fichiers .ts/.js pas encore collectes
    const signatures = ORM_SIGNATURES[stack.parser] || [];
    if (signatures.length > 0) {
      const allTs = await glob('**/*.{ts,js}', { cwd: projectPath, ignore: IGNORE, absolute: true });
      for (const filePath of allTs) {
        if (allFiles.has(filePath)) continue; // deja collecte
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (signatures.some(sig => content.includes(sig))) {
            allFiles.add(filePath);
          }
        } catch {
          // Fichier illisible, on skip
        }
      }
    }

    result[stack.parser] = [...allFiles];
  }

  return result;
}

/**
 * Patterns glob par suffixe de fichier pour chaque ORM.
 * C'est la methode classique, mais elle ne suffit pas seule.
 */
function getSuffixPatterns(parser) {
  switch (parser) {
    case 'mongoose':
      return ['**/*.schema.ts', '**/*.schema.js', '**/*.model.ts', '**/*.model.js'];
    case 'typeorm':
      return ['**/*.entity.ts', '**/*.entity.js'];
    case 'prisma':
      return ['**/schema.prisma', '**/*.prisma'];
    case 'sequelize':
      return ['**/*.model.ts', '**/*.model.js'];
    default:
      return [];
  }
}

/**
 * Patterns glob par dossier connu.
 * Attrape les fichiers comme models/user.ts ou entities/payment.ts
 * qui n'ont pas le suffixe conventionnel.
 */
function getDirPatterns(parser) {
  switch (parser) {
    case 'mongoose':
      return [
        '**/models/**/*.{ts,js}',
        '**/schemas/**/*.{ts,js}',
      ];
    case 'typeorm':
      return [
        '**/entities/**/*.{ts,js}',
      ];
    case 'prisma':
      return ['**/prisma/**/*.prisma'];
    case 'sequelize':
      return [
        '**/models/**/*.{ts,js}',
      ];
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────
// LECTURE DES DEPENDANCES
// ─────────────────────────────────────────────────────────

/**
 * Lit toutes les dependances du projet, y compris les sous-packages
 * d'un monorepo (apps/*, libs/*, packages/*).
 *
 * @param {string} projectPath — Chemin absolu du projet
 * @returns {Set<string>} — Ensemble de noms de packages
 */
function readAllDeps(projectPath) {
  const deps = new Set();

  // Package.json racine
  addDepsFromPkgJson(path.join(projectPath, 'package.json'), deps);

  // Sous-packages monorepo (NestJS, Nx, Lerna, Turborepo...)
  const subPkgPatterns = [
    'apps/*/package.json',
    'libs/*/package.json',
    'packages/*/package.json',
    'services/*/package.json',
  ];

  for (const pattern of subPkgPatterns) {
    try {
      const { globSync } = require('glob');
      const files = globSync(pattern, { cwd: projectPath });
      for (const f of files) {
        addDepsFromPkgJson(path.join(projectPath, f), deps);
      }
    } catch {
      // glob sync fail, pas critique
    }
  }

  return deps;
}

/**
 * Extrait les noms de packages d'un package.json et les ajoute au Set.
 */
function addDepsFromPkgJson(pkgPath, deps) {
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[section]) {
        Object.keys(pkg[section]).forEach(name => deps.add(name));
      }
    }
  } catch {
    // JSON invalide, on skip
  }
}

module.exports = { detectStack, collectFiles };
