// DiagView — coleta e mostra o estado do navegador atual. Tudo client-side:
// não há chamada ao servidor (nem ao banco), então funciona mesmo com as
// envs de admin erradas — que é justamente o cenário em que precisamos dela.

'use client';

import { useEffect, useState } from 'react';
import { isAndroid, isAndroidWebView } from '@/lib/hooks/useAndroidWebViewScrollPin';

interface Row {
  k: string;
  v: string;
  /** Destaque: verde = como esperado, vermelho = provável causa de bug. */
  tone?: 'ok' | 'bad';
}

export function DiagView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Sincroniza com sistemas externos (navigator/window/matchMedia,
    // service worker) — leitura só existe no browser, não é derivável no
    // render nem em SSR. `setRows` aqui é o resultado dessa sincronização.
    const ua = navigator.userAgent || '';
    const android = isAndroid(ua);
    const wv = isAndroidWebView(ua);
    const swCtl =
      'serviceWorker' in navigator ? !!navigator.serviceWorker.controller : null;
    const standalone =
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;

    const out: Row[] = [
      { k: 'User-Agent', v: ua },
      { k: 'É Android?', v: android ? 'sim' : 'não', tone: android ? 'ok' : undefined },
      {
        k: 'Reconhecido como WebView (token wv)',
        v: wv ? 'sim' : 'não',
      },
      {
        // O pin do pull-to-refresh liga em QUALQUER Android — se o body
        // não estiver esticado, o script do <head> não rodou.
        k: 'Trava do pull-to-refresh ativa',
        v: android
          ? (document.body.style.minHeight || document.documentElement.style.minHeight || '(não aplicada)')
          : 'n/a (só Android)',
        tone: android
          ? ((document.body.style.minHeight || document.documentElement.style.minHeight) ? 'ok' : 'bad')
          : undefined,
      },
      {
        k: 'Posição do documento (scrollY)',
        v: String(Math.round(window.scrollY)),
        tone: android ? (window.scrollY >= 1 ? 'ok' : 'bad') : undefined,
      },
      {
        // Se o SW não controla a página, TODA a defesa do "500 ao retomar"
        // (retry + página Reconectando) está fora do ar neste aparelho.
        k: 'Service Worker controlando a página',
        v: swCtl === null ? 'não suportado' : swCtl ? 'sim' : 'NÃO',
        tone: swCtl ? 'ok' : 'bad',
      },
      { k: 'Modo PWA (tela inicial)', v: standalone ? 'sim' : 'não' },
      { k: 'Online', v: navigator.onLine ? 'sim' : 'não', tone: navigator.onLine ? 'ok' : 'bad' },
      { k: 'Janela (px)', v: `${window.innerWidth} × ${window.innerHeight}` },
      { k: 'Densidade de tela', v: String(window.devicePixelRatio || 1) },
      { k: 'Idioma', v: navigator.language || '—' },
      { k: 'Endereço', v: window.location.href },
      // Qual build do SITE está rodando neste aparelho. O app carrega o site
      // ao vivo, então "já fiz o deploy" e "o aparelho já pegou" são coisas
      // diferentes — e o service worker guarda `/_next/static/` cache-first.
      { k: 'Build do site', v: process.env.NEXT_PUBLIC_BUILD || '—' },
    ];
    setRows(out);

    // Infos NATIVAS (casca Capacitor): modelo, OS, versão/build do app — o que
    // o suporte precisa e o navegador não sabe. Assíncrono; no web só mostra
    // "Casca nativa: não".
    import('@/lib/native')
      .then(async ({ native }) => {
        const d = await native.device.getInfo();
        const nativeRows: Row[] = [
          { k: 'Casca nativa (Capacitor)', v: d.isNative ? 'sim' : 'não', tone: d.isNative ? 'ok' : undefined },
        ];
        if (d.isNative) {
          nativeRows.push(
            { k: 'Plataforma', v: d.platform },
            { k: 'Modelo', v: d.model || '—' },
            { k: 'Versão do SO', v: d.osVersion || '—' },
            { k: 'Versão do app', v: d.appVersion || '—' },
            { k: 'Build', v: d.appBuild || '—' },
          );
          // A pergunta que custou a rejeição da Apple na build 17: o login
          // social só funciona na casca se os plugins Browser e App estiverem
          // VISÍVEIS pra esta página. Sem esta linha, a única forma de
          // responder isso era por dedução.
          const plugins = native.plugins();
          const oauthOk =
            plugins.includes('Browser') && plugins.includes('App');
          nativeRows.push(
            {
              k: 'Login social nativo',
              v: oauthOk ? 'disponível' : 'INDISPONÍVEL',
              tone: oauthOk ? 'ok' : 'bad',
            },
            {
              k: 'Plugins nativos',
              v: plugins.length ? plugins.join(', ') : 'nenhum',
              tone: plugins.length ? undefined : 'bad',
            },
          );
        }
        setRows([...out, ...nativeRows]);
      })
      .catch(() => {});

    // ESTADO DO PERFIL — a resposta pro "o cadastro pede tudo de novo".
    //
    // O app manda pro /completar-perfil quando `isProfileComplete` diz não, e
    // isso tem TRÊS causas possíveis, cada uma com conserto diferente: a
    // linha de perfil não existe (a trigger do banco falhou e engoliu a
    // exceção), existe sem categoria, ou existe sem @tag. Dedução já custou
    // três tentativas — aqui a resposta aparece escrita, no aparelho.
    import('@/lib/supabase')
      .then(async ({ getSupabase }) => {
        const sb = getSupabase();
        const { data: sess } = await sb.auth.getSession();
        const uid = sess?.session?.user?.id;
        const perfilRows: Row[] = [
          { k: 'Sessão (logado)', v: uid ? 'sim' : 'não', tone: uid ? 'ok' : 'bad' },
        ];
        if (!uid) {
          setRows((r) => [...(r ?? out), ...perfilRows]);
          return;
        }
        const { data, error } = await sb
          .from('profiles')
          .select('id, name, tag, username, user_type, role, phone, city, state, birth_date')
          .eq('id', uid)
          .maybeSingle();
        const p = data as Record<string, unknown> | null;
        const cheio = (v: unknown) => (typeof v === 'string' ? v.trim().length > 0 : !!v);
        perfilRows.push({
          k: 'Linha de perfil no banco',
          v: error ? 'ERRO: ' + error.message : p ? 'existe' : 'NÃO EXISTE',
          tone: p && !error ? 'ok' : 'bad',
        });
        if (p) {
          perfilRows.push(
            { k: '· categoria (user_type)', v: String(p.user_type ?? '—'), tone: cheio(p.user_type) ? 'ok' : 'bad' },
            { k: '· papel (role)', v: String(p.role ?? '—'), tone: cheio(p.role) ? 'ok' : 'bad' },
            { k: '· @tag', v: String(p.tag ?? '—'), tone: cheio(p.tag) ? 'ok' : 'bad' },
            { k: '· username', v: String(p.username ?? '—') },
            { k: '· nome', v: String(p.name ?? '—') },
            { k: '· telefone', v: cheio(p.phone) ? 'preenchido' : 'vazio' },
            { k: '· cidade / UF', v: (String(p.city ?? '—')) + ' / ' + String(p.state ?? '—') },
            { k: '· nascimento', v: cheio(p.birth_date) ? 'preenchido' : 'vazio' },
            {
              // A conta do "isProfileComplete": categoria E @tag.
              k: 'App considera o perfil completo?',
              v: (cheio(p.user_type) || cheio(p.role)) && (cheio(p.tag) || cheio(p.username)) ? 'sim' : 'NÃO — é por isso que pede de novo',
              tone: (cheio(p.user_type) || cheio(p.role)) && (cheio(p.tag) || cheio(p.username)) ? 'ok' : 'bad',
            },
          );
        }
        setRows((r) => [...(r ?? out), ...perfilRows]);
      })
      .catch(() => {});

    // Registra também no /api/log-error: assim, quando a env de admin for
    // corrigida, o histórico já está lá no /admin/errors. Best-effort.
    try {
      fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'diag-page',
          msg: `diag android=${android} wv=${wv} sw=${swCtl} scrollY=${Math.round(window.scrollY)} standalone=${standalone}`,
          ua,
          ctx: 'diag',
        }),
      }).catch(() => {});
    } catch {
      // silencioso
    }
  }, []);

  if (!rows) return <p className="text-sm text-[color:var(--color-muted)]">Lendo…</p>;

  const asText = rows.map((r) => `${r.k}: ${r.v}`).join('\n');

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // clipboard pode estar bloqueado no WebView — fallback textarea.
          const done = () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          };
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(asText).then(done).catch(() => {
              legacyCopy(asText);
              done();
            });
          } else {
            legacyCopy(asText);
            done();
          }
        }}
        className="w-full text-white font-bold mb-4"
        style={{ padding: 12, borderRadius: 12, border: 'none', background: 'var(--color-p1)', fontSize: 14 }}
      >
        {copied ? '✅ Copiado!' : '📋 Copiar tudo'}
      </button>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.k}
            className="bg-white border rounded-xl p-3"
            style={{
              borderColor:
                r.tone === 'bad'
                  ? 'rgba(230,57,70,.45)'
                  : r.tone === 'ok'
                    ? 'rgba(22,163,74,.35)'
                    : 'var(--color-border)',
            }}
          >
            <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--color-muted)]">
              {r.k}
            </div>
            <div
              className="text-[13px] font-mono break-all mt-0.5"
              style={{
                color:
                  r.tone === 'bad'
                    ? 'var(--color-danger)'
                    : r.tone === 'ok'
                      ? 'var(--color-success)'
                      : 'var(--color-ink)',
              }}
            >
              {r.v}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function legacyCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch {
    // sem clipboard — o texto segue visível na tela pra copiar na mão.
  }
}
