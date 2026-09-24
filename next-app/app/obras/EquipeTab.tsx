// Aba "Equipe" do gestor: convida quem usa o app pela @tag (a pessoa
// ACEITA no app dela) ou cadastra funcionário sem conta (escala vai por
// WhatsApp).
'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '@/components/Dialog';
import { showToast } from '@/lib/toast';
import { parseBRL } from '@/lib/utils';
import {
  adicionarSemConta,
  atualizarMembro,
  convidarPorTag,
  listEquipe,
  type MembroEquipe,
} from '@/lib/services/obras';
import { Botao, Campo, Chip, ErroObras, brl, cls } from './ui';

const ROTULO_STATUS: Record<MembroEquipe['status'], string> = {
  ativo: 'Ativo',
  convidado: 'Convite enviado',
  recusado: 'Recusou',
  saiu: 'Fora da equipe',
};

export function EquipeTab({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const q = useQuery({ queryKey: ['obra-equipe', uid], queryFn: () => listEquipe(uid), enabled: !!uid });
  const [modo, setModo] = useState<'app' | 'sem'>('app');
  const [f, setF] = useState({ tag: '', nome: '', telefone: '', funcao: '', diaria: '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const adicionar = useMutation({
    mutationFn: () => {
      const diaria = f.diaria.trim() ? parseBRL(f.diaria) : null;
      const extra = { funcao: f.funcao, diaria: Number.isFinite(diaria as number) ? diaria : null };
      return modo === 'app'
        ? convidarPorTag(uid, f.tag, extra)
        : adicionarSemConta(uid, { ...extra, nome: f.nome, telefone: f.telefone });
    },
    onSuccess: () => {
      showToast(modo === 'app' ? 'Convite enviado — a pessoa aceita no app dela' : 'Funcionário adicionado', 'success');
      setF({ tag: '', nome: '', telefone: '', funcao: '', diaria: '' });
      qc.invalidateQueries({ queryKey: ['obra-equipe', uid] });
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });

  async function mudar(m: MembroEquipe, status: MembroEquipe['status']) {
    if (status === 'saiu') {
      const ok = await dialog.confirm(`Tirar ${m.nome} da equipe? Os dias já escalados dele saem da agenda dele.`, {
        title: 'Tirar da equipe',
        okLabel: 'Tirar',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await atualizarMembro(uid, m.id, { status });
      qc.invalidateQueries({ queryKey: ['obra-equipe', uid] });
      if (status === 'convidado') showToast('Convite reenviado', 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  }

  const lista = q.data ?? [];
  const seg = (on: boolean) =>
    `flex-1 rounded-xl text-sm font-bold ${on ? 'bg-[color:var(--color-ink)] text-[color:var(--color-white)]' : 'text-[color:var(--color-ink)]'}`;

  return (
    <div className="flex flex-col gap-4">
      <form
        className={`${cls.card} flex flex-col gap-3`}
        onSubmit={(e) => {
          e.preventDefault();
          adicionar.mutate();
        }}
      >
        <h3 className="font-bold text-base" style={{ fontFamily: 'var(--font-display)' }}>Adicionar à equipe</h3>
        <div className="flex gap-1 p-1 rounded-xl bg-[color:var(--color-cream)]" role="group" aria-label="Tipo de funcionário">
          <button type="button" aria-pressed={modo === 'app'} onClick={() => setModo('app')} className={seg(modo === 'app')} style={{ minHeight: 44 }}>
            Já usa o app
          </button>
          <button type="button" aria-pressed={modo === 'sem'} onClick={() => setModo('sem')} className={seg(modo === 'sem')} style={{ minHeight: 44 }}>
            Sem conta
          </button>
        </div>
        {modo === 'app' ? (
          <Campo id="eq-tag" label="@tag do profissional">
            <input id="eq-tag" className={cls.input} value={f.tag} onChange={(e) => set('tag', e.target.value)} placeholder="@fulano" autoCapitalize="none" />
          </Campo>
        ) : (
          <>
            <Campo id="eq-nome" label="Nome">
              <input id="eq-nome" className={cls.input} value={f.nome} onChange={(e) => set('nome', e.target.value)} maxLength={80} />
            </Campo>
            <Campo id="eq-tel" label="Telefone (WhatsApp)">
              <input id="eq-tel" inputMode="tel" className={cls.input} value={f.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(11) 90000-0000" />
            </Campo>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo id="eq-fun" label="Função">
            <input id="eq-fun" className={cls.input} value={f.funcao} onChange={(e) => set('funcao', e.target.value)} maxLength={60} placeholder="Pintor, ajudante" />
          </Campo>
          <Campo id="eq-dia" label="Diária (R$)">
            <input id="eq-dia" inputMode="decimal" className={cls.input} value={f.diaria} onChange={(e) => set('diaria', e.target.value)} placeholder="0,00" />
          </Campo>
        </div>
        <p className="text-xs text-[color:var(--color-muted)]">
          {modo === 'app'
            ? 'A pessoa recebe um convite no app e só entra na equipe se aceitar.'
            : 'Sem conta, a escala vai pelo seu WhatsApp. A diária serve pra estimar a mão de obra da obra.'}
        </p>
        <Botao primario type="submit" disabled={adicionar.isPending}>
          {adicionar.isPending ? 'Enviando…' : modo === 'app' ? 'Enviar convite' : 'Adicionar funcionário'}
        </Botao>
      </form>

      <section>
        <h3 className={cls.sec}>Minha equipe · {lista.filter((m) => m.status === 'ativo').length} ativos</h3>
        {q.error ? <ErroObras erro={q.error} /> : null}
        <div className="flex flex-col gap-2">
          {lista.map((m) => (
            <div key={m.id} className={`${cls.card} flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{m.nome}</div>
                <div className="text-xs text-[color:var(--color-muted)]">
                  {[m.funcao, m.membro_id ? 'no app' : 'por WhatsApp', m.diaria ? `diária ${brl(m.diaria)}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Chip tom={m.status}>{ROTULO_STATUS[m.status]}</Chip>
              {m.status === 'ativo' || m.status === 'convidado' ? (
                <button type="button" onClick={() => mudar(m, 'saiu')} aria-label={`Tirar ${m.nome} da equipe`} className="text-lg px-2" style={{ minHeight: 44, minWidth: 44 }}>
                  ×
                </button>
              ) : m.membro_id ? (
                <button type="button" onClick={() => mudar(m, 'convidado')} className="text-xs font-bold underline px-1" style={{ minHeight: 44 }}>
                  Reconvidar
                </button>
              ) : (
                <button type="button" onClick={() => mudar(m, 'ativo')} className="text-xs font-bold underline px-1" style={{ minHeight: 44 }}>
                  Reativar
                </button>
              )}
            </div>
          ))}
          {!q.isLoading && lista.length === 0 && !q.error ? (
            <p className="text-sm text-[color:var(--color-muted)] text-center py-4">Sua equipe ainda está vazia.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
