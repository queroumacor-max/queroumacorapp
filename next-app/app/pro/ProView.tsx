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

// Contato da Cali Colors pra ativação manual do PRO (sem pagamento no app).
const STORE_PHONE_DISPLAY = '(11) 95976-5031';
const STORE_WHATSAPP = 'https://wa.me/5511959765031';
const PRO_WHATSAPP_LINK =
  STORE_WHATSAPP +
  '?text=' +
  encodeURIComponent('Olá! Quero ativar o plano PRO no QueroUmaCor.');

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

  // Por enquanto NÃO há pagamento do PRO dentro do app: a ativação é manual.
  // O cliente entra em contato com a loja física Cali Colors (telefone/
  // WhatsApp) e a equipe habilita a licença PRO no perfil dele.

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

      {/* Card preço */}
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
            fontSize: 36,
            fontWeight: 800,
            fontFamily: 'var(--font-display)',
            lineHeight: 1,
          }}
        >
          R$39<span style={{ fontSize: 16, fontWeight: 400 }}>/mês</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
          Cancele quando quiser
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

      {/* Ativação do PRO — feita pela loja física (sem pagamento no app).
          Por enquanto não há checkout online: o cliente fala com a Cali
          Colors pelo telefone/WhatsApp e a equipe habilita a licença PRO. */}
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
            Para ativar o plano PRO, entre em contato com a loja física{' '}
            <b>Cali Colors</b> pelo telefone{' '}
            <a
              href={STORE_WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-p1)', fontWeight: 700 }}
            >
              {STORE_PHONE_DISPLAY}
            </a>
            . A equipe habilita a sua licença PRO no seu perfil.
          </p>
          <a
            href={PRO_WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
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
            💬 Falar com a loja pelo WhatsApp
          </a>
        </div>
      )}

      {/* Atalho pra trocar 100 pts por 1 mês PRO */}
      {!isPro ? (
        <Link
          href="/pontos"
          className="block w-full text-center font-bold"
          style={{
            padding: 14,
            background: 'transparent',
            border: '1.5px solid var(--color-border)',
            borderRadius: 14,
            fontSize: 14,
            color: 'var(--color-ink)',
            textDecoration: 'none',
          }}
        >
          🎁 Trocar 100 pontos por 1 mês PRO
        </Link>
      ) : null}

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
        . A ativação e a renovação do PRO são feitas pela loja Cali Colors.
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
          A ativação, a renovação e o cancelamento do plano PRO são tratados
          diretamente com a loja Cali Colors. Fale com a gente pelo WhatsApp{' '}
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
