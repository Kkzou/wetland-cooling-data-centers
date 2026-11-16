#!/usr/bin/env node
// Static site builder: content root (public projection) -> dist/
//   /explore/                         research hub (all studies)
//   /<author>/                        author page
//   /<author>/<study>/                study overview
//   /<author>/<study>/<section>/      outcome | data | code | references | log
//   /<author>/<study>/files/<file>    public downloads
// Usage: node site/build.mjs [--content DIR] [--out DIR] [--legacy-root DIR] [--home explore|legacy]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { SECTIONS, MOTTO, SITE_NAME } from '../lib/constants.mjs';
import { escapeHTML as e, humanSize, readJSON } from '../lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_URL = process.env.WANWU_SITE_URL || 'https://01wanwu.si';

// Markdown: author text is rendered, raw HTML is escaped, unsafe link schemes dropped.
const md = new Marked({ gfm: true });
md.use({
  renderer: { html: (t) => e(t.text ?? t.raw ?? '') },
  walkTokens(t) { if ((t.type === 'link' || t.type === 'image') && /^\s*(javascript|data|vbscript):/i.test(t.href)) t.href = '#'; },
});
const render = (s) => md.parse(s || '');

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
}

export function loadContent(root) {
  const authors = [];
  if (!fs.existsSync(root)) return { authors, studies: [] };
  for (const h of fs.readdirSync(root).sort()) {
    if (!fs.statSync(path.join(root, h)).isDirectory()) continue;
    const a = readJSON(path.join(root, h, 'author.json'), null);
    if (!a) continue;
    a.studies = [];
    for (const s of fs.readdirSync(path.join(root, h)).sort()) {
      if (!fs.statSync(path.join(root, h, s)).isDirectory()) continue;
      const st = readJSON(path.join(root, h, s, 'study.json'), null);
      if (!st) continue;
      st.dir = path.join(root, h, s);
      st.sections = {};
      for (const sec of SECTIONS) {
        try { st.sections[sec.id] = fs.readFileSync(path.join(st.dir, 'sections', `${sec.id}.md`), 'utf8'); } catch { st.sections[sec.id] = ''; }
      }
      // Defence in depth: never trust that the content root holds only public material.
      st.materials = (st.materials || []).filter(m => m.visibility === 'public')
        .sort((x, y) => (x.order ?? 1e9) - (y.order ?? 1e9) || x.id.localeCompare(y.id));
      a.studies.push(st);
    }
    authors.push(a);
  }
  return { authors, studies: authors.flatMap(a => a.studies) };
}

const url = (...p) => '/' + p.filter(Boolean).join('/') + '/';
const visibleSections = st => SECTIONS.filter(s => s.id === 'overview' || st.sections[s.id] || st.materials.some(m => m.section === s.id));

function page({ title, desc, body, canonical, ogImage }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
${canonical ? `<link rel="canonical" href="${e(SITE_URL + canonical)}"><meta property="og:url" content="${e(SITE_URL + canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${e(SITE_URL + ogImage)}">` : ''}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&family=Roboto+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<nav class="top"><div class="wrap">
  <a class="brand" href="/explore/"><b>01</b>wanwu</a>
  <span class="links"><a href="/explore/">Explore</a><a href="/about/">About</a></span>
</div></nav>
${body}
<footer><div class="wrap"><span>${e(MOTTO)} · ${SITE_NAME}</span><span>Every page is published by its authors. We never view or use your uploads without your permission.</span></div></footer>
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}

function authorLine(st, byHandle) {
  const affs = [];
  const idx = a => { if (!a.affiliation) return ''; let i = affs.indexOf(a.affiliation); if (i < 0) { affs.push(a.affiliation); i = affs.length - 1; } return `<sup>${i + 1}</sup>`; };
  const names = st.authors.map(a => {
    const n = e(a.name) + idx(a) + (a.corresponding ? '<sup>*</sup>' : '');
    return byHandle[a.handle] ? `<a href="${url(a.handle)}">${n}</a>` : `<span>${n}</span>`;
  }).join('');
  const aff = affs.map((x, i) => `<span class="aff"><sup>${i + 1}</sup> ${e(x)}</span>`).join('');
  return `<div class="authors">${names}</div>${aff ? `<div class="authors">${aff}</div>` : ''}`;
}

