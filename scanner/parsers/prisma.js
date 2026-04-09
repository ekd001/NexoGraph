/**
 * prisma.js — Parser pour les fichiers schema.prisma
 *
 * Detecte et extrait :
 *   - Models (model User { ... })
 *   - Champs avec types (String, Int, DateTime, etc.)
 *   - Relations (@relation)
 *   - Attributs (@id, @unique, @default, @map, @@map, @@index)
 *   - Enums (enum Role { ADMIN USER })
 *
 * Format Prisma :
 *   model User {
 *     id       Int      @id @default(autoincrement())
 *     email    String   @unique
 *     name     String?
 *     posts    Post[]
 *     role     Role     @default(USER)
 *     @@map("users")
 *   }
 */

const { resolveDomainFromPath } = require('../domain-resolver');

/**
 * Parse un fichier .prisma et retourne les models trouves.
 *
 * @param {string} content — Contenu du fichier schema.prisma
 * @param {string} relativePath — Chemin relatif au projet
 * @returns {Array} — Collections extraites
 */
function parse(content, relativePath) {
  const results = [];

  // Extraire les enums Prisma
  const prismaEnums = extractPrismaEnums(content);

  // Trouver chaque bloc model
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const modelBody = match[2];

    // Verifier si @@map definit un nom de table different
    const mapMatch = modelBody.match(/@@map\s*\(\s*"(\w+)"\s*\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName.toLowerCase() + 's';

    // Parser les champs
    const fields = [];
    const ormRelations = [];

    const lines = modelBody.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('@@'));

    for (const line of lines) {
      const fieldMatch = line.match(/^(\w+)\s+([\w\[\]?]+)\s*(.*)?$/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      let fieldType = fieldMatch[2];
      const attrs = fieldMatch[3] || '';

      const field = { name: fieldName, type: fieldType };

      // Tableau (Post[])
      if (fieldType.endsWith('[]')) {
        field.isArray = true;
        field.type = fieldType.replace('[]', '');
      }

      // Optionnel (String?)
      if (fieldType.endsWith('?')) {
        field.nullable = true;
        field.type = fieldType.replace('?', '');
      }

      // @id
      if (attrs.includes('@id')) field.primary = true;

      // @unique
      if (attrs.includes('@unique')) field.unique = true;

      // @default
      const defaultMatch = attrs.match(/@default\(([^)]+)\)/);
      if (defaultMatch) field.default = defaultMatch[1];

      // @map (nom de colonne en base)
      const colMapMatch = attrs.match(/@map\("(\w+)"\)/);
      if (colMapMatch) field.columnName = colMapMatch[1];

      // @relation → c'est une relation, pas un champ scalaire
      const relMatch = attrs.match(/@relation\(([^)]*)\)/);
      if (relMatch) {
        const relOpts = relMatch[1];
        const refFieldsMatch = relOpts.match(/fields:\s*\[([^\]]+)\]/);
        const refMatch = relOpts.match(/references:\s*\[([^\]]+)\]/);

        ormRelations.push({
          type: field.isArray ? 'one-to-many' : 'many-to-one',
          targetEntity: field.type,
          field: fieldName,
          foreignKey: refFieldsMatch ? refFieldsMatch[1].trim() : null,
        });

        field.ref = field.type;
        field.type = `Relation -> ${field.type}`;
      }

      // Enum Prisma
      if (prismaEnums[field.type]) {
        field.enum = prismaEnums[field.type];
        field.enumName = field.type;
      }

      fields.push(field);
    }

    const domainId = resolveDomainFromPath(relativePath);

    results.push({
      id: tableName,
      name: tableName,
      className: modelName,
      domainId,
      db: 'postgresql',
      sourcePath: relativePath,
      fields,
      enums: Object.entries(prismaEnums)
        .filter(([name]) => fields.some(f => f.enumName === name))
        .map(([name, values]) => ({ name, values })),
      inheritance: null,
      _ormRelations: ormRelations,
    });
  }

  return results;
}

/**
 * Extrait les enums Prisma :
 *   enum Role {
 *     ADMIN
 *     USER
 *     MODERATOR
 *   }
 */
function extractPrismaEnums(content) {
  const enums = {};
  const regex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const values = match[2]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//'));
    enums[match[1]] = values;
  }

  return enums;
}

module.exports = { parse };
