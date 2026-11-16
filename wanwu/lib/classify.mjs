// First-pass sorting of an upload into a study section, plus a suggested visibility.
// This is deliberately simple and explainable; the agent (LLM) reviews every guess
// and can move a material with the `update_material` tool.
import path from 'node:path';
import { kindOf } from './extract.mjs';

const RULES = [
  // [section, regex on lowercase filename, reason]
  ['log',        /(meeting|minutes|notes?|journal|log|diary|weekly|standup|会议|纪要|周报|日志|记录)/, 'filename looks like notes or a log'],
  ['references', /(reference|bibliograph|literature|related|zotero|endnote|\.bib$|\.ris$|文献|参考)/, 'filename looks like a reference list'],
  ['outcome',    /(paper|manuscript|draft|preprint|thesis|poster|slides?|talk|abstract|conference|figure|fig\d|result|report|论文|海报|报告|摘要|结果|图)/, 'filename looks like a result or write-up'],
  ['data',       /(data|dataset|raw|panel|survey|sample|regression|anova|output|数据|样本)/, 'filename looks like data or model output'],
  ['code',       /(script|code|analysis|pipeline|notebook|model|代码)/, 'filename looks like code'],
];
const BY_KIND = {
  code: 'code', sheet: 'data', image: 'outcome', slides: 'outcome', pdf: 'references',
  doc: 'outcome', text: 'log', media: 'log', archive: 'data', other: 'data',
};

export function classify(file) {
  const name = path.basename(file).toLowerCase();
  const kind = kindOf(file);
  let section, reason;
  if (kind === 'code') { section = 'code'; reason = 'source code file'; }
  else if (kind === 'image') { section = 'outcome'; reason = 'image, treated as a figure'; }
  else {
    for (const [s, re, why] of RULES) if (re.test(name)) { section = s; reason = why; break; }
    if (!section) { section = BY_KIND[kind]; reason = `default for ${kind} files`; }
  }
  // Suggested visibility. Nothing is public until the author confirms (see visibility in store.mjs).
  // Raw data, manuscripts, notes and recordings default to private: they may be
  // unpublished, under embargo, or contain other people's words.
  let suggested = 'public';
  if (kind === 'media' || section === 'log') suggested = 'private'; // notes and recordings mention other people
  else if (section === 'data' && kind !== 'text') suggested = 'private';
  else if (/(manuscript|draft|thesis|论文|初稿)/.test(name) || kind === 'doc') suggested = 'private';
  return { section, kind, reason, suggestedVisibility: suggested };
}
