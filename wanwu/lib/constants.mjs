// Fixed study sections, in display order. "overview" is the study's index page.
// Product choice (v0.1): a small closed set keeps every study page predictable for
// recruiters and supervisors. Add new sections here; the builder and MCP tools follow.
export const SECTIONS = [
  { id: 'overview',   label: 'Overview',   blurb: 'What the study asks and what it found' },
  { id: 'outcome',    label: 'Outcome',    blurb: 'Papers, posters, talks, figures and key results' },
  { id: 'data',       label: 'Data',       blurb: 'Datasets, sources and how to get them' },
  { id: 'code',       label: 'Code',       blurb: 'Scripts, notebooks and pipelines' },
  { id: 'references', label: 'References', blurb: 'Literature and prior work the study builds on' },
  { id: 'log',        label: 'Log',        blurb: 'Timeline, meeting notes and next steps' },
];
export const SECTION_IDS = SECTIONS.map(s => s.id);
export const MATERIAL_SECTIONS = SECTION_IDS.filter(s => s !== 'overview');

export const STATUSES = ['idea', 'in-progress', 'preprint', 'under-review', 'published'];

// Reserved top-level paths that can never be an author handle.
export const RESERVED_HANDLES = new Set([
  'explore', 'hub', 'about', 'privacy', 'terms', 'api', 'login', 'signup', 'settings',
  'admin', 'static', 'assets', 'figures', 'code', 'wanwu', 'search', 'new', 'help',
]);

export const MOTTO = '从0到1，搭建万物';
export const SITE_NAME = '01wanwu';