function citation(st) {
  const fmt = n => { const p = n.trim().split(/\s+/); if (p.length < 2) return n; const last = p.pop(); return `${last}, ${p.map(x => x[0] + '.').join(' ')}`; };
  const names = st.authors.map(a => fmt(a.name));
  const who = names.length > 1 ? names.slice(0, -1).join(', ') + ', & ' + names.at(-1) : names[0];
  return `${who} (${st.year}). ${st.title}${/[.?!]$/.test(st.title) ? '' : '.'} ${SITE_NAME}. ${SITE_URL.replace(/^https?:\/\//, '')}${url(st.owner, st.slug)}`;
}

function studyHeader(st, byHandle, current) {
  const owner = byHandle[st.owner];
  const tabs = visibleSections(st).map(s =>
    `<a href="${s.id === 'overview' ? url(st.owner, st.slug) : url(st.owner, st.slug, s.id)}"${s.id === current ? ' aria-current="page"' : ''}>${e(s.label)}</a>`).join('');
  return `<div class="crumbs"><a href="${url(st.owner)}">${e(owner?.name || st.owner)}</a><span>/</span><span>${e(st.slug)}</span></div>
<header class="hero">
  <span class="tag">${e([st.subtitle, st.year].filter(Boolean).join(' · '))}</span>
  <h1>${e(st.title)}</h1>
  ${authorLine(st, byHandle)}
  <div class="row">
    <span class="pill st-${e(st.status)}">${e(st.status.replace('-', ' '))}</span>
    ${st.tags.map(t => `<span class="pill">${e(t)}</span>`).join('')}
    <button class="star" type="button" data-star="${e(st.owner + '/' + st.slug)}" aria-pressed="false" title="Star this study">☆ Star</button>
  </div>
</header>
<nav class="tabs" aria-label="Study sections">${tabs}</nav>`;
}

function fileRow(st, m) {
  const ext = path.extname(m.file).slice(1) || m.kind;
  let preview = '';
  if (m.kind === 'code' || (m.kind === 'text' && m.size < 40000)) {
    try {
      const src = fs.readFileSync(path.join(st.dir, m.file), 'utf8');
      if (src.length < 40000) preview = `<details><summary>Show code</summary><pre><code>${e(src)}</code></pre></details>`;
    } catch {}
  }
  return `<div class="file"><span class="ico">${e(ext)}</span><div><h3>${e(m.title)}</h3>${m.description || m.caption ? `<p class="meta">${e(m.description || m.caption)}</p>` : ''}<p class="meta">${e(humanSize(m.size))}</p></div><a href="${url(st.owner, st.slug)}${encodeURI(m.file)}" download>Download</a>${preview}</div>`;
}

function materialsBlock(st, section) {
  const ms = st.materials.filter(m => m.section === section);
  if (!ms.length) return '';
  const imgs = ms.filter(m => m.kind === 'image'), rest = ms.filter(m => m.kind !== 'image');
  let h = '';
  if (imgs.length) h += `<div class="figs">${imgs.map(m => `<figure><img loading="lazy" src="${url(st.owner, st.slug)}${encodeURI(m.file)}" alt="${e(m.caption || m.title)}"><figcaption>${e(m.caption || m.title)}</figcaption></figure>`).join('')}</div>`;
  if (rest.length) h += `<div class="files">${rest.map(m => fileRow(st, m)).join('')}</div>`;
  return `<section><h2>Files</h2>${h}</section>`;
}

function studyOverview(st, byHandle) {
  const results = st.keyResults?.length ? `<section><h2>Key results</h2><div class="cards">${st.keyResults.map(k =>
    `<div class="card">${k.value ? `<span class="big">${e(k.value)}</span>` : ''}<h3>${e(k.label)}</h3>${k.detail ? `<p>${e(k.detail)}</p>` : ''}</div>`).join('')}</div></section>` : '';
  const secCards = visibleSections(st).filter(s => s.id !== 'overview').map(s => {
    const n = st.materials.filter(m => m.section === s.id).length;
    return `<a class="card" href="${url(st.owner, st.slug, s.id)}"><h3>${e(s.label)}</h3><p>${e(s.blurb)}${n ? ` · ${n} file${n > 1 ? 's' : ''}` : ''}</p></a>`;
  }).join('');
  return `<main class="wrap">${studyHeader(st, byHandle, 'overview')}
${st.summary ? `<section><p class="sub">${e(st.summary)}</p></section>` : ''}
${results}
${st.sections.overview ? `<section><div class="prose">${render(st.sections.overview)}</div></section>` : ''}
${materialsBlock(st, 'overview')}
${secCards ? `<section><h2>Explore this study</h2><div class="cards">${secCards}</div></section>` : ''}
<section><h2>Cite</h2><div class="note"><span class="cite">${e(citation(st))}</span></div></section>
</main>`;
}

