/**
 * mongoose.js — Parser pour les schemas Mongoose / NestJS Mongoose
 *
 * Detecte et extrait :
 *   - Nom de la collection (@Schema({ collection: 'xxx' }) ou derive du nom de classe)
 *   - Champs (@Prop ou proprietes de new Schema({}))
 *   - Types, required, unique, index, default
 *   - References vers d'autres collections (ref: 'ModelName')
 *   - Enums (TypeScript enum ou inline ['a','b','c'])
 *   - Heritage (extends BaseModel, BaseSubmission, etc.)
 *
 * Supporte 2 styles :
 *   1. Decorateurs NestJS : @Schema() + @Prop()
 *   2. Classique : new mongoose.Schema({ field: { type: String } })
 */

const { resolveDomainFromPath } = require('../domain-resolver');

/**
 * Parse un fichier et retourne les collections trouvees.
 *
 * @param {string} content — Contenu du fichier
 * @param {string} relativePath — Chemin relatif au projet
 * @returns {Array} — Collections extraites
 */
function parse(content, relativePath) {
  // Extraire les enums definis dans le fichier (utilises par les @Prop)
  const fileEnums = extractEnums(content);

  // Tenter le parsing NestJS d'abord (plus courant dans les projets modernes)
  let collections = parseNestJSStyle(content, relativePath, fileEnums);

  // Si rien trouve, tenter le style classique mongoose
  if (collections.length === 0) {
    collections = parseClassicStyle(content, relativePath, fileEnums);
  }

  return collections;
}

// ─────────────────────────────────────────────────────────
// STYLE NESTJS : @Schema() + @Prop()
// ─────────────────────────────────────────────────────────

/**
 * Parse les schemas style NestJS avec decorateurs.
 *
 * Detection des classes :
 *   - On cherche @Schema({...}) suivi de export class XxxName
 *   - On ignore les sous-schemas embarques (@Schema({ _id: false }))
 *   - Le nom de collection vient de @Schema({ collection: 'xxx' }) ou du nom de classe
 */
