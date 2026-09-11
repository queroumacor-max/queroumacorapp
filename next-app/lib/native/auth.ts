// auth.ts — login social (Google/Apple) dentro da casca nativa.
//
// POR QUE EXISTE: OAuth NÃO funciona em WebView embarcada — o Google recusa
// com `disallowed_useragent`, e no iOS o App-Bound Domains bloqueia a
// navegação pro provedor (achado A-P1 da auditoria 2026-08-26). O caminho
// certo é o "fluxo A": abrir o OAuth hospedado do Supabase no NAVEGADOR DO
// SISTEMA (Custom Tab / ASWebAuthenticationSession via plugin Browser) e
// voltar pro app por deep link.
//
// Fluxo completo (PKCE — auditoria de autenticação de 2026-09-11):
//   1. Um cliente Supabase DEDICADO (`flowType: 'pkce'`, sem persistência)
//      gera a URL com `skipBrowserRedirect: true` — só gera, não navega a
//      WebView (navegar seria repetir o bug). O `code_verifier` fica na
//      memória DESTE cliente, dentro da WebView.
//   2. Browser.open(url) → navegador do sistema; Google vê um browser real.
//   3. Callback volta pro DOMÍNIO DO SUPABASE, que redireciona pro deep link
//      `br.com.queroumacor.app://auth/callback?code=<authorization code>`.
//   4. O SO entrega o deep link pra casca → plugin App dispara 'appUrlOpen'
//      NA MESMA WebView → trocamos o `code` pela sessão
//      (`exchangeCodeForSession`, que exige o verifier guardado no passo 1)
//      e gravamos a sessão no cliente principal com `setSession()`.
//   5. Navegamos pra /completar-perfil — o mesmo landing do fluxo web, que
//      decide entre /feed e onboarding.
//
// POR QUE PKCE, E NÃO O FLUXO IMPLICIT DE ANTES: o deep link é um custom
// scheme (`br.com.queroumacor.app://`), sem verificação de domínio — no
// Android QUALQUER app instalado pode registrar o mesmo scheme e receber o
// callback. No fluxo implicit o callback trazia `access_token` +
// `refresh_token` no fragment: o app malicioso ganhava a sessão inteira da
// pessoa. E na direção contrária, um link forjado
// `...://auth/callback#access_token=<token do atacante>` fazia o app gravar
// a sessão DO ATACANTE na vítima (login CSRF). Com PKCE o callback só carrega
// um `code` de uso único que SÓ vale junto do `code_verifier` que nunca saiu
// desta WebView: interceptado é inútil, e forjado não passa na troca.
// Token no fragment/query do deep link é IGNORADO de propósito.
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, resolveBrowserSupabaseEnv } from '../supabase';
import { getPlugin, isNativePlatform } from './platform';

/** Deep link de callback — deve constar na allowlist do Supabase. */
export const NATIVE_OAUTH_REDIRECT = 'br.com.queroumacor.app://auth/callback';

/** Tempo máximo esperando o usuário concluir o login no browser do sistema. */
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Teto da troca code→sessão (rede). Pendurar aqui travaria o botão. */
const EXCHANGE_TIMEOUT_MS = 20 * 1000;

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
  /** Authorization code do PKCE — a ÚNICA credencial aceita no deep link. */
  code?: string;
  errorDescription?: string;
}

/**
 * Extrai o `code` (PKCE) ou o erro de uma URL de callback. Pura e exportada
 * pra teste unitário. Aceita tanto `?a=b` quanto `#a=b` (o Supabase usa
 * query no PKCE; o `#` cobre provedor que degrade pra fragment).
 *
 * `access_token`/`refresh_token` na URL NÃO são lidos: aceitar token vindo
 * de fora seria reabrir o sequestro de sessão e o login CSRF por deep link.
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
  // Formato do code do GoTrue: uuid. Qualquer outra coisa é lixo/forja.
  if (!code || !/^[0-9a-f-]{20,64}$/i.test(code)) return {};
  return { code };
}

/** true quando o fluxo nativo está disponível (casca + plugins presentes). */
export function isNativeOAuthAvailable(): boolean {
  return (
    isNativePlatform() &&
    !!getPlugin<BrowserPlugin>('Browser') &&
    !!getPlugin<AppPlugin>('App')
  );
}

let _pkceClient: SupabaseClient | null = null;

/**
 * Cliente Supabase só pro handshake PKCE. Separado do singleton porque:
 *   - o singleton é `implicit` (o fluxo web de recovery/confirmação de
 *     e-mail depende disso — link aberto em OUTRO navegador não tem o
 *     verifier, e o PKCE quebraria a recuperação de senha);
 *   - `persistSession: false` → o `code_verifier` vive só na memória desta
 *     WebView, que é exatamente a garantia que o PKCE precisa.
 * A sessão obtida é entregue ao singleton por `setSession()`.
 */
function getPkceClient(): SupabaseClient {
  if (_pkceClient) return _pkceClient;
  const { url, key } = resolveBrowserSupabaseEnv();
  _pkceClient = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-native-oauth-pkce',
    },
  });
  return _pkceClient;
}

/** Só pra teste: descarta o cliente PKCE (troca de mocks entre casos). */
export function __resetNativeOAuthForTests(): void {
  _pkceClient = null;
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
  const pkce = getPkceClient();

  // 1. Gera a URL sem navegar (skipBrowserRedirect). O cliente PKCE guarda o
  //    code_verifier em memória e manda só o code_challenge na URL.
  const { data, error } = await pkce.auth.signInWithOAuth({
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
      if (!parsed.code) return; // não é nosso callback (ou veio sem code)
      const code = parsed.code;
      void (async () => {
        try {
          // 3. Troca o code pela sessão. Sem o verifier guardado no passo 1
          //    o GoTrue recusa — é o que torna inútil um code interceptado.
          const trocado = await Promise.race([
            pkce.auth.exchangeCodeForSession(code),
            new Promise<null>((r) => setTimeout(() => r(null), EXCHANGE_TIMEOUT_MS)),
          ]);
          if (!trocado) {
            finish({ error: 'Tempo esgotado ao concluir o login. Tente de novo.' });
            return;
          }
          if (trocado.error || !trocado.data?.session) {
            finish({ error: trocado.error?.message ?? 'Não foi possível concluir o login.' });
            return;
          }
          const { access_token, refresh_token } = trocado.data.session;
          // 4. Entrega a sessão ao cliente principal (o que o app inteiro usa).
          const { error: sessErr } = await sb.auth.setSession({ access_token, refresh_token });
          finish(sessErr ? { error: sessErr.message } : {});
        } catch (e) {
          finish({ error: e instanceof Error ? e.message : 'Falha ao gravar a sessão.' });
        }
      })();
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
