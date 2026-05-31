// useUndoable — hook helper que padroniza o fluxo "delete → snackbar com
// undo → hard timeout". Cobre:
//   1. Pending state pro botão Desabilitar enquanto deleta.
//   2. Snackbar state (message + undoToken vivos enquanto o usuário pode
//      desfazer).
//   3. Callback `undo` que limpa a snackbar e chama o reverter passado pelo
//      caller.
//   4. Auto-dismiss após `durationMs` (default 10s).
//
// O caller passa duas funções: `doDelete` (faz o soft delete e retorna
// undoToken) e `doUndo` (recebe undoToken, reverte). O hook segura o ciclo
// e expõe `delete(args)`, `undo()`, `snackbar` (message + props pra passar
// no <UndoSnackbar>), `isDeleting`, `error`.
//
// NÃO depende de TanStack — fica leve pra usar em pages que ainda não
// têm queryClient configurado, e callers que precisam de TanStack
// combinam manualmente (ex.: useDeletePost passa doDelete = mutation.mutateAsync).
//
// Padrão de uso:
//   const { remove, snackbar, undo } = useUndoable<string>({
//     deleteFn: (postId) => softDeletePost(userId, postId),
//     undoFn: (token) => undoDeletePost(userId, token),
//     buildMessage: () => 'Post removido.',
//   });
//   <UndoSnackbar message={snackbar.message} onUndo={undo} ... />

'use client';

import { useCallback, useRef, useState } from 'react';
import type { SoftDeleteResult } from '@/lib/services/postInteractions';

export interface UseUndoableOptions<TArgs> {
  /** Faz o soft delete; recebe os args passados em `remove`. Retorna undoToken. */
  deleteFn: (args: TArgs) => Promise<SoftDeleteResult>;
  /** Reverte; recebe o undoToken capturado no deleteFn. */
  undoFn: (undoToken: string) => Promise<void>;
  /** Mensagem mostrada na snackbar. Recebe os args originais. Default fixa. */
  buildMessage?: (args: TArgs) => string;
  /** Duração da snackbar em ms. Default 10000 (10s). */
  durationMs?: number;
  /** Callback opcional após soft delete bem-sucedido. */
  onDeleted?: (args: TArgs, undoToken: string) => void;
  /** Callback opcional após undo bem-sucedido. */
  onUndone?: (undoToken: string) => void;
}

export interface UndoSnackbarState {
  message: string | null;
  /** Token bruto (caller raramente precisa, mas exposto pra debug). */
  undoToken: string | null;
}

export interface UseUndoableResult<TArgs> {
  /** Dispara o soft delete + abre snackbar. */
  remove: (args: TArgs) => Promise<void>;
  /** Reverte o último delete (no-op se snackbar não está visível). */
  undo: () => Promise<void>;
  /** Estado da snackbar — passar pro <UndoSnackbar>. */
  snackbar: UndoSnackbarState;
  /** Limpa a snackbar (caller passa pra onDismiss da UndoSnackbar). */
  dismiss: () => void;
  /** True enquanto o soft delete está em andamento (botão disabled). */
  isDeleting: boolean;
  /** True enquanto a chamada undoFn está em andamento. */
  isUndoing: boolean;
  /** Erro do soft delete OU do undo (limpa quando começa nova operação). */
  error: Error | null;
  durationMs: number;
}

export function useUndoable<TArgs>(
  options: UseUndoableOptions<TArgs>,
): UseUndoableResult<TArgs> {
  const {
    deleteFn,
    undoFn,
    buildMessage,
    durationMs = 10000,
    onDeleted,
    onUndone,
  } = options;

  const [snackbar, setSnackbar] = useState<UndoSnackbarState>({
    message: null,
    undoToken: null,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Guarda o token corrente em ref pra undo() acessar sem depender de
  // closure stale (caso o caller chame undo dentro de um setState).
  const tokenRef = useRef<string | null>(null);

  const remove = useCallback(
    async (args: TArgs) => {
      setError(null);
      setIsDeleting(true);
      try {
        const result = await deleteFn(args);
        tokenRef.current = result.undoToken;
        setSnackbar({
          message: buildMessage ? buildMessage(args) : 'Item removido.',
          undoToken: result.undoToken,
        });
        onDeleted?.(args, result.undoToken);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsDeleting(false);
      }
    },
    [deleteFn, buildMessage, onDeleted],
  );

  const dismiss = useCallback(() => {
    tokenRef.current = null;
    setSnackbar({ message: null, undoToken: null });
  }, []);

  const undo = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setError(null);
    setIsUndoing(true);
    try {
      await undoFn(token);
      onUndone?.(token);
      // Limpa apenas no sucesso — em caso de erro deixa a snackbar pra
      // mostrar a falha ou o caller pode tentar de novo.
      tokenRef.current = null;
      setSnackbar({ message: null, undoToken: null });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsUndoing(false);
    }
  }, [undoFn, onUndone]);

  return {
    remove,
    undo,
    snackbar,
    dismiss,
    isDeleting,
    isUndoing,
    error,
    durationMs,
  };
}
