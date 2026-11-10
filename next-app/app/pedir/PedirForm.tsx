'use client';

// Formulário do /pedir. A validação é a MESMA do servidor
// (lib/pedidoPintor.ts) — a tela só antecipa o erro pra pessoa não esperar a
// rede pra descobrir que faltou o telefone.

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  CIDADE_PADRAO,
  PRAZOS_PEDIDO,
  SERVICOS_PEDIDO,
  validarPedidoPintor,
} from '@/lib/pedidoPintor';

const campo =
  'w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-white)] px-3 py-3 text-base outline-none focus:border-[color:var(--color-p1)]';
const rotulo = 'block text-xs font-bold text-[color:var(--color-muted)] mb-1.5 mt-4';

function Chips({ opcoes, valor, onChange, nome }: { opcoes: readonly string[]; valor: string; onChange: (v: string) => void; nome: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={nome}>
      {opcoes.map((o) => {
        const on = o === valor;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o)}
            className={
              'rounded-full border px-3 py-2 text-sm font-semibold ' +
              (on
                ? 'bg-[color:var(--color-ink-fixed)] text-[color:var(--color-white-fixed)] border-[color:var(--color-ink-fixed)]'
                : 'bg-[color:var(--color-white)] border-[color:var(--color-border)]')
            }
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function PedirForm({ cidadeInicial, origem }: { cidadeInicial: string; origem: string }) {
  const cidadeDaUrl = cidadeInicial;

  const [servico, setServico] = useState('');
  const [descricao, setDescricao] = useState('');
  const [cidade, setCidade] = useState(cidadeDaUrl || CIDADE_PADRAO);
  const [bairro, setBairro] = useState('');
  const [prazo, setPrazo] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [site, setSite] = useState(''); // campo-isca: gente não vê
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const emVoo = useRef(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emVoo.current) return;
    const dados = { servico, descricao, cidade, bairro, prazo, nome, telefone, consentimento, origem };
    const r = validarPedidoPintor(dados);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setErro('');
    emVoo.current = true;
    setEnviando(true);
    try {
      const res = await fetch('/api/pedidos-pintor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dados, site }),
      });
      if (res.ok) {
        setEnviado(true);
        return;
      }
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(
        res.status === 429
          ? 'Muitas tentativas. Espere um minuto e envie de novo.'
          : j?.error || 'Não consegui enviar seu pedido. Tente de novo.',
      );
    } catch {
      setErro('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <section className="rounded-2xl bg-[color:var(--color-white)] border border-[color:var(--color-border)] p-5 text-center" aria-live="polite">
        <div className="text-4xl mb-2">✅</div>
        <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Pedido recebido!
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mt-2 leading-relaxed">
          A equipe da Cali Colors vai passar seu pedido a pintores de {cidade} e
          você recebe o contato pelo WhatsApp informado.
        </p>
        <Link
          href="/signup"
          className="block mt-5 rounded-xl bg-[color:var(--color-p1-button)] text-[color:var(--color-white-fixed)] font-bold py-3"
        >
          Criar conta e ver portfólios dos pintores
        </Link>
        <p className="text-xs text-[color:var(--color-muted)] mt-3">Criar conta é opcional. Seu pedido já está registrado.</p>
      </section>
    );
  }

  return (
    <form onSubmit={enviar} noValidate>
      <section className="rounded-2xl p-5 text-[color:var(--color-white-fixed)]" style={{ background: 'linear-gradient(135deg,#c2531f,#ad4924)' }}>
        <h1 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Precisa de pintor em {cidade || CIDADE_PADRAO}?
        </h1>
        <p className="text-sm mt-2 opacity-95">
          Conte o que você precisa e receba o contato de pintores avaliados da sua região. É grátis.
        </p>
      </section>

      <span className={rotulo}>Que serviço?</span>
      <Chips opcoes={SERVICOS_PEDIDO} valor={servico} onChange={setServico} nome="Tipo de serviço" />

      <label className={rotulo} htmlFor="ped-desc">Descreva o serviço</label>
      <textarea
        id="ped-desc"
        className={campo}
        rows={4}
        maxLength={1500}
        placeholder="Ex.: apartamento de 60 m², 2 quartos, sala e cozinha. Paredes com algumas fissuras."
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={rotulo} htmlFor="ped-cidade">Cidade</label>
          <input id="ped-cidade" className={campo} maxLength={80} value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </div>
        <div>
          <label className={rotulo} htmlFor="ped-bairro">Bairro</label>
          <input id="ped-bairro" className={campo} maxLength={80} value={bairro} onChange={(e) => setBairro(e.target.value)} />
        </div>
      </div>

      <span className={rotulo}>Para quando?</span>
      <Chips opcoes={PRAZOS_PEDIDO} valor={prazo} onChange={setPrazo} nome="Prazo" />

      <label className={rotulo} htmlFor="ped-nome">Seu nome</label>
      <input id="ped-nome" className={campo} maxLength={80} autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />

      <label className={rotulo} htmlFor="ped-fone">WhatsApp com DDD</label>
      <input
        id="ped-fone"
        className={campo}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        placeholder="(11) 91234-5678"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
      />

      {/* Campo-isca: fora da tela e fora do Tab. Robô preenche; gente não. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Site
          <input tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} />
        </label>
      </div>

      <label className="flex items-start gap-3 mt-5 text-sm leading-snug">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={consentimento}
          onChange={(e) => setConsentimento(e.target.checked)}
        />
        <span>
          Autorizo a Cali Colors a passar meu nome, telefone e este pedido a pintores parceiros,
          só para este orçamento. Veja a{' '}
          <Link href="/info/privacidade" className="underline text-[color:var(--color-p1-text)]">
            Política de Privacidade
          </Link>
          .
        </span>
      </label>

      {erro && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full mt-5 rounded-xl bg-[color:var(--color-p1-button)] text-[color:var(--color-white-fixed)] font-bold py-3.5 text-base disabled:opacity-60"
      >
        {enviando ? 'Enviando…' : 'Pedir orçamento'}
      </button>
      <p className="text-xs text-[color:var(--color-muted)] text-center mt-3">
        Seu contato não aparece em lugar público. Só a equipe da loja e o pintor indicado veem.
      </p>
    </form>
  );
}
