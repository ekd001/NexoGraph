/**
 * renderer.js — Rendering engine v2
 *
 * Clean render with proper cleanup between view switches.
 * List view uses a dedicated wrapper to avoid ghost elements.
 */

const Renderer = (() => {

  let container = null;
  let wrapper = null;     // For canvas views (domains/graph)
  let listWrapper = null; // Separate wrapper for list view
  let svgLayer = null;
  let currentData = null;
  let currentLayout = null;
  let selectedNodeId = null;
  let viewMode = 'domains';
  let activeDomains = new Set();
  let searchQuery = '';

  // Pan & zoom
  let scale = 1, panX = 0, panY = 0;
  let isPanning = false, panStartX = 0, panStartY = 0;

  // Callbacks
  let onNodeSelect = null, onNodeDeselect = null;

  // ── INIT ────────────────────────────────
  function init(el, callbacks) {
    container = el;
    onNodeSelect = callbacks.onSelect;
    onNodeDeselect = callbacks.onDeselect;

    // Canvas wrapper (domains & graph views)
    wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;';
    container.appendChild(wrapper);

    // SVG for relation lines — z-index:1 so lines stay behind nodes (z-index:2)
    svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;z-index:1;';
    wrapper.appendChild(svgLayer);

    // Arrow marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('viewBox', '0 -5 10 10');
    marker.setAttribute('refX', '10'); marker.setAttribute('refY', '0');
    marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M0,-4L10,0L0,4');
    arrow.setAttribute('fill', 'var(--text-muted)');
    marker.appendChild(arrow); defs.appendChild(marker); svgLayer.appendChild(defs);

    // List view wrapper (separate from canvas)
    listWrapper = document.createElement('div');
    listWrapper.className = 'list-view-wrapper';
    listWrapper.style.display = 'none';
    container.appendChild(listWrapper);

    // Events
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseUp);
    container.addEventListener('click', (e) => {
      if (e.target === container || e.target === wrapper) deselect();
    });
  }

  // ── RENDER ──────────────────────────────
  function render(data) {
    currentData = data;
    activeDomains = new Set(data.domains.map(d => d.id));

    if (viewMode === 'list') {
      wrapper.style.display = 'none';
      listWrapper.style.display = 'block';
      renderList(data);
    } else {
      listWrapper.style.display = 'none';
      wrapper.style.display = 'block';
      renderCanvas(data);
    }
  }

  function renderCanvas(data) {
    if (!data.collections || data.collections.length === 0) {
      wrapper.innerHTML = `<div class="detail-empty" style="height:100%"><p>${I18N.t('projects.empty')}</p></div>`;
      return;
    }

    const w = container.clientWidth;
    const h = container.clientHeight;

    currentLayout = viewMode === 'graph'
      ? Layout.dagreGraph(data, w, h)
      : Layout.domainGrid(data, w - 60);

    // Clear previous nodes/boxes (keep SVG defs)
    wrapper.querySelectorAll('.domain-box, .node').forEach(el => el.remove());
    svgLayer.querySelectorAll('.rel-line').forEach(el => el.remove());

    const { nodes, domainBoxes } = currentLayout;

    svgLayer.setAttribute('width', currentLayout.totalWidth);
    svgLayer.setAttribute('height', currentLayout.totalHeight);

    // Domain boxes
    domainBoxes.forEach(box => {
      const el = document.createElement('div');
      el.className = 'domain-box';
      el.dataset.domainId = box.id;
      el.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;`;
      el.innerHTML = `<div class="domain-box-title">
        <span class="domain-dot" style="background:${box.color};width:8px;height:8px;border-radius:50%"></span>
        ${box.name}
        <span class="badge" style="margin-left:auto">${box.collectionCount}</span>
      </div>`;
      wrapper.appendChild(el);
    });

    // Nodes
    const nodeMap = new Map();
    nodes.forEach(node => {
      const el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = node.id;
      el.textContent = node.name;
      el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;border-left:3px solid ${node.color};`;
      el.addEventListener('click', (e) => { e.stopPropagation(); selectNode(node.id); });
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); focusOnNode(node.id); });
      wrapper.appendChild(el);
      nodeMap.set(node.id, { el, node });
    });

    // Relations — use dagre edge routes if available, otherwise bezier curves
    if (currentLayout.edgeRoutes) {
      renderDagreEdges(currentLayout.edgeRoutes, nodeMap);
    } else {
      renderRelations(data.relations, nodeMap);
    }
    applyFilters();
    resetView();
  }

  function renderRelations(relations, nodeMap) {
    svgLayer.querySelectorAll('path.rel-line').forEach(el => el.remove());

    relations.forEach(rel => {
      const se = nodeMap.get(rel.source), te = nodeMap.get(rel.target);
      if (!se || !te) return;
      const s = se.node, t = te.node;

      // Compute connection points (right edge → left edge)
      const sx = s.x + s.width, sy = s.y + s.height / 2;
      const tx = t.x, ty = t.y + t.height / 2;
      const dx = Math.abs(tx - sx);
      const cp = Math.max(50, dx * 0.4);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${sx},${sy} C${sx + cp},${sy} ${tx - cp},${ty} ${tx},${ty}`);
      path.setAttribute('class', 'rel-line');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--border)');
      path.setAttribute('stroke-width', rel.type === 'many-to-many' ? '2' : '1.5');
      path.setAttribute('stroke-dasharray', rel.type === 'many-to-many' ? '6,4' : 'none');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      path.dataset.source = rel.source;
      path.dataset.target = rel.target;
      path.style.opacity = '0.25';
      path.style.transition = 'opacity .15s, stroke .15s';
      svgLayer.appendChild(path);
    });
  }

  /**
   * Render edges using dagre's computed waypoints.
   * Produces clean, routed polylines with no crossover.
   */
  function renderDagreEdges(edgeRoutes, nodeMap) {
    svgLayer.querySelectorAll('.rel-line').forEach(el => el.remove());

    edgeRoutes.forEach(route => {
      if (!route.points || route.points.length < 2) return;

      // Build a smooth path through dagre's waypoints
      const pts = route.points;
      let d = `M${pts[0].x},${pts[0].y}`;

      if (pts.length === 2) {
        // Straight line
        d += ` L${pts[1].x},${pts[1].y}`;
      } else {
        // Smooth curve through waypoints
        for (let i = 1; i < pts.length - 1; i++) {
          const cur = pts[i];
          const next = pts[i + 1];
          const midX = (cur.x + next.x) / 2;
          const midY = (cur.y + next.y) / 2;
          d += ` Q${cur.x},${cur.y} ${midX},${midY}`;
        }
        const last = pts[pts.length - 1];
        d += ` L${last.x},${last.y}`;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'rel-line');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--border-hover)');
      path.setAttribute('stroke-width', route.type === 'many-to-many' ? '2' : '1.5');
      path.setAttribute('stroke-dasharray', route.type === 'many-to-many' ? '6,4' : 'none');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      path.dataset.source = route.source;
      path.dataset.target = route.target;
      path.style.opacity = '0.35';
      path.style.transition = 'opacity .15s, stroke .15s';
      svgLayer.appendChild(path);
    });
  }

  function renderList(data) {
    const connectionCounts = Layout.computeConnectionCounts(data);
    const domainMap = new Map(data.domains.map(d => [d.id, d]));

    const sorted = [...data.collections].sort((a, b) =>
      (connectionCounts[b.id] || 0) - (connectionCounts[a.id] || 0)
    );

    listWrapper.innerHTML = `<table class="list-table">
      <thead><tr>
        <th>${I18N.t('list.name')}</th>
        <th>${I18N.t('list.domain')}</th>
        <th>${I18N.t('list.db')}</th>
        <th>${I18N.t('list.fields')}</th>
        <th>${I18N.t('list.relations')}</th>
      </tr></thead>
      <tbody>${sorted.map(col => {
        const domain = domainMap.get(col.domainId);
        const conns = connectionCounts[col.id] || 0;
        return `<tr data-id="${col.id}">
          <td class="col-name">${col.name}</td>
          <td><span class="domain-dot" style="background:${domain?.color || '#94a3b8'};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle"></span>${domain?.name || col.domainId}</td>
          <td>${col.db}</td>
          <td>${col.fields.length}</td>
          <td>${conns > 0 ? `<span class="badge badge-accent">${conns}</span>` : `<span class="badge badge-danger">0</span>`}</td>
        </tr>`;
      }).join('')}</tbody></table>`;

    listWrapper.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => selectNode(tr.dataset.id));
    });
  }

  // ── SELECTION ───────────────────────────
  function selectNode(id) {
    selectedNodeId = id;

    const connected = new Set([id]);
    if (currentData) {
      currentData.relations.forEach(r => {
        if (r.source === id) connected.add(r.target);
        if (r.target === id) connected.add(r.source);
      });
    }

    wrapper.querySelectorAll('.node').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
      el.classList.toggle('dimmed', !connected.has(el.dataset.id));
    });

    svgLayer.querySelectorAll('.rel-line').forEach(line => {
      const related = line.dataset.source === id || line.dataset.target === id;
      line.style.opacity = related ? '0.9' : '0.04';
      line.style.stroke = related ? 'var(--accent)' : 'var(--border)';
    });

    if (onNodeSelect) onNodeSelect(id);
  }

  function deselect() {
    selectedNodeId = null;
    wrapper.querySelectorAll('.node').forEach(el => el.classList.remove('selected', 'dimmed'));
    svgLayer.querySelectorAll('.rel-line').forEach(line => {
      line.style.opacity = '0.25'; line.style.stroke = 'var(--border)';
    });
    if (onNodeDeselect) onNodeDeselect();
  }

  /**
   * Focus mode: double-click a node to zoom + center on it and its neighbors.
   * Pan and zoom so the selected node and its direct connections fill the viewport.
   */
  function focusOnNode(id) {
    selectNode(id);

    if (!currentData) return;

    // Find this node and all connected nodes
    const connected = new Set([id]);
    currentData.relations.forEach(r => {
      if (r.source === id) connected.add(r.target);
      if (r.target === id) connected.add(r.source);
    });

    // Compute bounding box of connected nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    wrapper.querySelectorAll('.node').forEach(el => {
      if (!connected.has(el.dataset.id)) return;
      const x = parseFloat(el.style.left);
      const y = parseFloat(el.style.top);
      const w = parseFloat(el.style.width);
      const h = parseFloat(el.style.height);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    });

    if (minX === Infinity) return; // No nodes found

    // Add padding around the bounding box
    const pad = 80;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const boxW = maxX - minX;
    const boxH = maxY - minY;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    // Compute scale to fit the bounding box in the viewport
    const newScale = Math.min(cw / boxW, ch / boxH, 1.5);

    // Compute pan to center the box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    panX = cw / 2 - centerX * newScale;
    panY = ch / 2 - centerY * newScale;
    scale = newScale;

    // Smooth transition
    wrapper.style.transition = 'transform 0.4s ease';
    applyTransform();
    setTimeout(() => { wrapper.style.transition = ''; }, 400);
  }

  // ── FILTERS ─────────────────────────────
  function setDomainFilter(domains) { activeDomains = new Set(domains); applyFilters(); }
  function setSearchFilter(query) { searchQuery = query.toLowerCase(); applyFilters(); }

  function applyFilters() {
    const colMap = new Map();
    if (currentData) currentData.collections.forEach(c => colMap.set(c.id, c));
    const vis = new Map();

    // Filter canvas nodes
    wrapper.querySelectorAll('.node').forEach(el => {
      const col = colMap.get(el.dataset.id);
      if (!col) return;
      const ok = activeDomains.has(col.domainId) && (!searchQuery || col.name.toLowerCase().includes(searchQuery));
      el.style.display = ok ? '' : 'none';
      vis.set(el.dataset.id, ok);
    });

    wrapper.querySelectorAll('.domain-box').forEach(el => {
      el.style.display = el.dataset.domainId && activeDomains.has(el.dataset.domainId) ? '' : 'none';
    });

    svgLayer.querySelectorAll('.rel-line').forEach(line => {
      line.style.display = vis.get(line.dataset.source) && vis.get(line.dataset.target) ? '' : 'none';
    });

    // Filter list view rows (same logic)
    listWrapper.querySelectorAll('tr[data-id]').forEach(tr => {
      const col = colMap.get(tr.dataset.id);
      if (!col) return;
      const ok = activeDomains.has(col.domainId) && (!searchQuery || col.name.toLowerCase().includes(searchQuery));
      tr.style.display = ok ? '' : 'none';
      // Highlight matching text in name cell
      const nameCell = tr.querySelector('.col-name');
      if (nameCell && searchQuery) {
        const name = col.name;
        const idx = name.toLowerCase().indexOf(searchQuery);
        if (idx >= 0) {
          nameCell.innerHTML = name.substring(0, idx) +
            '<mark style="background:var(--accent-soft);color:var(--accent);border-radius:2px;padding:0 2px">' +
            name.substring(idx, idx + searchQuery.length) + '</mark>' +
            name.substring(idx + searchQuery.length);
        } else {
          nameCell.textContent = name;
        }
      } else if (nameCell) {
        nameCell.textContent = col.name;
      }
    });
  }

  /**
   * Scroll and zoom to center on a specific domain box.
   * Called when user clicks a domain chip in the sidebar.
   */
  function scrollToDomain(domainId) {
    const box = wrapper.querySelector(`.domain-box[data-domain-id="${domainId}"]`);
    if (!box) return;

    const x = parseFloat(box.style.left);
    const y = parseFloat(box.style.top);
    const w = parseFloat(box.style.width);
    const h = parseFloat(box.style.height);

    const cw = container.clientWidth;
    const ch = container.clientHeight;

    // Zoom to fit the domain box with padding
    const pad = 60;
    const newScale = Math.min(cw / (w + pad * 2), ch / (h + pad * 2), 1.2);
    const cx = x + w / 2;
    const cy = y + h / 2;

    panX = cw / 2 - cx * newScale;
    panY = ch / 2 - cy * newScale;
    scale = newScale;

    wrapper.style.transition = 'transform .35s ease';
    applyTransform();
    setTimeout(() => { wrapper.style.transition = ''; }, 350);
  }

  // ── VIEW MODE ───────────────────────────
  function setViewMode(mode) {
    viewMode = mode;
    if (currentData) render(currentData);
  }

  // ── PAN & ZOOM ──────────────────────────
  function applyTransform() {
    wrapper.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
  }

  function onWheel(e) {
    if (viewMode === 'list') return;
    e.preventDefault();
    const d = e.deltaY > 0 ? 0.92 : 1.08;
    const ns = Math.max(0.15, Math.min(3, scale * d));
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    panX = mx - (mx - panX) * (ns / scale);
    panY = my - (my - panY) * (ns / scale);
    scale = ns;
    applyTransform();
  }

  function onMouseDown(e) {
    if (viewMode === 'list' || e.target.closest('.node')) return;
    isPanning = true;
    panStartX = e.clientX - panX; panStartY = e.clientY - panY;
    container.style.cursor = 'grabbing';
  }
  function onMouseMove(e) {
    if (!isPanning) return;
    panX = e.clientX - panStartX; panY = e.clientY - panStartY;
    applyTransform();
  }
  function onMouseUp() { isPanning = false; container.style.cursor = ''; }

  function resetView() { scale = 0.9; panX = 20; panY = 20; applyTransform(); }
  function zoomIn() { scale = Math.min(3, scale * 1.2); applyTransform(); }
  function zoomOut() { scale = Math.max(0.15, scale * 0.8); applyTransform(); }

  return {
    init, render, selectNode, deselect,
    setDomainFilter, setSearchFilter, setViewMode, scrollToDomain,
    getViewMode: () => viewMode, resetView, zoomIn, zoomOut,
    getSelectedId: () => selectedNodeId, getData: () => currentData,
  };
})();
