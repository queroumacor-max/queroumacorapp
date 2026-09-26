// Aba "Escala" do gestor: semana (seg–sáb), quem vai pra qual obra em
// cada dia, e "Enviar escala" — aviso no app pra quem tem conta e botão de
// WhatsApp pra quem não tem.
'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { showToast } from '@/lib/toast';
import { abrirLinkExterno } from '@/lib/native';
import { ymdBrt } from '@/lib/utils';
import { diasDaSemana, rotuloDia, textoEscalaWhatsApp, waDigitos } from '@/lib/obras';
import {
  desescalar,
  enviarEscala,
  escalar,
  listEquipe,
  listEscala,
  listObras,
  type EnvioEscala,
} from '@/lib/services/obras';
import { Botao, ErroObras, cls } from './ui';
import { useSingleFlight } from '@/lib/hooks/useSingleFlight';

export function EscalaTab({ uid }: { uid: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { profile } = useProfile();
  const hoje = ymdBrt();
  const [semana, setSemana] = useState(0);
  const dias = useMemo(() => diasDaSemana(hoje, semana), [hoje, semana]);
  const [dia, setDia] = useState(() => (dias.includes(hoje) ? hoje : dias[0]));
  const diaAtual = dias.includes(dia) ? dia : dias[0];
  const [envio, setEnvio] = useState<EnvioEscala | null>(null);

  const obras = useQuery({ queryKey: ['obras', uid], queryFn: () => listObras(uid), enabled: !!uid });
  const equipe = useQuery({ queryKey: ['obra-equipe', uid], queryFn: () => listEquipe(uid), enabled: !!uid });
  const escala = useQuery({
    queryKey: ['obra-escala', uid, dias[0], dias[5]],
    queryFn: () => listEscala(uid, dias[0], dias[5]),
    enabled: !!uid,
  });

  const ativas = (obras.data ?? []).filter((o) => o.status !== 'concluida');
  const ativos = (equipe.data ?? []).filter((m) => m.status === 'ativo');
  const nomeDe = new Map((equipe.data ?? []).map((m) => [m.id, m.nome]));
  const doDia = (escala.data ?? []).filter((e) => e.dia === diaAtual);

  const invalida = () => {
    qc.invalidateQueries({ queryKey: ['obra-escala', uid] });
    qc.invalidateQueries({ queryKey: ['obra-escala-da'] });
  };
  const add = useMutation({
    mutationFn: (x: { obra_id: string; equipe_id: string }) => escalar({ ...x, dia: diaAtual }),
    onSuccess: invalida,
    onError: (e) => showToast((e as Error).message, 'error'),
  });
  const rem = useMutation({ mutationFn: desescalar, onSuccess: invalida, onError: (e) => showToast((e as Error).message, 'error') });
  const enviar = useMutation({
    mutationFn: () => enviarEscala(dias[0], dias[5]),
    onSuccess: (r) => {
      setEnvio(r);
      showToast(r.app ? `Escala enviada no app pra ${r.app} pessoa(s)` : 'Escala pronta — mande pelo WhatsApp abaixo', 'success');
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });
  // Trava de clique duplo: dois toques rápidos mandavam o aviso da escala
  // duas vezes pra cada pessoa (o isPending só desabilita no render seguinte).
  const enviarFlight = useSingleFlight();

  function whatsapp(nome: string, telefone: string | null) {
    const alvo = (equipe.data ?? []).find((m) => m.nome === nome && m.telefone === telefone && !m.membro_id);
    const meus = (escala.data ?? [])
      .filter((e) => alvo && e.equipe_id === alvo.id)
      .map((e) => {
        const o = (obras.data ?? []).find((x) => x.id === e.obra_id);
        const horario = e.hora_inicio ? `${e.hora_inicio.slice(0, 5)}${e.hora_fim ? `–${e.hora_fim.slice(0, 5)}` : ''}` : null;
        return { dia: e.dia, obra: o?.nome ?? 'Obra', endereco: o?.endereco, horario, tarefa: e.tarefa };
      });
    const gestor = (profile as { name?: string | null } | null)?.name || user?.email || 'seu gestor';
    const texto = textoEscalaWhatsApp(nome, gestor, meus);
    const n = waDigitos(telefone);
    abrirLinkExterno(`https://wa.me/${n ?? ''}?text=${encodeURIComponent(texto)}`);
  }

  const erro = obras.error || equipe.error || escala.error;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setSemana((s) => s - 1)} aria-label="Semana anterior" className="text-xl px-3" style={{ minHeight: 44 }}>‹</button>
        <span className="text-sm font-bold">
          {rotuloDia(dias[0]).curto} a {rotuloDia(dias[5]).curto}
        </span>
        <button type="button" onClick={() => setSemana((s) => s + 1)} aria-label="Próxima semana" className="text-xl px-3" style={{ minHeight: 44 }}>›</button>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {dias.map((d) => {
          const on = d === diaAtual;
          const r = rotuloDia(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setDia(d)}
              className={`rounded-xl flex flex-col items-center justify-center border ${
                on ? 'bg-[color:var(--color-ink)] text-[color:var(--color-white)] border-[color:var(--color-ink)]' : 'bg-white border-[color:var(--color-border)]'
              }`}
              style={{ minHeight: 56 }}
            >
              <span className="text-xs font-bold">{r.sem}</span>
              <span className="text-base font-extrabold">{r.num}</span>
            </button>
          );
        })}
      </div>

      {erro ? <ErroObras erro={erro} /> : null}
      {!erro && ativas.length === 0 ? <p className="text-sm text-[color:var(--color-muted)]">Cadastre uma obra na aba Obras pra montar a escala.</p> : null}
      {!erro && ativas.length > 0 && ativos.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Ninguém ativo na equipe ainda. Adicione na aba Equipe.</p>
      ) : null}

      {ativas.map((o) => {
        const aqui = doDia.filter((e) => e.obra_id === o.id);
        const livres = ativos.filter((m) => !aqui.some((e) => e.equipe_id === m.id));
        return (
          <section key={o.id} className={cls.card}>
            <div className="font-bold" style={{ fontFamily: 'var(--font-display)' }}>{o.nome}</div>
            {o.endereco ? <div className="text-xs text-[color:var(--color-muted)]">{o.endereco}</div> : null}
            <div className="flex flex-wrap gap-2 mt-3">
              {aqui.map((e) => (
                <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-cream)] pl-3 text-sm font-bold">
                  {nomeDe.get(e.equipe_id) ?? '—'}
                  {e.presenca === 'confirmada' ? ' ✓' : ''}
                  <button type="button" onClick={() => rem.mutate(e.id)} aria-label={`Tirar ${nomeDe.get(e.equipe_id) ?? ''} deste dia`} className="px-2" style={{ minHeight: 36, minWidth: 36 }}>
                    ×
                  </button>
                </span>
              ))}
              {livres.length ? (
                <>
                  <label htmlFor={`esc-${o.id}`} className="sr-only">Escalar alguém em {o.nome}</label>
                  <select
                    id={`esc-${o.id}`}
                    value=""
                    onChange={(e) => e.target.value && add.mutate({ obra_id: o.id, equipe_id: e.target.value })}
                    className="rounded-full border border-dashed border-[color:var(--color-muted)] bg-white px-3 text-sm font-bold"
                    style={{ minHeight: 36 }}
                  >
                    <option value="">+ Escalar</option>
                    {livres.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </>
              ) : null}
            </div>
          </section>
        );
      })}

      {envio?.sem_conta.length ? (
        <section className={`${cls.card} flex flex-col gap-2`}>
          <h3 className={cls.sec}>Mandar pelo WhatsApp (sem conta no app)</h3>
          {envio.sem_conta.map((p) => (
            <Botao key={`${p.nome}-${p.telefone}`} onClick={() => whatsapp(p.nome, p.telefone)} disabled={!waDigitos(p.telefone)}>
              {p.nome} · {p.dias} dia(s){waDigitos(p.telefone) ? '' : ' (sem telefone)'}
            </Botao>
          ))}
        </section>
      ) : null}

      <Botao primario full onClick={() => { enviarFlight.run(() => enviar.mutateAsync()).catch(() => {}); }} disabled={enviar.isPending || ativas.length === 0}>
        {enviar.isPending ? 'Enviando…' : 'Enviar escala da semana'}
      </Botao>
    </div>
  );
}
