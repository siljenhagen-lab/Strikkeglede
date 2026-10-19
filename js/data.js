import * as db from './db.js';

export const STATUS = {
  aktiv: 'Aktiv',
  vent: 'På vent',
  ferdig: 'Ferdig',
};
const STATUS_ORDER = { aktiv: 0, vent: 1, ferdig: 2 };

export const NEEDLE_SIZES = [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10, 12, 15, 20, 25];
export const NEEDLE_TYPES = { pinne: 'Pinne', rundpinne: 'Rundpinne' };

export const fmtMm = (n) => String(n).replace('.', ',');
export const parseMm = (s) => parseFloat(String(s).replace(',', '.'));

export function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Grupperer pinner på type: { pinne: '3,5 · 4', rundpinne: '4,5' } */
export function needleSummary(needles = []) {
  const out = {};
  for (const type of Object.keys(NEEDLE_TYPES)) {
    const sizes = [...new Set(needles.filter((n) => n.type === type).map((n) => n.mm))].sort((a, b) => a - b);
    out[type] = sizes.map(fmtMm).join(' · ');
  }
  return out;
}

export function sortNeedles(needles) {
  return [...needles].sort((a, b) => a.mm - b.mm || a.type.localeCompare(b.type));
}

/** Det prosjektet som best beskriver oppskriften nå (aktiv > på vent > nyeste). */
export function currentProject(projects) {
  if (!projects.length) return null;
  return [...projects].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt - a.createdAt)[0];
}

export function statusRank(status) {
  return status in STATUS_ORDER ? STATUS_ORDER[status] : 3;
}

export async function loadOverview() {
  const [recipes, projects, patterns] = await Promise.all([db.all('recipes'), db.all('projects'), db.all('patterns')]);
  const projByRecipe = groupBy(projects, 'recipeId');
  const patByRecipe = groupBy(patterns, 'recipeId');
  return recipes.map((r) => {
    const ps = projByRecipe[r.id] || [];
    const pats = (patByRecipe[r.id] || []).sort((a, b) => a.createdAt - b.createdAt);
    return { recipe: r, projects: ps, patterns: pats, current: currentProject(ps) };
  });
}

export function groupBy(list, key) {
  const out = {};
  for (const item of list) (out[item[key]] ||= []).push(item);
  return out;
}

export async function getRecipeBundle(id) {
  const recipe = await db.get('recipes', id);
  if (!recipe) return null;
  const [files, patterns, projects] = await Promise.all([
    db.byRecipe('files', id), db.byRecipe('patterns', id), db.byRecipe('projects', id),
  ]);
  files.sort((a, b) => a.createdAt - b.createdAt);
  patterns.sort((a, b) => a.createdAt - b.createdAt);
  projects.sort((a, b) => b.createdAt - a.createdAt);
  return { recipe, files, patterns, projects, current: currentProject(projects) };
}

export async function saveRecipe(recipe) {
  recipe.updatedAt = Date.now();
  return db.put('recipes', recipe);
}

export async function addFile(recipeId, blob, name, kind) {
  const file = { id: db.uid(), recipeId, blob, name, kind, createdAt: Date.now() };
  return db.put('files', file);
}

export async function startProject(recipeId, { size = '', needles = [] } = {}) {
  const now = Date.now();
  const project = {
    id: db.uid(), recipeId, size: size.toUpperCase(), needles, status: 'aktiv',
    startedAt: now, finishedAt: null, createdAt: now, comment: '', photos: [], progress: {},
  };
  return db.put('projects', project);
}

export async function saveProject(project) {
  project.updatedAt = Date.now();
  return db.put('projects', project);
}

export async function deleteRecipe(id) {
  const [files, patterns, projects] = await Promise.all([
    db.byRecipe('files', id), db.byRecipe('patterns', id), db.byRecipe('projects', id),
  ]);
  for (const f of files) await db.del('files', f.id);
  for (const p of patterns) await db.del('patterns', p.id);
  for (const p of projects) await db.del('projects', p.id);
  await db.del('recipes', id);
}

export function progressOf(project, patternId) {
  return (project && project.progress && project.progress[patternId]) || { done: 0, repeats: 0 };
}

export async function getNeedleInventory() {
  return (await db.get('kv', 'needles')) || {};
}
export async function saveNeedleInventory(inv) {
  return db.put('kv', inv, 'needles');
}
export async function getCustomSizes() {
  return (await db.get('kv', 'customSizes')) || [];
}
export async function saveCustomSizes(sizes) {
  return db.put('kv', sizes, 'customSizes');
}
export async function allNeedleSizes() {
  const custom = await getCustomSizes();
  return [...new Set([...NEEDLE_SIZES, ...custom])].sort((a, b) => a - b);
}
