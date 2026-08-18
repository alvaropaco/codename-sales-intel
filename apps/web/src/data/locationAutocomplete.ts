import municipios from './municipios-brasil.json';

export interface Municipio {
  code: number;
  city: string;
  uf: string;
  n: string; // normalized city name (lowercase, accents stripped)
  label: string; // "São Paulo, SP"
}

const MUNICIPIOS = municipios as unknown as Municipio[];

function buildKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Pre-index normalized search text into buckets keyed by their first 1..3
// characters, so a keystroke only scans a handful of candidates (prefix match)
// instead of all 5571 municipios.
const buckets = new Map<string, Municipio[]>();
for (const m of MUNICIPIOS) {
  const key = `${m.n} ${m.uf.toLowerCase()}`;
  const prefixes = new Set<string>();
  for (let len = 1; len <= Math.min(key.length, 3); len += 1) {
    prefixes.add(key.slice(0, len));
  }
  for (const p of prefixes) {
    const bucket = buckets.get(p);
    if (bucket) bucket.push(m);
    else buckets.set(p, [m]);
  }
}

// Capitals and the largest municipalities get a ranking boost so that typing
// "sao" surfaces "São Paulo" (capital) before "São Brás" etc. Values are
// normalized (lowercase, accents stripped) to match `Municipio.n`.
const CAPITALS = new Set([
  'porto velho', 'rio branco', 'manaus', 'boa vista', 'belem', 'macapa',
  'palmas', 'sao luis', 'teresina', 'fortaleza', 'natal', 'joao pessoa',
  'recife', 'maceio', 'aracaju', 'salvador', 'belo horizonte', 'vitoria',
  'rio de janeiro', 'sao paulo', 'curitiba', 'florianopolis', 'porto alegre',
  'campo grande', 'cuiaba', 'goiania', 'brasilia',
]);

// Largest non-capital municipalities (population > ~500k), for useful ranking.
const LARGE = new Set([
  'guarulhos', 'campinas', 'sao bernardo do campo', 'sao jose dos campos',
  'santo andre', 'osasco', 'sorocaba', 'ribeirao preto', 'uberlandia',
  'contagem', 'juiz de fora', 'londrina', 'maringa', 'joinville', 'blumenau',
  'caxias do sul', 'canoas', 'pelotas', 'santa maria', 'anapolis',
]);

function importanceBoost(normalizedName: string): number {
  if (CAPITALS.has(normalizedName)) return 100000;
  if (LARGE.has(normalizedName)) return 50000;
  return 0;
}

export function normalizePlace(value: string): string {
  return buildKey(value);
}

/**
 * Optmized (Ukkonen cut-off) Levenshtein distance. Returns Infinity when the
 * distance exceeds `max`, so typo candidates are rejected cheaply.
 */
function boundedDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const curr = new Array<number>(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = j;
  for (let i = 1; i < rows; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return Infinity;
    prev.splice(0, cols, ...curr);
  }
  return prev[cols - 1];
}

/**
 * Rank-aware search over Brazilian municipalities. Tolerant to accents, case
 * and minor typos. Supports phrase prefixes ("sao car" -> São Carlos) and
 * "city uf" ("sao carlos sp"). Falls back to bounded edit distance when no
 * prefix matches (e.g. "sao paol" -> São Paulo).
 */
export function searchLocations(query: string, limit = 8): Municipio[] {
  const q = normalizePlace(query);
  if (!q) return [];

  const terms = q.split(/\s+/).filter(Boolean);
  const first = terms[0];
  const prefix = first.slice(0, 3);

  const prefixMatches: Municipio[] = [];
  for (const m of buckets.get(prefix) || []) {
    const search = `${m.n} ${m.uf.toLowerCase()}`;
    const allPrefix = terms.every((t) => search.startsWith(t) || search.split(' ').some((tok) => tok.startsWith(t)));
    if (allPrefix) prefixMatches.push(m);
  }

  // Preference: exact prefix matches first. When the user is clearly typing a
  // full name with a likely typo, supplement with edit-distance candidates.
  const fuzzyMax = q.length <= 4 ? 1 : q.length <= 8 ? 2 : 3;
  const pool = new Map<number, { m: Municipio; score: number; fuzzy: number }>();

  for (const m of prefixMatches) {
    const search = `${m.n} ${m.uf.toLowerCase()}`;
    let score = importanceBoost(m.n);
    if (m.n === q) score += 100000;
    else if (search.startsWith(q)) score += 20000;
    else if (m.n.startsWith(q)) score += 10000;
    if (terms.some((t) => t.length === 2 && m.uf.toLowerCase() === t)) score += 2000;
    score -= m.n.length;
    pool.set(m.code, { m, score, fuzzy: 0 });
  }

  // If prefix matching found nothing, run a bounded edit-distance scan over
  // all municipios to catch typos like "sao paol". We only fall back when there
  // are zero prefix hits so exact prefixes always rank above typo guesses.
  if (pool.size === 0) {
    for (const m of MUNICIPIOS) {
      if (pool.has(m.code)) continue;
      const cityDist = boundedDistance(m.n, q, fuzzyMax);
      const search = `${m.n} ${m.uf.toLowerCase()}`;
      const searchDist = boundedDistance(search, q, fuzzyMax);
      const dist = Math.min(cityDist, searchDist);
      if (dist === Infinity) continue;
      const score = importanceBoost(m.n) + (10000 - dist * 1000) - m.n.length;
      pool.set(m.code, { m, score, fuzzy: dist });
    }
  }

  const ranked = Array.from(pool.values()).sort((a, b) => {
    // Prefix-only matches always outrank fuzzy (typo) matches.
    const fuzzyKey = (a.fuzzy === 0 ? 0 : 1) - (b.fuzzy === 0 ? 0 : 1);
    if (fuzzyKey !== 0) return fuzzyKey;
    return b.score - a.score;
  });

  return ranked.slice(0, limit).map((r) => r.m);
}

/** Resolve a stored label ("São Paulo, SP") back to its IBGE municipio. */
export function municipioByLabel(label: string): Municipio | undefined {
  const q = buildKey(label);
  return MUNICIPIOS.find((m) => buildKey(m.label) === q);
}

/** Resolve an IBGE code back to its municipio. */
export function municipioByCode(code: number): Municipio | undefined {
  return MUNICIPIOS.find((m) => m.code === code);
}

export function totalMunicipios(): number {
  return MUNICIPIOS.length;
}
