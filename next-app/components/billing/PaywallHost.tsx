// PaywallHost — tela de compra (orçamentos, obras e assinatura PRO).
//
// Montado no AppShell; abre pelo evento `abrirPaywall(motivo)` de qualquer
// lugar: orçamento sem saldo, obra sem saldo, teste grátis de IA acabou,
// ou o botão de planos. Overlay em portal com z acima do BottomSheet
// (z-1000) e do Dialog (z-1100), porque quase sempre abre de dentro de um.
//
// Preço SEMPRE vem da loja. Fora do app (navegador/PWA), ou num app antigo
// sem o plugin, a tela mostra o saldo e diz que a compra é pelo app.
// Comprar/restaurar → o SERVIDOR confere e credita; a tela só relê o saldo.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { showToast } from '@/lib/toast';
import { BILLING_PRODUCTS, FREE_QUOTES, FREE_OBRAS, resumoDoSaldo, ilimitadoAtivo } from '@/lib/billingBalance';
import { PAYWALL_EVENT, type MotivoPaywall } from '@/lib/paywallEvents';
import {
  carregarProdutos,
  comprar,
  isPurchasesAvailable,
  restaurar,
  type ProdutoDaLoja,
} from '@/lib/services/billingPurchases';
import { useSingleFlight } from '@/lib/hooks/useSingleFlight';
import { useBillingBalance, BILLING_BALANCE_KEY } from '@/lib/hooks/useBillingBalance';


const TITULO: Record<MotivoPaywall, string> = {
  quote: 'Seus orçamentos grátis acabaram',
  obra: 'Sua obra grátis já foi usada',
  ia: 'Seu teste grátis desta ferramenta acabou',
  planos: 'Planos e créditos',
};

const SUBTITULO: Record<MotivoPaywall, string> = {
  quote: 'Compre mais orçamentos ou assine o PRO e grave quantos quiser.',
  obra: 'Compre uma obra extra ou assine o PRO e cadastre quantas quiser.',
  ia: 'As ferramentas com inteligência artificial fazem parte do PRO.',
  planos: 'Escolha o que faz sentido pra você. Dá pra mudar depois.',
};

const ROTULO: Record<string, { nome: string; detalhe: string }> = {
  [BILLING_PRODUCTS.pro]: { nome: 'PRO completo', detalhe: 'Orçamentos e obras ilimitados + todas as ferramentas com IA. Renova por mês; cancele quando quiser.' },
  [BILLING_PRODUCTS.quotePack40]: { nome: 'Pacote com 40 orçamentos', detalhe: 'Créditos que não vencem.' },
  [BILLING_PRODUCTS.quote1]: { nome: '1 orçamento', detalhe: 'Pra quando você precisa de só mais um.' },
  [BILLING_PRODUCTS.obra1]: { nome: '1 obra extra', detalhe: 'Cadastre mais uma obra na Gestão de Obras.' },
};

function ordemPara(motivo: MotivoPaywall): string[] {
  if (motivo === 'obra') return [BILLING_PRODUCTS.obra1, BILLING_PRODUCTS.pro];
  if (motivo === 'ia') return [BILLING_PRODUCTS.pro];
  if (motivo === 'quote') return [BILLING_PRODUCTS.pro, BILLING_PRODUCTS.quotePack40, BILLING_PRODUCTS.quote1];
  return [BILLING_PRODUCTS.pro, BILLING_PRODUCTS.quotePack40, BILLING_PRODUCTS.quote1, BILLING_PRODUCTS.obra1];
}

