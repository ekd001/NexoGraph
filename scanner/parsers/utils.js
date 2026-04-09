/**
 * utils.js — Shared utilities for all parsers
 *
 * Avoids code duplication across mongoose.js, typeorm.js, sequelize.js, prisma.js.
 * Functions for extracting enums, class bodies, option checking.
 */

/**
 * Extract all TypeScript enums from file content.
 *   export enum Status { A = 'a', B = 'b' }
 *
 * @param {string} content — File content
 * @returns {Object} — Map enumName → [values]
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
 * Extract the body of a class (everything between the braces).
 * Handles nested braces correctly.
 *
 * @param {string} content — Full file content
 * @param {number} startSearchFrom — Position to start searching for '{'
 * @returns {string|null} — Class body content, or null
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
 * Extract the content of an object {} starting from the opening brace.
 *
 * @param {string} content — Full content
 * @param {number} openIdx — Position of '{'
 * @returns {string|null}
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
 * Extract content between parentheses handling nested brackets.
 * Starts at openPos which must point to '('.
 *
 * @param {string} content — Full content
 * @param {number} openPos — Position of '('
 * @returns {string|null} — Content between ( and )
 */
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

/**
 * Check if a key:value option is present in an options string.
 *   hasOption("required: true, unique: false", "required", "true") → true
 *
 * @param {string} options — Raw options string
 * @param {string} key — Option key
 * @param {string} value — Expected value
 * @returns {boolean}
 */
function hasOption(options, key, value) {
  return new RegExp(`${key}\\s*:\\s*${value}`).test(options);
}

/**
 * Filter enums to only those used by fields.
 *
 * @param {Array} fields — Parsed fields with optional enumName
 * @param {Object} fileEnums — All enums from the file
 * @returns {Array<{name, values}>}
 */
function relevantEnums(fields, fileEnums) {
  const used = new Set(fields.map(f => f.enumName).filter(Boolean));
  return Object.entries(fileEnums)
    .filter(([name]) => used.has(name))
    .map(([name, values]) => ({ name, values }));
}

/**
 * Sanitize a string to be used as an ID.
 */
function sanitizeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

module.exports = {
  extractEnums,
  extractClassBody,
  extractObjectBody,
  extractParenContent,
  hasOption,
  relevantEnums,
  sanitizeId,
};
