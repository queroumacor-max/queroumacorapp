// "Minha agenda" — o lado do FUNCIONÁRIO: convites pra equipes e os dias
// em que foi escalado. Tudo por RPC (não lê as tabelas do gestor).
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/toast';
import { abrirLinkExterno } from '@/lib/native';
import { ymdBrt } from '@/lib/utils';
import { deYmd, rotuloDia, ymd } from '@/lib/obras';
import { confirmarPresenca, meusConvites, minhaAgenda, minhasEquipes, responderConvite, sairDaEquipe } from '@/lib/services/obras';
import { useDialog } from '@/components/Dialog';
import { Botao, ErroObras, cls } from './ui';

export function MinhaAgenda({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const hoje = ymdBrt();
  const ate = (() => {
    const d = deYmd(hoje);
    d.setDate(d.getDate() + 21);
    return ymd(d);
  })();
  const convites = useQuery({ queryKey: ['obra-convites', uid], queryFn: meusConvites, enabled: !!uid });
  const agenda = useQuery({ queryKey: ['minha-agenda', uid, hoje], queryFn: () => minhaAgenda(hoje, ate), enabled: !!uid });

  const responder = useMutation({
    mutationFn: (x: { id: string; aceitar: boolean }) => responderConvite(x.id, x.aceitar),
    onSuccess: (_, x) => {
      showToast(x.aceitar ? 'Você entrou na equipe' : 'Convite recusado', 'success');
      qc.invalidateQueries({ queryKey: ['obra-convites', uid] });
      qc.invalidateQueries({ queryKey: ['minha-agenda', uid] });
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });
  const dialog = useDialog();
  const equipes = useQuery({ queryKey: ['minhas-equipes', uid], queryFn: minhasEquipes, enabled: !!uid, retry: false });
  const sair = useMutation({
    mutationFn: (id: string) => sairDaEquipe(id),
    onSuccess: () => {
      showToast('Você saiu da equipe', 'success');
      qc.invalidateQueries({ queryKey: ['minhas-equipes', uid] });
      qc.invalidateQueries({ queryKey: ['minha-agenda', uid] });
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });
  async function pedirSaida(id: string, nome: string) {
    const ok = await dialog.confirm(`Sair da equipe de ${nome}? Você deixa de ver as obras e a escala dele. Ele pode te convidar de novo depois.`, {
      title: 'Sair da equipe',
      okLabel: 'Sair',
      danger: true,
    });
    if (ok) sair.mutate(id);
  }
  const presenca = useMutation({
    mutationFn: (x: { id: string; confirmar: boolean }) => confirmarPresenca(x.id, x.confirmar),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['minha-agenda', uid] }),
    onError: (e) => showToast((e as Error).message, 'error'),
  });

  const erro = convites.error || agenda.error;
  const dias = agenda.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {erro ? <ErroObras erro={erro} /> : null}

      {(convites.data ?? []).map((c) => (
        <section key={c.id} className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--color-ink-fixed)', color: 'var(--color-white-fixed)' }}>
          <p className="text-sm">
            <b>{c.gestor_nome || 'Um profissional'}</b>
            {c.gestor_tag ? ` (@${c.gestor_tag})` : ''} te convidou pra equipe de obras
            {c.funcao ? ` como ${c.funcao}` : ''}.
          </p>
          <p className="text-xs" style={{ opacity: 0.85 }}>Aceitando, você passa a ver aqui as obras e os dias em que for escalado.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => responder.mutate({ id: c.id, aceitar: false })}
              disabled={responder.isPending}
              className="flex-1 rounded-xl font-bold text-sm border"
              style={{ minHeight: 44, borderColor: 'rgba(255,255,255,.5)' }}
            >
              Recusar
            </button>
            <button
              type="button"
              onClick={() => responder.mutate({ id: c.id, aceitar: true })}
              disabled={responder.isPending}
              className="flex-1 rounded-xl font-bold text-sm"
              style={{ minHeight: 44, background: 'var(--color-white-fixed)', color: 'var(--color-ink-fixed)' }}
            >
              Aceitar
            </button>
          </div>
        </section>
      ))}

      {(equipes.data ?? []).length > 0 ? (
        <section>
          <h3 className={cls.sec}>Equipes em que você está</h3>
          <div className="flex flex-col gap-2">
            {(equipes.data ?? []).map((e) => {
              const nome = e.gestor_nome || (e.gestor_tag ? `@${e.gestor_tag}` : 'um profissional');
              return (
                <div key={e.id} className={`${cls.card} flex items-center justify-between gap-2`}>
                  <span className="text-sm min-w-0" style={{ overflowWrap: 'anywhere' }}>
                    <b>{nome}</b>{e.gestor_tag && e.gestor_nome ? ` (@${e.gestor_tag})` : ''}
                    {e.funcao ? ` · ${e.funcao}` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={sair.isPending}
                    onClick={() => pedirSaida(e.id, nome)}
                    className="shrink-0 text-sm font-bold text-[color:var(--color-danger)] px-2"
                    style={{ minHeight: 40 }}
                  >
                    Sair da equipe
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className={cls.sec}>Próximos 21 dias</h3>
        {!agenda.isLoading && !erro && dias.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhum dia escalado por enquanto.</p>
        ) : null}
        <div className="flex flex-col gap-2">
          {dias.map((d) => {
            const ok = d.presenca === 'confirmada';
            return (
              <div key={d.escala_id} className={`${cls.card} flex flex-col gap-2`}>
                <div className="flex justify-between gap-2">
                  <b>{rotuloDia(d.dia).curto}{d.dia === hoje ? ' · hoje' : ''}</b>
                  <span className="text-sm">{d.hora_inicio ? d.hora_inicio.slice(0, 5) : ''}{d.hora_fim ? `–${d.hora_fim.slice(0, 5)}` : ''}</span>
                </div>
                <div className="font-bold" style={{ fontFamily: 'var(--font-display)' }}>{d.obra_nome}</div>
                {d.obra_endereco ? <div className="text-sm">📍 {d.obra_endereco}</div> : null}
                <div className="text-sm text-[color:var(--color-muted)]">
                  {[d.gestor_nome ? `Gestor: ${d.gestor_nome}` : null, d.colegas ? `Com: ${d.colegas}` : null, d.tarefa ? `Tarefa: ${d.tarefa}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="flex gap-2">
                  {d.obra_endereco ? (
                    <Botao onClick={() => abrirLinkExterno(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.obra_endereco || '')}`)}>
                      Como chegar
                    </Botao>
                  ) : null}
                  <Botao primario={!ok} onClick={() => presenca.mutate({ id: d.escala_id, confirmar: !ok })} disabled={presenca.isPending}>
                    {ok ? 'Presença confirmada ✓' : 'Confirmar presença'}
                  </Botao>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
