/**
 * app.js — Main orchestrator v3
 *
 * All data is client-side (localStorage). No server API dependency.
 * Projects are scanned via File System Access API, stored in localStorage.
 */

const App = (() => {

  let currentProjectId = null;
  let currentData = null;

  function init() {
    I18N.applyToDOM();

    Projects.init(openProject);
    Toolbar.init({ onBack: goHome, onRescan: rescan });
    Renderer.init(document.getElementById('canvas-container'), {
      onSelect: (id) => Detail.show(id),
      onDeselect: () => Detail.hide(),
    });
    ExportManager.init();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (Renderer.getSelectedId()) { Renderer.deselect(); Detail.hide(); }
        else if (isExplorerActive()) goHome();
      }
      if (e.key === 'f' && (e.ctrlKey || e.metaKey) && isExplorerActive()) {
        e.preventDefault();
        document.getElementById('search-input').focus();
      }
    });

    // Restore last project on refresh
    const lastId = Projects.getLastProject();
    if (lastId) openProject(lastId);
  }

  function openProject(projectId) {
    const data = Projects.getProjectById(projectId);
    if (!data) {
      Projects.clearLastProject();
      Toast.show(I18N.t('toast.error') + ': Project not found', 'error');
      return;
    }

    currentData = data;
    currentProjectId = projectId;
    Projects.saveLastProject(projectId);

    Detail.setData(currentData);
    Toolbar.setData(currentData);
    ExportManager.setData(currentData);

    switchView('view-explorer');
    Renderer.render(currentData);
  }

  function goHome() {
    currentProjectId = null;
    currentData = null;
    Projects.clearLastProject();
    switchView('view-projects');
    Detail.hide();
    Renderer.deselect();
    document.getElementById('search-input').value = '';
    Projects.refresh();
  }

  async function rescan() {
    if (!currentData) return;
    // Re-scan = open folder picker again + replace project
    try {
      Toast.show(I18N.t('btn.scanning'), 'info');
      const result = await ClientScanner.scanDirectory();
      if (!result) return;

      // Use existing project name if user picked same folder
      const projects = JSON.parse(localStorage.getItem('nexograph-projects') || '[]');
      const existing = projects.find(p => p.id === currentProjectId);
      if (existing) {
        existing.data = result;
        localStorage.setItem('nexograph-projects', JSON.stringify(projects));
      }

      const s = result.project.stats;
      Toast.show(`${s.totalCollections} ${I18N.t('toast.scanOk')} ${s.scanTimeMs}ms`, 'success');
      openProject(currentProjectId);
    } catch (err) {
      Toast.show(I18N.t('toast.error') + ': ' + err.message, 'error');
    }
  }

  function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
  }

  function isExplorerActive() {
    return document.getElementById('view-explorer').classList.contains('active');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  if (typeof lucide !== 'undefined') lucide.createIcons();
});
