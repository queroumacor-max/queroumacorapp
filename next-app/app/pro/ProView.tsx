// ProView — cliente component da /pro. Mostra benefícios, preço e CTA.
// O PRO é ASSINATURA paga na loja (Google Play / App Store, via RevenueCat).
// O preço vem da loja — nunca escrito aqui (decisão de 25/10/2026).
// Estado do user (já PRO? grace period?) vem do useProfile pra trocar a
// UI quando aplicável (oculta "Assinar" se já é PRO, mostra "Estende
// assinatura" em vez).
'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { BILLING_PRODUCTS } from '@/lib/billingBalance';
import { carregarProdutos } from '@/lib/services/billingPurchases';
import { personaForRole } from '@/lib/aiPersona';
import { isPurchasesAvailable } from '@/lib/native';
import { abrirPaywall } from '@/lib/paywallEvents';

interface Feature {
  /** Emoji OU caminho de imagem (/img/...) — a lista renderiza os dois. */
  icon: string;
  label: string;
}

// Contato da Cali Colors — só pra DÚVIDAS sobre o PRO.
const STORE_PHONE_DISPLAY = '(11) 95976-5031';
const STORE_WHATSAPP = 'https://wa.me/5511959765031';

// A lista não crava o nome da persona: cada perfil tem o SEU parceiro
// digital (pintor → Seu Zé, grafiteiro → Fê, automotivo → Senna, cliente
// → Alice), então o texto é genérico e a FOTO vem de `personaForRole`.
function buildFeatures(personaImage: string): readonly Feature[] {
  return [
    { icon: '📥', label: 'Orçamentos e obras ilimitados' },
    { icon: '🏆', label: 'Apareça no topo das buscas e do mapa' },
    { icon: '✓', label: 'Badge verificado no perfil' },
    { icon: '📊', label: 'Estatísticas avançadas do perfil' },
    { icon: '🎓', label: 'Acesso a cursos exclusivos' },
    { icon: personaImage, label: 'Orçamento gerado pelo seu parceiro digital' },
    { icon: personaImage, label: 'Seu parceiro digital — chat e voz pra tirar dúvidas' },
    { icon: '🎨', label: 'Arte pra usar nas suas redes sociais a partir da sua foto' },
  ];
}

// A casca não muda depois de carregada: não há o que assinar.
const semAssinatura = () => () => {};

