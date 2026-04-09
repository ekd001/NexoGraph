/**
 * toolbar.js — Sidebar & toolbar v2
 *
 * Domains as vertical list items (not wrapping chips).
 * Each item shows dot + name + count.
 */

const Toolbar = (() => {

  let data = null;
  let activeDomains = new Set();
  let onBack = null, onRescan = null;

  function init(callbacks) {
    onBack = callbacks.onBack;
    onRescan = callbacks.onRescan;

    document.getElementById('btn-back').addEventListener('click', () => { if (onBack) onBack(); });

    document.getElementById('view-mode-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      document.querySelectorAll('#view-mode-btns .toolbar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Renderer.setViewMode(btn.dataset.view);
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      Renderer.setSearchFilter(e.target.value);
    });

    document.getElementById('btn-theme').addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
      html.dataset.theme = next;
      localStorage.setItem('nexograph-theme', next);
      updateThemeIcon(next);
    });

    document.getElementById('btn-lang').addEventListener('click', () => {
      I18N.toggleLang();
      I18N.applyToDOM();
      if (data) renderSidebar(data);
      Projects.refresh();
    });

    document.getElementById('btn-rescan').addEventListener('click', () => {
      if (onRescan) onRescan();
    });

    // Guide modal
    document.getElementById('btn-guide').addEventListener('click', showGuide);
    document.getElementById('guide-close').addEventListener('click', () => {
      document.getElementById('modal-guide').classList.remove('visible');
    });
    document.getElementById('modal-guide').addEventListener('click', (e) => {
      if (e.target.id === 'modal-guide') document.getElementById('modal-guide').classList.remove('visible');
    });

    const savedTheme = localStorage.getItem('nexograph-theme') || 'dark';
    document.documentElement.dataset.theme = savedTheme;
    updateThemeIcon(savedTheme);
  }

  function setData(projectData) {
    data = projectData;
    activeDomains = new Set(data.domains.map(d => d.id));
    document.getElementById('crumb-project').textContent = data.project.name;
    renderSidebar(data);
  }

  function renderSidebar(data) {
    const domainList = document.getElementById('domain-list');
    const statsGrid = document.getElementById('stats-grid');
    document.getElementById('domain-count').textContent = data.domains.length;

    const connectionCounts = Layout.computeConnectionCounts(data);
    const isolatedCount = data.collections.filter(c => (connectionCounts[c.id] || 0) === 0).length;
    const hubCount = data.collections.filter(c => (connectionCounts[c.id] || 0) >= 4).length;

    // Count collections per domain
    const domainCollCount = {};
    data.collections.forEach(c => { domainCollCount[c.domainId] = (domainCollCount[c.domainId] || 0) + 1; });

    const allActive = activeDomains.size === data.domains.length;

    // Vertical list of domains
    domainList.innerHTML =
      `<div class="domain-item ${allActive ? 'active' : ''}" data-domain="__all">
        <span class="domain-dot" style="background:var(--accent)"></span>
        <span class="domain-name">${I18N.t('sidebar.all')}</span>
        <span class="domain-count">${data.collections.length}</span>
      </div>` +
      data.domains.map(d => {
        const active = activeDomains.has(d.id);
        return `<div class="domain-item ${active ? 'active' : ''}" data-domain="${d.id}">
          <span class="domain-dot" style="background:${d.color}"></span>
          <span class="domain-name">${d.name}</span>
          <span class="domain-count">${domainCollCount[d.id] || 0}</span>
        </div>`;
      }).join('');

    domainList.querySelectorAll('.domain-item').forEach(item => {
      item.addEventListener('click', () => {
        const domainId = item.dataset.domain;
        if (domainId === '__all') {
          activeDomains = new Set(data.domains.map(d => d.id));
        } else if (activeDomains.size === data.domains.length) {
          activeDomains = new Set([domainId]);
        } else if (activeDomains.has(domainId)) {
          activeDomains.delete(domainId);
          if (activeDomains.size === 0) activeDomains = new Set(data.domains.map(d => d.id));
        } else {
          activeDomains.add(domainId);
        }
        Renderer.setDomainFilter(activeDomains);
        renderSidebar(data);

        // Scroll to the domain box in canvas view if a single domain is selected
        if (domainId !== '__all' && activeDomains.size === 1) {
          Renderer.scrollToDomain(domainId);
        }
      });
    });

    statsGrid.innerHTML = `
      <div class="stat-card"><div class="stat-value">${data.collections.length}</div><div class="stat-label">${I18N.t('stats.collections')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.relations.length}</div><div class="stat-label">${I18N.t('stats.relations')}</div></div>
      <div class="stat-card"><div class="stat-value">${isolatedCount}</div><div class="stat-label">${I18N.t('stats.isolated')}</div></div>
      <div class="stat-card"><div class="stat-value">${hubCount}</div><div class="stat-label">${I18N.t('stats.hubs')}</div></div>
    `;
  }

  function updateThemeIcon(theme) {
    const iconEl = document.getElementById('icon-theme');
    if (!iconEl) return;
    // Swap lucide icon name and recreate
    iconEl.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun');
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [iconEl] });
  }

  /** Show the guide modal with all shortcuts and features */
  function showGuide() {
    const t = I18N.t;
    document.getElementById('guide-title').textContent = t('guide.title');
    document.getElementById('guide-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px">
        <div>
          <h3 style="margin-bottom:10px">${t('guide.shortcuts')}</h3>
          <table style="width:100%;font-size:14px;border-collapse:collapse">
            <tr><td style="padding:6px 0"><kbd style="background:var(--surface-alt);padding:3px 8px;border-radius:4px;font-size:12px;font-family:var(--font-mono);border:1px solid var(--border)">Ctrl + F</kbd></td><td>${t('guide.shortcut.search')}</td></tr>
            <tr><td style="padding:6px 0"><kbd style="background:var(--surface-alt);padding:3px 8px;border-radius:4px;font-size:12px;font-family:var(--font-mono);border:1px solid var(--border)">Esc</kbd></td><td>${t('guide.shortcut.deselect')}</td></tr>
          </table>
        </div>
        <div>
          <h3 style="margin-bottom:10px">${t('guide.interactions')}</h3>
          <ul style="font-size:14px;padding-left:20px;display:flex;flex-direction:column;gap:6px;color:var(--text-secondary)">
            <li>${t('guide.int.click')}</li>
            <li>${t('guide.int.dblclick')}</li>
            <li>${t('guide.int.pan')}</li>
            <li>${t('guide.int.zoom')}</li>
            <li>${t('guide.int.clickrel')}</li>
          </ul>
        </div>
        <div>
          <h3 style="margin-bottom:10px">${t('guide.views')}</h3>
          <ul style="font-size:14px;padding-left:20px;display:flex;flex-direction:column;gap:6px;color:var(--text-secondary)">
            <li><strong>Domaines</strong> — ${t('guide.view.domains')}</li>
            <li><strong>Graphe</strong> — ${t('guide.view.graph')}</li>
            <li><strong>Liste</strong> — ${t('guide.view.list')}</li>
          </ul>
        </div>
        <div>
          <h3 style="margin-bottom:10px">${t('guide.features')}</h3>
          <ul style="font-size:14px;padding-left:20px;display:flex;flex-direction:column;gap:6px;color:var(--text-secondary)">
            <li>${t('guide.feat.search')}</li>
            <li>${t('guide.feat.filter')}</li>
            <li>${t('guide.feat.theme')}</li>
            <li>${t('guide.feat.lang')}</li>
            <li>${t('guide.feat.export')}</li>
            <li>${t('guide.feat.import')}</li>
            <li>${t('guide.feat.rescan')}</li>
            <li>${t('guide.feat.persist')}</li>
          </ul>
        </div>
      </div>
    `;
    document.getElementById('modal-guide').classList.add('visible');
  }

  return { init, setData };
})();
