(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => {
      if (c == null || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const safeUrl = (u) => {
    try {
      const p = new URL(u);
      return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : '';
    } catch { return ''; }
  };
  const repoName = (u) => {
    try {
      const parts = new URL(u).pathname.split('/').filter(Boolean);
      return parts.length >= 2 ? parts[0] + '/' + parts[1] : u;
    } catch { return u; }
  };
  let toastTimer;
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        msg = typeof j.detail === 'string' ? j.detail : 'Request failed (check the fields)';
      } catch { /* ignore */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ---------- state ----------
  let isAdmin = false;
  let editor = null;
  let dragIdx = null;

  const BLOCKS = {
    heading: { label: 'Heading', make: () => ({ type: 'heading', text: '' }) },
    subheading: { label: 'Subheading', make: () => ({ type: 'subheading', text: '' }) },
    text: { label: 'Text', make: () => ({ type: 'text', text: '' }) },
    code: { label: 'Code', make: () => ({ type: 'code', language: 'javascript', code: '' }) },
    image: { label: 'Image', make: () => ({ type: 'image', url: '', caption: '' }) },
    callout: { label: 'Callout', make: () => ({ type: 'callout', text: '' }) },
    github: { label: 'GitHub repo', make: () => ({ type: 'github', url: '', description: '' }) },
  };
  const LANGS = ['javascript', 'typescript', 'python', 'html', 'css', 'bash', 'powershell', 'json', 'sql', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'yaml', 'markdown', 'plaintext'];

  // ---------- views ----------
  const VIEWS = ['home', 'article', 'dashboard', 'editor'];
  function show(name) {
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
    window.scrollTo(0, 0);
  }

  function renderNav() {
    const nav = $('#nav');
    nav.replaceChildren(h('a', { href: '#/' }, 'Home'));
    if (isAdmin) {
      nav.append(
        h('a', { href: '#/admin' }, 'Dashboard'),
        h('a', { href: '#/new' }, 'New article'),
        h('button', { class: 'btn small', type: 'button', onclick: logout }, 'Log out')
      );
    } else {
      nav.append(h('a', { href: '/login' }, 'Admin'));
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    isAdmin = false;
    renderNav();
    if (location.hash === '#/' || location.hash === '') route();
    else location.hash = '#/';
  }

  // ---------- public: home ----------
  async function viewHome(category) {
    const [cats, list] = await Promise.all([
      api('/api/categories'),
      api('/api/articles' + (category ? '?category=' + encodeURIComponent(category) : '')),
    ]);
    const chips = $('#home-cats');
    chips.replaceChildren(h('a', { class: 'chip' + (category ? '' : ' active'), href: '#/' }, 'All'));
    cats.forEach((c) => chips.append(h('a', { class: 'chip' + (c === category ? ' active' : ''), href: '#/category/' + encodeURIComponent(c) }, c)));
    const box = $('#home-list');
    box.replaceChildren();
    if (!list.length) box.append(h('p', { class: 'empty' }, 'No published articles here yet.'));
    list.forEach((a) => box.append(
      h('a', { class: 'card', href: '#/article/' + encodeURIComponent(a.slug) },
        h('span', { class: 'tag' }, a.category),
        h('h3', {}, a.title),
        a.summary ? h('p', {}, a.summary) : null,
        h('small', { class: 'muted' }, fmtDate(a.published_at)))
    ));
    show('home');
  }

  // ---------- public: article ----------
  function renderBlocks(blocks, root) {
    blocks.forEach((b) => {
      switch (b.type) {
        case 'heading': root.append(h('h2', {}, b.text || '')); break;
        case 'subheading': root.append(h('h3', {}, b.text || '')); break;
        case 'text': root.append(h('p', {}, b.text || '')); break;
        case 'code': {
          const copy = h('button', { class: 'btn small', type: 'button' }, 'Copy');
          copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(b.code || ''); copy.textContent = 'Copied'; }
            catch { copy.textContent = 'Press Ctrl+C'; }
            setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
          });
          root.append(h('div', { class: 'code' },
            h('div', { class: 'code-head' }, h('span', {}, b.language || 'plaintext'), copy),
            h('pre', {}, h('code', {}, b.code || ''))));
          break;
        }
        case 'image': {
          const src = safeUrl(b.url);
          if (!src) break;
          root.append(h('figure', {}, h('img', { src, alt: b.caption || '', loading: 'lazy' }), b.caption ? h('figcaption', {}, b.caption) : null));
          break;
        }
        case 'callout': root.append(h('div', { class: 'callout' }, b.text || '')); break;
        case 'github': {
          const href = safeUrl(b.url);
          if (!href) break;
          root.append(h('a', { class: 'repo', href, target: '_blank', rel: 'noopener noreferrer' },
            h('strong', {}, '⌥ ' + repoName(href)),
            b.description ? h('span', {}, b.description) : null));
          break;
        }
      }
    });
  }

  async function viewArticle(slug) {
    const a = await api('/api/articles/' + encodeURIComponent(slug));
    const body = $('#article-body');
    const content = h('div', { class: 'content' });
    renderBlocks(a.blocks || [], content);
    body.replaceChildren(
      h('h1', {}, a.title),
      h('div', { class: 'art-meta' },
        h('span', { class: 'tag' }, a.category),
        h('span', { class: 'muted' }, fmtDate(a.published_at || a.updated_at)),
        a.status === 'draft' ? h('span', { class: 'badge' }, 'Draft') : null,
        isAdmin ? h('a', { class: 'btn small', href: '#/edit/' + a.id }, 'Edit') : null),
      content
    );
    document.title = a.title + ' · Nexus KB';
    show('article');
  }

  // ---------- admin: dashboard ----------
  async function viewDashboard() {
    if (!isAdmin) { location.href = '/login'; return; }
    const list = await api('/api/admin/articles');
    const box = $('#dash-list');
    if (!list.length) {
      box.replaceChildren(h('p', { class: 'empty' }, 'No articles yet. Create your first one.'));
    } else {
      const rows = list.map((a) => h('tr', {},
        h('td', {}, a.title),
        h('td', {}, a.category),
        h('td', {}, h('span', { class: 'badge' + (a.status === 'published' ? ' live' : '') }, a.status === 'published' ? 'Published' : 'Draft')),
        h('td', {}, fmtDate(a.updated_at)),
        h('td', {},
          h('a', { class: 'btn small', href: '#/edit/' + a.id }, 'Edit'),
          h('a', { class: 'btn small', href: '#/article/' + encodeURIComponent(a.slug) }, 'View'),
          h('button', {
            class: 'btn small danger', type: 'button',
            onclick: async () => {
              if (!confirm('Delete "' + a.title + '"? This cannot be undone.')) return;
              try { await api('/api/admin/articles/' + a.id, { method: 'DELETE' }); toast('Deleted'); viewDashboard(); }
              catch (e) { toast(e.message); }
            },
          }, 'Delete'))
      ));
      box.replaceChildren(h('div', { style: 'overflow-x:auto' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Title', 'Category', 'Status', 'Updated', 'Actions'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows))));
    }
    show('dashboard');
  }

  // ---------- admin: editor ----------
  const setStatus = (t) => { $('#ed-status').textContent = t; };

  function touch() {
    if (!editor) return;
    editor.dirty = true;
    setStatus('Unsaved changes…');
    clearTimeout(editor.timer);
    if (editor.title.trim()) editor.timer = setTimeout(() => save(null, true), 2500);
  }

  function refreshMeta() {
    const live = editor.status === 'published';
    const badge = $('#ed-badge');
    badge.textContent = live ? 'Published' : 'Draft';
    badge.className = 'badge' + (live ? ' live' : '');
    $('#btn-draft').textContent = live ? 'Unpublish' : 'Save draft';
    $('#btn-publish').textContent = live ? 'Update' : 'Publish';
    const view = $('#ed-view');
    view.hidden = !editor.slug;
    if (editor.slug) view.href = '#/article/' + encodeURIComponent(editor.slug);
  }

  async function save(status, auto) {
    if (!editor) return null;
    const ed = editor;
    if (!ed.title.trim()) { if (!auto) toast('Add a title first'); return null; }
    clearTimeout(ed.timer);
    ed.dirty = false;
    const body = {
      title: ed.title, category: ed.category || 'General', summary: ed.summary,
      status: status || ed.status, blocks: ed.blocks,
    };
    try {
      setStatus('Saving…');
      const doc = ed.id
        ? await api('/api/admin/articles/' + ed.id, { method: 'PUT', body })
        : await api('/api/admin/articles', { method: 'POST', body });
      ed.id = doc.id; ed.slug = doc.slug; ed.status = doc.status;
      if (editor === ed) {
        refreshMeta();
        setStatus('Saved at ' + new Date().toLocaleTimeString());
        history.replaceState(null, '', '#/edit/' + doc.id);
      }
      if (!auto) toast(status === 'published' ? 'Published' : status === 'draft' ? 'Draft saved' : 'Saved');
      return doc;
    } catch (e) {
      ed.dirty = true;
      setStatus('Save failed');
      toast(e.message);
      return null;
    }
  }

  async function leaveEditor() {
    if (!editor) return;
    clearTimeout(editor.timer);
    if (editor.dirty && editor.title.trim()) await save(null, true);
    editor = null;
  }

  function moveBlock(from, to) {
    if (to < 0 || to >= editor.blocks.length || from === to) return;
    const [b] = editor.blocks.splice(from, 1);
    editor.blocks.splice(to, 0, b);
    renderEditorBlocks();
    touch();
  }

  const field = (b, key, ph, tag, cls) => {
    const el = h(tag || 'input', { class: 'f ' + (cls || ''), placeholder: ph });
    el.value = b[key] || '';
    el.addEventListener('input', () => { b[key] = el.value; touch(); });
    return el;
  };

  function blockBody(b) {
    switch (b.type) {
      case 'heading': return [field(b, 'text', 'Heading text', 'input', 'h-input')];
      case 'subheading': return [field(b, 'text', 'Subheading text')];
      case 'text': return [field(b, 'text', 'Write your paragraph…', 'textarea')];
      case 'code': {
        const sel = h('select', { class: 'f' }, LANGS.map((l) => h('option', { value: l }, l)));
        sel.value = b.language || 'javascript';
        sel.addEventListener('change', () => { b.language = sel.value; touch(); });
        return [sel, field(b, 'code', 'Paste code here', 'textarea', 'mono')];
      }
      case 'image': return [field(b, 'url', 'Image URL (https://…)'), field(b, 'caption', 'Caption (optional)')];
      case 'callout': return [field(b, 'text', 'Callout text', 'textarea')];
      case 'github': return [field(b, 'url', 'https://github.com/owner/repo'), field(b, 'description', 'Short description (optional)')];
      default: return [];
    }
  }

  function blockCard(b, i) {
    const card = h('div', { class: 'block' });
    const handle = h('span', { class: 'handle', title: 'Drag to reorder' }, '⋮⋮');
    handle.addEventListener('mousedown', () => { card.draggable = true; });
    handle.addEventListener('mouseup', () => { card.draggable = false; });
    card.append(
      h('div', { class: 'block-head' },
        handle,
        h('span', { class: 'label' }, BLOCKS[b.type].label),
        h('button', { class: 'icon', type: 'button', title: 'Move up', onclick: () => moveBlock(i, i - 1) }, '▲'),
        h('button', { class: 'icon', type: 'button', title: 'Move down', onclick: () => moveBlock(i, i + 1) }, '▼'),
        h('button', {
          class: 'icon del', type: 'button', title: 'Delete block',
          onclick: () => { editor.blocks.splice(i, 1); renderEditorBlocks(); touch(); },
        }, '✕')),
      ...blockBody(b)
    );
    card.addEventListener('dragstart', (e) => {
      dragIdx = i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('dragging'); dragIdx = null; });
    card.addEventListener('dragover', (e) => { if (dragIdx === null) return; e.preventDefault(); card.classList.add('over'); });
    card.addEventListener('dragleave', () => card.classList.remove('over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('over');
      if (dragIdx === null || dragIdx === i) return;
      const from = dragIdx;
      dragIdx = null;
      moveBlock(from, i);
    });
    return card;
  }

  function renderEditorBlocks() {
    const box = $('#editor-blocks');
    box.replaceChildren();
    if (!editor.blocks.length) box.append(h('p', { class: 'empty' }, 'No blocks yet. Add one from the bar above.'));
    editor.blocks.forEach((b, i) => box.append(blockCard(b, i)));
  }

  async function openEditor(id) {
    if (!isAdmin) { location.href = '/login'; return; }
    const doc = id ? await api('/api/admin/articles/' + encodeURIComponent(id)) : null;
    editor = {
      id: doc ? doc.id : null,
      slug: doc ? doc.slug : null,
      status: doc ? doc.status : 'draft',
      title: doc ? doc.title : '',
      category: doc ? doc.category : '',
      summary: doc ? doc.summary : '',
      blocks: doc ? doc.blocks || [] : [],
      dirty: false,
      timer: null,
    };
    $('#ed-title').value = editor.title;
    $('#ed-category').value = editor.category;
    $('#ed-summary').value = editor.summary;
    setStatus(doc ? 'Loaded' : 'Not saved yet');
    refreshMeta();
    renderEditorBlocks();
    show('editor');
  }

  function initEditorControls() {
    const bar = $('#add-bar');
    Object.entries(BLOCKS).forEach(([type, def]) => {
      bar.append(h('button', {
        class: 'btn small', type: 'button',
        onclick: () => {
          editor.blocks.push(def.make());
          renderEditorBlocks();
          touch();
          const cards = document.querySelectorAll('#editor-blocks .block');
          const last = cards[cards.length - 1];
          if (last) { last.scrollIntoView({ block: 'center' }); const f = last.querySelector('input, textarea'); if (f) f.focus(); }
        },
      }, '+ ' + def.label));
    });
    $('#ed-title').addEventListener('input', (e) => { editor.title = e.target.value; touch(); });
    $('#ed-category').addEventListener('input', (e) => { editor.category = e.target.value; touch(); });
    $('#ed-summary').addEventListener('input', (e) => { editor.summary = e.target.value; touch(); });
    $('#btn-draft').addEventListener('click', () => save('draft', false));
    $('#btn-publish').addEventListener('click', () => save('published', false));
  }

  // ---------- router ----------
  async function route() {
    const hash = location.hash;
    const [a, b] = hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
    const staying = editor && a === 'edit' && b === editor.id;
    if (!staying) await leaveEditor();
    else return;
    document.title = 'Nexus KB';
    try {
      if (a === 'article' && b) await viewArticle(b);
      else if (a === 'admin') await viewDashboard();
      else if (a === 'new') await openEditor(null);
      else if (a === 'edit' && b) await openEditor(b);
      else await viewHome(a === 'category' ? b : null);
    } catch (e) {
      if (e.status === 401) { location.href = '/login'; return; }
      toast(e.message);
      if (a !== undefined && a !== '') location.hash = '#/';
    }
  }

  async function init() {
    initEditorControls();
    try { isAdmin = (await api('/api/me')).admin; } catch { isAdmin = false; }
    renderNav();
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (e) => { if (editor && editor.dirty) { e.preventDefault(); e.returnValue = ''; } });
    route();
  }

  init();
})();