export function ProView() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { profile } = useProfile();
  const isPro = !!profile?.is_pro;
  const persona = personaForRole(profile?.role || profile?.user_type);
  const FEATURES = buildFeatures(persona.image);

  // Assinatura só existe no app instalado (plugin de compras). No site, a
  // tela explica isso. Lido depois de montar: no servidor não existe casca
  // nativa, e ler no render daria HTML diferente do cliente (hidratação).
  const assinaturaNaLoja = useSyncExternalStore(semAssinatura, isPurchasesAvailable, () => false);

  // Mesma query (mesma chave) do PaywallHost: o preço vem da loja, com a
  // moeda e o imposto do país da pessoa.
  const produtos = useQuery({
    queryKey: ['billing-products', userId],
    queryFn: () => carregarProdutos(userId),
    enabled: !!userId && assinaturaNaLoja && !isPro,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const precoPro = produtos.data?.lista.find((p) => p.id === BILLING_PRODUCTS.pro)?.preco ?? null;

  return (
    <div className="px-3.5 pt-4 pb-10">
      <h1
        className="font-extrabold text-center"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          color: 'var(--color-ink)',
          marginBottom: 8,
        }}
      >
        ⚡ Plano PRO
      </h1>

      {isPro ? (
        <div
          className="text-center font-bold text-white"
          style={{
            background: 'linear-gradient(135deg, var(--color-p3), var(--color-p1))',
            padding: '12px 16px',
            borderRadius: 14,
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          ✅ Você já é PRO! Continue aproveitando todas as features.
        </div>
      ) : null}

      {/* Card do plano: assinatura mensal, preço da loja. */}
      <div
        className="text-center text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
          borderRadius: 18,
          padding: '20px 18px',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: precoPro ? 34 : 24,
            fontWeight: 800,
            fontFamily: 'var(--font-display)',
            lineHeight: 1.1,
          }}
        >
          {precoPro ?? 'Assinatura mensal'}
          {precoPro && <span style={{ fontSize: 16, fontWeight: 400 }}> / mês</span>}
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
          {precoPro
            ? 'Cobrado pela loja. Cancele quando quiser.'
            : 'O preço aparece na hora de assinar, direto da loja do seu celular.'}
        </div>
      </div>

      {/* Features */}
      <div className="flex flex-col gap-2.5" style={{ marginBottom: 18 }}>
        {FEATURES.map((f) => (
          <div
            key={f.label}
            className="flex items-center bg-white"
            style={{
              borderRadius: 12,
              padding: '12px 14px',
              boxShadow: '0 2px 6px rgba(0,0,0,.05)',
              fontSize: 14,
              color: 'var(--color-ink)',
              gap: 12,
            }}
          >
            {f.icon.startsWith('/') ? (
              // Foto da persona no MESMO tamanho visual dos emojis (20px).
              <img
                src={f.icon}
                alt=""
                width={22}
                height={22}
                className="rounded-full flex-shrink-0"
                style={{ objectFit: 'cover' }}
                loading="lazy"
              />
            ) : (
              <span style={{ fontSize: 20 }}>{f.icon}</span>
            )}
            <span style={{ flex: 1 }}>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Ativação do PRO: assinatura pela loja, só no app instalado. */}
      {isPro ? (
        <div
          className="w-full text-center text-white font-bold"
          style={{
            padding: 16,
            background: 'var(--color-muted)',
            borderRadius: 14,
            fontSize: 16,
          }}
        >
          Você já é PRO
        </div>
      ) : assinaturaNaLoja ? (
        <button
          type="button"
          onClick={() => abrirPaywall('planos')}
          className="block w-full text-center text-white font-bold"
          style={{
            padding: 16,
            background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
            borderRadius: 14,
            fontSize: 16,
            boxShadow: '0 6px 20px rgba(255,107,53,.35)',
          }}
        >
          ⚡ Assinar o PRO
        </button>
      ) : (
        <div
          style={{
            padding: '16px 16px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
          }}
        >
          <div
            className="font-bold"
            style={{ fontSize: 14, color: 'var(--color-ink)', marginBottom: 6 }}
          >
            Como assinar o PRO
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.6, margin: 0 }}>
            A assinatura é feita pelo app QueroUmaCor instalado no celular
            (Google Play ou App Store). Abra o app, entre nesta tela e toque em{' '}
            <b>Assinar o PRO</b>.
          </p>
        </div>
      )}

      <p
        className="text-center"
        style={{
          fontSize: 11,
          color: 'var(--color-muted)',
          marginTop: 16,
          lineHeight: 1.5,
        }}
      >
        Ao assinar o PRO, você concorda com os{' '}
        <Link
          href="/info/termos"
          style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}
        >
          Termos
        </Link>{' '}
        e a{' '}
        <Link
          href="/info/privacidade"
          style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}
        >
          Privacidade
        </Link>
        .{' '}
        A assinatura é cobrada pela loja e renova todo mês até você cancelar
        nas configurações da loja.
      </p>

      {/* Dúvidas sobre o PRO — canal de atendimento da loja. */}
      <div
        style={{
          marginTop: 20,
          padding: '14px 16px',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 14,
        }}
      >
        <div
          className="font-bold"
          style={{
            fontSize: 13,
            color: 'var(--color-ink)',
            marginBottom: 6,
          }}
        >
          Dúvidas sobre o PRO
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--color-muted)',
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Para dúvidas sobre o plano ou a cobrança, fale com a gente pelo
          WhatsApp{' '}
          <a
            href={STORE_WHATSAPP}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-p1)' }}
          >
            {STORE_PHONE_DISPLAY}
          </a>{' '}
          ou pelo e-mail{' '}
          <a
            href="mailto:loja@calicolors.com.br"
            style={{ color: 'var(--color-p1)' }}
          >
            loja@calicolors.com.br
          </a>
          . Veja também o item 13 dos{' '}
          <Link
            href="/info/termos"
            style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}
          >
            Termos de Uso
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