function parseNestJSStyle(content, relativePath, fileEnums) {
  const results = [];

  // Trouver toutes les classes avec @Schema
  // Approche robuste : chercher @Schema( puis la parenthese fermante,
  // puis export class — sur potentiellement plusieurs lignes.
  // Le contenu entre @Schema(...) peut avoir des {} imbriquees.
  const schemaPositions = findAllSchemaDecorators(content);

  for (const { options: schemaOptions, endPos } of schemaPositions) {
    // Chercher "export class" apres le @Schema
    const afterSchema = content.substring(endPos);
    const classMatch = afterSchema.match(/^\s*export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (!classMatch) continue;

    const className = classMatch[1];
    const inheritance = classMatch[2] || null;

    // Ignorer les sous-schemas embarques (pas des collections independantes)
    if (schemaOptions.includes('_id: false') || schemaOptions.includes('_id:false')) {
      continue;
    }

    // Extraire le nom de la collection
    const collectionMatch = schemaOptions.match(/collection:\s*['"]([^'"]+)['"]/);
    const collectionName = collectionMatch
      ? collectionMatch[1]
      : deriveCollectionName(className);

    // Extraire le body de la classe
    const classBodyStart = endPos + classMatch.index;
    const classBody = extractClassBody(content, classBodyStart);
    if (!classBody) continue;

    // Extraire les champs @Prop
    const fields = extractPropFields(classBody, fileEnums);

    // Resoudre le domaine depuis le chemin du fichier
    const domainId = resolveDomainFromPath(relativePath);

    results.push({
      id: sanitizeId(collectionName),
      name: collectionName,
      className,
      domainId,
      db: 'mongodb',
      sourcePath: relativePath,
      fields,
      enums: relevantEnums(fields, fileEnums),
      inheritance,
    });
  }

  return results;
}

/**
 * Extrait les champs depuis les decorateurs @Prop dans le body d'une classe.
 *
 * Gere les cas :
 *   - @Prop() simple
 *   - @Prop({ type: String, required: true })
 *   - @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Model' })
 *   - @Prop({ enum: StatusEnum }) et @Prop({ enum: ['a', 'b'] })
 *   - @Prop({ type: [String] }) pour les tableaux
 *   - @Prop({ type: [SubSchema] }) pour les sous-documents
 */
function extractPropFields(classBody, fileEnums) {
  const fields = [];

  // Approche robuste : trouver chaque @Prop(, matcher les parentheses
  // (potentiellement multi-lignes avec {} imbriquees), puis extraire
  // le nom du champ apres la parenthese fermante.
  const propStartRegex = /@Prop\s*\(/g;
  let match;

  while ((match = propStartRegex.exec(classBody)) !== null) {
    // Extraire le contenu entre parentheses en gerant l'imbrication
    const openPos = match.index + match[0].length - 1; // position du '('
    const rawOptions = extractParenContent(classBody, openPos);
    if (rawOptions === null) continue;

    const closePos = openPos + rawOptions.length + 2; // apres ')'

    // Extraire le nom du champ et son type TS apres le @Prop(...)
    const afterProp = classBody.substring(closePos);
    const fieldMatch = afterProp.match(/^\s*\n?\s*(\w+)[\?!]?\s*(?::\s*([^;\n]+))?/);
    if (!fieldMatch) continue;

    const fieldName = fieldMatch[1];
    const tsType = (fieldMatch[2] || 'any').trim();

    const field = {
      name: fieldName,
      type: tsType,
    };

    // ── Analyser les options du @Prop ──

    if (hasOption(rawOptions, 'required', 'true')) field.required = true;
    if (hasOption(rawOptions, 'unique', 'true')) field.unique = true;
    if (hasOption(rawOptions, 'index', 'true')) field.indexed = true;

    // Reference vers une autre collection
    const refMatch = rawOptions.match(/ref:\s*['"](\w+)['"]/);
    if (refMatch) field.ref = refMatch[1];

    // Type ObjectId
    if (rawOptions.includes('ObjectId') || rawOptions.includes('Types.ObjectId')) {
      field.type = field.ref ? `ObjectId -> ${field.ref}` : 'ObjectId';
    }

    // Tableau (type: [...])
    if (rawOptions.match(/type:\s*\[/) || tsType.includes('[]')) {
      field.isArray = true;
    }

    // Enum (reference a un enum TypeScript)
    const enumRefMatch = rawOptions.match(/enum:\s*(\w+)/);
    if (enumRefMatch && fileEnums[enumRefMatch[1]]) {
      field.enum = fileEnums[enumRefMatch[1]];
      field.enumName = enumRefMatch[1];
    }

    // Enum inline (enum: ['a', 'b', 'c'])
    const inlineEnumMatch = rawOptions.match(/enum:\s*\[([^\]]+)\]/);
    if (inlineEnumMatch && !field.enum) {
      field.enum = inlineEnumMatch[1]
        .split(',')
        .map(v => v.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    }

    // Default
    const defaultMatch = rawOptions.match(/default:\s*([^,}\s]+)/);
    if (defaultMatch) field.default = defaultMatch[1].replace(/['"]/g, '');

    // Type Mixed (donnees flexibles)
    if (rawOptions.includes('Mixed') || rawOptions.includes('type: Object')) {
      field.type = 'Mixed';
    }

    fields.push(field);
  }

  return fields;
}

// ─────────────────────────────────────────────────────────
// STYLE CLASSIQUE : new mongoose.Schema({...})
// ─────────────────────────────────────────────────────────

/**
 * Parse les schemas style classique :
 *   const UserSchema = new mongoose.Schema({ ... })
 *   const User = mongoose.model('User', UserSchema)
 */
function parseClassicStyle(content, relativePath, fileEnums) {
  const results = [];

  // Chercher les declarations new Schema({
  const schemaRegex = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*\{/g;
  let match;

  while ((match = schemaRegex.exec(content)) !== null) {
    const varName = match[1];

    // Chercher le nom du model : mongoose.model('Name', schema)
    const modelMatch = content.match(
      new RegExp(`model\\s*\\(\\s*['"]([\\w]+)['"]\\s*,\\s*${varName}`)
    );
    const collectionName = modelMatch
      ? modelMatch[1].toLowerCase() + 's'
      : deriveCollectionName(varName.replace(/Schema$/, ''));

    const className = varName.replace(/Schema$/, '') || varName;

    // Extraire les champs du schema (premiere couche de l'objet)
    const schemaBody = extractObjectBody(content, match.index + match[0].length - 1);
    const fields = extractClassicFields(schemaBody, fileEnums);

    const domainId = resolveDomainFromPath(relativePath);

    results.push({
      id: sanitizeId(collectionName),
      name: collectionName,
      className,
      domainId,
      db: 'mongodb',
      sourcePath: relativePath,
      fields,
      enums: relevantEnums(fields, fileEnums),
      inheritance: null,
    });
  }

  return results;
}

/**
 * Extrait les champs d'un schema classique mongoose :
 *   { fieldName: { type: String, required: true }, ... }
 * ou
 *   { fieldName: String, ... }
 */
function extractClassicFields(schemaBody, fileEnums) {
  const fields = [];
  if (!schemaBody) return fields;

  // Matcher chaque champ de premier niveau : "name: ..." ou "name : {...}"
  const fieldRegex = /(\w+)\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[\w.[\]]+)/g;
  let match;

  while ((match = fieldRegex.exec(schemaBody)) !== null) {
    const name = match[1];
    const value = match[2].trim();

    // Ignorer les mots-cles mongoose (timestamps, etc.)
    if (['timestamps', 'collection', 'versionKey', 'strict', 'toJSON', 'toObject'].includes(name)) continue;

    const field = { name, type: 'Mixed' };

    if (value.startsWith('{')) {
      // Format objet : { type: String, required: true, ... }
      const typeMatch = value.match(/type:\s*([\w.[\]]+)/);
      if (typeMatch) field.type = typeMatch[1].replace('mongoose.Schema.Types.', '');

      if (hasOption(value, 'required', 'true')) field.required = true;
      if (hasOption(value, 'unique', 'true')) field.unique = true;
      if (hasOption(value, 'index', 'true')) field.indexed = true;

      const refMatch = value.match(/ref:\s*['"](\w+)['"]/);
      if (refMatch) field.ref = refMatch[1];

      if (value.includes('ObjectId')) {
        field.type = field.ref ? `ObjectId -> ${field.ref}` : 'ObjectId';
      }
    } else {
      // Format court : fieldName: String
      field.type = value.replace('mongoose.Schema.Types.', '');
    }

    fields.push(field);
  }

  return fields;
}

// ─────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────

/**
 * Trouve tous les decorateurs @Schema(...) dans le contenu.
 * Gere les parentheses/accolades multi-lignes.
 *
 * Retourne un tableau de { options: string, endPos: number }
 *   - options : contenu entre les parentheses du @Schema()
 *   - endPos  : position juste apres la parenthese fermante
 */
function findAllSchemaDecorators(content) {
  const results = [];
  const regex = /@Schema\s*\(/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const openPos = match.index + match[0].length - 1; // position du '('
    const inner = extractParenContent(content, openPos);
    if (inner === null) continue;

    results.push({
      options: inner,
      endPos: openPos + inner.length + 2, // apres le ')'
    });
  }

  return results;
}

/**
 * Extrait le contenu entre parentheses en gerant l'imbrication.
 * Commence a openPos qui doit pointer sur '('.
 * Retourne le contenu entre ( et ), ou null si pas de match.
 *
 * Gere les parentheses, accolades et crochets imbriques.
 */
function extractParenContent(content, openPos) {
  if (content[openPos] !== '(') return null;

  let depth = 0;
  for (let i = openPos; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (depth === 0) {
      return content.substring(openPos + 1, i);
    }
  }
  return null;
}

/**
 * Extrait tous les enums TypeScript du fichier.
 * Supporte : export enum Status { A = 'a', B = 'b' }
 *
 * @returns {Object} — Map enumName → [valeurs]
 */
function extractEnums(content) {
  const enums = {};
  const regex = /export\s+enum\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const values = match[2]
      .split(',')
      .map(v => v.trim().split(/[=\s]/)[0])
      .filter(v => v && !v.startsWith('//'));
    enums[match[1]] = values;
  }

  return enums;
}

/**
 * Extrait le body d'une classe (tout entre les accolades).
 * Gere les accolades imbriquees.
 */
function extractClassBody(content, startSearchFrom) {
  const openIdx = content.indexOf('{', startSearchFrom);
  if (openIdx === -1) return null;

  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (depth === 0) return content.substring(openIdx + 1, i);
  }
  return null;
}

/**
 * Extrait le contenu d'un objet {} a partir de l'accolade ouvrante.
 */
function extractObjectBody(content, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (depth === 0) return content.substring(openIdx + 1, i);
  }
  return null;
}

/**
 * Derive un nom de collection depuis un nom de classe.
 *   UserSchema → users
 *   PaymentProvider → payment_providers
 */
function deriveCollectionName(className) {
  const clean = className
    .replace(/Schema$|Model$|Entity$/, '');

  // CamelCase → snake_case
  const snake = clean
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/__+/g, '_');

  // Pluraliser (simpliste mais suffisant)
  if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('z')) return snake + 'es';
  if (snake.endsWith('y')) return snake.slice(0, -1) + 'ies';
  return snake + 's';
}

/**
 * Nettoie un ID pour qu'il soit utilisable comme identifiant.
 */
function sanitizeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

/**
 * Verifie si une option est presente dans un string d'options.
 *   hasOption("required: true, unique: false", "required", "true") → true
 */
function hasOption(options, key, value) {
  const regex = new RegExp(`${key}\\s*:\\s*${value}`);
  return regex.test(options);
}

/**
 * Filtre les enums du fichier pour ne garder que ceux utilises par les champs.
 */
function relevantEnums(fields, fileEnums) {
  const used = new Set(fields.map(f => f.enumName).filter(Boolean));
  return Object.entries(fileEnums)
    .filter(([name]) => used.has(name))
    .map(([name, values]) => ({ name, values }));
}

module.exports = { parse };
