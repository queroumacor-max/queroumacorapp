// auth.ts — login social (Google/Apple) dentro da casca nativa.
//
// POR QUE EXISTE: OAuth NÃO funciona em WebView embarcada — o Google recusa
// com `disallowed_useragent`, e no iOS o App-Bound Domains bloqueia a
// navegação pro provedor (achado A-P1 da auditoria 2026-08-26). O caminho
// certo é o "fluxo A": abrir o OAuth hospedado do Supabase no NAVEGADOR DO
// SISTEMA (Custom Tab / ASWebAuthenticationSession via plugin Browser) e
// voltar pro app por deep link.
//
// Fluxo completo (PKCE, desde a auditoria de segurança mobile 2026-09-15 —
// ver o comentário do `flowType: 'pkce'` em lib/supabase.ts pro porquê):
//   1. signInWithOAuth({ skipBrowserRedirect: true }) → só gera a URL, não
//      navega a WebView (navegar seria repetir o bug). O supabase-js já
//      gera o `code_verifier` AQUI e guarda no storage do app (mesmo
//      localStorage/cookie de sempre) — ele nunca sai da WebView.
//   2. Browser.open(url) → navegador do sistema; Google vê um browser real.
//      A URL carrega só o `code_challenge` (derivado, sentido único).
//   3. Callback volta pro DOMÍNIO DO SUPABASE, que redireciona pro deep link
//      `br.com.queroumacor.app://auth/callback?code=...` — um código de
//      USO ÚNICO, não uma sessão pronta: sozinho, sem o `code_verifier`
//      guardado no passo 1, ele não abre sessão nenhuma.
//   4. O SO entrega o deep link pra casca → plugin App dispara 'appUrlOpen'
//      NA MESMA WebView (mesmo storage do passo 1) → extraímos o `code` e
//      chamamos `exchangeCodeForSession(code)`, que casa com o verifier
//      guardado e devolve a sessão de verdade.
//   5. Navegamos pra /completar-perfil — o mesmo landing do fluxo web, que
//      decide entre /feed e onboarding.
//
// O fluxo WEB (fora da casca) não precisa de nada disso escrito à mão: o
// supabase-js detecta o `?code=` na URL sozinho no boot (`detectSessionInUrl`,
// ligado por padrão) e troca por sessão antes do app renderizar. Só o
// caminho nativo precisa de código explícito, porque aqui o callback chega
// por EVENTO (`appUrlOpen`), não por navegação de página.
//
// CONFIG NECESSÁRIA (fora do código):
//   - O deep link `br.com.queroumacor.app://auth/callback` precisa estar na
//     allowlist de Redirect URLs do Supabase (Auth → URL Configuration).
//     Fora da allowlist, o Supabase manda pro Site URL e o app nunca recebe
//     o callback — mesma pegadinha do /completar-perfil web.
//   - O client OAuth é o MESMO web client já configurado no Supabase: a
//     autenticação acontece no domínio do Supabase dentro de um browser de
//     verdade. Não precisa de client iOS/Android (isso é só pro futuro
//     "fluxo B" com SDKs nativos + signInWithIdToken).
//   - Casca precisa dos plugins @capacitor/browser e @capacitor/app; o
//     scheme já está registrado no Info.plist (CFBundleURLTypes).
//
// LIÇÃO DO WEBVIEW (CLAUDE.md): promessa pendurada em WebView não rejeita.
// TUDO aqui tem timeout — se o usuário abandonar o browser, resolvemos com
// erro amigável em vez de deixar o botão de login travado pra sempre.

import { getSupabase } from '../supabase';
import { getPlugin, isNativePlatform } from './platform';

/** Deep link de callback — deve constar na allowlist do Supabase. */
export const NATIVE_OAUTH_REDIRECT = 'br.com.queroumacor.app://auth/callback';

/** Tempo máximo esperando o usuário concluir o login no browser do sistema. */
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface BrowserPlugin {
  open: (opts: { url: string }) => Promise<void>;
  close?: () => Promise<void>;
}

interface AppUrlOpenEvent {
  url: string;
}
interface ListenerHandle {
  remove: () => Promise<void> | void;
}
interface AppPlugin {
  addListener: (
    event: 'appUrlOpen',
    cb: (ev: AppUrlOpenEvent) => void,
  ) => Promise<ListenerHandle> | ListenerHandle;
}

export interface ParsedAuthCallback {
  /** Código PKCE de uso único (fluxo atual — trocar via `exchangeCodeForSession`). */
  code?: string;
  /** Só aparece se o client algum dia voltar pro implicit flow — mantido
   *  como leitura defensiva, não é o caminho ativo (ver lib/supabase.ts). */
  accessToken?: string;
  refreshToken?: string;
  errorDescription?: string;
}