function studySection(st, byHandle, sec) {
  return `<main class="wrap">${studyHeader(st, byHandle, sec.id)}
${st.sections[sec.id] ? `<section><div class="prose">${render(st.sections[sec.id])}</div></section>` : ''}
${materialsBlock(st, sec.id)}
</main>`;
}

function studyCard(st, byHandle) {
  const names = st.authors.map(a => a.name).join(', ');
  return `<a class="card" href="${url(st.owner, st.slug)}" data-search="${e([st.title, st.summary, names, ...(st.tags || [])].join(' ').toLowerCase())}">
<span class="tag">${e(byHandle[st.owner]?.affiliation || '')}${st.year ? ' · ' + e(st.year) : ''}</span>
<h3>${e(st.title)}</h3><p>${e(names)}</p>${st.summary ? `<p>${e(st.summary.length > 180 ? st.summary.slice(0, 177) + '…' : st.summary)}</p>` : ''}
<div class="row"><span class="pill st-${e(st.status)}">${e(st.status.replace('-', ' '))}</span>${(st.tags || []).slice(0, 3).map(t => `<span class="pill">${e(t)}</span>`).join('')}</div></a>`;
}

function authorPage(a, all, byHandle) {
  const coauthored = all.filter(st => st.owner !== a.handle && st.authors.some(x => x.handle === a.handle));
  const links = Object.entries(a.links || {}).filter(([, v]) => v).map(([k, v]) => `<a href="${e(k === 'email' ? 'mailto:' + v : v)}">${e(k[0].toUpperCase() + k.slice(1))}</a>`).join('');
  return `<main class="wrap">
<header class="hero">
  <span class="tag">${e([a.role, a.affiliation].filter(Boolean).join(' · '))}</span>
  <h1>${e(a.name)}${a.nameLocal ? ` <span class="muted">${e(a.nameLocal)}</span>` : ''}</h1>
  ${a.bio ? `<p class="sub">${e(a.bio)}</p>` : ''}
  ${links ? `<div class="row">${links}</div>` : ''}
</header>
<section><h2>Studies</h2>${a.studies.length ? `<div class="cards">${a.studies.map(s => studyCard(s, byHandle)).join('')}</div>` : '<p class="empty">No public studies yet.</p>'}</section>
${coauthored.length ? `<section><h2>Co-authored</h2><div class="cards">${coauthored.map(s => studyCard(s, byHandle)).join('')}</div></section>` : ''}
</main>`;
}

function explorePage(studies, byHandle) {
  const sorted = [...studies].sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
  return `<main class="wrap">
<header class="home-hero">
  <h1><b style="color:var(--blue);font-weight:400">01</b>wanwu</h1>
  <p class="motto">${e(MOTTO)}</p>
  <p class="sub">Neat, clean pages for your research. Upload everything you have; we organize it into one link for your supervisor, your CV and your interviews.</p>
  <input class="search" type="search" placeholder="Search studies, people, topics" aria-label="Search studies" data-filter=".cards .card">
</header>
<section><h2>Research hub</h2>${sorted.length ? `<div class="cards">${sorted.map(s => studyCard(s, byHandle)).join('')}</div>` : '<p class="empty">No studies yet.</p>'}</section>
</main>`;
}

function aboutPage() {
  return `<main class="wrap"><header class="hero"><span class="tag">${e(MOTTO)}</span><h1>About ${SITE_NAME}</h1>
<p class="sub">${SITE_NAME} turns a researcher's scattered materials (papers, spreadsheets, code, slides, notes and recordings) into a clean public page with one link: <code>01wanwu.si/&lt;you&gt;/&lt;study&gt;</code>.</p></header>
<section><div class="prose">
<h2>How it works</h2><ol><li>Upload everything for a study: Word, PDF, Excel, Markdown, code, Google Drive links, slides, even meeting recordings.</li><li>Our workflow reads it, sorts it into Outcome, Data, Code, References and Log, and drafts the pages.</li><li>You review, choose what is public, and publish. Co-authors appear in order, each linked to their own page.</li></ol>
<h2>Our promise</h2><p>We never view or use your data or uploads without your permission. Everything you upload starts private. Only files you mark public appear on your page, and you can take them down at any time.</p>
</div></section></main>`;
}

