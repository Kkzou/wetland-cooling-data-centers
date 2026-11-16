// Workspace store. Two roots, on purpose:
//   workspace (private): everything the researcher uploads, plus extracted text.
//                        Lives on the researcher's machine / private storage. Never committed.
//   content   (public):  the public projection written by exportPublic(): study metadata,
//                        section pages and ONLY materials the author marked public.
// The site builder reads `content`, so a private file cannot reach the web by accident.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTION_IDS, MATERIAL_SECTIONS, RESERVED_HANDLES, STATUSES } from './constants.mjs';
import { slugify, isSlug, readJSON, writeJSON, sha1, nowISO } from './util.mjs';
import { extractText, kindOf } from './extract.mjs';
import { classify } from './classify.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const paths = {
  get workspace() { return path.resolve(process.env.WANWU_WORKSPACE || path.join(os.homedir(), '.wanwu', 'workspace')); },
  get content() { return path.resolve(process.env.WANWU_CONTENT || path.join(PKG, 'content')); },
};
const authorDir = (h, root = paths.workspace) => path.join(root, h);
const studyDir = (h, s, root = paths.workspace) => path.join(root, h, s);

function assertHandle(h) {
  if (!isSlug(h)) throw new Error(`"${h}" is not a valid handle: use lowercase letters, digits and hyphens (e.g. "yujiazou").`);
  if (RESERVED_HANDLES.has(h)) throw new Error(`"${h}" is reserved; choose another handle.`);
}
function assertSlug(s) {
  if (!isSlug(s)) throw new Error(`"${s}" is not a valid study slug: lowercase letters, digits and hyphens.`);
  if (SECTION_IDS.includes(s) || s === 'files') throw new Error(`"${s}" is reserved.`);
}

// ---------- authors ----------
export function getAuthor(handle, root = paths.workspace) {
  return readJSON(path.join(authorDir(handle, root), 'author.json'), null);
}
export function upsertAuthor(input) {
  const handle = input.handle || slugify(input.name).replace(/-/g, '');
  assertHandle(handle);
  const p = path.join(authorDir(handle), 'author.json');
  const prev = readJSON(p, {});
  const a = {
    handle,
    name: input.name ?? prev.name,
    nameLocal: input.nameLocal ?? prev.nameLocal,          // e.g. 邹雨佳, optional
    affiliation: input.affiliation ?? prev.affiliation ?? '',
    role: input.role ?? prev.role ?? '',                    // e.g. "MS student"
    bio: input.bio ?? prev.bio ?? '',
    links: { ...(prev.links || {}), ...(input.links || {}) },
    createdAt: prev.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
  if (!a.name) throw new Error('name is required');
  writeJSON(p, a);
  return a;
}
export function listAuthors(root = paths.workspace) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(h => fs.statSync(path.join(root, h)).isDirectory() && fs.existsSync(path.join(root, h, 'author.json'))).map(h => getAuthor(h, root));
}

