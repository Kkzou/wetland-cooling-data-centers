# 01wanwu · 从0到1，搭建万物

Turn everything a researcher has for a study (papers, drafts, Excel, code, slides, references, notes, meeting recordings) into a neat public page with one link:

```
01wanwu.si/<author>/                       author page
01wanwu.si/<author>/<study>/               study overview
01wanwu.si/<author>/<study>/<section>/     outcome · data · code · references · log
01wanwu.si/explore/                        research hub
```

First entry: `01wanwu.si/yujiazou/wetland-cooling/` (live once this branch is merged to `main`).

It has two parts:

| Part | What it does |
|---|---|
| `mcp/server.mjs` | An MCP server. Any MCP client (Claude Code, Claude Desktop, Cursor…) gets tools to ingest files, read them, sort them, write pages, check, preview and publish, plus a `showcase_study` prompt that runs the whole workflow. The client's model is the agent. |
| `site/build.mjs` | A static site builder. Reads the public content folder and writes plain HTML (no framework) in the Google-like white style. Deployed by Vercel. |

## Quick start

```bash
cd wanwu && npm install
npm test                       # pipeline + privacy tests
npm run build                  # content/ -> dist/
```

Add the MCP server to Claude Code:

```bash
claude mcp add wanwu -- node /absolute/path/to/wanwu/mcp/server.mjs
```

or to Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "wanwu": {
  "command": "node", "args": ["/absolute/path/to/wanwu/mcp/server.mjs"],
  "env": { "WANWU_PUBLISH_REPO": "/absolute/path/to/site-repo" }
} } }
```

Then ask: *"Use the showcase_study prompt for author Yujia Zou, study 'wetland cooling', materials ~/Research/wetland"*.

## Tools

| Tool | Purpose |
|---|---|
| `create_author` | Author page: name, handle, affiliation, role, bio, links |
| `create_study` | Study: title, ordered authors (with handles to link co-authors), status, tags, summary, key results |
| `ingest` | Files, folders, Google Docs/Sheets/Slides/Drive links, URLs. Extracts text; sorts into a section; everything starts **private** |
| `list_materials` / `read_material` | What was uploaded, and its extracted text (paged) |
| `update_material` | Section, caption, description, order, visibility |
| `accept_suggested_visibility` | Apply suggested public/private in one go, after the author agreed |
| `write_section` / `read_section` | Markdown for overview, outcome, data, code, references, log |
| `check_study` | Empty sections, undecided files, captions, transcripts, leaks |
| `preview` | Build the public site locally and serve it |
| `publish` | Two-step: `confirm=false` shows exactly what goes public; `confirm=true` exports, commits and pushes |

## File support

| Input | Handling |
|---|---|
| Word `.docx`, PDF, Markdown/text, code, `.ipynb` | Text extracted |
| Excel `.xlsx/.xls`, CSV/TSV | Each sheet as CSV (first 60 rows) |
| Google Docs / Sheets / Slides / Drive links | Exported as docx/xlsx/pptx if link-shared; otherwise download with a Drive connector and pass the path |
| WPS `.wps/.et/.dps` | Stored; ask the author to save as .docx/.xlsx/.pptx (WPS: 文件 › 另存为) |
| Images | Shown as figures (agent adds captions) |
| Audio/video `.mp4/.m4a/.mp3/.wav` | Stored private; transcribed if `WANWU_TRANSCRIBE_CMD` is set (e.g. Whisper) |
| Slides, archives, other | Stored as downloads |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WANWU_WORKSPACE` | `~/.wanwu/workspace` | Private store: all uploads + extracted text. Never committed |
| `WANWU_CONTENT` | `wanwu/content` | Public projection that the site is built from |
| `WANWU_PUBLISH_REPO` | unset | Git checkout of the site repo; `publish` commits and pushes there |
| `WANWU_PUBLISH_SUBDIR` | `wanwu/content` | Where content lives inside that repo |
| `WANWU_PUBLISH_BRANCH` | current branch | Branch to push |
| `WANWU_TRANSCRIBE_CMD` | unset | e.g. `whisper {in} --model small --output_format txt --output_dir {outdir}` |
| `WANWU_SITE_URL` | `https://01wanwu.si` | Canonical URLs, citation, sitemap |

## Privacy model

1. Uploads go to the private workspace only.
2. Every material starts `private`; the classifier only *suggests* public/private (raw data, manuscripts, notes and recordings suggest private).
3. `exportPublic` copies only `public` materials, and strips private items from `study.json`.
4. The builder filters to `public` again (defence in depth). Markdown raw HTML is escaped and `javascript:` links dropped.
5. `publish` refuses to push without `confirm=true`, and the agent is told to show the list first.

See `docs/HANDOFF.zh.md` for product decisions and the roadmap.
