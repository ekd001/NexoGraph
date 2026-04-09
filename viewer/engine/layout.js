/**
 * layout.js — Layout engine v3
 *
 * Two layout modes:
 *   1. domainGrid — Collections grouped by domain in clean, spacious boxes
 *   2. dagreGraph — Uses dagre.js hierarchical layout (no overlap, proper routing)
 *
 * Design principles (from DrawSQL, ChartDB, Redgate best practices):
 *   - Nodes auto-size to text width (never clipped)
 *   - Generous spacing between nodes (no cramming)
 *   - Domain boxes sized to content with breathing room
 *   - Graph layout uses dagre for hierarchical, zero-overlap positioning
 */

const Layout = (() => {

  // ── Node sizing constants ──────────────
  const NODE_PAD_X = 36;       // Horizontal padding inside a node
  const NODE_HEIGHT = 36;      // Fixed node height
  const NODE_GAP_X = 16;       // Horizontal gap between nodes in a row
  const NODE_GAP_Y = 12;       // Vertical gap between rows
  const DOMAIN_PAD = 20;       // Padding inside domain box (sides/bottom)
  const DOMAIN_PAD_TOP = 48;   // Top padding (for title bar)
  const DOMAIN_GAP = 32;       // Gap between domain boxes
  const MAX_COLS = 3;          // Max nodes per row inside a domain box

  // ── Text measurement ───────────────────
  const _canvas = document.createElement('canvas');
  const _ctx = _canvas.getContext('2d');
  _ctx.font = '600 13px Inter, sans-serif';

  function measureText(text) {
    return _ctx.measureText(text).width;
  }

  function nodeWidth(name) {
    return Math.max(120, measureText(name) + NODE_PAD_X);
  }

  // ═══════════════════════════════════════════
  // DOMAIN GRID LAYOUT
  // ═══════════════════════════════════════════

  /**
   * Groups collections by domain in clean card-like boxes.
   * Uses masonry column packing for optimal space usage.
   */
  function domainGrid(data, containerWidth) {
    const { collections, domains } = data;
    const connectionCounts = computeConnectionCounts(data);

    // ── Group by domain ──
    const groups = new Map();
    domains.forEach(d => groups.set(d.id, { domain: d, items: [] }));
    collections.forEach(c => {
      let g = groups.get(c.domainId);
      if (!g) {
        g = { domain: { id: c.domainId, name: c.domainId, color: '#94a3b8' }, items: [] };
        groups.set(c.domainId, g);
      }
      g.items.push(c);
    });

    // Sort domains so that those sharing cross-domain relations are placed adjacent.
    // Algorithm: greedy walk — start with most-connected domain, then always pick
    // the unplaced domain that has the most relations to already-placed domains.
    const allGroups = [...groups.values()].filter(g => g.items.length > 0);

    // Build domain-to-domain adjacency weights from cross-domain relations
    const domainAdj = new Map(); // domainId → Map<domainId, weight>
    for (const rel of data.relations) {
      const colS = collections.find(c => c.id === rel.source);
      const colT = collections.find(c => c.id === rel.target);
      if (!colS || !colT || colS.domainId === colT.domainId) continue;
      for (const [a, b] of [[colS.domainId, colT.domainId], [colT.domainId, colS.domainId]]) {
        if (!domainAdj.has(a)) domainAdj.set(a, new Map());
        const m = domainAdj.get(a);
        m.set(b, (m.get(b) || 0) + 1);
      }
    }

    // Greedy ordering: start with the domain that has the most cross-domain edges
    const placed = new Set();
    const sortedGroups = [];

    // Seed: domain with most cross-domain connections
    allGroups.sort((a, b) => {
      const wA = domainAdj.has(a.domain.id) ? [...domainAdj.get(a.domain.id).values()].reduce((s, v) => s + v, 0) : 0;
      const wB = domainAdj.has(b.domain.id) ? [...domainAdj.get(b.domain.id).values()].reduce((s, v) => s + v, 0) : 0;
      return wB - wA;
    });

    while (sortedGroups.length < allGroups.length) {
      if (sortedGroups.length === 0) {
        // Pick the most connected domain as seed
        sortedGroups.push(allGroups[0]);
        placed.add(allGroups[0].domain.id);
      } else {
        // Pick the unplaced domain with the most connections to already-placed domains
        let bestGroup = null, bestScore = -1;
        for (const g of allGroups) {
          if (placed.has(g.domain.id)) continue;
          let score = 0;
          const adj = domainAdj.get(g.domain.id);
          if (adj) {
            for (const [otherId, weight] of adj) {
              if (placed.has(otherId)) score += weight;
            }
          }
          // Tiebreak: prefer bigger domains
          if (score > bestScore || (score === bestScore && (!bestGroup || g.items.length > bestGroup.items.length))) {
            bestScore = score;
            bestGroup = g;
          }
        }
        if (!bestGroup) {
          // Remaining isolated domains — just add them
          for (const g of allGroups) {
            if (!placed.has(g.domain.id)) { bestGroup = g; break; }
          }
        }
        sortedGroups.push(bestGroup);
        placed.add(bestGroup.domain.id);
      }
    }

    // Sort items inside each domain by connection count
    for (const g of sortedGroups) {
      g.items.sort((a, b) => (connectionCounts[b.id] || 0) - (connectionCounts[a.id] || 0));
    }

    const domainBoxes = [];
    const nodes = [];

    // ── Masonry column layout for domain boxes ──
    const maxBoxW = 560;
    const domainCols = Math.max(1, Math.floor((containerWidth + DOMAIN_GAP) / (maxBoxW + DOMAIN_GAP)));
    const colHeights = new Array(domainCols).fill(DOMAIN_GAP);

    for (const { domain, items } of sortedGroups) {
      // Compute individual node widths
      const widths = items.map(c => nodeWidth(c.name));

      // ── Pack nodes into rows (bin-packing) ──
      const rowMaxWidth = maxBoxW - DOMAIN_PAD * 2;
      const rows = [];
      let row = [], rowW = 0;

      for (let i = 0; i < items.length; i++) {
        const w = widths[i];
        // Start new row if current is full
        if (row.length >= MAX_COLS || (row.length > 0 && rowW + w + NODE_GAP_X > rowMaxWidth)) {
          rows.push(row);
          row = []; rowW = 0;
        }
        row.push({ col: items[i], width: w });
        rowW += w + NODE_GAP_X;
      }
      if (row.length > 0) rows.push(row);

      // ── Compute domain box dimensions ──
      let maxRowW = 0;
      for (const r of rows) {
        const rw = r.reduce((s, n) => s + n.width + NODE_GAP_X, -NODE_GAP_X);
        if (rw > maxRowW) maxRowW = rw;
      }

      const boxW = Math.max(220, maxRowW + DOMAIN_PAD * 2);
      const boxH = DOMAIN_PAD_TOP + rows.length * (NODE_HEIGHT + NODE_GAP_Y) - NODE_GAP_Y + DOMAIN_PAD + 4;

      // Place in shortest column
      const colIdx = colHeights.indexOf(Math.min(...colHeights));
      const boxX = DOMAIN_GAP + colIdx * (maxBoxW + DOMAIN_GAP);
      const boxY = colHeights[colIdx];
      colHeights[colIdx] += boxH + DOMAIN_GAP;

      domainBoxes.push({
        id: domain.id, name: domain.name, color: domain.color,
        x: boxX, y: boxY, width: boxW, height: boxH,
        collectionCount: items.length,
      });

      // ── Position nodes inside the box ──
      let rowY = boxY + DOMAIN_PAD_TOP;
      for (const r of rows) {
        let x = boxX + DOMAIN_PAD;
        for (const { col, width } of r) {
          nodes.push({
            id: col.id, name: col.name, domainId: domain.id, color: domain.color,
            x, y: rowY, width, height: NODE_HEIGHT,
          });
          x += width + NODE_GAP_X;
        }
        rowY += NODE_HEIGHT + NODE_GAP_Y;
      }
    }

    return {
      nodes, domainBoxes,
      totalWidth: domainCols * (maxBoxW + DOMAIN_GAP) + DOMAIN_GAP,
      totalHeight: Math.max(...colHeights) + DOMAIN_GAP,
    };
  }

  // ═══════════════════════════════════════════
  // DAGRE HIERARCHICAL LAYOUT
  // ═══════════════════════════════════════════

  /**
   * Uses dagre.js for a proper hierarchical graph layout.
   * Dagre guarantees no node overlap and computes clean edge routing.
   * Groups related nodes naturally by their connection structure.
   *
   * @param {Object} data — { collections, domains, relations }
   * @param {number} width — Container width (for fallback)
   * @param {number} height — Container height (for fallback)
   */
  function dagreGraph(data, width, height) {
    const { collections, domains, relations } = data;
    const domainMap = new Map(domains.map(d => [d.id, d]));

    // Create dagre graph
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'LR',          // Left to right (standard for ER diagrams)
      nodesep: 60,             // Vertical spacing between nodes in same rank
      ranksep: 150,            // Horizontal spacing between ranks
      edgesep: 30,             // Spacing between edges
      marginx: 50,
      marginy: 50,
      acyclicer: 'greedy',
      ranker: 'network-simplex', // Most precise ranker for large graphs
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes with their dimensions
    for (const col of collections) {
      const w = nodeWidth(col.name);
      g.setNode(col.id, { width: w, height: NODE_HEIGHT });
    }

    // Add edges (relations)
    for (const rel of relations) {
      // Only add if both nodes exist
      if (g.hasNode(rel.source) && g.hasNode(rel.target)) {
        g.setEdge(rel.source, rel.target);
      }
    }

    // Run dagre layout
    dagre.layout(g);

    // Extract node positions
    const nodes = [];
    for (const col of collections) {
      const domain = domainMap.get(col.domainId) || { color: '#94a3b8' };
      const nodeData = g.node(col.id);
      if (!nodeData) continue;

      const w = nodeWidth(col.name);
      nodes.push({
        id: col.id, name: col.name, domainId: col.domainId, color: domain.color,
        // dagre gives center coordinates, convert to top-left
        x: nodeData.x - w / 2,
        y: nodeData.y - NODE_HEIGHT / 2,
        width: w,
        height: NODE_HEIGHT,
      });
    }

    // Extract edge points for clean routing
    const edgeRoutes = [];
    for (const rel of relations) {
      if (!g.hasNode(rel.source) || !g.hasNode(rel.target)) continue;
      const edge = g.edge(rel.source, rel.target);
      if (edge && edge.points) {
        edgeRoutes.push({
          source: rel.source,
          target: rel.target,
          type: rel.type,
          points: edge.points, // Array of {x, y} waypoints computed by dagre
        });
      }
    }

    // Compute canvas bounds
    const graphInfo = g.graph();
    const totalW = (graphInfo.width || width) + 80;
    const totalH = (graphInfo.height || height) + 80;

    return { nodes, domainBoxes: [], edgeRoutes, totalWidth: totalW, totalHeight: totalH };
  }

  // ═══════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════

  function computeConnectionCounts(data) {
    const counts = {};
    data.collections.forEach(c => counts[c.id] = 0);
    data.relations.forEach(r => {
      counts[r.source] = (counts[r.source] || 0) + 1;
      counts[r.target] = (counts[r.target] || 0) + 1;
    });
    return counts;
  }

  return { domainGrid, dagreGraph, computeConnectionCounts };
})();
