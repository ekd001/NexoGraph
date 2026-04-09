/**
 * projects.js — Home page with client-side scanning
 *
 * "New Project" → showDirectoryPicker() → scanner-client.js → result displayed.
 * Projects are stored in localStorage (no server needed).
 * Import .nexo/JSON also works.
 */

const Projects = (() => {

  let onProjectOpen = null;

  // Projects stored in localStorage as JSON
  const STORAGE_KEY = 'nexograph-projects';

  function getProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function saveProjects(projects) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }

  function addProject(data) {
    const projects = getProjects();
    const id = data.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // Remove existing with same id
    const filtered = projects.filter(p => p.id !== id);
    filtered.push({ id, data, addedAt: new Date().toISOString() });
    saveProjects(filtered);
    return id;
  }

  function removeProject(id) {
    saveProjects(getProjects().filter(p => p.id !== id));
  }

  function getProjectById(id) {
    return getProjects().find(p => p.id === id)?.data || null;
  }

  // ─────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────

  function init(openCallback) {
    onProjectOpen = openCallback;

    // New project → open OS folder picker → scan
    document.getElementById('btn-new-project').addEventListener('click', handleNewProject);

    // Import .nexo/JSON
    document.getElementById('btn-import-project').addEventListener('click', () => {
      document.getElementById('file-import').click();
    });
    document.getElementById('file-import').addEventListener('change', handleImport);

    renderGrid();
  }

  // ─────────────────────────────────────────
  // NEW PROJECT (client-side scan)
  // ─────────────────────────────────────────

  async function handleNewProject() {
    try {
      Toast.show(I18N.t('btn.scanning'), 'info');
      const result = await ClientScanner.scanDirectory();
      if (!result) return; // User cancelled picker

      const id = addProject(result);
      const s = result.project.stats;
      Toast.show(`${s.totalCollections} ${I18N.t('toast.scanOk')} ${s.scanTimeMs}ms`, 'success');
      renderGrid();

      // Auto-open the new project
      onProjectOpen(id);
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  }

  // ─────────────────────────────────────────
  // IMPORT
  // ─────────────────────────────────────────

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.project || !data.collections) throw new Error('Invalid format');
      addProject(data);
      Toast.show(I18N.t('toast.imported'), 'success');
      renderGrid();
    } catch (err) {
      Toast.show(I18N.t('toast.error') + ': ' + err.message, 'error');
    }
    e.target.value = '';
  }

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  function renderGrid() {
    const grid = document.getElementById('projects-grid');
    const projects = getProjects();

    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="projects-empty">
          <div class="projects-empty-icon"><i data-lucide="database" style="width:48px;height:48px"></i></div>
          <p>${I18N.t('projects.empty')}</p>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: grid.querySelectorAll('[data-lucide]') });
      return;
    }

    grid.innerHTML = projects.map(p => {
      const d = p.data;
      const date = new Date(d.project.scannedAt).toLocaleDateString();
      const stats = d.project.stats || {};
      const stacks = (stats.stacksDetected || []).map(s =>
        `<span class="stack-badge">${s}</span>`
      ).join('');

      return `
        <div class="project-card" data-id="${p.id}">
          <div class="card-top">
            <div class="card-title">${d.project.name}</div>
            <div class="card-path" title="${d.project.path || ''}">${d.project.path || ''}</div>
            <div class="card-meta">${I18N.t('projects.scannedAt')} ${date} &middot; ${stats.scanTimeMs || '?'}ms</div>
            ${stacks ? `<div class="card-stacks">${stacks}</div>` : ''}
          </div>
          <div class="card-stats-row">
            <div class="s-cell">
              <div class="s-value">${stats.totalCollections || 0}</div>
              <div class="s-label">${I18N.t('projects.collections')}</div>
            </div>
            <div class="s-cell">
              <div class="s-value">${stats.totalRelations || 0}</div>
              <div class="s-label">${I18N.t('projects.relations')}</div>
            </div>
            <div class="s-cell">
              <div class="s-value">${stats.domainCount || 0}</div>
              <div class="s-label">${I18N.t('projects.domains')}</div>
            </div>
          </div>
          <div class="card-footer">
            <button class="btn-delete" data-id="${p.id}" title="${I18N.t('projects.delete')}">
              <i data-lucide="trash-2" style="width:14px;height:14px"></i>
            </button>
            <button class="btn btn-primary btn-open" data-id="${p.id}">
              ${I18N.t('projects.open')}
              <i data-lucide="arrow-right" style="width:13px;height:13px"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: grid.querySelectorAll('[data-lucide]') });

    // Bind open
    grid.querySelectorAll('.btn-open').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); onProjectOpen(btn.dataset.id); });
    });
    grid.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => onProjectOpen(card.dataset.id));
    });

    // Bind delete
    grid.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirm(
          I18N.t('projects.deleteTitle'),
          I18N.t('projects.deleteConfirm'),
          I18N.t('projects.deleteBtn'),
          () => {
            removeProject(btn.dataset.id);
            if (localStorage.getItem('nexograph-project') === btn.dataset.id) {
              localStorage.removeItem('nexograph-project');
            }
            Toast.show(I18N.t('toast.deleted'), 'info');
            renderGrid();
          }
        );
      });
    });
  }

  // ─────────────────────────────────────────
  // CONFIRM MODAL
  // ─────────────────────────────────────────

  function showConfirm(title, message, btnLabel, onConfirm) {
    const overlay = document.getElementById('modal-confirm');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok');
    okBtn.textContent = btnLabel;
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    const cancelBtn = document.getElementById('confirm-cancel');
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    const close = () => overlay.classList.remove('visible');
    newCancel.addEventListener('click', close);
    newOk.addEventListener('click', () => { close(); onConfirm(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
    overlay.classList.add('visible');
  }

  function refresh() { renderGrid(); }

  // Persistence helpers (used by app.js)
  function getLastProject() { return localStorage.getItem('nexograph-project'); }
  function saveLastProject(id) { localStorage.setItem('nexograph-project', id); }
  function clearLastProject() { localStorage.removeItem('nexograph-project'); }

  return { init, renderGrid, refresh, getLastProject, saveLastProject, clearLastProject, getProjectById, loadProjects: renderGrid };
})();
