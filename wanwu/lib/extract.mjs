// Turn an uploaded file into plain text the agent can read and summarize.
// Every extractor fails soft: a file we cannot read is still stored, with a status
// that tells the agent what is missing (e.g. a transcript).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const run = promisify(execFile);

const MAX_TEXT = 200_000; // chars kept per material

export const KINDS = {
  doc: ['.docx', '.doc', '.wps', '.odt', '.rtf'],
  pdf: ['.pdf'],
  sheet: ['.xlsx', '.xls', '.et', '.ods', '.csv', '.tsv'],
  text: ['.md', '.markdown', '.txt', '.tex', '.bib', '.ris', '.json', '.yaml', '.yml'],
  code: ['.py', '.r', '.R', '.js', '.mjs', '.ts', '.ipynb', '.m', '.jl', '.sql', '.sh', '.do', '.sas', '.stata', '.c', '.cpp', '.java', '.go', '.rs'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
  slides: ['.pptx', '.ppt', '.dps', '.key', '.odp'],
  media: ['.mp4', '.mov', '.m4a', '.mp3', '.wav', '.webm', '.aac', '.ogg'],
  archive: ['.zip', '.tar', '.gz', '.7z'],
};
export function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  for (const [k, exts] of Object.entries(KINDS)) if (exts.map(e => e.toLowerCase()).includes(ext)) return k;
  return 'other';
}

async function docx(file) {
  const mammoth = require('mammoth');
  const r = await mammoth.extractRawText({ path: file });
  return r.value;
}
async function pdf(file) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const r = await pdfParse(fs.readFileSync(file));
  return r.text;
}
function sheet(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file, { cellDates: true });
  return wb.SheetNames.map(n => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
    const rows = csv.split('\n');
    const head = rows.slice(0, 60).join('\n');
    return `## Sheet: ${n} (${rows.length} rows)\n${head}${rows.length > 60 ? '\n…' : ''}`;
  }).join('\n\n');
}
function notebook(file) {
  const nb = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (nb.cells || []).map(c => `# [${c.cell_type}]\n${[].concat(c.source || []).join('')}`).join('\n\n');
}
async function transcribe(file) {
  // Pluggable: set WANWU_TRANSCRIBE_CMD, e.g.
  //   whisper {in} --model small --output_format txt --output_dir {outdir}
  // The command must write {outdir}/<basename>.txt.
  const cmd = process.env.WANWU_TRANSCRIBE_CMD;
  if (!cmd) return null;
  const outdir = fs.mkdtempSync(path.join(path.dirname(file), '.tx-'));
  const args = cmd.split(/\s+/).map(a => a.replace('{in}', file).replace('{outdir}', outdir));
  await run(args[0], args.slice(1), { timeout: 60 * 60 * 1000 });
  const txt = fs.readdirSync(outdir).find(f => f.endsWith('.txt'));
  const out = txt ? fs.readFileSync(path.join(outdir, txt), 'utf8') : null;
  fs.rmSync(outdir, { recursive: true, force: true });
  return out;
}

/** @returns {Promise<{status:'ok'|'needs_transcription'|'unsupported'|'error', text:string, note?:string}>} */
export async function extractText(file) {
  const kind = kindOf(file);
  const ext = path.extname(file).toLowerCase();
  try {
    let text = null;
    if (kind === 'doc') {
      if (ext !== '.docx') return { status: 'unsupported', text: '', note: `Save ${ext} as .docx (Word/WPS: File > Save As) and upload again.` };
      text = await docx(file);
    } else if (kind === 'pdf') text = await pdf(file);
    else if (kind === 'sheet') text = (ext === '.et') ? null : sheet(file);
    else if (ext === '.ipynb') text = notebook(file);
    else if (kind === 'text' || kind === 'code') text = fs.readFileSync(file, 'utf8');
    else if (kind === 'media') {
      text = await transcribe(file);
      if (text == null) return { status: 'needs_transcription', text: '', note: 'Audio/video stored. Set WANWU_TRANSCRIBE_CMD (e.g. Whisper) or upload a transcript .txt to extract its content.' };
    } else if (kind === 'image') return { status: 'ok', text: '', note: 'Image: shown as a figure. Ask the author for a caption.' };
    else return { status: 'unsupported', text: '', note: `No text extractor for ${ext || 'this file'}; stored as a download.` };
    if (text == null) return { status: 'unsupported', text: '', note: `Save ${ext} as .xlsx and upload again.` };
    return { status: 'ok', text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n…[truncated]' : text };
  } catch (e) {
    return { status: 'error', text: '', note: `Could not read file: ${e.message}` };
  }
}
