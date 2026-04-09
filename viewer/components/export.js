/**
 * export.js — Export & toast components
 *
 * Export formats:
 *   - PNG:   Canvas screenshot via html2canvas-style approach
 *   - SVG:   Serialize the SVG layer
 *   - NEXO:  Full project JSON with .nexo extension
 *   - JSON:  Raw project JSON
 *
 * Toast: simple notification system.
 */

// ─────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────

const Toast = (() => {
  /**
   * Show a toast notification.
   * @param {string} message — Text to display
   * @param {'success'|'error'|'info'} type — Style variant
   * @param {number} duration — Auto-dismiss in ms (default 3000)
   */
  function show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  return { show };
})();

// ─────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────

const ExportManager = (() => {

  let projectData = null;

  function init() {
    const btn = document.getElementById('btn-export');
    const menu = document.getElementById('export-menu');

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left = 'auto';
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    // Close on outside click
    document.addEventListener('click', () => {
      menu.style.display = 'none';
    });

    // Export actions
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        handleExport(item.dataset.export);
      });
    });
  }

  function setData(data) {
    projectData = data;
  }

  /**
   * Handle export by format.
   */
  function handleExport(format) {
    if (!projectData) return;

    switch (format) {
      case 'json':
        downloadJSON(projectData, `${projectData.project.name}.json`);
        Toast.show(I18N.t('export.success'), 'success');
        break;
      case 'nexo':
        downloadJSON(projectData, `${projectData.project.name}.nexo`);
        Toast.show(I18N.t('export.success'), 'success');
        break;
      case 'svg':
        exportSVG();
        Toast.show(I18N.t('export.success'), 'success');
        break;
      case 'png':
        exportPNG();
        Toast.show(I18N.t('export.success'), 'success');
        break;
      case 'pdf':
        exportPDF(); // Async — toast shown inside
        return;
    }
  }

  /**
   * Download data as a JSON file.
   */
  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
  }

  /**
   * Export the canvas as SVG.
   */
  function exportSVG() {
    const container = document.getElementById('canvas-container');
    const svgEl = container.querySelector('svg');
    if (!svgEl) {
      Toast.show(I18N.t('toast.error'), 'error');
      return;
    }

    // Clone and add styles
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    downloadBlob(blob, `${projectData.project.name}.svg`);
  }

  /**
   * Export the canvas as PNG using a temporary canvas.
   * Captures the DOM nodes as a simple schematic.
   */
  function exportPNG() {
    const container = document.getElementById('canvas-container');
    const nodes = container.querySelectorAll('.node');
    const domainBoxes = container.querySelectorAll('.domain-box');

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    nodes.forEach(n => {
      const x = parseInt(n.style.left);
      const y = parseInt(n.style.top);
      const w = n.offsetWidth;
      const h = n.offsetHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    const padding = 40;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    const canvas = document.createElement('canvas');
    canvas.width = width * 2;  // 2x for retina
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // Background
    const isDark = document.documentElement.dataset.theme === 'dark';
    ctx.fillStyle = isDark ? '#0f1117' : '#f5f6f8';
    ctx.fillRect(0, 0, width, height);

    // Domain boxes
    domainBoxes.forEach(box => {
      const x = parseInt(box.style.left) - minX + padding;
      const y = parseInt(box.style.top) - minY + padding;
      const w = parseInt(box.style.width);
      const h = parseInt(box.style.height);
      ctx.fillStyle = isDark ? '#242836' : '#f0f1f4';
      ctx.strokeStyle = isDark ? '#2e3345' : '#d4d7e0';
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 12);
      ctx.fill();
      ctx.stroke();
    });

    // Nodes
    nodes.forEach(n => {
      if (n.style.display === 'none') return;
      const x = parseInt(n.style.left) - minX + padding;
      const y = parseInt(n.style.top) - minY + padding;
      const w = n.offsetWidth;
      const h = n.offsetHeight;

      ctx.fillStyle = isDark ? '#1a1d27' : '#ffffff';
      ctx.strokeStyle = isDark ? '#2e3345' : '#d4d7e0';
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();

      // Left color bar
      ctx.fillStyle = n.style.borderLeftColor || '#6c8cff';
      ctx.fillRect(x, y + 2, 3, h - 4);

      // Text
      ctx.fillStyle = isDark ? '#e1e4ed' : '#1a1d27';
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillText(n.textContent, x + 10, y + h / 2 + 3);
    });

    canvas.toBlob(blob => {
      downloadBlob(blob, `${projectData.project.name}.png`);
    });
  }

  // ── Helpers ──────────────────────────

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── PDF Export (pdfmake) ──────────────

  /**
   * Generate a professional PDF report of the project cartography.
   * Structure:
   *   1. Title page
   *   2. Overview table (domain → collection count → relation count)
   *   3. Per-domain detail: collection name, fields, relations
   *   4. Relations summary table
   */
  async function exportPDF() {
    if (!projectData) return;
    Toast.show(I18N.t('export.pdfGenerating'), 'info');

    const d = projectData;
    const t = I18N.t;
    const stats = d.project.stats || {};
    const domainMap = new Map(d.domains.map(dm => [dm.id, dm]));
    const connCounts = Layout.computeConnectionCounts(d);

    // Group collections by domain
    const byDomain = new Map();
    d.domains.forEach(dm => byDomain.set(dm.id, { domain: dm, items: [] }));
    d.collections.forEach(c => {
      const g = byDomain.get(c.domainId);
      if (g) g.items.push(c);
    });

    // ── Build document definition ──
    const content = [];

    // 1. Title page
    content.push(
      { text: '\n\n\n\n', fontSize: 12 },
      { text: d.project.name, fontSize: 28, bold: true, color: '#2563eb', alignment: 'center' },
      { text: '\n' },
      { text: 'Cartographie des Collections', fontSize: 18, alignment: 'center', color: '#64748b' },
      { text: '\n\n' },
      {
        columns: [
          { text: `${stats.totalCollections || 0} collections`, alignment: 'center', fontSize: 14, bold: true, color: '#2563eb' },
          { text: `${stats.totalRelations || 0} relations`, alignment: 'center', fontSize: 14, bold: true, color: '#2563eb' },
          { text: `${stats.domainCount || 0} domaines`, alignment: 'center', fontSize: 14, bold: true, color: '#2563eb' },
        ],
      },
      { text: '\n\n' },
      { text: `${t('projects.scannedAt')} ${new Date(d.project.scannedAt).toLocaleDateString()} — ${stats.scanTimeMs || '?'}ms`, alignment: 'center', fontSize: 11, color: '#94a3b8' },
      { text: d.project.path || '', alignment: 'center', fontSize: 10, color: '#94a3b8', margin: [0, 4, 0, 0] },
      { text: '', pageBreak: 'after' }
    );

    // 2. Overview table
    content.push(
      { text: 'Vue d\'ensemble par domaine', fontSize: 18, bold: true, margin: [0, 0, 0, 12] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 60, 60],
          body: [
            [
              { text: 'Domaine', bold: true, fillColor: '#f0f1f4' },
              { text: 'Collections', bold: true, fillColor: '#f0f1f4', alignment: 'center' },
              { text: 'Relations', bold: true, fillColor: '#f0f1f4', alignment: 'center' },
            ],
            ...[...byDomain.values()]
              .filter(g => g.items.length > 0)
              .sort((a, b) => b.items.length - a.items.length)
              .map(g => {
                const rels = d.relations.filter(r =>
                  g.items.some(c => c.id === r.source || c.id === r.target)
                ).length;
                return [
                  { text: g.domain.name, color: g.domain.color },
                  { text: String(g.items.length), alignment: 'center' },
                  { text: String(rels), alignment: 'center' },
                ];
              }),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: '', pageBreak: 'after' }
    );

    // 3. Per-domain detail pages
    const domainEntries = [...byDomain.values()].filter(g => g.items.length > 0);
    for (let di = 0; di < domainEntries.length; di++) {
      const { domain, items } = domainEntries[di];
      items.sort((a, b) => a.name.localeCompare(b.name));

      content.push(
        { text: domain.name, fontSize: 16, bold: true, color: domain.color, margin: [0, 0, 0, 8] },
        { text: `${items.length} collections`, fontSize: 11, color: '#94a3b8', margin: [0, 0, 0, 12] }
      );

      for (const col of items) {
        const outRels = d.relations.filter(r => r.source === col.id);
        const inRels = d.relations.filter(r => r.target === col.id);

        content.push(
          { text: col.name, fontSize: 13, bold: true, margin: [0, 8, 0, 4] },
          { text: `${col.db} — ${col.fields.length} ${t('detail.fields')} — ${outRels.length + inRels.length} ${t('detail.relations')}`, fontSize: 10, color: '#64748b', margin: [0, 0, 0, 4] }
        );

        // Fields table
        if (col.fields.length > 0) {
          const fieldRows = col.fields.map(f => [
            { text: f.name, font: 'Roboto', fontSize: 9 },
            { text: f.type, fontSize: 9, color: '#64748b' },
            { text: [f.required ? 'req' : '', f.unique ? ' uniq' : '', f.ref ? ' → ' + f.ref : ''].join('').trim() || '—', fontSize: 9, color: f.ref ? '#2563eb' : '#94a3b8' },
          ]);

          content.push({
            table: {
              headerRows: 1,
              widths: ['30%', '35%', '35%'],
              body: [
                [
                  { text: t('detail.fields'), bold: true, fontSize: 9, fillColor: '#f8f9fb' },
                  { text: 'Type', bold: true, fontSize: 9, fillColor: '#f8f9fb' },
                  { text: 'Flags', bold: true, fontSize: 9, fillColor: '#f8f9fb' },
                ],
                ...fieldRows,
              ],
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 4],
          });
        }

        // Relations
        if (outRels.length > 0) {
          content.push({
            ul: outRels.map(r => {
              const target = d.collections.find(c => c.id === r.target);
              return { text: `→ ${target?.name || r.target} (via ${r.field}, ${r.type})`, fontSize: 9, color: '#2563eb' };
            }),
            margin: [10, 2, 0, 4],
          });
        }
      }

      // Page break between domains (except last)
      if (di < domainEntries.length - 1) {
        content.push({ text: '', pageBreak: 'after' });
      }
    }

    // 4. Relations summary
    content.push(
      { text: '', pageBreak: 'before' },
      { text: 'Relations', fontSize: 18, bold: true, margin: [0, 0, 0, 12] },
      {
        table: {
          headerRows: 1,
          widths: ['30%', '30%', '20%', '20%'],
          body: [
            [
              { text: 'Source', bold: true, fontSize: 10, fillColor: '#f0f1f4' },
              { text: 'Target', bold: true, fontSize: 10, fillColor: '#f0f1f4' },
              { text: 'Via', bold: true, fontSize: 10, fillColor: '#f0f1f4' },
              { text: 'Type', bold: true, fontSize: 10, fillColor: '#f0f1f4' },
            ],
            ...d.relations.map(r => [
              { text: r.source, fontSize: 9 },
              { text: r.target, fontSize: 9, color: '#2563eb' },
              { text: r.field, fontSize: 9, font: 'Roboto' },
              { text: r.type, fontSize: 9, color: '#64748b' },
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      }
    );

    // Generate PDF
    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      defaultStyle: { font: 'Roboto', fontSize: 11 },
      content,
      footer: (currentPage, pageCount) => ({
        columns: [
          { text: d.project.name, fontSize: 8, color: '#94a3b8', margin: [40, 0, 0, 0] },
          { text: `${currentPage} / ${pageCount}`, fontSize: 8, color: '#94a3b8', alignment: 'right', margin: [0, 0, 40, 0] },
        ],
      }),
    };

    try {
      pdfMake.createPdf(docDefinition).download(`${d.project.name} - Cartographie.pdf`);
      Toast.show(I18N.t('export.success'), 'success');
    } catch (err) {
      Toast.show(I18N.t('toast.error') + ': ' + err.message, 'error');
    }
  }

  return { init, setData };
})();
