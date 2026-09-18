// ComboBox — campo que ACEITA DIGITAR e mostra a lista filtrada pra clicar.
//
// Existe porque `<select>` no celular abre a roleta do sistema: pra achar
// "Rio Grande do Sul" entre 27 estados, ou a sua cidade entre as 645 de São
// Paulo, a pessoa rola. Digitar três letras resolve — e continua dando pra
// escolher no toque, que é o pedido original ("opção de digitar para
// aparecer o que quer e clicar também").
//
// NÃO é um `<datalist>`: o suporte dele no Safari do iPhone é irregular, e o
// app roda dentro de WebView. Aqui a lista é nossa, então funciona igual nos
// dois sistemas e herda o tema do app.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface ComboOption {
  value: string;
  label: string;
}

interface Props {
  id: string;
  /** Valor selecionado (o `value` da opção), ou '' quando nada escolhido. */
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Texto quando a busca não casa com nada. */
  emptyMessage?: string;
  /**
   * Aceita texto que não está na lista. Usado na cidade: se o IBGE não
   * responder, bloquear o cadastro seria pior que aceitar um nome digitado.
   */
  allowFree?: boolean;
  className?: string;
  'aria-invalid'?: 'true' | 'false';
}

/** Sem acento e sem caixa — "sao paulo" tem que achar "São Paulo". */
function chave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function ComboBox({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  loading,
  emptyMessage = 'Nada encontrado',
  allowFree = false,
  className = '',
  'aria-invalid': ariaInvalid,
}: Props) {
  const selecionada = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );
  // O que está escrito. Enquanto fechado, espelha o rótulo do selecionado.
  const [texto, setTexto] = useState(selecionada?.label ?? (allowFree ? value : ''));
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const raiz = useRef<HTMLDivElement | null>(null);

  // Valor mudou por fora (ex.: trocar o estado limpa a cidade). Ajuste
  // DURANTE o render (idiom oficial) — puramente derivado, sem trabalho
  // assíncrono/DOM. Só sincroniza fechado: aberto, a pessoa está digitando.
  const rotuloDerivado = selecionada?.label ?? (allowFree ? value : '');
  const [rotuloVisto, setRotuloVisto] = useState({ rotulo: rotuloDerivado, aberto });
  if (rotuloDerivado !== rotuloVisto.rotulo || aberto !== rotuloVisto.aberto) {
    setRotuloVisto({ rotulo: rotuloDerivado, aberto });
    if (!aberto) setTexto(rotuloDerivado);
  }

  // Clique fora fecha e devolve o texto pro que está de fato selecionado —
  // senão a tela mostraria uma cidade que o formulário não guardou.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) {
        setAberto(false);
        if (!allowFree) setTexto(selecionada?.label ?? '');
      }
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto, selecionada, allowFree]);

  const filtradas = useMemo(() => {
    const q = chave(texto);
    // Com o item já escolhido e o texto igual ao rótulo, mostra tudo — senão
    // reabrir o campo exibiria uma lista de um item só.
    if (!q || q === chave(selecionada?.label ?? '')) return options;
    return options.filter((o) => chave(o.label).includes(q));
  }, [texto, options, selecionada]);

  function escolher(op: ComboOption) {
    onChange(op.value);
    setTexto(op.label);
    setAberto(false);
  }

  return (
    <div ref={raiz} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={loading ? 'Carregando…' : placeholder}
        value={texto}
        aria-invalid={ariaInvalid}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
          setDestaque(0);
          // Digitar desfaz a seleção: o formulário nunca fica com um valor
          // que não é o que está escrito na tela.
          if (allowFree) onChange(e.target.value);
          else if (value) onChange('');
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAberto(true);
            setDestaque((d) => Math.min(d + 1, filtradas.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setDestaque((d) => Math.max(d - 1, 0));
          } else if (e.key === 'Enter' && aberto && filtradas[destaque]) {
            e.preventDefault();
            escolher(filtradas[destaque]);
          } else if (e.key === 'Escape') {
            setAberto(false);
          }
        }}
        className={className}
      />

      {aberto && !disabled && (
        <ul
          id={`${id}-lista`}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl shadow-lg"
          style={{
            background: 'var(--color-white)',
            border: '1px solid var(--color-border)',
          }}
        >
          {loading && (
            <li className="px-3 py-2 text-sm" style={{ color: 'var(--color-muted)' }}>
              Carregando…
            </li>
          )}
          {!loading && filtradas.length === 0 && (
            <li className="px-3 py-2 text-sm" style={{ color: 'var(--color-muted)' }}>
              {emptyMessage}
            </li>
          )}
          {!loading &&
            filtradas.map((op, i) => (
              <li key={op.value} role="option" aria-selected={op.value === value}>
                <button
                  type="button"
                  // `onMouseDown` e não `onClick`: o blur do input dispara
                  // antes do clique e fecharia a lista debaixo do dedo.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    escolher(op);
                  }}
                  onMouseEnter={() => setDestaque(i)}
                  className="w-full text-left px-3 py-2 text-sm"
                  style={{
                    background:
                      i === destaque ? 'var(--color-cream)' : 'transparent',
                    color: 'var(--color-ink)',
                    fontWeight: op.value === value ? 700 : 400,
                  }}
                >
                  {op.label}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
