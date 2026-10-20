// ProExpirandoModal — avisa, UMA vez por prazo, que o Plano PRO acaba nas
// próximas 24h. Regra em lib/proAviso.ts.
//
// Montado no AppShell (vale em qualquer tela logada). Fechou de qualquer
// jeito (Renovar, Agora não, Esc, fundo) = visto, como o CorDoAnoModal.
// Duas saídas pra renovar: chat com a loja dentro do app (router.push, sem
// navegação de documento) ou WhatsApp por abrirLinkExterno — na casca,
// navegar o documento pra fora do app pinta a tela "Sem conexão".
// Os hooks do chat vivem no diálogo interno, que só monta com o aviso
// aberto: no AppShell eles custariam uma consulta em toda tela.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCalicolorsId, useNewChat } from '@/lib/hooks/useChat';
import { showToast } from '@/lib/toast';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { abrirLinkExterno } from '@/lib/native/browser';
import {
  jaViuAvisoPro,
  marcarAvisoProVisto,
  proAcabandoEm,
  quandoAcaba,
} from '@/lib/proAviso';

const STORE_WHATSAPP = 'https://wa.me/5511959765031';
const ATRASO_MS = 600;
// O app costuma ficar aberto por horas: reconfere de vez em quando pra quem
// entra na janela de 24h com ele aberto.
const RECHECAGEM_MS = 10 * 60 * 1000;

export function ProExpirandoModal() {
  const user = usePolicyUser();
  const [fim, setFim] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), RECHECAGEM_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const alvo = proAcabandoEm(user, agora);
    if (alvo === null || jaViuAvisoPro(alvo)) return undefined;
    const t = setTimeout(() => setFim(alvo), ATRASO_MS);
    return () => clearTimeout(t);
  }, [user, agora]);

  const fechar = useCallback(() => {
    if (fim !== null) marcarAvisoProVisto(fim);
    setFim(null);
  }, [fim]);

  useEffect(() => {
    if (fim === null) return undefined;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [fim, fechar]);

  if (fim === null) return null;
  return <AvisoProDialog fim={fim} agora={agora} fechar={fechar} />;
}

const TEXTO_RENOVAR = 'Oi! Meu Plano PRO do QueroUmaCor está acabando e quero renovar.';

function AvisoProDialog({
  fim,
  agora,
  fechar,
}: {
  fim: number;
  agora: number;
  fechar: () => void;
}) {
  const router = useRouter();
  const { id: storeId } = useCalicolorsId();
  const { start: startChat, creating } = useNewChat();

  const pelaWhatsApp = () => {
    abrirLinkExterno(`${STORE_WHATSAPP}?text=${encodeURIComponent(TEXTO_RENOVAR)}`);
    fechar();
  };

  const peloChat = async () => {
    if (!storeId) {
      showToast('Não consegui localizar a loja agora. Tente pelo WhatsApp.', 'error');
      return;
    }
    const convId = await startChat({ otherId: storeId });
    if (!convId) return;
    fechar();
    router.push(`/chat/${encodeURIComponent(convId)}`);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 modal-fade"
      style={{ background: 'rgba(0,0,0,.55)' }}
      onClick={fechar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-expirando-titulo"
        onClick={(e) => e.stopPropagation()}
        className="modal-pop w-full max-w-[380px] max-h-full overflow-y-auto rounded-2xl shadow-2xl p-5"
        style={{
          background: 'var(--color-white)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="text-4xl text-center" aria-hidden="true">⏳</div>
        <p
          className="mt-2 text-center text-[11px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--color-p1)' }}
        >
          Plano PRO
        </p>
        <h2
          id="pro-expirando-titulo"
          className="text-center text-xl font-extrabold leading-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
        >
          Seu PRO acaba {quandoAcaba(fim, agora)}
        </h2>
        <p className="mt-3 text-sm text-center" style={{ color: 'var(--color-ink2)' }}>
          Depois disso, as ferramentas exclusivas (Agenda, Financeiro,
          Anotações e mais) ficam bloqueadas.
        </p>
        <p className="mt-2 text-sm text-center font-semibold" style={{ color: 'var(--color-ink)' }}>
          Caso queira renovar, entre em contato com a Cali Colors pelo chat
          do app ou pelo WhatsApp.
        </p>

        <button
          type="button"
          onClick={peloChat}
          disabled={creating}
          autoFocus
          className="mt-5 w-full rounded-xl py-3 font-bold text-white active:scale-[.98] transition-transform disabled:opacity-60"
          style={{ background: 'var(--color-p1)' }}
        >
          {creating ? 'Abrindo conversa…' : '💬 Falar com a loja pelo chat'}
        </button>
        <button
          type="button"
          onClick={pelaWhatsApp}
          className="mt-2 w-full rounded-xl py-3 font-bold text-white active:scale-[.98] transition-transform"
          style={{ background: '#25D366' }}
        >
          📱 Falar pelo WhatsApp
        </button>
        <button
          type="button"
          onClick={fechar}
          className="mt-2 w-full rounded-xl py-3 font-semibold"
          style={{ color: 'var(--color-muted)' }}
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
