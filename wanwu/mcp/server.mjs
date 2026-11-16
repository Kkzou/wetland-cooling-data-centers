#!/usr/bin/env node
// 01wanwu MCP server (stdio). Any MCP client (Claude Code, Claude Desktop, Cursor...) can
// call these tools; the client's model is the "agent" that reads, sorts and writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as store from '../lib/store.mjs';
import { SECTIONS, MATERIAL_SECTIONS, SECTION_IDS, STATUSES, MOTTO } from '../lib/constants.mjs';
import { build } from '../site/build.mjs';
import { WORKFLOW } from './workflow.mjs';

const server = new McpServer({ name: 'wanwu', version: '0.1.0' }, {
  instructions: `01wanwu (${MOTTO}) turns a researcher's materials into public study pages at 01wanwu.si/<author>/<study>/<section>. ` +
    `Follow the "showcase_study" prompt. Everything uploaded starts PRIVATE; only publish what the author explicitly approved. ` +
    `Never invent results, numbers, co-authors or affiliations: every claim on a page must come from the author's materials or the author.`,
});

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: String(err?.message || err) }] });
const tool = (name, config, fn) => server.registerTool(name, config, async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } });

const Handle = z.string().describe('Author handle, the first URL segment, e.g. "yujiazou"');
const Slug = z.string().describe('Study slug, the second URL segment, e.g. "wetland-cooling"');

tool('create_author', {
  title: 'Create or update an author',
  description: 'Create or update the author page at 01wanwu.si/<handle>/. Fields not given keep their old values.',
  inputSchema: {
    name: z.string().describe('Display name, e.g. "Yujia Zou"'),
    handle: Handle.optional().describe('Defaults to the name lowercased without spaces'),
    nameLocal: z.string().optional().describe('Name in another script, e.g. 邹雨佳'),
    affiliation: z.string().optional(), role: z.string().optional().describe('e.g. "MS student", "Assistant Professor"'),
    bio: z.string().optional().describe('One or two sentences, written or approved by the author'),
    links: z.record(z.string()).optional().describe('e.g. {"github":"https://github.com/x","scholar":"...","orcid":"...","website":"..."}'),
  },
}, (a) => store.upsertAuthor(a));

tool('create_study', {
  title: 'Create or update a study',
  description: 'Create or update a study at 01wanwu.si/<handle>/<slug>/. Authors are listed in the given order (first author first); give a co-author a handle to link their own page.',
  inputSchema: {
    handle: Handle, slug: Slug.optional().describe('Defaults to a slug of the title'),
    title: z.string(), subtitle: z.string().optional().describe('Short context line, e.g. "Columbia University · Northern Virginia"'),
    summary: z.string().optional().describe('1–3 plain-language sentences a recruiter can follow'),
    status: z.enum(STATUSES).optional(), year: z.number().int().optional(), tags: z.array(z.string()).optional(),
    authors: z.array(z.object({ name: z.string(), handle: z.string().optional(), affiliation: z.string().optional(), corresponding: z.boolean().optional() })).optional()
      .describe('Ordered author list. The owner is added first if missing.'),
    keyResults: z.array(z.object({ value: z.string().optional(), label: z.string(), detail: z.string().optional() })).optional()
      .describe('2–4 headline numbers, each traceable to a material'),
    links: z.record(z.string()).optional().describe('e.g. {"doi":"...","preprint":"...","repo":"..."}'),
  },
}, ({ handle, ...rest }) => { const st = store.upsertStudy(handle, rest); return { ...st, materials: `${st.materials.length} materials`, url: `/${handle}/${st.slug}/` }; });

