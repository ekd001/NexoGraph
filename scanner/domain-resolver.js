/**
 * domain-resolver.js — Resolution automatique des domaines
 *
 * Responsabilite :
 *   Deduire le domaine (groupe logique) d'une collection a partir
 *   de son chemin dans l'arborescence du projet.
 *
 * Strategie :
 *   On extrait le nom du module/app/lib depuis le chemin du fichier source.
 *   Exemples :
 *     apps/payment-service/src/schemas/payment.schema.ts  → "payment-service"
 *     libs/auth/src/entities/user.entity.ts               → "auth"
 *     src/modules/users/models/user.model.ts              → "users"
 *     src/workspace/workspace.schema.ts                   → "workspace"
 *
 *   Ensuite on genere une couleur unique et stable pour chaque domaine
 *   (basee sur un hash du nom → meme couleur a chaque scan).
 */

/**
 * Palette de couleurs predefinies pour les premiers domaines.
 * Au-dela de cette palette, on genere des couleurs via hash.
 */
const COLOR_PALETTE = [
  '#6c8cff', '#a78bfa', '#f59e0b', '#ec4899', '#14b8a6',
  '#f97316', '#22d3ee', '#ef4444', '#84cc16', '#8b5cf6',
  '#06b6d4', '#f472b6', '#10b981', '#fbbf24', '#c084fc',
  '#64748b', '#fb923c', '#34d399', '#818cf8', '#e879f9',
];

/**
 * Extrait le nom du domaine depuis le chemin relatif du fichier.
 *
 * Regles de resolution (par priorite) :
 *   1. apps/<nom>/...     → <nom>
 *   2. libs/<nom>/...     → <nom>
 *   3. packages/<nom>/... → <nom>
 *   4. services/<nom>/... → <nom>
 *   5. src/modules/<nom>/ → <nom>
 *   6. src/<nom>/...      → <nom> (si src a des sous-dossiers)
 *   7. modules/<nom>/...  → <nom>
 *   8. Sinon              → nom du dossier parent du fichier
 *
 * @param {string} relativePath — Chemin du fichier relatif a la racine du projet
 * @returns {string} — Nom du domaine (slug, ex: "payment-service")
 */
function resolveDomainFromPath(relativePath) {
  const parts = relativePath.split(/[/\\]/);

  // Patterns connus de structure de projet
  const patterns = [
    // Monorepo NestJS / Nx / Turborepo
    { prefix: 'apps', depth: 1 },
    { prefix: 'libs', depth: 1 },
    { prefix: 'packages', depth: 1 },
    { prefix: 'services', depth: 1 },
    // Structure classique avec src/modules
    { prefix: 'src/modules', depth: 2, match: (p) => p[0] === 'src' && p[1] === 'modules' ? p[2] : null },
    // src/<module>/
    { prefix: 'src', depth: 1, match: (p) => p[0] === 'src' && p.length > 2 ? p[1] : null },
    // modules/<module>/
    { prefix: 'modules', depth: 1 },
  ];

  for (const pattern of patterns) {
    if (pattern.match) {
      const result = pattern.match(parts);
      if (result) return cleanDomainName(result);
    }

    const idx = parts.indexOf(pattern.prefix);
    if (idx !== -1 && parts.length > idx + pattern.depth) {
      return cleanDomainName(parts[idx + pattern.depth]);
    }
  }

  // Fallback : dossier parent du fichier
  if (parts.length >= 2) {
    return cleanDomainName(parts[parts.length - 2]);
  }

  return 'default';
}

/**
 * Nettoie le nom du domaine :
 *   - Retire les suffixes generiques (-service, -module, -lib)
 *   - Met en minuscule
 *   - Garde les tirets pour la lisibilite
 *
 * @param {string} name — Nom brut
 * @returns {string} — Nom nettoye
 */
function cleanDomainName(name) {
  return name
    .toLowerCase()
    .replace(/-service$/, '')
    .replace(/-module$/, '')
    .replace(/-lib$/, '')
    .trim();
}

/**
 * Formate un slug en label lisible.
 *   "payment-gateway" → "Payment Gateway"
 *   "auth" → "Auth"
 *
 * @param {string} slug — ex: "payment-gateway"
 * @returns {string} — ex: "Payment Gateway"
 */
function formatDomainLabel(slug) {
  return slug
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Genere une couleur deterministe a partir d'un string.
 * Meme input → meme couleur, toujours.
 *
 * @param {string} str — Le nom du domaine
 * @returns {string} — Couleur hex (#rrggbb)
 */
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generer une couleur avec saturation et luminosite controlees
  // pour qu'elle soit toujours lisible sur fond sombre ET clair
  const h = Math.abs(hash) % 360;
  const s = 55 + (Math.abs(hash >> 8) % 25);   // 55-80%
  const l = 55 + (Math.abs(hash >> 16) % 15);   // 55-70%
  return hslToHex(h, s, l);
}

/**
 * Convertit HSL en hex.
 */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Construit la liste des domaines a partir des collections scannees.
 * Attribue une couleur de la palette (ou generee) a chaque domaine.
 *
 * @param {Array} collections — Collections avec domainId deja resolu
 * @returns {Array<{id, name, color}>} — Domaines avec leurs couleurs
 */
function buildDomainList(collections) {
  const seen = new Map();
  let colorIdx = 0;

  for (const col of collections) {
    if (!seen.has(col.domainId)) {
      const color = colorIdx < COLOR_PALETTE.length
        ? COLOR_PALETTE[colorIdx]
        : hashColor(col.domainId);

      seen.set(col.domainId, {
        id: col.domainId,
        name: formatDomainLabel(col.domainId),
        color,
      });
      colorIdx++;
    }
  }

  return [...seen.values()];
}

module.exports = { resolveDomainFromPath, buildDomainList, formatDomainLabel };
