import taxonomy from './cnae-taxonomy.json';
import { CnaeAtividade, CnaeCategoria, CnaeRamo } from '@/types';

interface TaxonomyDoc {
  version: string;
  source: string;
  ramos: CnaeRamo[];
}

export const CNAE_VERSION = taxonomy.version;
export const CNAE_SOURCE = taxonomy.source;
export const CNAE_RAMOS: CnaeRamo[] = (taxonomy as TaxonomyDoc).ramos;

// Lookup: 7-digit CNAE code -> activity (for rendering selected chips).
const codeIndex = new Map<string, CnaeAtividade>();
for (const ramo of CNAE_RAMOS) {
  for (const categoria of ramo.categorias) {
    for (const atividade of categoria.atividades) {
      codeIndex.set(atividade.codigo, atividade);
    }
  }
}

export function cnaeByCode(codigo: string): CnaeAtividade | undefined {
  return codeIndex.get(codigo);
}

export function cnaeLabel(codigo: string): string {
  const atividade = codeIndex.get(codigo);
  return atividade ? `${atividade.cnae} · ${atividade.atividade}` : codigo;
}

export function totalCnaes(): number {
  return codeIndex.size;
}

export function searchCnaeTaxonomy(
  query: string,
): Array<{ ramo: CnaeRamo; categorias: CnaeCategoria[] }> {
  const q = query.trim().toLowerCase();
  if (!q) {
    return CNAE_RAMOS.map((ramo) => ({ ramo, categorias: ramo.categorias }));
  }
  const results: Array<{ ramo: CnaeRamo; categorias: CnaeCategoria[] }> = [];
  for (const ramo of CNAE_RAMOS) {
    const ramoMatches = ramo.nome.toLowerCase().includes(q) || ramo.oficial.toLowerCase().includes(q) || ramo.secao.toLowerCase() === q;
    if (ramoMatches) {
      results.push({ ramo, categorias: ramo.categorias });
      continue;
    }
    const matchedCategorias = ramo.categorias
      .map((categoria) => {
        const categoriaMatches = categoria.nome.toLowerCase().includes(q) || categoria.divisao === q;
        if (categoriaMatches) {
          return categoria;
        }
        const matchedAtividades = categoria.atividades.filter(
          (a) =>
            a.atividade.toLowerCase().includes(q) ||
            a.cnae.includes(q) ||
            a.codigo.includes(q),
        );
        return matchedAtividades.length ? { ...categoria, atividades: matchedAtividades } : null;
      })
      .filter((c): c is CnaeCategoria => c !== null);
    if (matchedCategorias.length) {
      results.push({ ramo, categorias: matchedCategorias });
    }
  }
  return results;
}