tool('ingest', {
  title: 'Upload materials',
  description: 'Add files, whole folders or links (Google Docs/Sheets/Slides/Drive share links, direct URLs) to a study. ' +
    'Supports Word .docx, PDF, Excel/CSV, Markdown/text, code, notebooks, images, slides, audio/video. ' +
    'WPS users: save as .docx/.xlsx first. Private Drive files: download them with your Drive tools and pass the local path. ' +
    'Each file is text-extracted and sorted into a section. All new files start PRIVATE.',
  inputSchema: {
    handle: Handle, slug: Slug,
    sources: z.array(z.string()).min(1).describe('Local paths, folders or https URLs'),
    section: z.enum(MATERIAL_SECTIONS).optional().describe('Force a section for all of these files'),
  },
}, ({ handle, slug, sources, section }) => store.ingest(handle, slug, sources, { section }));

tool('list_materials', {
  title: 'List materials',
  description: 'List a study\'s materials with section, kind, visibility (current and suggested), extraction status and caption.',
  inputSchema: { handle: Handle, slug: Slug },
}, ({ handle, slug }) => {
  const st = store.getStudy(handle, slug); if (!st) throw new Error('No such study');
  return st.materials.map(m => ({ id: m.id, title: m.title, file: m.originalName, section: m.section, kind: m.kind, visibility: m.visibility,
    suggested: m.suggestedVisibility, decided: !!m.visibilityConfirmedAt, extract: m.extract.status, chars: m.extract.chars, caption: m.caption || undefined, note: m.extract.note || undefined }));
});

tool('read_material', {
  title: 'Read a material',
  description: 'Read the extracted text of one material (paged). Use this to understand the study before writing any page.',
  inputSchema: { handle: Handle, slug: Slug, id: z.string(), offset: z.number().int().optional(), limit: z.number().int().max(50000).optional() },
}, ({ handle, slug, id, offset, limit }) => store.readMaterialText(handle, slug, id, { offset, limit }));

tool('update_material', {
  title: 'Edit a material',
  description: 'Change a material\'s title, section, caption, description, display order or visibility. Set visibility "public" ONLY after the author approved it.',
  inputSchema: {
    handle: Handle, slug: Slug, id: z.string(),
    title: z.string().optional(), section: z.enum(MATERIAL_SECTIONS).optional(), caption: z.string().optional(),
    description: z.string().optional(), order: z.number().optional(), visibility: z.enum(['public', 'private']).optional(),
  },
}, ({ handle, slug, id, ...patch }) => store.updateMaterial(handle, slug, id, patch));

tool('accept_suggested_visibility', {
  title: 'Apply suggested visibility',
  description: 'Apply the suggested public/private setting to every material the author has not decided on yet. Only call after showing the author the list and getting a yes.',
  inputSchema: { handle: Handle, slug: Slug, author_approved: z.literal(true).describe('Must be true: the author saw the list and agreed') },
}, ({ handle, slug }) => store.acceptSuggestedVisibility(handle, slug));

tool('remove_material', {
  title: 'Remove a material', description: 'Delete a material and its extracted text from the workspace.',
  inputSchema: { handle: Handle, slug: Slug, id: z.string() },
}, ({ handle, slug, id }) => store.removeMaterial(handle, slug, id));

tool('write_section', {
  title: 'Write a section page',
  description: `Write the Markdown body of one section page: ${SECTIONS.map(s => `${s.id} (${s.blurb})`).join('; ')}. ` +
    'Files in the section are listed automatically below the text, so do not repeat them. Plain, concise English unless the author asks otherwise; every number must come from a material.',
  inputSchema: { handle: Handle, slug: Slug, section: z.enum(SECTION_IDS), markdown: z.string() },
}, ({ handle, slug, section, markdown }) => ({ written: store.writeSection(handle, slug, section, markdown) }));

tool('read_section', {
  title: 'Read a section page', description: 'Read the current Markdown of a section page.',
  inputSchema: { handle: Handle, slug: Slug, section: z.enum(SECTION_IDS) },
}, ({ handle, slug, section }) => store.readSection(handle, slug, section) || '(empty)');

tool('check_study', {
  title: 'Check before publishing',
  description: 'List problems to fix before publishing: empty sections, undecided visibility, figures without captions, missing transcripts, private files linked from public text.',
  inputSchema: { handle: Handle, slug: Slug },
}, ({ handle, slug }) => store.checkStudy(handle, slug));

