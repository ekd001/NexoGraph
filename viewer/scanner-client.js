/**
 * scanner-client.js — Client-side project scanner
 *
 * Uses the File System Access API (showDirectoryPicker) to read
 * project files directly from the user's machine.
 * Works in local AND hosted (Vercel) mode — no server needed.
 *
 * Flow:
 *   1. User clicks "New Project" → showDirectoryPicker() opens OS file picker
 *   2. Browser reads all .schema.ts, .entity.ts, .model.ts, .prisma files
 *   3. Parser extracts collections, fields, refs, enums
 *   4. Relations are detected
 *   5. Domains are classified from directory structure
 *   6. Result is returned as JSON (same format as server scanner)
 */

const ClientScanner = (() => {

  // ── File patterns to scan ──────────────
  const SCAN_EXTENSIONS = ['.schema.ts', '.model.ts', '.entity.ts', '.schema.js', '.model.js', '.entity.js', '.prisma'];
  const SKIP_DIRS = ['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__', '__mocks__', 'seeds', '.next', '.nuxt'];
  const SKIP_PATTERNS = ['.spec.', '.test.', '.d.ts', 'seed.', 'seeder', 'indexer'];

  // ── ORM signatures for content-based detection ──
  const ORM_SIGNATURES = {
    mongoose: ['@Schema', 'new Schema(', '@Prop(', 'mongoose.model('],
    typeorm: ['@Entity', '@Column', '@ManyToOne', '@OneToMany'],
    prisma: ['model ', 'datasource '],
    sequelize: ['@Table', 'Model.init(', 'sequelize.define('],
  };

  /**
   * Open the OS file picker and scan the selected directory.
   * @returns {Object|null} — Scan result { project, domains, collections, relations } or null if cancelled
   */
  async function scanDirectory() {
    // Check browser support
    if (!('showDirectoryPicker' in window)) {
      throw new Error('Your browser does not support folder selection. Use Chrome or Edge.');
    }

    // Open native folder picker
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    const projectName = dirHandle.name;
    const start = Date.now();

    // Collect all relevant files recursively
    const files = [];
    await collectFiles(dirHandle, '', files);

    if (files.length === 0) {
      throw new Error('No schema/model/entity files found in this project.');
    }

    // Detect which ORMs are used
    const stacks = detectStacks(files);

    // Parse all files
    const allCollections = [];
    for (const file of files) {
      const parsed = parseFile(file.content, file.path, stacks);
      allCollections.push(...parsed);
    }

    // Deduplicate by sourcePath + className
    const collMap = new Map();
    for (const col of allCollections) {
      const key = col.sourcePath + ':' + col.className;
      const existing = collMap.get(key);
      if (!existing || col.fields.length > existing.fields.length) {
        collMap.set(key, col);
      }
    }
    const collections = [...collMap.values()];

    // Ensure unique IDs
    const idCounts = new Map();
    for (const col of collections) {
      const count = idCounts.get(col.id) || 0;
      if (count > 0) col.id = col.id + '_' + count;
      idCounts.set(col.id, count + 1);
    }

    // Detect relations
    const relations = detectRelations(collections);

    // Build domain list
    const domains = buildDomainList(collections);

    // Clean internal fields
    const cleanCollections = collections.map(col => {
      const { _ormRelations, ...rest } = col;
      return rest;
    });

    const elapsed = Date.now() - start;

    return {
      project: {
        name: projectName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        path: projectName,
        scannedAt: new Date().toISOString(),
        version: '1.0',
        stats: {
          totalCollections: cleanCollections.length,
          totalRelations: relations.length,
          totalFiles: files.length,
          scanTimeMs: elapsed,
          stacksDetected: stacks,
          databases: countByDb(cleanCollections),
          domainCount: domains.length,
        },
      },
      domains,
      collections: cleanCollections,
      relations,
    };
  }

  // ═════════════════════════════════════════
  // FILE COLLECTION
  // ═════════════════════════════════════════

  /**
   * Recursively collect relevant files from a directory handle.
   */
  async function collectFiles(dirHandle, basePath, results) {
    for await (const [name, handle] of dirHandle) {
      const path = basePath ? basePath + '/' + name : name;

      if (handle.kind === 'directory') {
        if (SKIP_DIRS.includes(name) || name.startsWith('.')) continue;
        await collectFiles(handle, path, results);
      } else if (handle.kind === 'file') {
        // Check if this file is relevant
        const isRelevant = SCAN_EXTENSIONS.some(ext => name.endsWith(ext)) ||
          (name.endsWith('.ts') || name.endsWith('.js')) && isInModelDir(path);

        if (!isRelevant) continue;
        if (SKIP_PATTERNS.some(p => name.includes(p))) continue;

        try {
          const file = await handle.getFile();
          const content = await file.text();
          // Only keep files that actually contain ORM code
          if (hasORMContent(content)) {
            results.push({ path, content, name });
          }
        } catch { /* skip unreadable files */ }
      }
    }
  }

  function isInModelDir(path) {
    const lower = path.toLowerCase();
    return lower.includes('/models/') || lower.includes('/schemas/') || lower.includes('/entities/');
  }

  function hasORMContent(content) {
    for (const sigs of Object.values(ORM_SIGNATURES)) {
      if (sigs.some(s => content.includes(s))) return true;
    }
    return false;
  }

  function detectStacks(files) {
    const found = new Set();
    for (const file of files) {
      for (const [orm, sigs] of Object.entries(ORM_SIGNATURES)) {
        if (found.has(orm)) continue;
        if (sigs.some(s => file.content.includes(s))) found.add(orm);
      }
    }
    return [...found];
  }

  // ═════════════════════════════════════════
  // PARSER (unified — handles all ORMs)
  // ═════════════════════════════════════════

  function parseFile(content, filePath, stacks) {
    const results = [];

    // Extract enums
    const fileEnums = {};
    const enumBlocks = [...content.matchAll(/export\s+enum\s+(\w+)\s*\{([^}]+)\}/g)];
    for (const em of enumBlocks) {
      fileEnums[em[1]] = em[2].split(',').map(v => v.trim().split(/[=\s]/)[0]).filter(v => v && !v.startsWith('//'));
    }

    // Try Mongoose NestJS style
    const schemaRegex = /@Schema\s*\(/g;
    let match;
    while ((match = schemaRegex.exec(content)) !== null) {
      const openPos = match.index + match[0].length - 1;
      const options = extractParenContent(content, openPos);
      if (options === null) continue;
      if (options.includes('_id: false') || options.includes('_id:false')) continue;

      const endPos = openPos + options.length + 2;
      const afterSchema = content.substring(endPos);
      const classMatch = afterSchema.match(/^\s*export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/);
      if (!classMatch) continue;

      const className = classMatch[1];
      const inheritance = classMatch[2] || null;
      const collMatch = options.match(/collection:\s*['"]([^'"]+)['"]/);
      const collectionName = collMatch ? collMatch[1] : deriveCollectionName(className);

      const classBody = extractClassBody(content, endPos + classMatch.index);
      if (!classBody) continue;

      const fields = extractPropFields(classBody, fileEnums);
      const domainId = resolveDomain(filePath);

      results.push({
        id: sanitizeId(collectionName), name: collectionName, className,
        domainId, db: 'mongodb', sourcePath: filePath,
        fields, enums: relevantEnums(fields, fileEnums), inheritance,
      });
    }

    // Try TypeORM @Entity
    const entityRegex = /@Entity\s*\(\s*(?:['"](\w+)['"]|\{[^}]*name:\s*['"](\w+)['"][^}]*\})\s*\)/g;
    while ((match = entityRegex.exec(content)) !== null) {
      const tableName = match[1] || match[2];
      const afterEntity = content.substring(match.index);
      const classMatch = afterEntity.match(/export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/);
      if (!classMatch) continue;

      const className = classMatch[1];
      const classBody = extractClassBody(content, match.index + classMatch.index);
      if (!classBody) continue;

      const fields = extractColumns(classBody, fileEnums);
      const ormRelations = extractTypeORMRelations(classBody);
      const domainId = resolveDomain(filePath);

      results.push({
        id: tableName, name: tableName, className,
        domainId, db: 'postgresql', sourcePath: filePath,
        fields, enums: relevantEnums(fields, fileEnums),
        inheritance: classMatch[2] || null, _ormRelations: ormRelations,
      });
    }

    // Try Prisma model
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1];
      const body = match[2];
      const mapMatch = body.match(/@@map\s*\(\s*"(\w+)"\s*\)/);
      const tableName = mapMatch ? mapMatch[1] : modelName.toLowerCase() + 's';
      const fields = [];
      const ormRels = [];

      body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('@@')).forEach(line => {
        const fm = line.match(/^(\w+)\s+([\w\[\]?]+)\s*(.*)?$/);
        if (!fm) return;
        const field = { name: fm[1], type: fm[2].replace('[]','').replace('?','') };
        if (fm[2].endsWith('[]')) field.isArray = true;
        if (fm[2].endsWith('?')) field.nullable = true;
        const attrs = fm[3] || '';
        if (attrs.includes('@id')) field.primary = true;
        if (attrs.includes('@unique')) field.unique = true;
        if (attrs.includes('@relation')) {
          field.ref = field.type;
          ormRels.push({ type: field.isArray ? 'one-to-many' : 'many-to-one', targetEntity: field.type, field: fm[1] });
        }
        fields.push(field);
      });

      results.push({
        id: tableName, name: tableName, className: modelName,
        domainId: resolveDomain(filePath), db: 'postgresql', sourcePath: filePath,
        fields, enums: [], inheritance: null, _ormRelations: ormRels,
      });
    }

    // Try classic Mongoose: new Schema({
    const classicRegex = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*\{/g;
    while ((match = classicRegex.exec(content)) !== null) {
      const varName = match[1];
      const modelMatch = content.match(new RegExp(`model\\s*\\(\\s*['"]([\\w]+)['"]\\s*,\\s*${varName}`));
      const collectionName = modelMatch ? modelMatch[1].toLowerCase() + 's' : deriveCollectionName(varName.replace(/Schema$/, ''));
      const schemaBody = extractObjectBody(content, match.index + match[0].length - 1);
      const fields = extractClassicFields(schemaBody, fileEnums);

      results.push({
        id: sanitizeId(collectionName), name: collectionName, className: varName.replace(/Schema$/, ''),
        domainId: resolveDomain(filePath), db: 'mongodb', sourcePath: filePath,
        fields, enums: relevantEnums(fields, fileEnums), inheritance: null,
      });
    }

    return results;
  }

  // ═════════════════════════════════════════
  // FIELD EXTRACTORS
  // ═════════════════════════════════════════

  function extractPropFields(classBody, fileEnums) {
    const fields = [];
    const propStart = /@Prop\s*\(/g;
    let m;
    while ((m = propStart.exec(classBody)) !== null) {
      const openPos = m.index + m[0].length - 1;
      const raw = extractParenContent(classBody, openPos);
      if (raw === null) continue;
      const closePos = openPos + raw.length + 2;
      const after = classBody.substring(closePos);
      const fm = after.match(/^\s*\n?\s*(\w+)[\?!]?\s*(?::\s*([^;\n]+))?/);
      if (!fm) continue;

      const field = { name: fm[1], type: (fm[2] || 'any').trim() };
      if (raw.includes('required: true') || raw.includes('required:true')) field.required = true;
      if (raw.includes('unique: true') || raw.includes('unique:true')) field.unique = true;
      if (raw.includes('index: true') || raw.includes('index:true')) field.indexed = true;

      const refM = raw.match(/ref:\s*['"](\w+)['"]/);
      if (refM) field.ref = refM[1];
      if (raw.includes('ObjectId') || raw.includes('Types.ObjectId')) field.type = field.ref ? `ObjectId -> ${field.ref}` : 'ObjectId';
      if (raw.match(/type:\s*\[/) || (fm[2] && fm[2].includes('[]'))) field.isArray = true;

      const enumRef = raw.match(/enum:\s*(\w+)/);
      if (enumRef && fileEnums[enumRef[1]]) { field.enum = fileEnums[enumRef[1]]; field.enumName = enumRef[1]; }
      const inlineEnum = raw.match(/enum:\s*\[([^\]]+)\]/);
      if (inlineEnum && !field.enum) field.enum = inlineEnum[1].split(',').map(v => v.trim().replace(/['"]/g, '')).filter(Boolean);
      if (raw.includes('Mixed') || raw.includes('type: Object')) field.type = 'Mixed';

      fields.push(field);
    }
    return fields;
  }

  function extractColumns(classBody, fileEnums) {
    const fields = [];
    const colRegex = /@(Column|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\s*\(([^)]*)\)\s*\n\s*(\w+)[\?!]?\s*(?::\s*([^;\n]+))?/g;
    let m;
    while ((m = colRegex.exec(classBody)) !== null) {
      const field = { name: m[3], type: (m[4] || 'any').trim() };
      if (m[1] === 'PrimaryGeneratedColumn') field.primary = true;
      const opts = m[2];
      if (opts.includes('unique: true')) field.unique = true;
      if (opts.includes('nullable: true')) field.nullable = true;
      const enumM = opts.match(/enum:\s*(\w+)/);
      if (enumM && fileEnums[enumM[1]]) { field.enum = fileEnums[enumM[1]]; field.enumName = enumM[1]; }
      fields.push(field);
    }
    return fields;
  }

  function extractTypeORMRelations(classBody) {
    const rels = [];
    const relRegex = /@(ManyToOne|OneToMany|OneToOne|ManyToMany)\s*\(\s*\(\)\s*=>\s*(\w+)/g;
    let m;
    while ((m = relRegex.exec(classBody)) !== null) {
      const after = classBody.substring(m.index + m[0].length);
      const fm = after.match(/\n\s+(\w+)[\?!]?\s*:/);
      rels.push({
        type: m[1].replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''),
        targetEntity: m[2], field: fm ? fm[1] : null,
      });
    }
    return rels;
  }

  function extractClassicFields(body, fileEnums) {
    if (!body) return [];
    const fields = [];
    const fr = /(\w+)\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[\w.[\]]+)/g;
    let m;
    while ((m = fr.exec(body)) !== null) {
      const name = m[1];
      if (['timestamps', 'collection', 'versionKey', 'strict'].includes(name)) continue;
      const field = { name, type: 'Mixed' };
      const v = m[2].trim();
      if (v.startsWith('{')) {
        const tm = v.match(/type:\s*([\w.[\]]+)/);
        if (tm) field.type = tm[1].replace('mongoose.Schema.Types.', '');
        if (v.includes('required: true')) field.required = true;
        if (v.includes('unique: true')) field.unique = true;
        const rm = v.match(/ref:\s*['"](\w+)['"]/);
        if (rm) field.ref = rm[1];
        if (v.includes('ObjectId')) field.type = field.ref ? `ObjectId -> ${field.ref}` : 'ObjectId';
      } else {
        field.type = v.replace('mongoose.Schema.Types.', '');
      }
      fields.push(field);
    }
    return fields;
  }

  // ═════════════════════════════════════════
  // RELATIONS
  // ═════════════════════════════════════════

  function detectRelations(collections) {
    const rels = [];
    const nameToId = new Map();
    for (const col of collections) {
      nameToId.set(col.className, col.id);
      nameToId.set(col.name, col.id);
      nameToId.set(col.className.replace(/Entity$|Schema$|Model$/, ''), col.id);
    }
    for (const col of collections) {
      for (const f of col.fields) {
        if (f.ref) {
          const tid = nameToId.get(f.ref);
          if (tid && tid !== col.id) rels.push({ source: col.id, target: tid, field: f.name, type: f.isArray ? 'many-to-many' : 'many-to-one' });
        }
      }
      if (col._ormRelations) {
        for (const r of col._ormRelations) {
          const tid = nameToId.get(r.targetEntity);
          if (tid && tid !== col.id) rels.push({ source: col.id, target: tid, field: r.field || r.targetEntity, type: r.type });
        }
      }
    }
    const seen = new Set();
    return rels.filter(r => { const k = `${r.source}|${r.target}|${r.field}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ═════════════════════════════════════════
  // DOMAIN RESOLVER
  // ═════════════════════════════════════════

  const COLOR_PALETTE = [
    '#3b82f6','#8b5cf6','#f59e0b','#ec4899','#14b8a6',
    '#f97316','#22d3ee','#ef4444','#84cc16','#06b6d4',
    '#f472b6','#10b981','#fbbf24','#c084fc','#64748b',
  ];

  function resolveDomain(filePath) {
    const parts = filePath.split('/');
    const patterns = [
      { prefix: 'apps', depth: 1 },
      { prefix: 'libs', depth: 1 },
      { prefix: 'packages', depth: 1 },
      { prefix: 'services', depth: 1 },
    ];
    for (const p of patterns) {
      const idx = parts.indexOf(p.prefix);
      if (idx !== -1 && parts.length > idx + p.depth) {
        return cleanDomain(parts[idx + p.depth]);
      }
    }
    if (parts[0] === 'src' && parts.length > 2) {
      return cleanDomain(parts[1] === 'modules' ? parts[2] : parts[1]);
    }
    return parts.length >= 2 ? cleanDomain(parts[parts.length - 2]) : 'default';
  }

  function cleanDomain(name) {
    return name.toLowerCase().replace(/-service$|-module$|-lib$/, '').trim();
  }

  function buildDomainList(collections) {
    const seen = new Map();
    let ci = 0;
    for (const col of collections) {
      if (!seen.has(col.domainId)) {
        seen.set(col.domainId, {
          id: col.domainId,
          name: col.domainId.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          color: ci < COLOR_PALETTE.length ? COLOR_PALETTE[ci] : hashColor(col.domainId),
        });
        ci++;
      }
    }
    return [...seen.values()];
  }

  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 65%, 60%)`;
  }

  // ═════════════════════════════════════════
  // UTILITIES
  // ═════════════════════════════════════════

  function extractParenContent(content, openPos) {
    if (content[openPos] !== '(') return null;
    let depth = 0;
    for (let i = openPos; i < content.length; i++) {
      const ch = content[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      if (ch === ')' || ch === '}' || ch === ']') depth--;
      if (depth === 0) return content.substring(openPos + 1, i);
    }
    return null;
  }

  function extractClassBody(content, startFrom) {
    const idx = content.indexOf('{', startFrom);
    if (idx === -1) return null;
    let d = 0;
    for (let i = idx; i < content.length; i++) {
      if (content[i] === '{') d++; if (content[i] === '}') d--;
      if (d === 0) return content.substring(idx + 1, i);
    }
    return null;
  }

  function extractObjectBody(content, openIdx) {
    let d = 0;
    for (let i = openIdx; i < content.length; i++) {
      if (content[i] === '{') d++; if (content[i] === '}') d--;
      if (d === 0) return content.substring(openIdx + 1, i);
    }
    return null;
  }

  function deriveCollectionName(className) {
    const clean = className.replace(/Schema$|Model$|Entity$/, '');
    const snake = clean.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/__+/g, '_');
    if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('z')) return snake + 'es';
    if (snake.endsWith('y')) return snake.slice(0, -1) + 'ies';
    return snake + 's';
  }

  function sanitizeId(name) { return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }
  function countByDb(cols) { const c = {}; cols.forEach(col => c[col.db] = (c[col.db] || 0) + 1); return c; }

  function relevantEnums(fields, fileEnums) {
    const used = new Set(fields.map(f => f.enumName).filter(Boolean));
    return Object.entries(fileEnums).filter(([n]) => used.has(n)).map(([n, v]) => ({ name: n, values: v }));
  }

  return { scanDirectory };
})();
