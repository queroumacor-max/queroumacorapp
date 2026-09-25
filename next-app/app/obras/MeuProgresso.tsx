// "Meu progresso" — o lado do CLIENTE: as obras que algum profissional
// vinculou a ele, com status, equipe escalada e agenda. Tudo por RPC
// (nunca lê `obras`/`obra_equipe`/`obra_escala` direto) — nunca mostra
// valor da obra nem as anotações privadas do gestor.
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { abrirLinkExterno } from '@/lib/native';
import { ymdBrt } from '@/lib/utils';
import { rotuloDia, rotuloStatusObra } from '@/lib/obras';
import { agendaDaObraCliente, equipeDaObraCliente, minhasObrasCliente, type ObraCliente } from '@/lib/services/obras';
import { Botao, Chip, ErroObras, cls } from './ui';

export function MeuProgresso({ uid }: { uid: string }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['minhas-obras-cliente', uid], queryFn: minhasObrasCliente, enabled: !!uid });
  const obras = q.data ?? [];
  const obraAberta = obras.find((o) => o.obra_id === aberta);

  if (obraAberta) return <ObraDoCliente obra={obraAberta} onVoltar={() => setAberta(null)} />;

  return (
    <div className="flex flex-col gap-3">
      {q.error ? <ErroObras erro={q.error} /> : null}
      {!q.isLoading && !q.error && obras.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)] text-center py-6">
          Nenhuma obra vinculada a você ainda. Quando um profissional te der acesso, ela aparece aqui.
        </p>
      ) : null}
      {obras.map((o) => (
        <button key={o.obra_id} type="button" onClick={() => setAberta(o.obra_id)} className={`${cls.card} text-left`}>
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-bold text-base" style={{ fontFamily: 'var(--font-display)' }}>{o.nome}</div>
              {o.gestor_nome ? (
                <div className="text-sm text-[color:var(--color-muted)]">
                  {o.gestor_nome}{o.gestor_tag ? ` · @${o.gestor_tag}` : ''}
                </div>
              ) : null}
            </div>
            <Chip tom={o.status}>{rotuloStatusObra(o.status)}</Chip>
          </div>
          {o.endereco ? <div className="text-sm mt-2">📍 {o.endereco}</div> : null}
        </button>
      ))}
    </div>
  );
}

function ObraDoCliente({ obra, onVoltar }: { obra: ObraCliente; onVoltar: () => void }) {
  const hoje = ymdBrt();
  const ate = (() => {
    const d = new Date(`${hoje}T00:00:00`);
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();
  const equipe = useQuery({ queryKey: ['obra-equipe-cliente', obra.obra_id], queryFn: () => equipeDaObraCliente(obra.obra_id) });
  const agenda = useQuery({ queryKey: ['obra-agenda-cliente', obra.obra_id, hoje], queryFn: () => agendaDaObraCliente(obra.obra_id, hoje, ate) });
  const erro = equipe.error || agenda.error;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onVoltar} aria-label="Voltar" className="text-xl px-2" style={{ minHeight: 44, minWidth: 44 }}>
          ‹
        </button>
        <h3 className="font-extrabold text-xl flex-1 min-w-0" style={{ fontFamily: 'var(--font-display)' }}>{obra.nome}</h3>
        <Chip tom={obra.status}>{rotuloStatusObra(obra.status)}</Chip>
      </div>

      <section className={`${cls.card} flex flex-col gap-2 text-sm`}>
        {obra.gestor_nome ? <div>Responsável: <b>{obra.gestor_nome}</b>{obra.gestor_tag ? ` · @${obra.gestor_tag}` : ''}</div> : null}
        {obra.endereco ? <div>📍 {obra.endereco}</div> : null}
        <div className="text-[color:var(--color-muted)]">
          {obra.inicio ? `Início ${rotuloDia(obra.inicio).curto}` : 'Sem data de início'}
          {obra.fim ? ` · previsão de fim ${rotuloDia(obra.fim).curto}` : ''}
        </div>
        {obra.endereco ? (
          <Botao onClick={() => abrirLinkExterno(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(obra.endereco || '')}`)}>
            Como chegar
          </Botao>
        ) : null}
      </section>

      {erro ? <ErroObras erro={erro} /> : null}

      <section>
        <h4 className={cls.sec}>Quem está trabalhando na sua obra</h4>
        <div className={`${cls.card} flex flex-wrap gap-2 text-sm`}>
          {(equipe.data ?? []).length === 0 ? (
            <span className="text-[color:var(--color-muted)]">Ninguém escalado ainda.</span>
          ) : (
            (equipe.data ?? []).map((m, i) => (
              <span key={`${m.nome}-${i}`} className="rounded-full bg-[color:var(--color-cream)] px-3 py-1 font-bold">
                {m.nome}{m.funcao ? ` · ${m.funcao}` : ''}
              </span>
            ))
          )}
        </div>
      </section>

      <section>
        <h4 className={cls.sec}>Próximos 30 dias</h4>
        <div className="flex flex-col gap-2">
          {!agenda.isLoading && !erro && (agenda.data ?? []).length === 0 ? (
            <p className="text-sm text-[color:var(--color-muted)]">Nada agendado nos próximos dias.</p>
          ) : null}
          {(agenda.data ?? []).map((d, i) => (
            <div key={`${d.dia}-${i}`} className={`${cls.card} flex flex-col gap-1 text-sm`}>
              <div className="flex justify-between gap-2">
                <b>{rotuloDia(d.dia).curto}{d.dia === hoje ? ' · hoje' : ''}</b>
                <span>{d.hora_inicio ? d.hora_inicio.slice(0, 5) : ''}{d.hora_fim ? `–${d.hora_fim.slice(0, 5)}` : ''}</span>
              </div>
              {d.tarefa ? <div>{d.tarefa}</div> : null}
              {d.equipe ? <div className="text-[color:var(--color-muted)]">Com: {d.equipe}</div> : null}
              <div className="text-xs text-[color:var(--color-muted)]">
                {d.presenca === 'confirmada' ? '✓ confirmado' : d.presenca === 'faltou' ? 'não foi' : 'aguardando confirmação'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
