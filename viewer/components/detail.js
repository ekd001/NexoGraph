/**
 * detail.js — Detail panel component
 *
 * Shows full details of a selected collection:
 *   - Name, domain, database, source path
 *   - Metrics (fields count, outgoing/incoming relations, refs)
 *   - Outgoing relations (clickable → navigate to target)
 *   - Incoming relations (clickable → navigate to source)
 *   - Fields list with types, refs, enums
 *   - Enums with values
 */

const Detail = (() => {

  let data = null;  // Current project data

  /**
   * Set the project data (called when a project is loaded).
   */
  function setData(projectData) {
    data = projectData;
  }

  /**
   * Show the detail panel for a collection.
   *
   * @param {string} collectionId — ID of the collection to show
   */
  function show(collectionId) {
    if (!data) return;

    const col = data.collections.find(c => c.id === collectionId);
    if (!col) return;

    const domain = data.domains.find(d => d.id === col.domainId);
    const outgoing = data.relations.filter(r => r.source === collectionId);
    const incoming = data.relations.filter(r => r.target === collectionId);
    const totalConns = outgoing.length + incoming.length;

    // Connection status badge
    let statusBadge;
    if (totalConns === 0) statusBadge = `<span class="badge badge-danger">${I18N.t('detail.isolated')}</span>`;
    else if (totalConns >= 4) statusBadge = `<span class="badge badge-success">${I18N.t('detail.hub')}</span>`;
    else statusBadge = `<span class="badge badge-accent">${I18N.t('detail.connected')}</span>`;

    // Count fields that are refs
    const refCount = col.fields.filter(f => f.ref).length;

    // Build HTML
    const html = `
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-title">
          ${col.name}
          ${statusBadge}
        </div>
        <div class="detail-meta">
          <span><span class="chip-dot" style="background:${domain?.color || '#94a3b8'};display:inline-block;margin-right:3px"></span>${domain?.name || col.domainId}</span>
          <span>${I18N.t('detail.database')}: ${col.db}</span>
          ${col.inheritance ? `<span>${I18N.t('detail.inheritance')}: ${col.inheritance}</span>` : ''}
        </div>
        <div class="detail-meta" style="margin-top:4px">
          <span>${I18N.t('detail.source')}: <span style="font-family:var(--font-mono);font-size:var(--font-xs)">${col.sourcePath || '—'}</span></span>
        </div>
      </div>

      <!-- Metrics -->
      <div class="detail-section">
        <h4>${I18N.t('detail.metrics')}</h4>
        <div class="detail-metrics">
          <div class="detail-metric">
            <div class="m-value">${col.fields.length}</div>
            <div class="m-label">${I18N.t('detail.fields')}</div>
          </div>
          <div class="detail-metric">
            <div class="m-value">${refCount}</div>
            <div class="m-label">${I18N.t('detail.refs')}</div>
          </div>
          <div class="detail-metric">
            <div class="m-value">${outgoing.length}</div>
            <div class="m-label">${I18N.t('detail.outgoing')}</div>
          </div>
          <div class="detail-metric">
            <div class="m-value">${incoming.length}</div>
            <div class="m-label">${I18N.t('detail.incoming')}</div>
          </div>
        </div>
      </div>

      <!-- Relations -->
      <div class="detail-section">
        <h4>${I18N.t('detail.relations')} (${totalConns})</h4>
        ${totalConns === 0 ? `<p style="font-size:var(--font-sm);color:var(--text-muted)">${I18N.t('detail.noRelations')}</p>` : ''}
        ${outgoing.length > 0 ? `
          <div style="margin-bottom:6px;font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${I18N.t('detail.outgoing')} (${outgoing.length})</div>
          ${outgoing.map(r => relationCard(r, 'out')).join('')}
        ` : ''}
        ${incoming.length > 0 ? `
          <div style="margin-top:8px;margin-bottom:6px;font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${I18N.t('detail.incoming')} (${incoming.length})</div>
          ${incoming.map(r => relationCard(r, 'in')).join('')}
        ` : ''}
      </div>

      <!-- Fields -->
      <div class="detail-section">
        <h4>${I18N.t('detail.fields')} (${col.fields.length})</h4>
        <ul class="field-list">
          ${col.fields.map(f => fieldItem(f)).join('')}
        </ul>
      </div>

      <!-- Enums -->
      ${col.enums && col.enums.length > 0 ? `
        <div class="detail-section">
          <h4>${I18N.t('detail.enums')} (${col.enums.length})</h4>
          ${col.enums.map(e => `
            <div style="margin-bottom:6px">
              <span style="font-family:var(--font-mono);font-size:var(--font-xs);font-weight:600">${e.name}</span>
              <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">
                ${e.values.map(v => `<span class="badge">${v}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // Inject and reset scroll position
    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    emptyEl.style.display = 'none';
    contentEl.style.display = 'flex';
    contentEl.style.flexDirection = 'column';
    contentEl.innerHTML = html;
    document.getElementById('detail-panel').scrollTop = 0;

    // Bind relation card clicks
    contentEl.querySelectorAll('.relation-card').forEach(card => {
      card.addEventListener('click', () => {
        const targetId = card.dataset.target;
        Renderer.selectNode(targetId);
      });
    });
  }

  /**
   * Hide the detail panel (show empty state).
   */
  function hide() {
    document.getElementById('detail-empty').style.display = 'flex';
    document.getElementById('detail-content').style.display = 'none';
  }

  // ── Helpers ─────────────────────────────

  /**
   * Render a relation card.
   * @param {Object} rel — Relation object { source, target, field, type }
   * @param {'in'|'out'} direction
   */
  function relationCard(rel, direction) {
    const targetId = direction === 'out' ? rel.target : rel.source;
    const targetCol = data.collections.find(c => c.id === targetId);
    const targetName = targetCol?.name || targetId;
    const arrow = direction === 'out' ? '&#8594;' : '&#8592;';
    const dirLabel = direction === 'out' ? I18N.t('detail.outgoing').toLowerCase() : I18N.t('detail.incoming').toLowerCase();

    return `
      <div class="relation-card" data-target="${targetId}">
        <div class="rel-direction">${arrow} ${dirLabel}</div>
        <div class="rel-target">${targetName}</div>
        <div class="rel-field">via ${rel.field}</div>
        <span class="rel-type">${I18N.t('rel.' + rel.type) || rel.type}</span>
      </div>`;
  }

  /**
   * Render a field list item.
   */
  function fieldItem(field) {
    const badges = [];
    if (field.required) badges.push('<span class="badge badge-warning">req</span>');
    if (field.unique) badges.push('<span class="badge badge-accent">uniq</span>');
    if (field.primary) badges.push('<span class="badge badge-success">PK</span>');
    if (field.indexed) badges.push('<span class="badge">idx</span>');
    if (field.isArray) badges.push('<span class="badge">[]</span>');

    const typeClass = field.ref ? 'field-ref' : 'field-type';
    const typeLabel = field.ref ? `${field.type}` : field.type;

    return `
      <li class="field-item">
        <span class="field-name">${field.name}</span>
        <span style="display:flex;gap:3px;align-items:center">
          ${badges.join('')}
          <span class="${typeClass}">${typeLabel}</span>
        </span>
      </li>`;
  }

  return { setData, show, hide };
})();
