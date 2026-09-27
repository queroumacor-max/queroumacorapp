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
  apagarMembro,
  atualizarMembro,
  convidarPorTag,
  listEquipe,
  normalizarTag,
  pessoasQueSigo,
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
  const seguindo = useQuery({ queryKey: ['pessoas-que-sigo', uid], queryFn: () => pessoasQueSigo(uid), enabled: !!uid });
  const [modo, setModo] = useState<'app' | 'sem'>('app');
  const [f, setF] = useState({ tag: '', nome: '', telefone: '', funcao: '', diaria: '' });
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const termoTag = normalizarTag(f.tag);
  const sugestoes = (seguindo.data ?? [])
    .filter((p) => !termoTag || normalizarTag(p.tag).includes(termoTag) || p.nome.toLowerCase().includes(termoTag))
    .slice(0, 6);

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

  // Otimista: a tela muda NA HORA e o banco confirma por trás. Antes a
  // pessoa confirmava e ficava olhando a mesma lista até o UPDATE (triggers
  // da equipe/escala) + a releitura voltarem — sem nenhum aviso no meio.
  const [emAndamento, setEmAndamento] = useState<Set<string>>(new Set());

  async function mudar(m: MembroEquipe, status: MembroEquipe['status']) {
    if (status === 'saiu') {
      const convite = m.status === 'convidado';
      const ok = await dialog.confirm(
        convite
          ? `Cancelar o convite de ${m.nome}? Se mudar de ideia, dá pra convidar de novo.`
          : `Remover ${m.nome} da equipe? Os dias já escalados saem da agenda dessa pessoa.`,
        {
          title: convite ? 'Cancelar convite' : 'Remover da equipe',
          okLabel: convite ? 'Cancelar convite' : 'Remover',
          danger: true,
        },
      );
      if (!ok) return;
    }
    const chave = ['obra-equipe', uid];
    const antes = qc.getQueryData<MembroEquipe[]>(chave);
    qc.setQueryData<MembroEquipe[]>(chave, (l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, status } : x)));
    setEmAndamento((s) => new Set(s).add(m.id));
    showToast(
      status === 'saiu'
        ? m.status === 'convidado' ? 'Convite cancelado' : `${m.nome} saiu da equipe`
        : status === 'convidado' ? 'Convite reenviado' : `${m.nome} voltou pra equipe`,
      'success',
    );
    try {
      await atualizarMembro(uid, m.id, { status });
    } catch (e) {
      qc.setQueryData(chave, antes);
      showToast(`Não deu certo: ${(e as Error).message}`, 'error');
    } finally {
      setEmAndamento((s) => {
        const n = new Set(s);
        n.delete(m.id);
        return n;
      });
      qc.invalidateQueries({ queryKey: chave });
    }
  }

  async function apagar(m: MembroEquipe) {
    const ok = await dialog.confirm(
      `Apagar ${m.nome} da lista? Os dias em que essa pessoa foi escalada também somem do histórico das obras.`,
      { title: 'Apagar da lista', okLabel: 'Apagar', danger: true },
    );
    if (!ok) return;
    const chave = ['obra-equipe', uid];
    const antes = qc.getQueryData<MembroEquipe[]>(chave);
    qc.setQueryData<MembroEquipe[]>(chave, (l) => (l ?? []).filter((x) => x.id !== m.id));
    showToast(`${m.nome} apagado da lista`, 'success');
    try {
      await apagarMembro(uid, m.id);
    } catch (e) {
      qc.setQueryData(chave, antes);
      showToast(`Não deu certo: ${(e as Error).message}`, 'error');
    } finally {
      qc.invalidateQueries({ queryKey: chave });
    }
  }

  const lista = q.data ?? [];
  // Quem saiu ou recusou não é mais equipe: fica numa seção fechada embaixo,
  // senão a lista de verdade some no meio de gente que já foi embora.
  const naEquipe = lista.filter((m) => m.status === 'ativo' || m.status === 'convidado');
  const fora = lista.filter((m) => m.status === 'saiu' || m.status === 'recusado');
  const [foraAberta, setForaAberta] = useState(false);
  const cartao = (m: MembroEquipe) => {
    const ocupado = emAndamento.has(m.id);
    const botao = 'text-xs font-bold px-3 rounded-xl border border-[color:var(--color-border)] bg-white text-[color:var(--color-ink)] disabled:opacity-60';
    return (
      <div key={m.id} className={`${cls.card} flex flex-col gap-2`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm" style={{ overflowWrap: 'anywhere' }}>{m.nome}</div>
            <div className="text-xs text-[color:var(--color-muted)]">
              {[m.funcao, m.membro_id ? 'no app' : 'por WhatsApp', m.diaria ? `diária ${brl(m.diaria)}` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <Chip tom={m.status}>{ROTULO_STATUS[m.status]}</Chip>
        </div>
        <div className="flex justify-end gap-2">
          {m.status === 'saiu' || m.status === 'recusado' ? (
            <button type="button" disabled={ocupado} onClick={() => apagar(m)} className={`${botao} text-[color:var(--color-danger)]`} style={{ minHeight: 40 }}>
              Apagar
            </button>
          ) : null}
          {m.status === 'convidado' ? (
            <button type="button" disabled={ocupado} onClick={() => mudar(m, 'saiu')} className={`${botao} text-[color:var(--color-danger)]`} style={{ minHeight: 40 }}>
              Cancelar convite
            </button>
          ) : m.status === 'ativo' ? (
            <button type="button" disabled={ocupado} onClick={() => mudar(m, 'saiu')} className={`${botao} text-[color:var(--color-danger)]`} style={{ minHeight: 40 }}>
              Remover da equipe
            </button>
          ) : m.membro_id ? (
            <button type="button" disabled={ocupado} onClick={() => mudar(m, 'convidado')} className={botao} style={{ minHeight: 40 }}>
              Convidar de novo
            </button>
          ) : (
            <button type="button" disabled={ocupado} onClick={() => mudar(m, 'ativo')} className={botao} style={{ minHeight: 40 }}>
              Reativar
            </button>
          )}
        </div>
      </div>
    );
  };

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
            <div className="relative">
              <input
                id="eq-tag"
                className={cls.input}
                value={f.tag}
                onChange={(e) => set('tag', e.target.value)}
                onFocus={() => setSugestoesAbertas(true)}
                onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
                placeholder="@fulano"
                autoCapitalize="none"
                autoComplete="off"
              />
              {sugestoesAbertas && sugestoes.length > 0 ? (
                <ul
                  role="listbox"
                  aria-label="Pessoas que você segue"
                  className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl border border-[color:var(--color-border)] bg-white shadow-lg overflow-hidden"
                >
                  {sugestoes.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          set('tag', `@${p.tag}`);
                          setSugestoesAbertas(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[color:var(--color-cream)]"
                        style={{ minHeight: 44 }}
                      >
                        <span className="font-bold">{p.nome || `@${p.tag}`}</span>
                        {p.nome ? <span className="text-[color:var(--color-muted)]"> · @{p.tag}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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
          {naEquipe.map(cartao)}
          {!q.isLoading && naEquipe.length === 0 && !q.error ? (
            <p className="text-sm text-[color:var(--color-muted)] text-center py-4">Ninguém na equipe agora.</p>
          ) : null}
        </div>
      </section>

      {fora.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setForaAberta((v) => !v)}
            aria-expanded={foraAberta}
            className={`${cls.sec} w-full text-left`}
            style={{ minHeight: 40 }}
          >
            {foraAberta ? '▾' : '▸'} Fora da equipe · {fora.length}
          </button>
          {foraAberta ? <div className="flex flex-col gap-2">{fora.map(cartao)}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
