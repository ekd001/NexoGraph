/**
 * sequelize.js — Parser pour les models Sequelize / Sequelize-TypeScript
 *
 * Detecte et extrait :
 *   - Decorateur @Table({ tableName: 'xxx' })
 *   - Colonnes @Column({ type: DataType.STRING })
 *   - Relations @BelongsTo, @HasMany, @HasOne, @BelongsToMany
 *   - Style classique sequelize.define('Model', { ... })
 *   - Enums DataType.ENUM('a', 'b')
 */

const { resolveDomainFromPath } = require('../domain-resolver');
const { extractEnums, extractClassBody, extractObjectBody } = require('./utils');

/**
 * Parse un fichier model Sequelize.
 *
 * @param {string} content — Contenu du fichier
 * @param {string} relativePath — Chemin relatif au projet
 * @returns {Array} — Collections extraites
 */
function parse(content, relativePath) {
  // Essayer le style decorateur (sequelize-typescript) d'abord
  let results = parseDecoratorStyle(content, relativePath);

  // Sinon essayer le style classique (sequelize.define)
  if (results.length === 0) {
    results = parseClassicStyle(content, relativePath);
  }

  return results;
}

/**
 * Style sequelize-typescript avec decorateurs :
 *   @Table({ tableName: 'users' })
 *   export class User extends Model { ... }
 */
function parseDecoratorStyle(content, relativePath) {
  const results = [];
  const fileEnums = extractEnums(content);

  const tableRegex = /@Table\s*\(\s*(\{[^}]*\})?\s*\)\s*\n\s*export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  let match;

  while ((match = tableRegex.exec(content)) !== null) {
    const options = match[1] || '';
    const className = match[2];
    const inheritance = match[3] || null;

    // Nom de table
    const tableMatch = options.match(/tableName:\s*['"](\w+)['"]/);
    const tableName = tableMatch ? tableMatch[1] : className.toLowerCase() + 's';

    // Body de la classe
    const classBody = extractClassBody(content, match.index);
    if (!classBody) continue;

    // Colonnes
    const fields = extractDecoratorColumns(classBody, fileEnums);

    // Relations
    const ormRelations = extractDecoratorRelations(classBody);

    const domainId = resolveDomainFromPath(relativePath);

    results.push({
      id: tableName,
      name: tableName,
      className,
      domainId,
      db: 'postgresql',
      sourcePath: relativePath,
      fields,
      enums: Object.entries(fileEnums)
        .filter(([name]) => fields.some(f => f.enumName === name))
        .map(([name, values]) => ({ name, values })),
      inheritance,
      _ormRelations: ormRelations,
    });
  }

  return results;
}

/**
 * Extrait les colonnes du style decorateur :
 *   @Column({ type: DataType.STRING, allowNull: false })
 *   username: string;
 */
function extractDecoratorColumns(classBody, fileEnums) {
  const fields = [];

  const colRegex = /@(Column|PrimaryKey|AutoIncrement|CreatedAt|UpdatedAt|DeletedAt)\s*(?:\(([^)]*)\))?\s*\n\s*(\w+)[\?!]?\s*(?::\s*([^;\n]+))?/g;
  let match;

  while ((match = colRegex.exec(classBody)) !== null) {
    const decorator = match[1];
    const options = match[2] || '';
    const fieldName = match[3];
    const tsType = (match[4] || 'any').trim();

    const field = { name: fieldName, type: tsType };

    if (decorator === 'PrimaryKey') field.primary = true;
    if (decorator === 'CreatedAt') field.auto = 'createdAt';
    if (decorator === 'UpdatedAt') field.auto = 'updatedAt';

    // Type DataType
    const dtMatch = options.match(/DataType\.(\w+)/);
    if (dtMatch) field.dbType = dtMatch[1];

    if (options.includes('allowNull: false')) field.required = true;
    if (options.includes('unique: true')) field.unique = true;

    // Enum DataType.ENUM('a', 'b')
    const enumMatch = options.match(/ENUM\s*\(([^)]+)\)/);
    if (enumMatch) {
      field.enum = enumMatch[1].split(',').map(v => v.trim().replace(/['"]/g, '')).filter(Boolean);
    }

    fields.push(field);
  }

  return fields;
}

/**
 * Extrait les relations decorateur :
 *   @BelongsTo(() => Company)
 *   @HasMany(() => Post)
 */
function extractDecoratorRelations(classBody) {
  const relations = [];
  const relMap = {
    'BelongsTo': 'many-to-one',
    'HasMany': 'one-to-many',
    'HasOne': 'one-to-one',
    'BelongsToMany': 'many-to-many',
  };

  const relRegex = /@(BelongsTo|HasMany|HasOne|BelongsToMany)\s*\(\s*\(\)\s*=>\s*(\w+)/g;
  let match;

  while ((match = relRegex.exec(classBody)) !== null) {
    const afterRel = classBody.substring(match.index + match[0].length);
    const fieldMatch = afterRel.match(/\n\s+(\w+)[\?!]?\s*:/);

    relations.push({
      type: relMap[match[1]] || match[1],
      targetEntity: match[2],
      field: fieldMatch ? fieldMatch[1] : null,
    });
  }

  return relations;
}

/**
 * Style classique :
 *   const User = sequelize.define('User', { ... })
 *   ou
 *   User.init({ ... }, { sequelize, tableName: 'users' })
 */
function parseClassicStyle(content, relativePath) {
  const results = [];

  // sequelize.define('Model', { fields })
  const defineRegex = /(?:sequelize|db)\.define\s*\(\s*['"](\w+)['"]\s*,\s*\{/g;
  let match;

  while ((match = defineRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = extractObjectBody(content, content.indexOf('{', match.index + match[0].length - 1));

    const fields = parseDefineFields(body);
    const domainId = resolveDomainFromPath(relativePath);

    results.push({
      id: modelName.toLowerCase() + 's',
      name: modelName.toLowerCase() + 's',
      className: modelName,
      domainId,
      db: 'postgresql',
      sourcePath: relativePath,
      fields,
      enums: [],
      inheritance: null,
      _ormRelations: [],
    });
  }

  return results;
}

/**
 * Parse les champs d'un sequelize.define
 */
function parseDefineFields(body) {
  if (!body) return [];
  const fields = [];

  const fieldRegex = /(\w+)\s*:\s*(?:(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})|DataTypes?\.(\w+)|Sequelize\.(\w+))/g;
  let match;

  while ((match = fieldRegex.exec(body)) !== null) {
    const field = { name: match[1], type: match[3] || match[4] || 'Mixed' };

    if (match[2]) {
      // Options object
      const opts = match[2];
      const typeMatch = opts.match(/type:\s*DataTypes?\.(\w+)/);
      if (typeMatch) field.type = typeMatch[1];
      if (opts.includes('allowNull: false')) field.required = true;
      if (opts.includes('unique: true')) field.unique = true;
      if (opts.includes('primaryKey: true')) field.primary = true;
    }

    fields.push(field);
  }

  return fields;
}

module.exports = { parse };
