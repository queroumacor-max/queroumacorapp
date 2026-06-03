// Página /termos — alias top-level pra `/info/termos`.
// Mesmo padrão de /privacidade: URL direta sem prefixo /info/ pra cadastrar
// no Play Console e em outras lojas (App Store, App Gallery) que exigem
// link público da política/termos.
//
// queroumacor.com.br/termos → Play Console terms URL
// queroumacor.com.br/info/termos → navegação interna

export { default, metadata } from '../info/termos/page';
