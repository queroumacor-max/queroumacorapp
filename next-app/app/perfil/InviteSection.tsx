// InviteSection — espelha o `#invite-section-pintor` do vanilla
// (index.html linha 944+ + modules/invite.js). Gera código QUC-XXXXX,
// mostra na tela, persiste em background na tabela `invites`, e expõe
// botão de compartilhar via Web Share / clipboard.
'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let code = 'QUC-';
  for (let i = 0; i < 5; i++) {
    code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return code;
}

export function InviteSection() {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!user) return;
    setGenerating(true);
    const newCode = makeCode();
    // Mostra IMEDIATO. Persiste em background (igual o vanilla — não
    // bloqueia UX se rede estiver lenta).
    setCode(newCode);
    setGenerating(false);
    try {
      const sb = getSupabase();
      // `invites` ainda não está no schema gerado dos types — cast pra
      // ignorar o checker. A tabela existe no banco (vanilla usa
      // sb.from('invites').insert(...) em modules/invite.js).
      const sbAny = sb as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      };
      await sbAny.from('invites').insert({
        code: newCode,
        created_by: user.id,
        used: false,
        uses: 0,
        max_uses: 5,
      });
    } catch (e) {
      // Silent — código já apareceu pro usuário. Erro de constraint é raro
      // (32^5 = 33M combinações).
      console.warn('invite insert:', e);
    }
  }

  async function handleShare() {
    if (!code) return;
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://queroumacor.com.br';
    const link = `${origin}/?invite=${encodeURIComponent(code)}`;
    const text = `Oi! Use meu código ${code} para se cadastrar no QueroUmaCor — o app pra pintores e clientes:\n${link}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Convite QueroUmaCor', text, url: link });
        return;
      } catch {
        /* cancelado */
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* silent */
      }
    }
  }

  return (
    <div
      className="bg-white"
      style={{
        borderRadius: 14,
        padding: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,.05)',
        marginBottom: 20,
      }}
    >
      <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        </div>
        <div className="flex-1">
          <div
            className="font-bold"
            style={{ fontSize: 14, color: 'var(--color-ink)' }}
          >
            Convide pintores e clientes
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            Gere um código e compartilhe
          </div>
        </div>
      </div>

      {code ? (
        <div
          className="text-center"
          style={{
            background: 'var(--color-cream)',
            borderRadius: 10,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-muted)',
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              marginBottom: 6,
            }}
          >
            Seu código de convite
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '3px',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {code}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="w-full font-bold text-white"
        style={{
          padding: 11,
          background: 'var(--color-ink)',
          borderRadius: 10,
          fontSize: 13,
          cursor: generating ? 'wait' : 'pointer',
          border: 'none',
        }}
      >
        {code ? 'Gerar novo código' : 'Gerar Código de Convite'}
      </button>

      {code ? (
        <button
          type="button"
          onClick={handleShare}
          className="w-full font-bold text-white"
          style={{
            padding: 11,
            background: 'var(--color-p1)',
            borderRadius: 10,
            fontSize: 13,
            cursor: 'pointer',
            border: 'none',
            marginTop: 6,
          }}
        >
          Compartilhar Código
        </button>
      ) : null}
    </div>
  );
}
