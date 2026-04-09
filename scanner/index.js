/**
 * scanner/index.js — Orchestrateur du scan de projet
 *
 * Point d'entree du scanner. Coordonne :
 *   1. Detection de la stack (quels ORMs sont utilises)
 *   2. Collecte des fichiers candidats (3 passes : suffixe, dossier, contenu)
 *   3. Parsing parallele de tous les fichiers avec le bon parser
 *   4. Detection des relations entre collections
 *   5. Construction de la liste des domaines
 *   6. Generation du JSON final
 *
 * Usage :
 *   const { scan } = require('./scanner');
 *   const result = await scan('/path/to/project', 'Mon Projet');
 */

const fs = require('fs');
const path = require('path');
const { detectStack, collectFiles } = require('./detector');
const { buildDomainList } = require('./domain-resolver');

/** Chargement des parsers disponibles */
const PARSERS = {
  mongoose: require('./parsers/mongoose'),
  typeorm: require('./parsers/typeorm'),
  prisma: require('./parsers/prisma'),
  sequelize: require('./parsers/sequelize'),
};

/**
 * Scanne un projet et retourne la cartographie complete.
 *
 * @param {string} projectPath — Chemin absolu ou relatif du projet
 * @param {string} projectName — Nom affiche dans le viewer
 * @returns {Object} — Cartographie complete { project, domains, collections, relations }
 */
async function scan(projectPath, projectName) {
  const start = Date.now();
  const absPath = path.resolve(projectPath);

  // Verifier que le chemin existe
  if (!fs.existsSync(absPath)) {
    throw new Error(`Chemin introuvable : ${absPath}`);
  }

  // ── Etape 1 : Detecter la stack technique ──
  const stacks = await detectStack(absPath);
  if (stacks.length === 0) {
    throw new Error(
      'Aucun ORM detecte (Mongoose, TypeORM, Prisma, Sequelize). ' +
      'Verifiez que le projet contient des fichiers de models.'
    );
  }

  // ── Etape 2 : Collecter tous les fichiers candidats ──
  const filesByParser = await collectFiles(absPath, stacks);

  // ── Etape 3 : Parser tous les fichiers en parallele ──
  const allCollections = [];
  const parsePromises = [];

  for (const [parserName, files] of Object.entries(filesByParser)) {
    const parser = PARSERS[parserName];
    if (!parser) continue;

    for (const filePath of files) {
      parsePromises.push(
        fs.promises.readFile(filePath, 'utf-8')
          .then(content => {
            const relativePath = path.relative(absPath, filePath);
            try {
              const parsed = parser.parse(content, relativePath);
              return parsed;
            } catch (err) {
              // Un fichier qui echoue ne doit pas bloquer le scan
              console.warn(`[nexograph] Erreur parsing ${relativePath}: ${err.message}`);
              return [];
            }
          })
          .catch(() => []) // Fichier illisible → skip
      );
    }
  }

  const parseResults = await Promise.all(parsePromises);
  for (const collections of parseResults) {
    allCollections.push(...collections);
  }

  // ── Etape 4 : Dedupliquer les collections ──
  // Dedup par sourcePath (meme fichier detecte par 2 passes → garder une fois)
  // Mais garder les doublons de collection name venant de fichiers differents
  // car ce sont des models distincts (ex: notifications dans front/ vs notification/)
  const collectionMap = new Map();
  for (const col of allCollections) {
    // Cle unique = sourcePath + className (pas collection name)
    const key = col.sourcePath + ':' + col.className;
    const existing = collectionMap.get(key);
    if (!existing || col.fields.length > existing.fields.length) {
      collectionMap.set(key, col);
    }
  }
  const collections = [...collectionMap.values()];

  // Garantir des IDs uniques (si 2 collections ont le meme nom, suffixer)
  const idCounts = new Map();
  for (const col of collections) {
    const count = idCounts.get(col.id) || 0;
    if (count > 0) {
      col.id = col.id + '_' + count;
    }
    idCounts.set(col.id, count + 1);
  }

  // ── Etape 5 : Detecter les relations ──
  const relations = detectRelations(collections);

  // ── Etape 6 : Construire la liste des domaines ──
  const domains = buildDomainList(collections);

  // ── Etape 7 : Nettoyer les collections (retirer les champs internes) ──
  const cleanCollections = collections.map(col => {
    const { _ormRelations, ...rest } = col;
    return rest;
  });

  const elapsed = Date.now() - start;

  return {
    project: {
      name: projectName,
      path: absPath,
      scannedAt: new Date().toISOString(),
      version: '1.0',
      stats: {
        totalCollections: collections.length,
        totalRelations: relations.length,
        totalFiles: Object.values(filesByParser).reduce((sum, f) => sum + f.length, 0),
        scanTimeMs: elapsed,
        stacksDetected: stacks.map(s => s.id),
        databases: countByDb(collections),
        domainCount: domains.length,
      },
    },
    domains,
    collections: cleanCollections,
    relations,
  };
}

// ─────────────────────────────────────────────────────────
// DETECTION DES RELATIONS
// ─────────────────────────────────────────────────────────

/**
 * Detecte toutes les relations entre collections.
 *
 * Sources de relations :
 *   1. Champs avec ref: 'ModelName' (Mongoose)
 *   2. Decorateurs @ManyToOne etc. (TypeORM, Sequelize) stockes dans _ormRelations
 *   3. Relations Prisma (@relation) stockees dans _ormRelations
 *
 * Deduplique les relations pour eviter les doublons.
 */
function detectRelations(collections) {
  const relations = [];

  // Construire un index pour resoudre les noms de classes/collections → id
  const nameToId = new Map();
  for (const col of collections) {
    nameToId.set(col.className, col.id);
    nameToId.set(col.name, col.id);
    // Aussi sans suffixe (UserEntity → User, UserSchema → User)
    const cleanName = col.className.replace(/Entity$|Schema$|Model$/, '');
    nameToId.set(cleanName, col.id);
  }

  for (const col of collections) {
    // ── Source 1 : refs Mongoose dans les champs ──
    for (const field of col.fields) {
      if (field.ref) {
        const targetId = nameToId.get(field.ref);
        if (targetId && targetId !== col.id) {
          relations.push({
            source: col.id,
            target: targetId,
            field: field.name,
            type: field.isArray ? 'many-to-many' : 'many-to-one',
          });
        }
      }
    }

    // ── Source 2 : relations ORM (TypeORM, Prisma, Sequelize) ──
    if (col._ormRelations) {
      for (const rel of col._ormRelations) {
        const targetId = nameToId.get(rel.targetEntity);
        if (targetId && targetId !== col.id) {
          relations.push({
            source: col.id,
            target: targetId,
            field: rel.field || rel.targetEntity,
            type: rel.type,
          });
        }
      }
    }
  }

  // Dedupliquer : meme source + target + field = une seule relation
  const seen = new Set();
  return relations.filter(r => {
    const key = `${r.source}|${r.target}|${r.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Compte les collections par type de base de donnees.
 */
function countByDb(collections) {
  const counts = {};
  for (const col of collections) {
    counts[col.db] = (counts[col.db] || 0) + 1;
  }
  return counts;
}

module.exports = { scan };