let previewServer = null;
function serveDir(dir, port) {
  if (previewServer) previewServer.close();
  previewServer = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(dir, p);
    if (!f.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/html' }).end(fs.readFileSync(path.join(dir, '404.html'))); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  }).listen(port, '127.0.0.1');
  return `http://127.0.0.1:${port}`;
}

tool('preview', {
  title: 'Preview the site',
  description: 'Build the public site from the current workspace into a temporary folder (only PUBLIC materials are included) and serve it locally.',
  inputSchema: { handle: Handle.optional().describe('Limit to one author'), port: z.number().int().optional() },
}, ({ handle, port }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wanwu-preview-'));
  const content = path.join(tmp, 'content'), out = path.join(tmp, 'dist');
  const prev = process.env.WANWU_CONTENT; process.env.WANWU_CONTENT = content;
  try { store.exportPublic({ handle }); } finally { if (prev === undefined) delete process.env.WANWU_CONTENT; else process.env.WANWU_CONTENT = prev; }
  const r = build({ content, out, home: 'explore' });
  const base = serveDir(out, port || Number(process.env.WANWU_PREVIEW_PORT || 4173));
  return { folder: out, url: base, pages: r.pages.map(p => base + p) };
});

tool('publish', {
  title: 'Publish to 01wanwu.si',
  description: 'Publish the author\'s public pages. Call first with confirm=false to get the exact list of files and pages that will become public, show it to the author, then call again with confirm=true once they agree. ' +
    'Publishing writes the public projection into WANWU_PUBLISH_REPO (a git checkout of the site), commits and pushes; Vercel deploys on push.',
  inputSchema: { handle: Handle, confirm: z.boolean(), message: z.string().optional() },
}, ({ handle, confirm, message }) => {
  const studies = store.listStudies(handle);
  const plan = studies.map(st => ({
    page: `/${handle}/${st.slug}/`, check: store.checkStudy(handle, st.slug).issues,
    public: st.materials.filter(m => m.visibility === 'public').map(m => `${m.section}/${m.originalName}`),
    staysPrivate: st.materials.filter(m => m.visibility !== 'public').length,
  }));
  if (!confirm) return { action: 'Show this to the author and ask for approval, then call publish with confirm=true.', plan };
  const repo = process.env.WANWU_PUBLISH_REPO;
  if (!repo) {
    const r = store.exportPublic({ handle });
    return { published: false, exported: r, note: 'WANWU_PUBLISH_REPO is not set, so the public files were exported to the content folder only. Commit and push it to deploy.' };
  }
  const contentDir = path.join(repo, process.env.WANWU_PUBLISH_SUBDIR || 'wanwu/content');
  process.env.WANWU_CONTENT = contentDir;
  const r = store.exportPublic({ handle });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  git('add', '-A', contentDir);
  if (!git('status', '--porcelain', contentDir)) return { published: false, note: 'Nothing changed since the last publish.', exported: r };
  git('commit', '-m', message || `Publish ${handle} on 01wanwu`);
  const branch = process.env.WANWU_PUBLISH_BRANCH || git('rev-parse', '--abbrev-ref', 'HEAD');
  git('push', 'origin', `HEAD:${branch}`);
  return { published: true, branch, commit: git('rev-parse', '--short', 'HEAD'), urls: plan.map(p => `https://01wanwu.si${p.page}`), exported: r };
});

server.registerPrompt('showcase_study', {
  title: 'Showcase a study on 01wanwu',
  description: 'The end-to-end agentic workflow: upload everything, organize, draft pages, get consent, publish.',
  argsSchema: { author: z.string().describe('Author name or handle'), study: z.string().describe('Study title or slug'), sources: z.string().optional().describe('Paths, folders or links, comma separated') },
}, ({ author, study, sources }) => ({
  messages: [{ role: 'user', content: { type: 'text', text: WORKFLOW({ author, study, sources }) } }],
}));

await server.connect(new StdioServerTransport());