/**
 * Extrai o código PKCE (ou erro) de uma URL de callback. Pura e exportada
 * pra teste unitário. Aceita tanto `?a=b` (formato real do PKCE) quanto
 * `#a=b` (implicit, legado — cobre um client mal configurado que ainda
 * mande tokens no fragment).
 */
export function parseAuthCallbackUrl(url: string): ParsedAuthCallback {
  if (!url.startsWith(NATIVE_OAUTH_REDIRECT)) return {};
  const raw = url.slice(NATIVE_OAUTH_REDIRECT.length);
  // Junta fragment e query num só URLSearchParams.
  const parts = raw.split(/[#?]/).filter(Boolean);
  const params = new URLSearchParams(parts.join('&'));
  const errorDescription =
    params.get('error_description') ?? params.get('error') ?? undefined;
  if (errorDescription) return { errorDescription };
  const code = params.get('code') ?? undefined;
  const accessToken = params.get('access_token') ?? undefined;
  const refreshToken = params.get('refresh_token') ?? undefined;
  return { code, accessToken, refreshToken };
}

/** true quando o fluxo nativo está disponível (casca + plugins presentes). */
export function isNativeOAuthAvailable(): boolean {
  return (
    isNativePlatform() &&
    !!getPlugin<BrowserPlugin>('Browser') &&
    !!getPlugin<AppPlugin>('App')
  );
}

/**
 * Executa o login social pelo browser do sistema. Resolve quando a sessão
 * foi gravada (ou com { error } em falha/timeout/cancelamento). O caller
 * decide a navegação pós-login — em sucesso a sessão já está no client e o
 * onAuthStateChange do AuthProvider dispara normalmente.
 *
 * Retorna { error: 'unavailable' } quando o ambiente nativo não suporta —
 * o caller DEVE cair pro fluxo web nesse caso (feature-detection).
 */
export async function nativeSignInWithOAuth(
  provider: 'google' | 'apple',
): Promise<{ error?: string }> {
  if (!isNativeOAuthAvailable()) return { error: 'unavailable' };
  const browser = getPlugin<BrowserPlugin>('Browser')!;
  const app = getPlugin<AppPlugin>('App')!;
  const sb = getSupabase();

  // 1. Gera a URL sem navegar (skipBrowserRedirect).
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    return { error: error?.message ?? 'Não foi possível iniciar o login.' };
  }

  // 2. Arma o listener ANTES de abrir o browser (callback pode ser rápido).
  return new Promise<{ error?: string }>((resolve) => {
    let settled = false;
    let handle: ListenerHandle | undefined;
    const finish = (result: { error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        void handle?.remove();
      } catch {
        /* listener já removido */
      }
      try {
        void browser.close?.();
      } catch {
        /* Custom Tab pode já ter fechado sozinha */
      }
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ error: 'Tempo esgotado. Tente entrar de novo.' }),
      OAUTH_TIMEOUT_MS,
    );

    const onUrl = (ev: AppUrlOpenEvent) => {
      const parsed = parseAuthCallbackUrl(ev.url ?? '');
      if (parsed.errorDescription) {
        finish({ error: parsed.errorDescription });
        return;
      }
      // Caminho ativo (PKCE): troca o código de uso único pela sessão —
      // exige o code_verifier gravado no passo 1 (signInWithOAuth), que
      // vive no MESMO storage desta WebView.
      if (parsed.code) {
        void sb.auth
          .exchangeCodeForSession(parsed.code)
          .then(({ error: sessErr }) =>
            finish(sessErr ? { error: sessErr.message } : {}),
          )
          .catch((e: unknown) =>
            finish({
              error: e instanceof Error ? e.message : 'Falha ao trocar o código pela sessão.',
            }),
          );
        return;
      }
      // Fallback defensivo (implicit, legado): só dispara se o client algum
      // dia voltar a rodar sem `flowType: 'pkce'` — não é o caminho normal
      // hoje (lib/supabase.ts fixa PKCE).
      if (!parsed.accessToken || !parsed.refreshToken) return; // não é nosso callback
      void sb.auth
        .setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        })
        .then(({ error: sessErr }) =>
          finish(sessErr ? { error: sessErr.message } : {}),
        )
        .catch((e: unknown) =>
          finish({
            error: e instanceof Error ? e.message : 'Falha ao gravar a sessão.',
          }),
        );
    };

    // addListener pode retornar o handle direto ou uma Promise dele (Cap 5/6).
    Promise.resolve(app.addListener('appUrlOpen', onUrl))
      .then((h) => {
        handle = h;
        return browser.open({ url: data.url });
      })
      .catch((e: unknown) =>
        finish({
          error:
            e instanceof Error ? e.message : 'Não foi possível abrir o navegador.',
        }),
      );
  });
}
