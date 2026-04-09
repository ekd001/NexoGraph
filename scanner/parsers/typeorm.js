/**
 * typeorm.js — Parser pour les entites TypeORM
 *
 * Detecte et extrait :
 *   - Nom de la table (@Entity('table_name'))
 *   - Colonnes (@Column, @PrimaryGeneratedColumn, @CreateDateColumn, etc.)
 *   - Types SQL (varchar, uuid, int, jsonb, enum, etc.)
 *   - Relations (@ManyToOne, @OneToMany, @OneToOne, @ManyToMany)
 *   - Enums TypeScript utilises dans les colonnes
 *   - Indexes (@Index)
 *   - Contraintes (unique, nullable, primary)
 */

const { resolveDomainFromPath } = require('../domain-resolver');
const { extractEnums, extractClassBody, hasOption, relevantEnums } = require('./utils');

/**
 * Parse un fichier entity TypeORM.
 *
 * @param {string} content — Contenu du fichier
 * @param {string} relativePath — Chemin relatif au projet
 * @returns {Array} — Entites extraites
 */
function parse(content, relativePath) {
  const results = [];
  const fileEnums = extractEnums(content);

  // Chercher toutes les classes decorees avec @Entity
  // Supporte 2 formats :
  //   @Entity('table_name')
  //   @Entity({ name: 'table_name' })
  const entityRegex = /@Entity\s*\(\s*(?:['"](\w+)['"]|\{[^}]*name:\s*['"](\w+)['"][^}]*\})\s*\)/g;
  let match;

  while ((match = entityRegex.exec(content)) !== null) {
    const tableName = match[1] || match[2];
    const entityPos = match.index;

    // Trouver la declaration de classe apres le @Entity
    const afterEntity = content.substring(entityPos);
    const classMatch = afterEntity.match(/export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (!classMatch) continue;

    const className = classMatch[1];
    const inheritance = classMatch[2] || null;

    // Extraire le body de la classe
    const classBody = extractClassBody(content, entityPos + classMatch.index);
    if (!classBody) continue;

    // ── Extraire les colonnes ──
    const fields = extractColumns(classBody, fileEnums);

    // ── Extraire les relations ORM ──
    const ormRelations = extractRelations(classBody);

    // ── Extraire les indexes depuis les decorateurs @Index sur la classe ──
    const indexes = extractIndexes(content, entityPos);

    const domainId = resolveDomainFromPath(relativePath);

    results.push({
      id: tableName,
      name: tableName,
      className,
      domainId,
      db: 'postgresql',
      sourcePath: relativePath,
      fields,
      enums: relevantEnums(fields, fileEnums),
      inheritance,
      indexes,
      // Stocke temporairement pour la detection de relations dans index.js
      _ormRelations: ormRelations,
    });
  }

  return results;
}

/**
 * Extrait les colonnes decorees avec @Column, @PrimaryGeneratedColumn,
 * @CreateDateColumn, @UpdateDateColumn.
 *
 * Pour chaque colonne, on extrait :
 *   - name (nom du champ TypeScript)
 *   - type (type SQL ou TypeScript)
 *   - Flags : primary, unique, nullable, enum
 */
function extractColumns(classBody, fileEnums) {
  const fields = [];

  // Pattern pour capturer tous les types de colonnes
  const colRegex = /@(Column|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\s*\(([^)]*)\)\s*\n\s*(\w+)[\?!]?\s*(?::\s*([^;\n]+))?/g;
  let match;

  while ((match = colRegex.exec(classBody)) !== null) {
    const decorator = match[1];
    const rawOptions = match[2].trim();
    const fieldName = match[3];
    const tsType = (match[4] || 'any').trim();

    const field = {
      name: fieldName,
      type: tsType,
    };

    // Colonnes speciales
    if (decorator === 'PrimaryGeneratedColumn') {
      field.primary = true;
      // Extraire le type de generation ('uuid', 'increment', etc.)
      const genType = rawOptions.replace(/['"]/g, '').trim();
      if (genType) field.type = genType;
    }

    if (decorator === 'CreateDateColumn') field.auto = 'createdAt';
    if (decorator === 'UpdateDateColumn') field.auto = 'updatedAt';
    if (decorator === 'DeleteDateColumn') field.auto = 'deletedAt';

    // ── Analyser les options de @Column ──

    // Type SQL
    const typeMatch = rawOptions.match(/type:\s*['"](\w+)['"]/);
    if (typeMatch) field.dbType = typeMatch[1];

    // Nom de colonne en base
    const nameMatch = rawOptions.match(/name:\s*['"]([^'"]+)['"]/);
    if (nameMatch) field.columnName = nameMatch[1];

    // Unique
    if (hasOption(rawOptions, 'unique', 'true')) field.unique = true;

    // Nullable
    if (hasOption(rawOptions, 'nullable', 'true')) field.nullable = true;

    // Default
    const defaultMatch = rawOptions.match(/default:\s*([^,}\s]+)/);
    if (defaultMatch) field.default = defaultMatch[1].replace(/['"]/g, '');

    // Enum
    const enumMatch = rawOptions.match(/enum:\s*(\w+)/);
    if (enumMatch && fileEnums[enumMatch[1]]) {
      field.enum = fileEnums[enumMatch[1]];
      field.enumName = enumMatch[1];
    }

    // Length
    const lengthMatch = rawOptions.match(/length:\s*(\d+)/);
    if (lengthMatch) field.length = parseInt(lengthMatch[1]);

    // Precision/Scale (decimal)
    const precisionMatch = rawOptions.match(/precision:\s*(\d+)/);
    const scaleMatch = rawOptions.match(/scale:\s*(\d+)/);
    if (precisionMatch) field.precision = parseInt(precisionMatch[1]);
    if (scaleMatch) field.scale = parseInt(scaleMatch[1]);

    fields.push(field);
  }

  return fields;
}

/**
 * Extrait les relations TypeORM :
 *   @ManyToOne(() => TargetEntity, ...)
 *   @OneToMany(() => TargetEntity, ...)
 *   @OneToOne(() => TargetEntity, ...)
 *   @ManyToMany(() => TargetEntity, ...)
 *
 * Retourne le type de relation et l'entite cible.
 */
function extractRelations(classBody) {
  const relations = [];

  const relRegex = /@(ManyToOne|OneToMany|OneToOne|ManyToMany)\s*\(\s*\(\)\s*=>\s*(\w+)/g;
  let match;

  while ((match = relRegex.exec(classBody)) !== null) {
    const relType = match[1];
    const targetEntity = match[2];

    // Trouver le nom du champ associe (la propriete juste apres le decorateur)
    const afterRel = classBody.substring(match.index + match[0].length);
    const fieldMatch = afterRel.match(/\n\s+(\w+)[\?!]?\s*:/);

    // Convertir le format du type : ManyToOne → many-to-one
    const typeNormalized = relType
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');

    relations.push({
      type: typeNormalized,
      targetEntity,
      field: fieldMatch ? fieldMatch[1] : null,
    });
  }

  return relations;
}

/**
 * Extrait les decorateurs @Index de la classe (pas des colonnes).
 * Exemple : @Index(['transactionId'], { unique: true })
 */
function extractIndexes(content, entityPos) {
  const indexes = [];

  // Chercher les @Index entre le @Entity et le export class
  const section = content.substring(Math.max(0, entityPos - 500), entityPos + 200);
  const indexRegex = /@Index\s*\(\s*\[([^\]]+)\](?:\s*,\s*(\{[^}]*\}))?\s*\)/g;
  let match;

  while ((match = indexRegex.exec(section)) !== null) {
    const columns = match[1]
      .split(',')
      .map(c => c.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    const options = match[2] || '';
    indexes.push({
      columns,
      unique: options.includes('unique: true'),
    });
  }

  return indexes;
}

module.exports = { parse };
