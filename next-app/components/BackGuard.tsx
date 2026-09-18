// BackGuard — o botão VOLTAR do Android deixa de fechar o app.
//
// Motivo (2026-09-01): o relato foi "o voltar nativo fecha o app hoje, e
// deveria voltar pra tela inicial". Acontece porque o app é uma SPA dentro
// de uma WebView: quem entra direto numa tela (deep link, notificação) ou
// volta depois de o Android matar o renderizador — que RE-NAVEGA pra URL
// atual — fica com UMA entrada só no histórico. Aí o "voltar" não tem pra
// onde ir e o wrapper encerra o app, do meio de qualquer tela.
//
// A defesa é uma entrada-sentinela: ao carregar, marcamos a entrada ATUAL
// como base e empurramos uma de trabalho por cima. O primeiro "voltar"
// consome a de trabalho e cai na base — e é aí que decidimos o destino, em
// vez de deixar o app fechar.
//
// Do /feed em diante o comportamento é o que o Android espera: o primeiro
// "voltar" chega na base e NÃO faz nada, então o segundo encerra o app.
// Prender a pessoa dentro do app seria pior que o problema original.
//
// Arma UMA vez por carregamento de página (flag de módulo, não de
// componente): o `AppShell` remonta a cada troca de rota, e sem essa trava
// cada navegação empurraria uma entrada nova — o histórico viraria uma pilha
// que nunca esvazia e o "voltar" pararia de sair do app.

'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Rota considerada "início" — de onde o voltar pode encerrar o app. */
const INICIO = '/feed';

let armado = false;

interface EstadoHistorico {
  qucBase?: boolean;
  qucApp?: boolean;
}

export function BackGuard() {
  const router = useRouter();
  const pathname = usePathname();
  // O handler vive fora do ciclo de render; a ref mantém a rota atual sem
  // rearmar o listener a cada navegação.
  const rotaRef = useRef(pathname);
  useEffect(() => {
    rotaRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (!armado) {
      armado = true;
      const atual = window.history.state as EstadoHistorico | null;
      if (!atual?.qucBase) {
        window.history.replaceState({ qucBase: true }, '');
        window.history.pushState({ qucApp: true }, '');
      }
    }

    const aoVoltar = (e: PopStateEvent) => {
      const estado = e.state as EstadoHistorico | null;
      // Ainda há histórico do próprio app: deixa o voltar seguir normal.
      if (!estado?.qucBase) return;
      // Chegamos à base vindo de uma tela interna: em vez de fechar o app,
      // volta pro início e repõe a entrada de trabalho.
      if (rotaRef.current !== INICIO) {
        router.replace(INICIO);
        window.history.pushState({ qucApp: true }, '');
        return;
      }
      // Já no início: não repõe nada. O próximo "voltar" encerra o app,
      // que é o que a pessoa espera do Android.
    };

    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, [router]);

  return null;
}

/** Só pros testes: desarma a trava de módulo entre casos. */
export function __resetBackGuardForTests(): void {
  armado = false;
}