export function PaywallHost() {
  const [motivo, setMotivo] = useState<MotivoPaywall | null>(null);

  useEffect(() => {
    const abrir = (e: Event) => {
      const m = (e as CustomEvent<{ motivo?: MotivoPaywall }>).detail?.motivo;
      setMotivo(m && TITULO[m] ? m : 'planos');
    };
    window.addEventListener(PAYWALL_EVENT, abrir);
    return () => window.removeEventListener(PAYWALL_EVENT, abrir);
  }, []);

  useEffect(() => {
    if (!motivo) return undefined;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMotivo(null);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [motivo]);

  if (!motivo || typeof document === 'undefined') return null;
  return createPortal(<PaywallSheet motivo={motivo} fechar={() => setMotivo(null)} />, document.body);
}

/** Erro real da loja (RevenueCat/StoreKit), pra diagnóstico. Selecionável pra copiar. */
function DetalheDaLoja({ texto }: { texto: string }) {
  return (
    <p
      className="mt-2 rounded-lg p-2 text-xs select-text"
      style={{ background: 'var(--color-bg)', color: 'var(--color-ink2)', overflowWrap: 'anywhere', fontFamily: 'monospace' }}
    >
      Detalhe técnico: {texto}
    </p>
  );
}

function PaywallSheet({ motivo, fechar }: { motivo: MotivoPaywall; fechar: () => void }) {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const qc = useQueryClient();
  const naLoja = isPurchasesAvailable();
  const [erro, setErro] = useState<string | null>(null);

  const saldo = useBillingBalance();

  const produtos = useQuery({
    queryKey: ['billing-products', userId],
    queryFn: () => carregarProdutos(userId),
    enabled: !!userId && naLoja,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const recarregar = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: BILLING_BALANCE_KEY });
    // O PRO vive no perfil: a assinatura liga is_pro lá.
    await qc.invalidateQueries({ queryKey: ['profile'] });
  }, [qc]);

  const vooCompra = useSingleFlight();
  const vooRestaurar = useSingleFlight();

  const comprarProduto = (p: ProdutoDaLoja) => vooCompra.run(async () => {
    setErro(null);
    try {
      const r = await comprar(userId, p);
      if (r === 'cancelado') return;
      await recarregar();
      showToast('Compra confirmada! ✅', 'success');
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a compra.');
    }
  });

  const restaurarCompras = () => vooRestaurar.run(async () => {
    setErro(null);
    try {
      await restaurar(userId);
      await recarregar();
      showToast('Compras restauradas.', 'success');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível restaurar as compras.');
    }
  });

  const ocupado = vooCompra.busy || vooRestaurar.busy;
  const b = saldo.data;
  const lista = (produtos.data?.lista || []).slice().sort(
    (x, y) => ordemPara(motivo).indexOf(x.id) - ordemPara(motivo).indexOf(y.id),
  ).filter((p) => ordemPara(motivo).includes(p.id));

  return (
    <div
      className="fixed inset-0 z-[1150] flex items-end sm:items-center justify-center modal-fade"
      style={{ background: 'rgba(0,0,0,.55)' }}
      onClick={ocupado ? undefined : fechar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-titulo"
        onClick={(e) => e.stopPropagation()}
        className="modal-pop w-full max-w-[430px] max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl p-5"
        style={{ background: 'var(--color-white)', border: '1px solid var(--color-border)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="paywall-titulo" className="text-xl font-extrabold leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
            {TITULO[motivo]}
          </h2>
          <button type="button" onClick={fechar} disabled={ocupado} aria-label="Fechar" className="shrink-0 rounded-full w-9 h-9 text-lg" style={{ background: 'var(--color-bg)', color: 'var(--color-ink)' }}>
            ×
          </button>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-ink2)' }}>{SUBTITULO[motivo]}</p>

        {b && (
          <div className="mt-4 rounded-xl p-3 text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-ink)' }}>
            {ilimitadoAtivo(b) ? (
              <p className="font-semibold">⚡ Você é PRO: orçamentos e obras ilimitados.</p>
            ) : (
              <>
                <p>🧾 Orçamentos: <b>{resumoDoSaldo(b, 'quote')}</b></p>
                <p className="mt-1">🏗️ Obras: <b>{resumoDoSaldo(b, 'obra')}</b></p>
              </>
            )}
          </div>
        )}

        {!naLoja ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--color-ink2)' }}>
            A compra é feita pelo app QueroUmaCor instalado pela Google Play ou App Store.
            Todo mundo começa com {FREE_QUOTES} orçamentos e {FREE_OBRAS} obra grátis.
          </p>
        ) : produtos.isLoading ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--color-ink2)' }}>Carregando preços…</p>
        ) : lista.length === 0 ? (
          <>
            <p className="mt-4 text-sm" style={{ color: 'var(--color-ink2)' }}>
              Não consegui carregar os planos agora. Confira sua conexão e tente de novo.
            </p>
            {produtos.data?.problema && <DetalheDaLoja texto={produtos.data.problema} />}
          </>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {lista.map((p) => {
              const r = ROTULO[p.id] || { nome: p.produto.title, detalhe: p.produto.description };
              const destaque = p.id === BILLING_PRODUCTS.pro;
              return (
                <button
                  key={p.produto.identifier}
                  type="button"
                  disabled={ocupado}
                  onClick={() => { void comprarProduto(p); }}
                  className="w-full text-left rounded-xl p-4 active:scale-[.99] transition-transform disabled:opacity-60"
                  style={{
                    border: destaque ? '2px solid var(--color-p1)' : '1px solid var(--color-border)',
                    background: 'var(--color-white)',
                    color: 'var(--color-ink)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold min-w-0">{destaque ? '⚡ ' : ''}{r.nome}</span>
                    <span className="shrink-0 font-extrabold" style={{ color: 'var(--color-p1)' }}>
                      {p.preco}{destaque ? '/mês' : ''}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-ink2)' }}>{r.detalhe}</p>
                </button>
              );
            })}
            {produtos.data?.problema && <DetalheDaLoja texto={produtos.data.problema} />}
          </div>
        )}

        {erro && (
          <p role="alert" className="mt-3 text-sm font-semibold" style={{ color: '#c0392b' }}>{erro}</p>
        )}

        {naLoja && (
          <button
            type="button"
            onClick={() => { void restaurarCompras(); }}
            disabled={ocupado}
            className="mt-4 w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--color-bg)', color: 'var(--color-ink)' }}
          >
            {vooRestaurar.busy ? 'Restaurando…' : 'Restaurar compras'}
          </button>
        )}
        {vooCompra.busy && (
          <p className="mt-2 text-center text-xs" style={{ color: 'var(--color-ink2)' }}>Confirmando a compra…</p>
        )}
        <p className="mt-3 text-[11px] text-center" style={{ color: 'var(--color-ink2)' }}>
          Pagamento pela {typeof navigator !== 'undefined' && /iphone|ipad/i.test(navigator.userAgent) ? 'App Store' : 'Google Play'}.
          A assinatura renova sozinha até você cancelar nas configurações de assinaturas do seu celular.
        </p>
        <p className="mt-2 text-[11px] text-center" style={{ color: 'var(--color-ink2)' }}>
          <Link href="/info/termos" onClick={fechar} style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}>Termos de Uso</Link>
          {' · '}
          <Link href="/info/privacidade" onClick={fechar} style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}>Privacidade</Link>
        </p>
      </div>
    </div>
  );
}
