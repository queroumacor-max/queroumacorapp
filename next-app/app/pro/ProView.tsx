// ProView — cliente component da /pro. Mostra benefícios, preço e CTA.
// Estado do user (já PRO? grace period?) vem do useProfile pra trocar a
// UI quando aplicável (oculta "Assinar" se já é PRO, mostra "Estende
// assinatura" em vez).
'use client';

import Link from 'next/link';
import { useProfile } from '@/lib/hooks/useProfile';

interface Feature {
  icon: string;
  label: string;
}

// Contato da Cali Colors — só pra DÚVIDAS sobre o PRO (a ativação é via pontos).
const STORE_PHONE_DISPLAY = '(11) 95976-5031';
const STORE_WHATSAPP = 'https://wa.me/5511959765031';

// Custo da troca pontos → PRO (espelha REDEEM_COST em PontosView/points.ts).
const PRO_POINTS_COST = 1000;

const FEATURES: readonly Feature[] = [
  { icon: '📥', label: 'Pedidos de orçamento ilimitados' },
  { icon: '🏆', label: 'Apareça no topo das buscas e do mapa' },
  { icon: '✓', label: 'Badge verificado no perfil' },
  { icon: '📊', label: 'Estatísticas avançadas do perfil' },
  { icon: '🎓', label: 'Acesso a cursos exclusivos' },
  { icon: '🤖', label: 'Orçamento gerado pelo Seu Zé' },
  { icon: '🐻', label: 'Seu Zé — chat e voz pra tirar dúvidas' },
  { icon: '🎨', label: 'Arte pra Instagram a partir da sua foto' },
];

export function ProView() {
  const { profile } = useProfile();
  const isPro = !!profile?.is_pro;

  // NÃO há pagamento do PRO dentro do app. A ÚNICA forma de ativar o PRO é
  // trocando pontos pelo plano (RPC redeem_pro_with_points, instantâneo). Os
  // pontos são ganhos convidando amigos e usando o app.

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

      {/* Card de troca por pontos (substitui o preço — não há pagamento no app:
          o PRO é ativado SÓ trocando pontos pelo plano). */}
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
            fontSize: 34,
            fontWeight: 800,
            fontFamily: 'var(--font-display)',
            lineHeight: 1,
          }}
        >
          {PRO_POINTS_COST} pontos
          <span style={{ fontSize: 16, fontWeight: 400 }}> = 1 mês PRO</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
          Junte pontos e troque pelo plano PRO
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
            <span style={{ fontSize: 20 }}>{f.icon}</span>
            <span style={{ flex: 1 }}>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Ativação do PRO — EXCLUSIVAMENTE pela troca de pontos (sem pagamento
          no app). O botão leva pra /pontos, onde a troca é atômica via RPC. */}
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
      ) : (
        <div
          style={{
            padding: '16px 16px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
            marginBottom: 12,
          }}
        >
          <div
            className="font-bold"
            style={{ fontSize: 14, color: 'var(--color-ink)', marginBottom: 6 }}
          >
            Como ativar o PRO
          </div>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-muted)',
              lineHeight: 1.6,
              margin: '0 0 14px',
            }}
          >
            O plano PRO é ativado <b>apenas trocando seus pontos</b> pelo plano —
            não há pagamento dentro do app. Junte pontos convidando amigos e
            usando o app, e troque <b>{PRO_POINTS_COST} pontos por 1 mês de PRO</b>.
            A ativação é instantânea.
          </p>
          <Link
            href="/pontos"
            className="block w-full text-center text-white font-bold"
            style={{
              padding: 16,
              background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
              borderRadius: 14,
              fontSize: 16,
              textDecoration: 'none',
              boxShadow: '0 6px 20px rgba(255,107,53,.35)',
            }}
          >
            🎁 Trocar pontos por PRO
          </Link>
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
        Ao ativar o PRO, você concorda com os{' '}
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
        . A ativação do PRO é feita exclusivamente pela troca de pontos.
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
          O PRO é ativado pela troca de pontos, direto no app. Para dúvidas
          sobre pontos ou sobre o plano, fale com a gente pelo WhatsApp{' '}
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