// ---------- studies ----------
export function getStudy(handle, slug, root = paths.workspace) {
  return readJSON(path.join(studyDir(handle, slug, root), 'study.json'), null);
}
function saveStudy(handle, st) {
  st.updatedAt = nowISO();
  writeJSON(path.join(studyDir(handle, st.slug), 'study.json'), st);
  return st;
}
export function upsertStudy(handle, input) {
  assertHandle(handle);
  const owner = getAuthor(handle);
  if (!owner) throw new Error(`No author "${handle}". Create the author first.`);
  const slug = input.slug || slugify(input.title);
  assertSlug(slug);
  const prev = getStudy(handle, slug) || {};
  if (input.status && !STATUSES.includes(input.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  // Author order is meaningful (first author first). The owner is added if missing.
  let authors = input.authors ?? prev.authors ?? [];
  authors = authors.map(a => typeof a === 'string' ? { name: a } : a);
  if (!authors.some(a => a.handle === handle)) authors.unshift({ name: owner.name, handle, affiliation: owner.affiliation });
  const st = {
    slug,
    owner: handle,
    title: input.title ?? prev.title,
    subtitle: input.subtitle ?? prev.subtitle ?? '',
    summary: input.summary ?? prev.summary ?? '',
    status: input.status ?? prev.status ?? 'in-progress',
    year: input.year ?? prev.year ?? new Date().getFullYear(),
    tags: input.tags ?? prev.tags ?? [],
    authors,
    keyResults: input.keyResults ?? prev.keyResults ?? [],
    links: { ...(prev.links || {}), ...(input.links || {}) },
    license: input.license ?? prev.license ?? '',
    materials: prev.materials || [],
    createdAt: prev.createdAt || nowISO(),
  };
  if (!st.title) throw new Error('title is required');
  fs.mkdirSync(path.join(studyDir(handle, slug), 'sections'), { recursive: true });
  return saveStudy(handle, st);
}
export function listStudies(handle, root = paths.workspace) {
  const d = authorDir(handle, root);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(s => fs.statSync(path.join(d, s)).isDirectory() && fs.existsSync(path.join(d, s, 'study.json'))).map(s => getStudy(handle, s, root));
}
function mustStudy(handle, slug) {
  const st = getStudy(handle, slug);
  if (!st) throw new Error(`No study "${handle}/${slug}".`);
  return st;
}

// ---------- sections ----------
export function writeSection(handle, slug, section, markdown) {
  if (!SECTION_IDS.includes(section)) throw new Error(`section must be one of ${SECTION_IDS.join(', ')}`);
  mustStudy(handle, slug);
  const p = path.join(studyDir(handle, slug), 'sections', `${section}.md`);
  fs.writeFileSync(p, markdown.trim() + '\n');
  return p;
}
export function readSection(handle, slug, section, root = paths.workspace) {
  try { return fs.readFileSync(path.join(studyDir(handle, slug, root), 'sections', `${section}.md`), 'utf8'); } catch { return ''; }
}

// ---------- materials ----------
function googleExportURL(u) {
  let m;
  if ((m = u.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return [`https://docs.google.com/document/d/${m[1]}/export?format=docx`, `${m[1]}.docx`];
  if ((m = u.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) return [`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, `${m[1]}.xlsx`];
  if ((m = u.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return [`https://docs.google.com/presentation/d/${m[1]}/export/pptx`, `${m[1]}.pptx`];
  if ((m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/)) || (m = u.match(/drive\.google\.com\/open\?id=([\w-]+)/)))
    return [`https://drive.google.com/uc?export=download&id=${m[1]}`, null];
  return [u, null];
}
async function download(url, destDir) {
  const [real, guess] = googleExportURL(url);
  const res = await fetch(real, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}. If it is a private Drive/WPS file, download it with your Drive connector or export it, then pass the local path.`);
  const cd = res.headers.get('content-disposition') || '';
  const fromHeader = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1];
  const name = decodeURIComponent(fromHeader || guess || path.basename(new URL(real).pathname) || 'download');
  const tmp = path.join(destDir, `.dl-${Date.now()}-${name}`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  return { tmp, name };
}
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * Add files (paths, folders or URLs) to a study. Each file is copied into the private
 * workspace, text-extracted and given a first-guess section. All new materials start
 * PRIVATE; the suggestion is recorded so the author can accept it in one step.
 */
export async function ingest(handle, slug, sources, opts = {}) {
  const st = mustStudy(handle, slug);
  const dir = studyDir(handle, slug);
  const filesDir = path.join(dir, 'files');
  const exDir = path.join(dir, 'extracted');
  fs.mkdirSync(filesDir, { recursive: true }); fs.mkdirSync(exDir, { recursive: true });
  const results = [];
  for (const src of [].concat(sources)) {
    let items = [];
    try {
      if (/^https?:\/\//.test(src)) { const d = await download(src, filesDir); items = [{ p: d.tmp, name: d.name, temp: true, source: src }]; }
      else {
        const abs = path.resolve(src.replace(/^~(?=$|\/)/, os.homedir()));
        if (!fs.existsSync(abs)) throw new Error(`Not found: ${src}`);
        items = fs.statSync(abs).isDirectory()
          ? walk(abs).map(p => ({ p, name: path.relative(abs, p), source: p }))
          : [{ p: abs, name: path.basename(abs), source: abs }];
      }
    } catch (e) { results.push({ source: src, error: e.message }); continue; }

    for (const it of items) {
      const buf = fs.readFileSync(it.p);
      const hash = sha1(buf);
      const dup = st.materials.find(m => m.sha1 === hash);
      if (dup) { if (it.temp) fs.rmSync(it.p); results.push({ source: it.source, skipped: `duplicate of ${dup.id}` }); continue; }
      const id = `m${String(st.materials.length + 1).padStart(3, '0')}`;
      const base = path.basename(it.name).replace(/[^\w.\-一-鿿 ()]+/g, '_');
      const stored = `${id}-${base}`;
      fs.writeFileSync(path.join(filesDir, stored), buf);
      if (it.temp) fs.rmSync(it.p);
      const c = classify(it.name);
      const section = opts.section || c.section;
      const ex = await extractText(path.join(filesDir, stored));
      if (ex.text) fs.writeFileSync(path.join(exDir, `${id}.txt`), ex.text);
      const m = {
        id, title: path.basename(base, path.extname(base)).replace(/[_-]+/g, ' ').trim(),
        file: `files/${stored}`, originalName: it.name, source: /^https?:/.test(it.source) ? it.source : path.basename(it.source),
        kind: kindOf(it.name), section, reason: opts.section ? 'set by uploader' : c.reason,
        visibility: 'private', suggestedVisibility: opts.visibility || c.suggestedVisibility,
        caption: '', description: '', size: buf.length, sha1: hash,
        extract: { status: ex.status, note: ex.note || '', chars: ex.text.length },
        addedAt: nowISO(),
      };
      st.materials.push(m);
      results.push({ id, file: it.name, section, kind: m.kind, suggestedVisibility: m.suggestedVisibility, extract: m.extract.status, note: m.extract.note || undefined });
    }
  }
  saveStudy(handle, st);
  return results;
}

export function readMaterialText(handle, slug, id, { offset = 0, limit = 20000 } = {}) {
  const st = mustStudy(handle, slug);
  const m = st.materials.find(x => x.id === id);
  if (!m) throw new Error(`No material ${id}`);
  let text = '';
  try { text = fs.readFileSync(path.join(studyDir(handle, slug), 'extracted', `${id}.txt`), 'utf8'); } catch {}
  return { material: m, total: text.length, offset, text: text.slice(offset, offset + limit) };
}

export function updateMaterial(handle, slug, id, patch) {
  const st = mustStudy(handle, slug);
  const m = st.materials.find(x => x.id === id);
  if (!m) throw new Error(`No material ${id}`);
  if (patch.section && !MATERIAL_SECTIONS.includes(patch.section)) throw new Error(`section must be one of ${MATERIAL_SECTIONS.join(', ')}`);
  if (patch.visibility && !['public', 'private'].includes(patch.visibility)) throw new Error('visibility must be public or private');
  for (const k of ['title', 'section', 'visibility', 'caption', 'description', 'order']) if (patch[k] !== undefined) m[k] = patch[k];
  if (patch.visibility) m.visibilityConfirmedAt = nowISO();
  saveStudy(handle, st);
  return m;
}

/** Apply the suggested visibility to every material the author has not decided on yet. */
export function acceptSuggestedVisibility(handle, slug) {
  const st = mustStudy(handle, slug);
  const changed = [];
  for (const m of st.materials) if (!m.visibilityConfirmedAt) {
    m.visibility = m.suggestedVisibility; m.visibilityConfirmedAt = nowISO(); changed.push({ id: m.id, visibility: m.visibility });
  }
  saveStudy(handle, st);
  return changed;
}

export function removeMaterial(handle, slug, id) {
  const st = mustStudy(handle, slug);
  const i = st.materials.findIndex(x => x.id === id);
  if (i < 0) throw new Error(`No material ${id}`);
  const [m] = st.materials.splice(i, 1);
  fs.rmSync(path.join(studyDir(handle, slug), m.file), { force: true });
  fs.rmSync(path.join(studyDir(handle, slug), 'extracted', `${id}.txt`), { force: true });
  saveStudy(handle, st);
  return m;
}

// ---------- checks & export ----------
export function checkStudy(handle, slug) {
  const st = mustStudy(handle, slug);
  const issues = [];
  if (!st.summary) issues.push('No summary: add a 1–3 sentence plain-language summary.');
  if (!readSection(handle, slug, 'overview')) issues.push('Overview page is empty: write sections/overview.md with write_section.');
  for (const s of MATERIAL_SECTIONS) {
    const hasText = !!readSection(handle, slug, s);
    const hasPub = st.materials.some(m => m.section === s && m.visibility === 'public');
    if (!hasText && !hasPub) issues.push(`Section "${s}" is empty and will be hidden.`);
  }
  const undecided = st.materials.filter(m => !m.visibilityConfirmedAt);
  if (undecided.length) issues.push(`${undecided.length} material(s) are private until the author decides: ${undecided.map(m => m.id).join(', ')}.`);
  for (const m of st.materials) if (m.kind === 'image' && m.visibility === 'public' && !m.caption) issues.push(`Figure ${m.id} (${m.title}) has no caption.`);
  for (const m of st.materials) if (m.extract.status === 'needs_transcription') issues.push(`Recording ${m.id} needs a transcript before it can be summarized.`);
  // Private material named in public text is a leak risk.
  const allText = SECTION_IDS.map(s => readSection(handle, slug, s)).join('\n');
  for (const m of st.materials) if (m.visibility === 'private' && allText.includes(m.file)) issues.push(`Public text links private file ${m.file}.`);
  return { ok: issues.length === 0, issues };
}

/** Public projection of the whole workspace (or one author) into the content root. */
export function exportPublic({ handle } = {}) {
  const ws = paths.workspace, out = paths.content;
  const handles = handle ? [handle] : listAuthors(ws).map(a => a.handle);
  const report = [];
  for (const h of handles) {
    const a = getAuthor(h, ws);
    fs.rmSync(path.join(out, h), { recursive: true, force: true });
    writeJSON(path.join(out, h, 'author.json'), a);
    for (const st of listStudies(h, ws)) {
      const pub = { ...st, materials: st.materials.filter(m => m.visibility === 'public').map(({ sha1: _s, reason: _r, suggestedVisibility: _v, source: _src, ...m }) => m) };
      const dst = path.join(out, h, st.slug);
      writeJSON(path.join(dst, 'study.json'), pub);
      for (const s of SECTION_IDS) {
        const md = readSection(h, st.slug, s, ws);
        if (md) { fs.mkdirSync(path.join(dst, 'sections'), { recursive: true }); fs.writeFileSync(path.join(dst, 'sections', `${s}.md`), md); }
      }
      for (const m of pub.materials) {
        fs.mkdirSync(path.join(dst, 'files'), { recursive: true });
        fs.copyFileSync(path.join(studyDir(h, st.slug, ws), m.file), path.join(dst, m.file));
      }
      report.push({ study: `${h}/${st.slug}`, publicFiles: pub.materials.length, privateKept: st.materials.length - pub.materials.length });
    }
  }
  return { content: out, report };
}
