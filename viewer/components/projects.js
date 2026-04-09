/**
 * projects.js — Home page + directory browser
 *
 * The scan modal includes a visual directory browser.
 * Users click to navigate folders — no path to type.
 */

const Projects = (() => {

  let projects = [];
  let onProjectOpen = null;
  let selectedPath = null; // Currently selected directory path

  function init(openCallback) {
    onProjectOpen = openCallback;

    document.getElementById('btn-new-project').addEventListener('click', openScanModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-scan').addEventListener('click', (e) => {
      if (e.target.id === 'modal-scan') closeModal();
    });
    document.getElementById('btn-scan').addEventListener('click', handleScan);
    document.getElementById('btn-import-project').addEventListener('click', () => {
      document.getElementById('file-import').click();
    });
    document.getElementById('file-import').addEventListener('change', handleImport);

    // Enable scan button as user types the project name
    document.getElementById('input-name').addEventListener('input', updateScanButton);

    loadProjects();
  }

  // ─────────────────────────────────────────
  // DIRECTORY BROWSER
  // ─────────────────────────────────────────

  /** Open the scan modal and load the home directory */
  function openScanModal() {
    document.getElementById('modal-scan').classList.add('visible');
    document.getElementById('input-name').value = '';
    document.getElementById('input-name').focus();
    selectedPath = null;
    document.getElementById('btn-scan').disabled = true;
    browseTo(null); // Start at home directory
  }

  /**
   * Navigate to a directory and render its contents.
   * @param {string|null} dirPath — Path to browse, null = home dir
   */
  async function browseTo(dirPath) {
    const pathEl = document.getElementById('browser-path');
    const listEl = document.getElementById('browser-list');

    listEl.innerHTML = '<div class="browser-empty">...</div>';

    try {
      const url = dirPath
        ? `/api/browse?path=${encodeURIComponent(dirPath)}`
        : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Cannot browse');
      const data = await res.json();

      // Render breadcrumb path
      renderBreadcrumb(pathEl, data.current);

      // Set hidden input and always track current path
      document.getElementById('input-path').value = data.current;
      selectedPath = data.current;
      updateScanButton();

      // Auto-fill project name if a project is detected
      if (data.isProject) {
        const nameInput = document.getElementById('input-name');
        if (!nameInput.value.trim()) {
          const folderName = data.current.split('/').filter(Boolean).pop() || 'Project';
          nameInput.value = folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
        updateScanButton();
      }

      // Render directory listing
      let html = '';

      // Parent directory link
      if (data.hasParent) {
        html += `<div class="browser-item" data-path="${data.parent}">
          <i data-lucide="arrow-left" style="width:14px;height:14px;color:var(--text-muted)"></i>
          <span class="browser-item-name">..</span>
        </div>`;
      }

      // Current folder — selectable with indicator if project detected
      html += `<div class="browser-item ${data.isProject ? 'selected' : ''}" data-select="${data.current}">
        <i data-lucide="${data.isProject ? 'folder-check' : 'folder-open'}" style="width:14px;height:14px;color:${data.isProject ? 'var(--accent)' : 'var(--text-muted)'}"></i>
        <span class="browser-item-name" style="${data.isProject ? 'color:var(--accent);font-weight:600' : ''}">${I18N.t('modal.scan.select')}</span>
        ${data.isProject ? `<span class="browser-item-badge">${I18N.t('modal.scan.project')}</span>` : ''}
      </div>`;

      if (data.dirs.length === 0 && !data.hasParent) {
        html += `<div class="browser-empty">${I18N.t('modal.scan.emptyDir')}</div>`;
      }

      // Subdirectories
      for (const dir of data.dirs) {
        html += `<div class="browser-item ${dir.isProject ? 'is-project' : ''}" data-path="${dir.path}">
          <i data-lucide="${dir.isProject ? 'folder-git-2' : 'folder'}" style="width:14px;height:14px;color:${dir.isProject ? 'var(--accent)' : 'var(--text-muted)'}"></i>
          <span class="browser-item-name">${dir.name}</span>
          ${dir.isProject ? `<span class="browser-item-badge">${I18N.t('modal.scan.project')}</span>` : ''}
        </div>`;
      }

      listEl.innerHTML = html;

      // Render Lucide icons in browser list
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: listEl.querySelectorAll('[data-lucide]') });

      // Bind events — navigate into subdirectories
      listEl.querySelectorAll('.browser-item[data-path]').forEach(item => {
        item.addEventListener('click', () => browseTo(item.dataset.path));
      });

      // Bind select current folder
      listEl.querySelectorAll('.browser-item[data-select]').forEach(item => {
        item.addEventListener('click', () => {
          selectedPath = item.dataset.select;
          document.getElementById('input-path').value = selectedPath;
          // Auto-fill name
          const nameInput = document.getElementById('input-name');
          if (!nameInput.value.trim()) {
            const folderName = selectedPath.split('/').filter(Boolean).pop() || 'Project';
            nameInput.value = folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
          updateScanButton();
          // Visual feedback
          listEl.querySelectorAll('.browser-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="browser-empty" style="color:var(--danger)">${err.message}</div>`;
    }
  }

  /**
   * Render clickable breadcrumb from a path.
   * /home/user/projects → [/] [home] [user] [projects]
   */
  function renderBreadcrumb(el, fullPath) {
    const parts = fullPath.split('/').filter(Boolean);
    let html = `<span class="browser-path-seg" data-path="/">~</span>`;

    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      html += `<span class="browser-path-sep">&rsaquo;</span>`;
      html += `<span class="browser-path-seg" data-path="${accumulated}">${part}</span>`;
    }

    el.innerHTML = html;

    el.querySelectorAll('.browser-path-seg').forEach(seg => {
      seg.addEventListener('click', () => browseTo(seg.dataset.path));
    });
  }

  /**
   * Enable/disable scan button based on whether name and path are filled.
   * Called on every navigation and name input change.
   */
  function updateScanButton() {
    const name = document.getElementById('input-name').value.trim();
    const path = document.getElementById('input-path').value.trim();
    document.getElementById('btn-scan').disabled = !(name && path);
  }

  // ─────────────────────────────────────────
  // PROJECTS LIST
  // ─────────────────────────────────────────

  async function loadProjects() {
    try {
      const res = await fetch('/api/projects');
      projects = await res.json();
      renderGrid();
    } catch (err) {
      Toast.show(I18N.t('toast.error') + ': ' + err.message, 'error');
    }
  }

  function renderGrid() {
    const grid = document.getElementById('projects-grid');

    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="projects-empty">
          <div class="projects-empty-icon">
            <i data-lucide="database" style="width:48px;height:48px"></i>
          </div>
          <p>${I18N.t('projects.empty')}</p>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: grid.querySelectorAll('[data-lucide]') });
      return;
    }

    grid.innerHTML = projects.map(p => {
      const date = new Date(p.scannedAt).toLocaleDateString();
      const stats = p.stats || {};
      const stacks = (stats.stacksDetected || []).map(s =>
        `<span class="stack-badge">${s}</span>`
      ).join('');

      return `
        <div class="project-card" data-filename="${p.filename}">
          <div class="card-top">
            <div class="card-title">${p.name}</div>
            <div class="card-path" title="${p.path || ''}">${p.path || ''}</div>
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
            <button class="btn-delete" data-filename="${p.filename}" title="${I18N.t('projects.delete')}">
              <i data-lucide="trash-2" style="width:14px;height:14px"></i>
            </button>
            <button class="btn btn-primary btn-open" data-filename="${p.filename}">
              ${I18N.t('projects.open')}
              <i data-lucide="arrow-right" style="width:13px;height:13px"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: grid.querySelectorAll('[data-lucide]') });

    grid.querySelectorAll('.btn-open').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); onProjectOpen(btn.dataset.filename); });
    });
    grid.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => onProjectOpen(card.dataset.filename));
    });
    grid.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirm(
          I18N.t('projects.deleteTitle'),
          I18N.t('projects.deleteConfirm'),
          I18N.t('projects.deleteBtn'),
          async () => {
            await fetch(`/api/projects/${btn.dataset.filename}`, { method: 'DELETE' });
            if (localStorage.getItem('nexograph-project') === btn.dataset.filename) {
              localStorage.removeItem('nexograph-project');
            }
            Toast.show(I18N.t('toast.deleted'), 'info');
            loadProjects();
          }
        );
      });
    });
  }

  // ─────────────────────────────────────────
  // SCAN & IMPORT
  // ─────────────────────────────────────────

  async function handleScan() {
    const name = document.getElementById('input-name').value.trim();
    const pathVal = document.getElementById('input-path').value.trim();
    if (!name || !pathVal) return;

    const btn = document.getElementById('btn-scan');
    const labelEl = btn.querySelector('.scan-btn-label');
    const loadingEl = btn.querySelector('.scan-btn-loading');
    const errorEl = document.getElementById('scan-error');
    errorEl.style.display = 'none';

    // Show loading state
    btn.disabled = true;
    if (labelEl) labelEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'inline-flex';

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: pathVal, projectName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');

      Toast.show(`${data.stats.totalCollections} ${I18N.t('toast.scanOk')} ${data.stats.scanTimeMs}ms`, 'success');
      closeModal();
      loadProjects();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      if (labelEl) labelEl.style.display = 'inline-flex';
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Import failed');
      Toast.show(I18N.t('toast.imported'), 'success');
      loadProjects();
    } catch (err) {
      Toast.show(I18N.t('toast.error') + ': ' + err.message, 'error');
    }
    e.target.value = '';
  }

  function closeModal() {
    document.getElementById('modal-scan').classList.remove('visible');
    document.getElementById('scan-error').style.display = 'none';
    selectedPath = null;
  }

  /**
   * Show a custom confirm modal instead of browser confirm().
   * @param {string} title — Modal title
   * @param {string} message — Description text
   * @param {string} btnLabel — Confirm button label
   * @param {Function} onConfirm — Callback if user confirms
   */
  function showConfirm(title, message, btnLabel, onConfirm) {
    const overlay = document.getElementById('modal-confirm');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok');
    okBtn.textContent = btnLabel;

    // Remove old listeners by cloning
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
  function getLastProject() { return localStorage.getItem('nexograph-project'); }
  function saveLastProject(filename) { localStorage.setItem('nexograph-project', filename); }
  function clearLastProject() { localStorage.removeItem('nexograph-project'); }

  return { init, loadProjects, refresh, getLastProject, saveLastProject, clearLastProject };
})();