function write(out, rel, html) {
  const p = path.join(out, rel, 'index.html');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}

export function build({ content, out, legacyRoot, home = legacyRoot ? 'legacy' : 'explore' }) {
  const { authors, studies } = loadContent(content);
  const byHandle = Object.fromEntries(authors.map(a => [a.handle, a]));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  for (const f of ['style.css', 'site.js', 'favicon.svg']) fs.copyFileSync(path.join(HERE, f), path.join(out, 'assets', f));

  const pages = [];
  const emit = (rel, opts) => { write(out, rel, page(opts)); pages.push('/' + rel + (rel ? '/' : '')); };

  emit('explore', { title: `${SITE_NAME} · Research hub`, desc: `${MOTTO}. Clean public pages for research studies.`, body: explorePage(studies, byHandle), canonical: '/explore/' });
  emit('about', { title: `About · ${SITE_NAME}`, desc: `About ${SITE_NAME}`, body: aboutPage(), canonical: '/about/' });

  for (const a of authors) {
    emit(a.handle, { title: `${a.name} · ${SITE_NAME}`, desc: a.bio || `${a.name}'s research on ${SITE_NAME}`, body: authorPage(a, studies, byHandle), canonical: url(a.handle) });
    for (const st of a.studies) {
      const fig = st.materials.find(m => m.kind === 'image');
      const og = fig ? url(st.owner, st.slug) + encodeURI(fig.file) : undefined;
      const names = st.authors.map(x => x.name).join(', ');
      emit(`${a.handle}/${st.slug}`, { title: `${st.title} · ${names}`, desc: st.summary || st.title, body: studyOverview(st, byHandle), canonical: url(a.handle, st.slug), ogImage: og });
      for (const sec of visibleSections(st)) if (sec.id !== 'overview')
        emit(`${a.handle}/${st.slug}/${sec.id}`, { title: `${sec.label} · ${st.title}`, desc: `${sec.blurb}: ${st.title}`, body: studySection(st, byHandle, sec), canonical: url(a.handle, st.slug, sec.id), ogImage: og });
      for (const m of st.materials) {
        const dst = path.join(out, a.handle, st.slug, m.file);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(st.dir, m.file), dst);
      }
    }
  }

  // Home page. While the platform is new, 01wanwu.si/ keeps serving the original
  // single-study portfolio so the link already on Yujia's CV does not change.
  if (home === 'legacy' && legacyRoot) {
    for (const f of ['index.html', 'figures', 'code']) {
      const src = path.join(legacyRoot, f);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(out, f), { recursive: true, filter: s => !/__pycache__|\.pyc$/.test(s) });
    }
  } else {
    write(out, '', page({ title: `${SITE_NAME} · ${MOTTO}`, desc: `${MOTTO}. Clean public pages for research studies.`, body: explorePage(studies, byHandle), canonical: '/' }));
  }
  write(out, '404', page({ title: `Not found · ${SITE_NAME}`, desc: 'Page not found', body: `<main class="wrap"><header class="hero"><h1>Page not found</h1><p class="sub">This study may have moved or been made private. <a href="/explore/">Browse the research hub</a>.</p></header></main>` }));
  fs.renameSync(path.join(out, '404', 'index.html'), path.join(out, '404.html')); fs.rmdirSync(path.join(out, '404'));

  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), studies: studies.map(s => ({ path: url(s.owner, s.slug), title: s.title, authors: s.authors.map(a => a.name), tags: s.tags, status: s.status, year: s.year })) }, null, 2));
  return { out, pages, authors: authors.length, studies: studies.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args();
  const pkg = path.resolve(HERE, '..');
  const r = build({
    content: path.resolve(o.content || process.env.WANWU_CONTENT || path.join(pkg, 'content')),
    out: path.resolve(o.out || path.join(pkg, 'dist')),
    legacyRoot: o['legacy-root'] ? path.resolve(o['legacy-root']) : undefined,
    home: o.home,
  });
  console.log(`Built ${r.pages.length} pages (${r.authors} authors, ${r.studies} studies) -> ${r.out}`);
}
