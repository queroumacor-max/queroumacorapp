// Página /info/sobre — Sobre o QueroUmaCor. Conteúdo idêntico ao vanilla
// index.html linha 1274-1285.
import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoSubPage } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Sobre o QueroUmaCor',
  description:
    'Conectamos clientes aos melhores profissionais de pintura.',
};

export default function SobrePage() {
  return (
    <InfoSubPage title="Sobre">
      <div className="text-center" style={{ padding: '8px 0' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            fontWeight: 800,
            color: 'var(--color-ink)',
          }}
        >
          Quero<span style={{ color: 'var(--color-p1)' }}>Uma</span>Cor
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-muted)',
            marginTop: 4,
          }}
        >
          Versão 1.0
        </div>
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: 'var(--color-ink)',
            marginTop: 16,
          }}
        >
          Conectamos clientes aos melhores profissionais de pintura — pintores,
          grafiteiros, muralistas, pintores automotivos e funileiros — de um
          jeito simples, perto de você.
        </p>
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--color-border)',
            fontSize: 12,
            color: 'var(--color-muted)',
            lineHeight: 1.6,
          }}
        >
          Feito no Brasil 🇧🇷
          <br />© 2026 QueroUmaCor. Todos os direitos reservados.
          <br />
          <br />
          <b style={{ color: 'var(--color-ink)' }}>Cali Colors</b>
          <br />
          CNPJ: __.___.___/____-__
          <br />
          [endereço completo]
          <br />
          loja@calicolors.com.br
        </div>
        <div className="flex gap-2 mt-4">
          <Link
            href="/info/termos"
            className="flex-1 text-center font-bold"
            style={{
              padding: 10,
              background: 'var(--color-cream)',
              border: 'none',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--color-ink)',
              textDecoration: 'none',
            }}
          >
            Termos de Uso
          </Link>
          <Link
            href="/info/privacidade"
            className="flex-1 text-center font-bold"
            style={{
              padding: 10,
              background: 'var(--color-cream)',
              border: 'none',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--color-ink)',
              textDecoration: 'none',
            }}
          >
            Privacidade
          </Link>
        </div>
      </div>
    </InfoSubPage>
  );
}
