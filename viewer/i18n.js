/**
 * i18n.js — Internationalization module
 *
 * Supports: French (fr), English (en)
 * Persists language choice in localStorage
 *
 * Usage:
 *   t('key')              → translated string
 *   t('key', { n: 5 })   → interpolated string
 *   setLang('en')         → switch language, update DOM
 *   toggleLang()          → toggle between fr/en
 *
 * HTML:
 *   <span data-i18n="key"></span>           → textContent
 *   <input data-i18n-placeholder="key">     → placeholder
 *   <button data-i18n-title="key">          → title attribute
 */

const I18N = (() => {
  const translations = {
    fr: {
      'app.subtitle':             'Collections Visualizer',
      'projects.empty':           'Aucun projet. Scannez votre premier projet pour commencer.',
      'projects.scannedAt':       'Scanne le',
      'projects.collections':     'collections',
      'projects.relations':       'relations',
      'projects.domains':         'domaines',
      'projects.scanTime':        'en',
      'projects.delete':          'Supprimer',
      'projects.deleteConfirm':   'Voulez-vous vraiment supprimer ce projet ? Cette action est irreversible.',
      'projects.deleteTitle':     'Supprimer le projet',
      'projects.deleteBtn':       'Supprimer',
      'projects.open':            'Ouvrir',
      'btn.newProject':           'Nouveau Projet',
      'btn.import':               'Importer',
      'btn.scan':                 'Scanner',
      'btn.scanning':             'Scan en cours...',
      'btn.cancel':               'Annuler',
      'btn.back':                 'Retour',
      'btn.rescan':               'Rescanner',
      'btn.export':               'Exporter',
      'btn.theme':                'Theme',
      'btn.lang':                 'EN',
      'modal.scan.title':         'Scanner un projet',
      'modal.scan.name':          'Nom du projet',
      'modal.scan.namePh':        'Mon Backend',
      'modal.scan.path':          'Dossier du projet',
      'modal.scan.select':        'Selectionner ce dossier',
      'modal.scan.emptyDir':      'Dossier vide',
      'modal.scan.project':       'projet',
      'search.placeholder':       'Rechercher...',
      'view.domains':             'Domaines',
      'view.graph':               'Graphe',
      'view.list':                'Liste',
      'sidebar.domains':          'Domaines',
      'sidebar.stats':            'Stats',
      'sidebar.all':              'Tous',
      'stats.collections':        'Collections',
      'stats.relations':          'Relations',
      'stats.isolated':           'Isolees',
      'stats.hubs':               'Hubs',
      'detail.empty':             'Cliquez sur une collection pour voir ses details',
      'detail.fields':            'Champs',
      'detail.relations':         'Relations',
      'detail.outgoing':          'Sortantes',
      'detail.incoming':          'Entrantes',
      'detail.noRelations':       'Aucune relation',
      'detail.metrics':           'Metriques',
      'detail.enums':             'Enums',
      'detail.source':            'Source',
      'detail.database':          'Base',
      'detail.inheritance':       'Heritage',
      'detail.refs':              'Refs',
      'detail.hub':               'Hub',
      'detail.isolated':          'Isolee',
      'detail.connected':         'Connectee',
      'export.pdf':               'PDF (rapport pro)',
      'export.png':               'PNG (image)',
      'export.svg':               'SVG (vectoriel)',
      'export.nexo':              '.nexo (projet)',
      'export.json':              'JSON (donnees)',
      'export.success':           'Export reussi',
      'export.pdfGenerating':     'Generation du PDF...',
      'toast.imported':           'Projet importe',
      'toast.deleted':            'Projet supprime',
      'toast.scanOk':             'collections detectees en',
      'toast.error':              'Erreur',
      'guide.title':              'Guide Nexograph',
      'guide.shortcuts':          'Raccourcis clavier',
      'guide.shortcut.search':    'Rechercher',
      'guide.shortcut.deselect':  'Deselectionner / Retour',
      'guide.interactions':       'Interactions',
      'guide.int.click':          'Clic sur un noeud → voir ses details et relations',
      'guide.int.dblclick':       'Double-clic → zoom sur le noeud et ses voisins',
      'guide.int.pan':            'Cliquer-glisser le fond → deplacer la vue',
      'guide.int.zoom':           'Molette souris → zoomer / dezoomer',
      'guide.int.clickrel':       'Clic sur une relation → naviguer vers la cible',
      'guide.views':              'Vues',
      'guide.view.domains':       'Domaines — collections groupees par module',
      'guide.view.graph':         'Graphe — layout hierarchique (dagre)',
      'guide.view.list':          'Liste — tableau triable avec recherche',
      'guide.features':           'Fonctionnalites',
      'guide.feat.search':        'Recherche temps reel (filtre toutes les vues)',
      'guide.feat.filter':        'Filtrer par domaine (sidebar gauche)',
      'guide.feat.theme':         'Theme sombre / clair',
      'guide.feat.lang':          'Francais / Anglais',
      'guide.feat.export':        'Export : PDF, PNG, SVG, .nexo, JSON',
      'guide.feat.import':        'Import : .nexo ou JSON',
      'guide.feat.rescan':        'Rescanner le projet sans quitter',
      'guide.feat.persist':       'Etat persiste (refresh ne perd rien)',
      'rel.many-to-one':          'N → 1',
      'rel.many-to-many':         'N → N',
      'rel.one-to-many':          '1 → N',
      'rel.one-to-one':           '1 → 1',
      'list.name':                'Nom',
      'list.domain':              'Domaine',
      'list.db':                  'Base',
      'list.fields':              'Champs',
      'list.relations':           'Relations',
    },
    en: {
      'app.subtitle':             'Collections Visualizer',
      'projects.empty':           'No projects yet. Scan your first project to get started.',
      'projects.scannedAt':       'Scanned on',
      'projects.collections':     'collections',
      'projects.relations':       'relations',
      'projects.domains':         'domains',
      'projects.scanTime':        'in',
      'projects.delete':          'Delete',
      'projects.deleteConfirm':   'Are you sure you want to delete this project? This action cannot be undone.',
      'projects.deleteTitle':     'Delete project',
      'projects.deleteBtn':       'Delete',
      'projects.open':            'Open',
      'btn.newProject':           'New Project',
      'btn.import':               'Import',
      'btn.scan':                 'Scan',
      'btn.scanning':             'Scanning...',
      'btn.cancel':               'Cancel',
      'btn.back':                 'Back',
      'btn.rescan':               'Rescan',
      'btn.export':               'Export',
      'btn.theme':                'Theme',
      'btn.lang':                 'FR',
      'modal.scan.title':         'Scan a project',
      'modal.scan.name':          'Project name',
      'modal.scan.namePh':        'My Backend',
      'modal.scan.path':          'Project folder',
      'modal.scan.select':        'Select this folder',
      'modal.scan.emptyDir':      'Empty folder',
      'modal.scan.project':       'project',
      'search.placeholder':       'Search...',
      'view.domains':             'Domains',
      'view.graph':               'Graph',
      'view.list':                'List',
      'sidebar.domains':          'Domains',
      'sidebar.stats':            'Stats',
      'sidebar.all':              'All',
      'stats.collections':        'Collections',
      'stats.relations':          'Relations',
      'stats.isolated':           'Isolated',
      'stats.hubs':               'Hubs',
      'detail.empty':             'Click on a collection to see its details',
      'detail.fields':            'Fields',
      'detail.relations':         'Relations',
      'detail.outgoing':          'Outgoing',
      'detail.incoming':          'Incoming',
      'detail.noRelations':       'No relations',
      'detail.metrics':           'Metrics',
      'detail.enums':             'Enums',
      'detail.source':            'Source',
      'detail.database':          'Database',
      'detail.inheritance':       'Inherits',
      'detail.refs':              'Refs',
      'detail.hub':               'Hub',
      'detail.isolated':          'Isolated',
      'detail.connected':         'Connected',
      'export.pdf':               'PDF (pro report)',
      'export.png':               'PNG (image)',
      'export.svg':               'SVG (vector)',
      'export.nexo':              '.nexo (project)',
      'export.json':              'JSON (data)',
      'export.success':           'Export successful',
      'export.pdfGenerating':     'Generating PDF...',
      'toast.imported':           'Project imported',
      'toast.deleted':            'Project deleted',
      'toast.scanOk':             'collections detected in',
      'toast.error':              'Error',
      'guide.title':              'Nexograph Guide',
      'guide.shortcuts':          'Keyboard shortcuts',
      'guide.shortcut.search':    'Search',
      'guide.shortcut.deselect':  'Deselect / Back',
      'guide.interactions':       'Interactions',
      'guide.int.click':          'Click a node → view details and relations',
      'guide.int.dblclick':       'Double-click → zoom to node and neighbors',
      'guide.int.pan':            'Drag background → pan the view',
      'guide.int.zoom':           'Mouse wheel → zoom in/out',
      'guide.int.clickrel':       'Click a relation → navigate to target',
      'guide.views':              'Views',
      'guide.view.domains':       'Domains — collections grouped by module',
      'guide.view.graph':         'Graph — hierarchical layout (dagre)',
      'guide.view.list':          'List — sortable table with search',
      'guide.features':           'Features',
      'guide.feat.search':        'Real-time search (filters all views)',
      'guide.feat.filter':        'Filter by domain (left sidebar)',
      'guide.feat.theme':         'Dark / Light theme',
      'guide.feat.lang':          'French / English',
      'guide.feat.export':        'Export: PDF, PNG, SVG, .nexo, JSON',
      'guide.feat.import':        'Import: .nexo or JSON',
      'guide.feat.rescan':        'Rescan project without leaving',
      'guide.feat.persist':       'State persists (refresh keeps view)',
      'rel.many-to-one':          'N to 1',
      'rel.many-to-many':         'N to N',
      'rel.one-to-many':          '1 to N',
      'rel.one-to-one':           '1 to 1',
      'list.name':                'Name',
      'list.domain':              'Domain',
      'list.db':                  'Database',
      'list.fields':              'Fields',
      'list.relations':           'Relations',
    },
  };

  let lang = localStorage.getItem('nexograph-lang') || 'fr';

  /** Translate a key, with optional interpolation */
  function t(key, vars) {
    let text = translations[lang]?.[key] || translations.fr[key] || key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replaceAll(`{${k}}`, v);
      });
    }
    return text;
  }

  /** Apply translations to all data-i18n elements in the DOM */
  function applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
  }

  function setLang(l) {
    if (!translations[l]) return;
    lang = l;
    localStorage.setItem('nexograph-lang', lang);
    applyToDOM();
  }

  function toggleLang() {
    setLang(lang === 'fr' ? 'en' : 'fr');
  }

  function getLang() { return lang; }

  return { t, setLang, getLang, toggleLang, applyToDOM };
})();
