/**
 * app.js — Main orchestrator v2
 *
 * State persistence: saves current project in localStorage.
 * On refresh, reopens the last viewed project automatically.
 */

const App = (() => {

  let currentProject = null;
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

    // Restore last opened project on refresh
    const lastProject = Projects.getLastProject();
    if (lastProject) {
      openProject(lastProject);
    }
  }

  async function openProject(filename) {
    try {
      const res = await fetch(`/api/projects/${filename}`);
      if (!res.ok) throw new Error('Project not found');

      currentData = await res.json();
      currentProject = filename;

      // Save for persistence across refreshes
      Projects.saveLastProject(filename);

      Detail.setData(currentData);
      Toolbar.setData(currentData);
      ExportManager.setData(currentData);

      switchView('view-explorer');
      Renderer.render(currentData);

    } catch (err) {
      // Project not found (deleted?), clear saved state and stay home
      Projects.clearLastProject();
      Toast.show(I18N.t('toast.error') + ': ' + err.message, 'error');
    }
  }

  function goHome() {
    currentProject = null;
    currentData = null;
    Projects.clearLastProject();
    switchView('view-projects');
    Detail.hide();
    Renderer.deselect();
    document.getElementById('search-input').value = '';
    Projects.loadProjects();
  }

  async function rescan() {
    if (!currentData) return;
    try {
      Toast.show(I18N.t('btn.scanning'), 'info');
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: currentData.project.path,
          projectName: currentData.project.name,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      Toast.show(`${result.stats.totalCollections} ${I18N.t('toast.scanOk')} ${result.stats.scanTimeMs}ms`, 'success');
      // Reload in place, don't go home
      openProject(currentProject);
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
  // Re-render Lucide icons after dynamic content is loaded
  if (typeof lucide !== 'undefined') lucide.createIcons();
});
