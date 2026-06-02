'use client';
// Dialog system in-app — substitui window.confirm/alert/prompt nativos do
// browser (que mostram "queroumacor.com.br says..."). API estilo Promise:
//   const ok = await dialog.confirm('Apagar post?')
//   const text = await dialog.prompt('Nome do cliente:', 'João')
//   await dialog.alert('Erro: foto muito grande')
//
// Padrões:
//  - <DialogProvider /> no layout monta um único container; cada chamada
//    abre um modal (não enfileira — chamadas concorrentes substituem).
//  - useDialog() devolve { confirm, prompt, alert }. Tipagem garante
//    refactor seguro.
//  - Esc fecha = false/null. Click no backdrop fecha = mesma coisa.
//  - Visual: cream + ink, mesmo design language do BottomSheet — não
//    parece dialog de browser.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type DialogKind = 'confirm' | 'alert' | 'prompt';

interface DialogState {
  kind: DialogKind;
  title?: string;
  message: string;
  defaultValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** resolve do Promise — string pra prompt, boolean pra confirm, void pra alert. */
  resolve: (v: unknown) => void;
}

interface ConfirmOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface AlertOptions {
  title?: string;
  okLabel?: string;
}

interface PromptOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
}

interface DialogApi {
  confirm: (message: string, opts?: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, opts?: AlertOptions) => Promise<void>;
  prompt: (message: string, defaultValue?: string, opts?: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    // Fallback gracioso pra contextos onde o Provider não rodou (SSR/tests):
    // chama window.* (não ideal mas evita crash).
    return {
      confirm: async (m) =>
        typeof window !== 'undefined' ? window.confirm(m) : false,
      alert: async (m) => {
        if (typeof window !== 'undefined') window.alert(m);
      },
      prompt: async (m, d) =>
        typeof window !== 'undefined' ? window.prompt(m, d ?? '') : null,
    };
  }
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const open = useCallback(
    (next: DialogState, initialValue = '') => {
      setValue(initialValue);
      setState(next);
    },
    [],
  );

  const close = useCallback(
    (result: unknown) => {
      const cur = state;
      setState(null);
      setValue('');
      if (cur) cur.resolve(result);
    },
    [state],
  );

  // Autofocus do input quando prompt abre.
  useEffect(() => {
    if (state?.kind === 'prompt') {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [state]);

  // ESC fecha sempre = cancelar (false/null/void).
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(state?.kind === 'alert' ? undefined : state?.kind === 'confirm' ? false : null);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, close]);

  const api: DialogApi = {
    confirm: useCallback(
      (message, opts) =>
        new Promise<boolean>((resolve) => {
          open({
            kind: 'confirm',
            message,
            title: opts?.title,
            okLabel: opts?.okLabel,
            cancelLabel: opts?.cancelLabel,
            danger: opts?.danger,
            resolve: (v) => resolve(v as boolean),
          });
        }),
      [open],
    ),
    alert: useCallback(
      (message, opts) =>
        new Promise<void>((resolve) => {
          open({
            kind: 'alert',
            message,
            title: opts?.title,
            okLabel: opts?.okLabel,
            resolve: () => resolve(),
          });
        }),
      [open],
    ),
    prompt: useCallback(
      (message, defaultValue, opts) =>
        new Promise<string | null>((resolve) => {
          open(
            {
              kind: 'prompt',
              message,
              title: opts?.title,
              okLabel: opts?.okLabel,
              cancelLabel: opts?.cancelLabel,
              defaultValue: defaultValue ?? '',
              resolve: (v) => resolve(v as string | null),
            },
            defaultValue ?? '',
          );
        }),
      [open],
    ),
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {state ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quc-dialog-title"
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,.55)', padding: 12 }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            close(state.kind === 'alert' ? undefined : state.kind === 'confirm' ? false : null);
          }}
        >
          <div
            className="bg-white shadow-xl"
            style={{
              width: '100%',
              maxWidth: 380,
              borderRadius: 16,
              padding: 20,
              fontFamily: 'var(--font-body)',
            }}
          >
            {state.title ? (
              <h3
                id="quc-dialog-title"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 17,
                  fontWeight: 800,
                  color: 'var(--color-ink)',
                  marginBottom: 6,
                }}
              >
                {state.title}
              </h3>
            ) : null}
            <p
              style={{
                fontSize: 14,
                color: 'var(--color-ink)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                marginBottom: state.kind === 'prompt' ? 12 : 18,
              }}
            >
              {state.message}
            </p>

            {state.kind === 'prompt' ? (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    close(value);
                  }
                }}
                className="w-full"
                style={{
                  padding: '10px 12px',
                  fontSize: 14,
                  border: '1.5px solid var(--color-border)',
                  borderRadius: 10,
                  outline: 'none',
                  marginBottom: 18,
                  background: 'var(--color-bg)',
                }}
              />
            ) : null}

            <div className="flex gap-2 justify-end">
              {state.kind !== 'alert' ? (
                <button
                  type="button"
                  onClick={() => close(state.kind === 'confirm' ? false : null)}
                  className="font-bold"
                  style={{
                    padding: '10px 16px',
                    borderRadius: 10,
                    fontSize: 13,
                    background: '#fff',
                    color: 'var(--color-ink)',
                    border: '1.5px solid var(--color-border)',
                    cursor: 'pointer',
                  }}
                >
                  {state.cancelLabel ?? 'Cancelar'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  close(
                    state.kind === 'alert'
                      ? undefined
                      : state.kind === 'confirm'
                        ? true
                        : value,
                  )
                }
                className="font-bold text-white"
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  fontSize: 13,
                  background: state.danger
                    ? 'var(--color-danger, #e63946)'
                    : 'var(--color-ink)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {state.okLabel ?? (state.kind === 'alert' ? 'OK' : 'Confirmar')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}
