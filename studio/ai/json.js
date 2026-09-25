'use strict';

/**
 * studio/ai/json.js — parse tolerante da saída de LLM (fix issue extração).
 *
 * Modelos às vezes devolvem JSON com prosa antes/depois ("Aqui está: {..."),
 * cercas com texto residual ou saída truncada. `parseModelJson` tenta, em
 * ordem: JSON direto → cerca não-ancorada → primeiro objeto balanceado
 * (respeitando strings). Truncado → null (o caller decide o retry).
 */

function balancedObjectSlice(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // JSON truncado (fechamento nunca chegou)
}

function parseModelJson(content) {
  const s = String(content || '').trim();
  if (!s) return null;

  // 1) JSON direto.
  try {
    return JSON.parse(s);
  } catch (_) {
    /* segue */
  }

  // 2) Cerca de código (não-ancorada — permite prosa antes/depois).
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (_) {
      /* segue */
    }
  }

  // 3) Primeiro objeto balanceado no texto (prosa em volta).
  const start = s.indexOf('{');
  if (start >= 0) {
    const slice = balancedObjectSlice(s, start);
    if (slice) {
      try {
        return JSON.parse(slice);
      } catch (_) {
        /* segue */
      }
    }
  }
  return null;
}

module.exports = { parseModelJson, balancedObjectSlice };
