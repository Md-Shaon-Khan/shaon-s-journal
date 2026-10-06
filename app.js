(() => {
  'use strict';

  // ---------- helpers ----------
  const SITE = "Shaon's Journal";
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

  // ---------- reader preferences (customization) ----------
  const PREF_KEY = 'sj-prefs';
  const DEFAULTS = {
    accent: '', head: 'playfair', body: 'inter', size: 18, lh: 1.8, width: 720,
    align: 'left', ul: 'solid', ulw: 2, dropcap: true, loc: 'Dhaka, Bangladesh', vol: '',
  };
  const HEADS = {
    playfair: '"Playfair Display", Georgia, "Times New Roman", serif',
    lora: '"Lora", Georgia, serif',
    source: '"Source Serif 4", Georgia, serif',
    georgia: 'Georgia, "Times New Roman", serif',
  };
  const BODIES = {
    inter: '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
    source: '"Source Serif 4", Georgia, serif',
    lora: '"Lora", Georgia, serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  };
  const ACCENTS = [['#C8102E', 'Crimson'], ['#E03131', 'Signal red'], ['#9B1B30', 'Burgundy'], ['#E11D48', 'Rose'], ['#FF5468', 'Coral'], ['#7A0019', 'Maroon']];

  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { /* ignore */ }

  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };
  const onAccent = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '';
    const n = parseInt(m[1], 16);
    const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum > 160 ? '#1b1213' : '#ffffff';
  };

  function applyPrefs() {
    const root = document.documentElement;
    const set = (k, v) => root.style.setProperty(k, v);
    if (/^#[0-9a-f]{6}$/i.test(prefs.accent)) {
      set('--accent-custom', prefs.accent);
      set('--on-accent', onAccent(prefs.accent));
    } else {
      root.style.removeProperty('--accent-custom');
      root.style.removeProperty('--on-accent');
    }
    set('--head-font', HEADS[prefs.head] || HEADS.playfair);
    set('--body-font', BODIES[prefs.body] || BODIES.inter);
    set('--fs', prefs.size + 'px');
    set('--lh', String(prefs.lh));
    set('--measure', prefs.width + 'px');
    set('--align', prefs.align);
    set('--ul-line', prefs.ul === 'none' ? 'none' : 'underline');
    set('--ul-style', prefs.ul === 'none' ? 'solid' : prefs.ul);
    set('--ul-w', prefs.ulw + 'px');
    if (prefs.dropcap) delete root.dataset.dropcap; else root.dataset.dropcap = 'off';
  }
  const setPref = (k, v) => { prefs[k] = v; savePrefs(); applyPrefs(); };

  const roman = (n) => {
    const t = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
    return out || String(n);
  };
  function paintMasthead() {
    const now = new Date();
    const vol = Number(prefs.vol) > 0 ? Number(prefs.vol) : Math.max(1, now.getFullYear() - 2024);
    const day = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
    $('#m-vol').textContent = 'Vol. ' + roman(vol) + ', No. ' + day;
    $('#m-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    $('#m-loc').textContent = prefs.loc || '';
  }

  function buildPanel() {
    const panel = $('#custom-panel');
    const root = document.documentElement;
    const ctl = (label, ...kids) => h('div', { class: 'ctl' }, h('label', {}, label), ...kids);
    const seg = (key, opts, parse = (v) => v) => {
      const box = h('div', { class: 'seg' });
      opts.forEach(([v, t]) => {
        const b = h('button', { type: 'button', class: 'segbtn' + (String(prefs[key]) === String(v) ? ' on' : '') }, t);
        b.addEventListener('click', () => {
          setPref(key, parse(v));
          box.querySelectorAll('.segbtn').forEach((x) => x.classList.toggle('on', x === b));
        });
        box.append(b);
      });
      return box;
    };
    const range = (key, label, min, max, step, unit) => {
      const out = h('output', {}, prefs[key] + unit);
      const inp = h('input', { type: 'range', min, max, step, value: prefs[key] });
      inp.addEventListener('input', () => { setPref(key, Number(inp.value)); out.textContent = inp.value + unit; });
      return h('div', { class: 'ctl' }, h('label', {}, label, out), inp);
    };

    const swatches = h('div', { class: 'swatches' });
    const paintSw = () => swatches.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.c.toLowerCase() === (prefs.accent || '').toLowerCase()));
    ACCENTS.forEach(([c, name]) => {
      const s = h('button', { type: 'button', class: 'sw', title: name, 'aria-label': name, style: 'background:' + c });
      s.dataset.c = c;
      s.addEventListener('click', () => { setPref('accent', c); picker.value = c; paintSw(); });
      swatches.append(s);
    });
    const picker = h('input', { type: 'color', class: 'colorpick', title: 'Custom accent color' });
    picker.value = /^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : '#c8102e';
    picker.addEventListener('input', () => { setPref('accent', picker.value); paintSw(); });
    swatches.append(picker, h('button', { type: 'button', class: 'btn small', onclick: () => { setPref('accent', ''); paintSw(); } }, 'Default'));

    const loc = h('input', { type: 'text', maxlength: 60, value: prefs.loc, placeholder: 'e.g. Dhaka, Bangladesh' });
    loc.addEventListener('input', () => { setPref('loc', loc.value); paintMasthead(); });
    const vol = h('input', { type: 'number', min: 1, max: 99, value: prefs.vol, placeholder: 'Auto (from year)' });
    vol.addEventListener('input', () => { setPref('vol', vol.value); paintMasthead(); });

    panel.replaceChildren(
      h('div', { class: 'panel-head' },
        h('h2', {}, 'Customize'),
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onclick: () => togglePanel(false) }, '✕')),
      ctl('Theme', seg('theme', [['light', 'Light'], ['dark', 'Dark']]).cloneNode(false)),
      ctl('Accent color', swatches),
      ctl('Headline font', seg('head', [['playfair', 'Playfair'], ['lora', 'Lora'], ['source', 'Source Serif'], ['georgia', 'Georgia']])),
      ctl('Body font', seg('body', [['inter', 'Inter'], ['source', 'Source Serif'], ['lora', 'Lora'], ['system', 'System']])),
      range('size', 'Text size', 14, 26, 1, 'px'),
      range('lh', 'Line height', 1.4, 2.4, 0.05, ''),
      ctl('Column width', seg('width', [[620, 'Narrow'], [720, 'Medium'], [860, 'Wide']], Number)),
      ctl('Paragraph alignment', seg('align', [['left', 'Left'], ['justify', 'Justify']])),
      ctl('Link underline', seg('ul', [['solid', 'Solid'], ['wavy', 'Wavy'], ['dotted', 'Dotted'], ['double', 'Double'], ['none', 'None']])),
      ctl('Underline thickness', seg('ulw', [[1, 'Thin'], [2, 'Medium'], [4, 'Bold']], Number)),
      ctl('Drop cap', seg('dropcap', [[true, 'On'], [false, 'Off']], (v) => v === true || v === 'true')),
      ctl('Masthead location', loc),
      ctl('Masthead volume', vol),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => { prefs = { ...DEFAULTS }; savePrefs(); applyPrefs(); paintMasthead(); buildPanel(); toast('Customization reset'); },
      }, 'Reset all'),
      h('p', { class: 'panel-note' }, 'Saved in this browser only.')
    );

    // theme segment needs its own handler (theme is stored separately)
    const themeCtl = panel.querySelector('.ctl .seg');
    const cur = root.dataset.theme === 'dark' ? 'dark' : 'light';
    themeCtl.append(...['light', 'dark'].map((v) => {
      const b = h('button', { type: 'button', class: 'segbtn' + (cur === v ? ' on' : '') }, v === 'light' ? 'Light' : 'Dark');
      b.addEventListener('click', () => {
        root.dataset.theme = v;
        try { localStorage.setItem('sj-theme', v); } catch { /* ignore */ }
        themeCtl.querySelectorAll('.segbtn').forEach((x) => x.classList.toggle('on', x === b));
      });
      return b;
    }));
    paintSw();
  }

  function togglePanel(open) {
    const p = $('#custom-panel');
    const on = open ?? !p.classList.contains('open');
    p.classList.toggle('open', on);
    $('#custom-btn').setAttribute('aria-expanded', String(on));
  }

  // ---------- state ----------
  let isAdmin = false;
  let editor = null;
  let dragIdx = null;
  let homeItems = [];
  let homeCategory = null;

  const BLOCKS = {
    heading: { label: 'Heading', make: () => ({ type: 'heading', text: '' }) },
    subheading: { label: 'Subheading', make: () => ({ type: 'subheading', text: '' }) },
    text: { label: 'Text', make: () => ({ type: 'text', text: '' }) },
    quote: { label: 'Pull quote', make: () => ({ type: 'quote', text: '', cite: '' }) },
    code: { label: 'Code', make: () => ({ type: 'code', language: 'python', code: '' }) },
    image: { label: 'Image', make: () => ({ type: 'image', url: '', caption: '' }) },
    callout: { label: 'Callout', make: () => ({ type: 'callout', text: '' }) },
    divider: { label: 'Divider', make: () => ({ type: 'divider', variant: 'line' }) },
    github: { label: 'GitHub repo', make: () => ({ type: 'github', url: '', description: '' }) },
  };
  const STYLED = new Set(['heading', 'subheading', 'text', 'callout', 'quote']);
  const LANGS = ['python', 'javascript', 'typescript', 'html', 'css', 'bash', 'powershell', 'json', 'sql', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'yaml', 'markdown', 'plaintext'];

  // ---------- chrome: theme, menu, progress ----------
  function initChrome() {
    const root = document.documentElement;
    $('#theme-btn').addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('sj-theme', next); } catch { /* ignore */ }
      buildPanel();
    });
    $('#custom-btn').addEventListener('click', () => togglePanel());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') togglePanel(false); });
    const menuBtn = $('#menu-btn');
    menuBtn.addEventListener('click', () => {
      const open = $('#nav').classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.textContent = open ? '✕' : '☰';
    });
    $('#nav').addEventListener('click', (e) => { if (e.target.closest('a,button')) closeMenu(); });
    $('.avatar').addEventListener('click', (e) => { e.preventDefault(); $('#site-footer').scrollIntoView({ behavior: 'smooth' }); });
    const bar = $('#progress');
    window.addEventListener('scroll', () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + '%';
    }, { passive: true });
    $('#q').addEventListener('input', paintHome);
  }
  function closeMenu() {
    $('#nav').classList.remove('open');
    const b = $('#menu-btn');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = '☰';
  }

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

  // ---------- inline formatting: **bold** *italic* __underline__ ==highlight== [link](url) ----------
  const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|==([^=]+)==|__([^_]+)__/g;
  function inline(text) {
    text = String(text || '');
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] !== undefined) {
        const href = safeUrl(m[2]);
        out.push(href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, m[1]) : m[0]);
      } else if (m[3] !== undefined) out.push(h('strong', {}, m[3]));
      else if (m[4] !== undefined) out.push(h('em', {}, m[4]));
      else if (m[5] !== undefined) out.push(h('mark', {}, m[5]));
      else out.push(h('span', { class: 'u' }, m[6]));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // ---------- per-block styling (size, font, align, color, underline, bold, italic) ----------
  const SCALE = { sm: 0.85, lg: 1.25, xl: 1.6, xxl: 2.1 };
  const FONTS = { sans: 'var(--font)', serif: 'var(--serif)', mono: 'var(--mono)' };
  const ALIGNS = ['left', 'center', 'right', 'justify'];
  const ULS = ['solid', 'double', 'wavy', 'dotted', 'dashed'];
  function applyStyle(el, s) {
    if (!s || typeof s !== 'object') return el;
    const st = el.style;
    if (SCALE[s.size]) st.setProperty('--sc', SCALE[s.size]);
    if (FONTS[s.font]) st.fontFamily = FONTS[s.font];
    if (ALIGNS.includes(s.align)) st.textAlign = s.align;
    if (/^#[0-9a-f]{3,8}$/i.test(s.color || '')) st.color = s.color;
    if (s.bold) st.fontWeight = '800';
    if (s.italic) st.fontStyle = 'italic';
    if (ULS.includes(s.underline)) {
      st.textDecorationLine = 'underline';
      st.textDecorationStyle = s.underline;
      st.textDecorationColor = 'var(--accent)';
      st.textDecorationThickness = '2px';
      st.textUnderlineOffset = '5px';
    }
    return el;
  }

  // ---------- tiny syntax highlighter ----------
  const R_STR = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/.source;
  const C_HASH = /#[^\n]*/.source;
  const C_C = /\/\/[^\n]*|\/\*[\s\S]*?\*\//.source;
  const COMMENTS = {
    python: C_HASH, bash: C_HASH, powershell: C_HASH, yaml: C_HASH,
    sql: /--[^\n]*|\/\*[\s\S]*?\*\//.source, css: /\/\*[\s\S]*?\*\//.source, html: /<!--[\s\S]*?-->/.source,
    php: C_C + '|' + C_HASH, json: null, markdown: null,
  };
  const JS_KW = 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield null true false undefined';
  const JAVA_KW = 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new package private protected public return short static super switch this throw throws try void volatile while null true false';
  const C_KW = 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL';
  const KW = {
    python: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False self',
    javascript: JS_KW,
    typescript: JS_KW + ' interface type enum implements private public protected readonly namespace declare abstract',
    java: JAVA_KW,
    csharp: JAVA_KW + ' namespace using var string bool foreach out ref get set',
    c: C_KW,
    cpp: C_KW + ' class namespace template typename public private protected virtual new delete using bool true false nullptr this',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
    rust: 'as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await',
    php: 'abstract and array as break case catch class const continue echo else elseif extends final finally for foreach function if implements include interface namespace new null or private protected public require return static switch this throw try use var while true false',
    bash: 'if then else elif fi for while do done case esac function in echo export local return exit cd',
    powershell: 'if else elseif foreach for while function param return switch try catch finally',
    sql: 'select from where insert into values update set delete create table drop alter add join left right inner outer on group by order having limit as and or not null primary key foreign references distinct union all',
    json: 'true false null', yaml: 'true false null yes no',
  };
  function highlight(code, lang) {
    lang = String(lang || 'plaintext').toLowerCase();
    code = String(code || '');
    if (lang === 'plaintext' || lang === 'markdown' || lang === 'html' && !code.includes('<!--')) return [code];
    const com = lang in COMMENTS ? COMMENTS[lang] : C_C;
    const kw = KW[lang];
    const re = new RegExp(
      '(' + (com || '(?!)') + ')|(' + R_STR + ')|(@[A-Za-z_][\\w.]*)|(\\b\\d+(?:\\.\\d+)?\\b)|(' +
      (kw ? '\\b(?:' + kw.split(' ').join('|') + ')\\b' : '(?!)') + ')|(\\b[A-Za-z_]\\w*(?=\\())',
      lang === 'sql' ? 'gi' : 'g'
    );
    const out = [];
    let last = 0, m;
    while ((m = re.exec(code))) {
      if (m.index > last) out.push(code.slice(last, m.index));
      const cls = m[1] !== undefined ? 'com' : m[2] !== undefined ? 'str' : m[3] !== undefined ? 'dec' : m[4] !== undefined ? 'num' : m[5] !== undefined ? 'kw' : 'fn';
      out.push(h('span', { class: 'tk-' + cls }, m[0]));
      last = re.lastIndex;
    }
    if (last < code.length) out.push(code.slice(last));
    return out;
  }

  // ---------- story pieces ----------
  const href = (a) => '#/article/' + encodeURIComponent(a.slug);
  const badges = (a) => h('div', { class: 'badges' },
    h('span', { class: 'tag' }, a.category),
    (a.tags || []).slice(0, 4).map((t) => h('span', { class: 'tag line' }, t)));
  const storyMeta = (a) => h('div', { class: 'meta' },
    h('span', {}, a.author || ''),
    h('span', {}, fmtDate(a.published_at)),
    a.read_mins ? h('span', {}, a.read_mins + ' min read') : null);

  // ---------- public: home ----------
  function paintHome() {
    const q = $('#q').value.trim().toLowerCase();
    const items = q
      ? homeItems.filter((a) => (a.title + ' ' + a.summary + ' ' + a.category + ' ' + (a.tags || []).join(' ')).toLowerCase().includes(q))
      : homeItems;
    const front = $('#front'), more = $('#more-title'), box = $('#home-list');
    box.replaceChildren();
    if (!items.length) {
      front.hidden = true; more.hidden = true;
      box.append(h('p', { class: 'empty' }, q ? 'No articles match "' + $('#q').value.trim() + '".' : 'No published articles here yet.'));
      return;
    }
    let rest = items;
    if (q) {
      front.hidden = true;
      more.hidden = false;
      more.textContent = 'Search results';
    } else {
      front.hidden = false;
      const lead = items[0];
      $('#home-lead').replaceChildren(h('article', {},
        badges(lead),
        h('h2', {}, h('a', { href: href(lead) }, lead.title)),
        lead.summary ? h('p', { class: 'deck' }, lead.summary) : null,
        storyMeta(lead),
        h('a', { class: 'more ul', href: href(lead) }, 'Read Full Story')));
      const inside = items.slice(1, 6);
      const aside = $('#home-inside');
      aside.hidden = !inside.length;
      aside.replaceChildren(
        h('h3', { class: 'inside-title' }, 'Inside This Issue'),
        h('ul', {}, inside.map((a) => h('li', {},
          h('span', { class: 'kick' }, a.category),
          h('a', { class: 'in-title', href: href(a) }, a.title),
          a.summary ? h('span', { class: 'in-sum' }, a.summary) : null))));
      rest = items.slice(6);
      more.hidden = !rest.length;
      more.textContent = 'More stories';
    }
    rest.forEach((a) => box.append(h('article', { class: 'card' },
      badges(a),
      h('h3', {}, h('a', { href: href(a) }, a.title)),
      a.summary ? h('p', { class: 'deck' }, a.summary) : null,
      storyMeta(a),
      h('a', { class: 'more ul', href: href(a) }, 'Read Full Story'))));
  }

  async function viewHome(category) {
    const [cats, list] = await Promise.all([
      api('/api/categories'),
      api('/api/articles' + (category ? '?category=' + encodeURIComponent(category) : '')),
    ]);
    const chips = $('#home-cats');
    chips.replaceChildren(h('a', { class: 'chip' + (category ? '' : ' active'), href: '#/' }, 'All'));
    cats.forEach((c) => chips.append(h('a', { class: 'chip' + (c === category ? ' active' : ''), href: '#/category/' + encodeURIComponent(c) }, c)));
    if (homeCategory !== category) $('#q').value = '';
    homeCategory = category;
    homeItems = list;
    paintHome();
    show('home');
  }

  // ---------- public: article ----------
  function renderBlocks(blocks, root) {
    let dropDone = false;
    blocks.forEach((b) => {
      switch (b.type) {
        case 'heading': root.append(applyStyle(h('h2', {}, inline(b.text)), b.style)); break;
        case 'subheading': root.append(applyStyle(h('h3', {}, inline(b.text)), b.style)); break;
        case 'text': {
          const p = h('p', {}, inline(b.text));
          if (!dropDone && /^\s*[\p{L}\p{N}]/u.test(b.text || '')) { p.classList.add('dropcap'); dropDone = true; }
          root.append(applyStyle(p, b.style));
          break;
        }
        case 'quote':
          root.append(applyStyle(h('blockquote', { class: 'pullquote' },
            h('p', {}, inline(b.text)),
            b.cite ? h('cite', {}, b.cite) : null), b.style));
          break;
        case 'divider': {
          const v = ['line', 'double', 'thick', 'ornament'].includes(b.variant) ? b.variant : 'line';
          root.append(v === 'ornament' ? h('div', { class: 'orn', 'aria-hidden': 'true' }, '⁂') : h('hr', { class: 'rule ' + (v === 'line' ? '' : v) }));
          break;
        }
        case 'code': {
          const copy = h('button', { class: 'btn small', type: 'button' }, 'Copy');
          copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(b.code || ''); copy.textContent = 'Copied'; }
            catch { copy.textContent = 'Press Ctrl+C'; }
            setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
          });
          root.append(h('div', { class: 'code' },
            h('div', { class: 'code-head' }, h('span', {}, b.language || 'plaintext'), copy),
            h('pre', {}, h('code', {}, highlight(b.code, b.language)))));
          break;
        }
        case 'image': {
          const src = safeUrl(b.url);
          if (!src) break;
          root.append(h('figure', {}, h('img', { src, alt: b.caption || '', loading: 'lazy' }), b.caption ? h('figcaption', {}, b.caption) : null));
          break;
        }
        case 'callout': root.append(applyStyle(h('div', { class: 'callout' }, inline(b.text)), b.style)); break;
        case 'github': {
          const url = safeUrl(b.url);
          if (!url) break;
          root.append(h('a', { class: 'repo', href: url, target: '_blank', rel: 'noopener noreferrer' },
            h('strong', {}, '⌥ ' + repoName(url)),
            b.description ? h('span', {}, b.description) : null));
          break;
        }
      }
    });
  }

  const readMins = (blocks) => {
    const words = blocks.reduce((n, b) => n + ((b.text || b.description || '') + ' ').split(/\s+/).filter(Boolean).length, 0);
    return Math.max(1, Math.round(words / 200));
  };

  async function viewArticle(slug) {
    const a = await api('/api/articles/' + encodeURIComponent(slug));
    const body = $('#article-body');
    const content = h('div', { class: 'content' });
    const blocks = a.blocks || [];
    renderBlocks(blocks, content);
    const date = a.published_at || a.updated_at;
    body.replaceChildren(
      h('header', { class: 'art-head' },
        badges(a),
        h('h1', {}, a.title),
        a.summary ? h('p', { class: 'deck' }, a.summary) : null,
        h('div', { class: 'byline' },
          h('span', {}, 'By ', h('a', { class: 'ul', href: '#', onclick: (e) => { e.preventDefault(); $('#site-footer').scrollIntoView({ behavior: 'smooth' }); } }, a.author || 'Md. Shaon Khan')),
          h('span', {}, date ? new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''),
          h('span', {}, readMins(blocks) + ' min read'),
          a.status === 'draft' ? h('span', { class: 'badge' }, 'Draft') : null,
          isAdmin ? h('a', { class: 'btn small', href: '#/edit/' + a.id }, 'Edit') : null)),
      content
    );
    document.title = a.title + ' · ' + SITE;
    show('article');
  }

  // ---------- admin: dashboard ----------
  async function viewDashboard() {
    if (!isAdmin) { location.href = '/login'; return; }
    const list = await api('/api/admin/articles');
    const live = list.filter((a) => a.status === 'published').length;
    $('#dash-stats').replaceChildren(
      h('div', { class: 'stat' }, h('b', {}, list.length), h('span', { class: 'muted' }, 'Total')),
      h('div', { class: 'stat' }, h('b', {}, live), h('span', { class: 'muted' }, 'Published')),
      h('div', { class: 'stat' }, h('b', {}, list.length - live), h('span', { class: 'muted' }, 'Drafts'))
    );
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
      author: ed.author || 'Md. Shaon Khan',
      tags: ed.tags.split(',').map((t) => t.trim()).filter(Boolean),
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

  function styleBar(b) {
    if (!b.style || typeof b.style !== 'object') b.style = {};
    const s = b.style;
    const sel = (key, title, opts) => {
      const el = h('select', { title }, opts.map(([v, t]) => h('option', { value: v }, t)));
      el.value = s[key] || '';
      el.addEventListener('change', () => { if (el.value) s[key] = el.value; else delete s[key]; touch(); });
      return el;
    };
    const tgl = (key, txt, title) => {
      const bt = h('button', { class: 'icon' + (s[key] ? ' on' : ''), type: 'button', title }, txt);
      bt.addEventListener('click', () => {
        if (s[key]) delete s[key]; else s[key] = true;
        bt.classList.toggle('on', !!s[key]);
        touch();
      });
      return bt;
    };
    const col = h('input', { type: 'color', class: 'colorpick', title: 'Text color' });
    col.value = /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#c8102e';
    col.addEventListener('input', () => { s.color = col.value; touch(); });
    return h('div', { class: 'style-bar' },
      sel('size', 'Text size', [['', 'Size'], ['sm', 'Small'], ['lg', 'Large'], ['xl', 'X-Large'], ['xxl', 'Huge']]),
      sel('font', 'Font style', [['', 'Font'], ['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]),
      sel('align', 'Alignment', [['', 'Align'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']]),
      sel('underline', 'Underline style', [['', 'Underline'], ['solid', 'Solid'], ['double', 'Double'], ['wavy', 'Wavy'], ['dotted', 'Dotted'], ['dashed', 'Dashed']]),
      tgl('bold', 'B', 'Bold'),
      tgl('italic', 'I', 'Italic'),
      col,
      h('button', { class: 'btn small', type: 'button', onclick: () => { b.style = {}; renderEditorBlocks(); touch(); } }, 'Reset'));
  }

  function blockBody(b) {
    switch (b.type) {
      case 'heading': return [field(b, 'text', 'Heading text', 'input', 'h-input')];
      case 'subheading': return [field(b, 'text', 'Subheading text')];
      case 'text': return [field(b, 'text', 'Write your paragraph…', 'textarea')];
      case 'quote': return [field(b, 'text', 'Quote or key line to highlight', 'textarea'), field(b, 'cite', 'Attribution (optional)')];
      case 'code': {
        const sel = h('select', { class: 'f' }, LANGS.map((l) => h('option', { value: l }, l)));
        sel.value = b.language || 'python';
        sel.addEventListener('change', () => { b.language = sel.value; touch(); });
        return [sel, field(b, 'code', 'Paste code here', 'textarea', 'mono')];
      }
      case 'image': return [field(b, 'url', 'Image URL (https://…)'), field(b, 'caption', 'Caption (optional)')];
      case 'callout': return [field(b, 'text', 'Callout text', 'textarea')];
      case 'divider': {
        const sel = h('select', { class: 'f' }, [['line', 'Hairline'], ['double', 'Double rule'], ['thick', 'Thick red rule'], ['ornament', 'Ornament ⁂']].map(([v, t]) => h('option', { value: v }, t)));
        sel.value = b.variant || 'line';
        sel.addEventListener('change', () => { b.variant = sel.value; touch(); });
        return [sel];
      }
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
      STYLED.has(b.type) ? styleBar(b) : null,
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
    editor.blocks.forEach((b, i) => { if (BLOCKS[b.type]) box.append(blockCard(b, i)); });
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
      author: doc ? doc.author : 'Md. Shaon Khan',
      tags: doc ? (doc.tags || []).join(', ') : '',
      blocks: doc ? doc.blocks || [] : [],
      dirty: false,
      timer: null,
    };
    $('#ed-title').value = editor.title;
    $('#ed-category').value = editor.category;
    $('#ed-summary').value = editor.summary;
    $('#ed-author').value = editor.author;
    $('#ed-tags').value = editor.tags;
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
          if (last) { last.scrollIntoView({ block: 'center' }); const f = last.querySelector('input:not([type=color]), textarea'); if (f) f.focus(); }
        },
      }, '+ ' + def.label));
    });
    const bind = (sel, key) => $(sel).addEventListener('input', (e) => { editor[key] = e.target.value; touch(); });
    bind('#ed-title', 'title');
    bind('#ed-category', 'category');
    bind('#ed-summary', 'summary');
    bind('#ed-author', 'author');
    bind('#ed-tags', 'tags');
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
    document.title = SITE;
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
    applyPrefs();
    paintMasthead();
    buildPanel();
    initChrome();
    initEditorControls();
    try { isAdmin = (await api('/api/me')).admin; } catch { isAdmin = false; }
    renderNav();
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (e) => { if (editor && editor.dirty) { e.preventDefault(); e.returnValue = ''; } });
    route();
  }

  init();
})();