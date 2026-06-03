// Página /privacidade — alias top-level pra `/info/privacidade`.
// Necessária pro Play Console (URL pública direta sem prefixo /info/).
// Re-exporta a mesma página/metadados pra evitar drift de conteúdo —
// LGPD exige UMA fonte de verdade da política.
//
// queroumacor.com.br/privacidade → Play Console privacy policy URL
// queroumacor.com.br/info/privacidade → navegação interna (Mais Informações)

export { default, metadata } from '../info/privacidade/page';
