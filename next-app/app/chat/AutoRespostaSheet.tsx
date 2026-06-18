// AutoRespostaSheet — modal de configuração de respostas automáticas.
// Espelha o `#auto-resp-modal` do vanilla (index.html linha 1962+).
// Persiste em `auto_responses` (3 rows: new_quote, follow_up, new_message)
// via upsert por (user_id, trigger_type). Listener em useChatRealtime
// dispara o auto-reply quando new_message está ativo.
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/lib/toast';
import { invalidateAutoReplyCfg } from '@/lib/hooks/useChatRealtime';

interface AutoConfig {
  message_template: string;
  is_active: boolean;
}

type TriggerType = 'new_quote' | 'follow_up' | 'new_message';

interface Slot {
  key: TriggerType;
  label: string;
  defaultMsg: string;
  delayMinutes: number;
}

const SLOTS: ReadonlyArray<Slot> = [
  {
    key: 'new_quote',
    label: 'Novo Orçamento Recebido',
    defaultMsg:
      'Olá! Obrigado pelo interesse. Recebi seu pedido de orçamento e entrarei em contato em breve! 🎨',
    delayMinutes: 0,
  },
  {
    key: 'follow_up',
    label: 'Follow-up (3 dias)',
    defaultMsg:
      'Olá! Gostaria de saber se ainda precisa do serviço de pintura. Posso fazer uma visita para avaliar o local. 😊',
    delayMinutes: 4320,
  },
  {
    key: 'new_message',
    label: 'Nova Mensagem',
    defaultMsg: 'Olá! Vi sua mensagem. Retorno em breve!',
    delayMinutes: 0,
  },
];

export interface AutoRespostaSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AutoRespostaSheet({ open, onClose }: AutoRespostaSheetProps) {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<Record<TriggerType, AutoConfig>>(() =>
    SLOTS.reduce(
      (acc, s) => ({
        ...acc,
        [s.key]: { message_template: s.defaultMsg, is_active: false },
      }),
      {} as Record<TriggerType, AutoConfig>,
    ),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carrega config existente quando o modal abre.
  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    const sb = getSupabase();
    sb.from('auto_responses')
      .select('trigger_type, message_template, is_active')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return;
        const rows = data as Array<{
          trigger_type: string;
          message_template: string | null;
          is_active: boolean | null;
        }>;
        setConfigs((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            const key = r.trigger_type as TriggerType;
            if (SLOTS.some((s) => s.key === key)) {
              next[key] = {
                message_template:
                  r.message_template ??
                  SLOTS.find((s) => s.key === key)?.defaultMsg ??
                  '',
                is_active: !!r.is_active,
              };
            }
          }
          return next;
        });
      })
      .then(undefined, () => {
        /* silent */
      })
      .then(() => setLoading(false));
  }, [open, user]);

  async function handleSave() {
    if (!user || saving) return;
    setSaving(true);
    try {
      const sb = getSupabase();
      for (const slot of SLOTS) {
        const cfg = configs[slot.key];
        await sb
          .from('auto_responses')
          .upsert(
            {
              user_id: user.id,
              trigger_type: slot.key,
              message_template: cfg.message_template,
              is_active: cfg.is_active,
              delay_minutes: slot.delayMinutes,
            },
            { onConflict: 'user_id,trigger_type' },
          );
      }
      // Força recarga do config no próximo auto-reply trigger.
      invalidateAutoReplyCfg();
      showToast('Respostas automáticas salvas!', 'success');
      onClose();
    } catch (e) {
      showToast((e as Error).message || 'Erro ao salvar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Respostas automáticas">
      <h2
        className="font-extrabold text-center"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          marginBottom: 6,
          color: 'var(--color-ink)',
        }}
      >
        ⚡ Respostas Automáticas
      </h2>
      <p
        className="text-center"
        style={{
          fontSize: 13,
          color: 'var(--color-muted)',
          marginBottom: 14,
        }}
      >
        Configure mensagens automáticas para novos orçamentos e follow-ups.
      </p>
      <p
        className="text-center"
        style={{
          fontSize: 11,
          color: 'var(--color-muted)',
          marginBottom: 14,
          marginTop: -8,
        }}
      >
        🤖 Para transparência, mensagens enviadas automaticamente aparecem para
        o destinatário com a etiqueta &quot;Resposta automática&quot;.
      </p>

      {loading ? (
        <p className="text-center text-sm text-[color:var(--color-muted)] py-4">
          Carregando…
        </p>
      ) : null}

      {SLOTS.map((slot) => {
        const cfg = configs[slot.key];
        return (
          <div
            key={slot.key}
            className="bg-white"
            style={{
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
              boxShadow: '0 2px 8px rgba(0,0,0,.05)',
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{slot.label}</span>
              <label
                className="relative inline-block"
                style={{ width: 44, height: 24, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={cfg.is_active}
                  onChange={(e) =>
                    setConfigs((prev) => ({
                      ...prev,
                      [slot.key]: { ...prev[slot.key], is_active: e.target.checked },
                    }))
                  }
                  className="absolute opacity-0 w-0 h-0"
                />
                <span
                  className="absolute"
                  style={{
                    inset: 0,
                    borderRadius: 999,
                    background: cfg.is_active ? 'var(--color-p1)' : 'var(--color-border)',
                    transition: 'background .15s',
                  }}
                />
                <span
                  className="absolute"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    top: 2,
                    left: cfg.is_active ? 22 : 2,
                    transition: 'left .15s',
                    boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                  }}
                />
              </label>
            </div>
            <textarea
              value={cfg.message_template}
              onChange={(e) =>
                setConfigs((prev) => ({
                  ...prev,
                  [slot.key]: { ...prev[slot.key], message_template: e.target.value },
                }))
              }
              rows={2}
              className="w-full"
              style={{
                padding: 10,
                borderRadius: 10,
                border: '1.5px solid var(--color-border)',
                fontSize: 12,
                resize: 'none',
                outline: 'none',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>
        );
      })}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full text-white font-bold"
        style={{
          padding: 12,
          background: 'var(--color-p1)',
          borderRadius: 10,
          fontSize: 14,
          border: 'none',
          cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.7 : 1,
          marginTop: 4,
        }}
      >
        {saving ? 'Salvando…' : 'Salvar Configurações'}
      </button>
    </BottomSheet>
  );
}
