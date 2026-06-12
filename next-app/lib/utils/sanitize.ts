// Sanitização de HTML pra renderização segura via `dangerouslySetInnerHTML`.
//
// CONTEXTO (CRIT-3 do audit 2026-06-12): O RPC `search_all` usa
// `ts_headline()` do Postgres pra grifar matches no snippet. Por default,
// `ts_headline` envolve o match com `<b>...</b>` direto no texto bruto
// SEM escapar HTML do input. Como o input vem de `profiles.bio`,
// `posts.caption`, `products.description` (user-generated), um atacante
// que grava `<img src=x onerror=alert(document.cookie)>` no próprio bio
// dispara XSS em qualquer um que buscar uma palavra que case com o bio.
// Frontend renderizava o snippet com `dangerouslySetInnerHTML` → JS
// executado, acesso à sessão Supabase em localStorage.
//
// SOLUÇÃO (defesa em duas camadas):
// 1. Migration Wave 31 (`2026-06-12-search-safe-headline.sql`) muda os
//    delimitadores de `ts_headline` pra sentinelas únicas (`⟦HL_OPEN⟧` /
//    `⟦HL_CLOSE⟧`) que dificilmente aparecem em texto livre.
// 2. Este helper escapa TODO o snippet, depois substitui as sentinelas
//    escapadas pelas tags `<b>`/`</b>` reais — única HTML permitida na saída.
//
// Se alguém esquecer de aplicar a migration, o helper ainda escapa todo
// HTML do banco e remove o highlight (cai em texto plano) — fail-safe.

const HL_OPEN = '⟦HL_OPEN⟧';
const HL_CLOSE = '⟦HL_CLOSE⟧';

/** Escapa caracteres HTML perigosos. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitiza snippet de search: escapa TUDO, depois reintroduz só
 * `<b>...</b>` nas sentinelas conhecidas vindas do `ts_headline` (via
 * migration Wave 31).
 *
 * - Qualquer `<script>`, `<img onerror>`, etc. fica como texto literal.
 * - Sentinelas `⟦HL_OPEN⟧` / `⟦HL_CLOSE⟧` viram `<b>` / `</b>` reais.
 * - Sentinelas órfãs (sem par) ficam neutralizadas — `</b>` extra sem
 *   `<b>` correspondente não quebra o documento porque é só um tag de
 *   fechamento isolado dentro de um `<span>`.
 */
export function sanitizeSearchSnippet(raw: string): string {
  if (!raw) return '';
  const escaped = escapeHtml(raw);
  return escaped
    .split(HL_OPEN).join('<b>')
    .split(HL_CLOSE).join('</b>');
}

export { HL_OPEN, HL_CLOSE };
