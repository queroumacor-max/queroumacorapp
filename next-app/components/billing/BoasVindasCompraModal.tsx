// BoasVindasCompraModal — "Parabéns, você é PRO" (uma vez por conta) e
// "Seu pacote chegou" (quando o saldo de créditos sobe). Regra pura em
// lib/boasVindasCompra.ts. Montado no AppShell: vale pra qualquer tela
// logada, então aparece na primeira abertura depois da compra — inclusive
// logo depois de comprar, quando o saldo é relido.
//
// Fechar de qualquer jeito (botão, Esc, fundo) conta como visto, igual ao
// ProExpirandoModal.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { useProfile } from '@/lib/hooks/useProfile';
import { useBillingBalance } from '@/lib/hooks/useBillingBalance';
import { creditos } from '@/lib/billingBalance';
import {
  boasVindasAgora,
  ehProComprado,
  jaViuBoasVindasPro,
  marcarBoasVindasPro,
  marcarCreditosVistos,
  pacotesIniciante,
  ultimosCreditosVistos,
  type BoasVindas,
} from '@/lib/boasVindasCompra';

const ATRASO_MS = 700;

const BENEFICIOS_PRO: ReadonlyArray<{ icon: string; label: string }> = [
  { icon: '📥', label: 'Orçamentos e obras sem limite' },
  { icon: '🤖', label: 'Todas as ferramentas com IA sem limite' },
  { icon: '📅', label: 'Agenda, Financeiro e Anotações liberados' },
  { icon: '🏆', label: 'Destaque nas buscas e badge no perfil' },
];

function dataBr(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function BoasVindasCompraModal() {
  const user = usePolicyUser();
  const { profile } = useProfile();
  const saldo = useBillingBalance();
  const [aviso, setAviso] = useState<BoasVindas | null>(null);

  const uid = user?.id ?? null;
  const perfilCarregado = !!profile;
  const b = saldo.data ?? null;
  const qtdCreditos = b ? creditos(b) : null;

  useEffect(() => {
    if (!uid || aviso) return undefined;

    // Deixou de ser PRO (perfil já carregado): apaga a marca, pra que uma
    // nova assinatura no futuro dê boas-vindas de novo.
    if (perfilCarregado && !ehProComprado(user) && jaViuBoasVindasPro(uid)) {
      marcarBoasVindasPro(uid, false);
    }

    const ultimos = ultimosCreditosVistos(uid);
    const agora = boasVindasAgora({
      user,
      perfilCarregado,
      creditos: qtdCreditos,
      assinaturaAte: b?.unlimitedUntil ?? null,
      jaViuPro: jaViuBoasVindasPro(uid),
      ultimosCreditos: ultimos,
    });

    if (!agora) {
      // Gastou crédito (ou primeira leitura sem saldo): só atualiza a marca,
      // pra a próxima compra ser medida a partir daqui.
      if (qtdCreditos !== null && (ultimos === null || qtdCreditos < ultimos)) {
        marcarCreditosVistos(uid, qtdCreditos);
      }
      return undefined;
    }
    const t = setTimeout(() => setAviso(agora), ATRASO_MS);
    return () => clearTimeout(t);
  }, [uid, user, perfilCarregado, qtdCreditos, b?.unlimitedUntil, aviso]);

  const fechar = useCallback(() => {
    if (uid && aviso?.tipo === 'pro') marcarBoasVindasPro(uid, true);
    if (uid && aviso?.tipo === 'creditos') marcarCreditosVistos(uid, aviso.total);
    setAviso(null);
  }, [uid, aviso]);

  useEffect(() => {
    if (!aviso) return undefined;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aviso, fechar]);

  if (!aviso) return null;

  return (
    <div
      className="fixed inset-0 z-[1160] flex items-center justify-center p-4 modal-fade"
      style={{ background: 'rgba(0,0,0,.55)' }}
      onClick={fechar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="boasvindas-titulo"
        onClick={(e) => e.stopPropagation()}
        className="modal-pop w-full max-w-[380px] max-h-full overflow-y-auto rounded-2xl shadow-2xl p-5"
        style={{ background: 'var(--color-white)', border: '1px solid var(--color-border)' }}
      >
        {aviso.tipo === 'pro' ? <ConteudoPro fim={aviso.fim} /> : <ConteudoCreditos total={aviso.total} ganhou={aviso.ganhou} />}
        <button
          type="button"
          onClick={fechar}
          autoFocus
          className="mt-5 w-full rounded-xl py-3 font-bold text-white active:scale-[.98] transition-transform"
          style={{ background: 'var(--color-p1)' }}
        >
          Começar a usar
        </button>
      </div>
    </div>
  );
}

function Titulo({ emoji, kicker, children }: { emoji: string; kicker: string; children: React.ReactNode }) {
  return (
    <>
      <div className="text-4xl text-center" aria-hidden="true">{emoji}</div>
      <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-p1)' }}>
        {kicker}
      </p>
      <h2
        id="boasvindas-titulo"
        className="text-center text-xl font-extrabold leading-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
      >
        {children}
      </h2>
    </>
  );
}

function ConteudoPro({ fim }: { fim: number | null }) {
  return (
    <>
      <Titulo emoji="🎉" kicker="Plano PRO">Parabéns, você é PRO!</Titulo>
      <ul className="mt-4 space-y-2">
        {BENEFICIOS_PRO.map((it) => (
          <li key={it.label} className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-ink)' }}>
            <span className="text-lg shrink-0" aria-hidden="true">{it.icon}</span>
            <span>{it.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-xl p-3 text-sm text-center font-semibold" style={{ background: 'var(--color-bg)', color: 'var(--color-ink)' }}>
        {fim !== null
          ? <>Seu PRO ilimitado vale até <b>{dataBr(fim)}</b>.</>
          : <>Seu PRO ilimitado não tem data para acabar.</>}
      </p>
    </>
  );
}

function ConteudoCreditos({ total, ganhou }: { total: number; ganhou: number }) {
  const pacotes = pacotesIniciante(ganhou);
  const compra = pacotes
    ? `${pacotes} ${pacotes === 1 ? 'pacote' : 'pacotes'} Iniciante (${ganhou} créditos)`
    : `${ganhou} ${ganhou === 1 ? 'crédito' : 'créditos'}`;
  return (
    <>
      <Titulo emoji="🎁" kicker="Compra confirmada">Seu pacote chegou!</Titulo>
      <p className="mt-3 text-sm text-center" style={{ color: 'var(--color-ink2)' }}>
        Você comprou <b style={{ color: 'var(--color-ink)' }}>{compra}</b>.
      </p>
      <p className="mt-4 rounded-xl p-3 text-center" style={{ background: 'var(--color-bg)', color: 'var(--color-ink)' }}>
        <span className="block text-3xl font-extrabold" style={{ fontFamily: 'var(--font-display)' }}>{total}</span>
        <span className="text-sm">{total === 1 ? 'crédito disponível' : 'créditos disponíveis'}</span>
      </p>
      <p className="mt-3 text-xs text-center" style={{ color: 'var(--color-muted)' }}>
        Cada crédito vale 1 orçamento, 1 obra ou 1 uso de IA.
      </p>
    </>
  );
}
