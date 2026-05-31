// useAutosave — persiste rascunho de form em localStorage, com restore no
// mount, write throttled, TTL e quota. Funciona tanto com react-hook-form
// (passando os snapshots via `watch()` no parent) quanto com `useState`
// puro: o hook não acopla a nenhum lib — recebe `values` e um `restore()`
// callback. Quem usa o hook é responsável por aplicar os valores no form.
//
// Por que não consumir `useFormContext` diretamente? Os forms grandes do
// app (Composer.tsx) usam `useState` puro, não RHF, então um hook acoplado
// a `useFormContext` excluiria o Composer. O design abaixo cobre os dois
// casos de uso pelo mesmo helper.
//
// Constraints implementadas:
//   - TTL 7 dias: drafts com `savedAt` > 7d são descartados no restore.
//   - Quota 50KB: stringificação maior que esse limite é silenciosamente
//     descartada (em vez de estourar QuotaExceededError do localStorage e
//     quebrar o write).
//   - Throttle: por padrão 1 escrita a cada `intervalMs` (default 5s),
//     evitando spam de IO em forms com input rápido.
//   - Filtro de campos sensíveis: por convenção a chave do values nunca
//     deve conter senha/arquivo. O caller passa apenas o que é seguro
//     persistir; o hook em si não inspeciona os valores.

'use client';

import { useCallback, useEffect, useRef } from 'react';

const STORAGE_PREFIX = 'autosave_';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const QUOTA_BYTES = 50 * 1024; // 50KB
const DEFAULT_INTERVAL_MS = 5000;

interface Envelope<T> {
  v: 1;
  savedAt: number;
  values: T;
}

export interface UseAutosaveOptions<T> {
  /** Chave única do form (ex.: 'profile_edit', 'post_composer', `quote_${id}`). */
  key: string;
  /** Snapshot atual dos valores a salvar. */
  values: T;
  /** Callback invocado no mount com o draft restaurado (se houver). */
  onRestore?: (restored: T) => void;
  /** Intervalo mínimo entre escritas (ms). Default 5000. */
  intervalMs?: number;
  /** TTL do draft em ms. Default 7 dias. */
  ttlMs?: number;
  /** Quando false, suspende save (ex.: enquanto submitting). */
  enabled?: boolean;
}

export interface UseAutosaveResult {
  /** Apaga o draft (chamar após submit success). */
  clear: () => void;
  /** Última timestamp de save (epoch ms). 0 se ainda não salvou. */
  lastSavedAt: number;
}

function storageKey(key: string): string {
  return STORAGE_PREFIX + key;
}

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Lê o draft persistido para `key`, validando TTL. Retorna `null` se
 * inexistente, expirado ou corrompido.
 */
export function readDraft<T = unknown>(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): T | null {
  if (!hasStorage()) return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null;
    const age = Date.now() - (parsed.savedAt ?? 0);
    if (age > ttlMs) {
      try {
        localStorage.removeItem(storageKey(key));
      } catch {
        // ignore
      }
      return null;
    }
    return parsed.values ?? null;
  } catch {
    return null;
  }
}

/**
 * Apaga o draft persistido. Idempotente.
 */
export function clearDraft(key: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // ignore — quota/disabled storage não deve quebrar fluxo
  }
}

/**
 * Persiste um snapshot agora (ignorando throttle). Retorna `true` se
 * escreveu, `false` se quota excedida ou storage indisponível.
 */
export function writeDraft<T>(key: string, values: T): boolean {
  if (!hasStorage()) return false;
  const envelope: Envelope<T> = {
    v: 1,
    savedAt: Date.now(),
    values,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return false;
  }
  if (serialized.length > QUOTA_BYTES) return false;
  try {
    localStorage.setItem(storageKey(key), serialized);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hook principal. Carrega draft no mount (uma vez), persiste `values` a
 * cada mudança throttled, e expõe `clear()` para limpar pós-submit.
 *
 * O hook NÃO controla o form — quem chama precisa aplicar `restored` aos
 * inputs (via `reset()` do RHF ou `setState` etc.). Isso mantém o hook
 * agnóstico de lib de forms.
 */
export function useAutosave<T>({
  key,
  values,
  onRestore,
  intervalMs = DEFAULT_INTERVAL_MS,
  ttlMs = DEFAULT_TTL_MS,
  enabled = true,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const lastSavedRef = useRef(0);
  const restoredRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // Restore no mount — só uma vez por key.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const restored = readDraft<T>(key, ttlMs);
    if (restored !== null && onRestoreRef.current) {
      onRestoreRef.current(restored);
    }
    // intencionalmente sem deps voláteis — restore é one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist sempre que `values` muda, respeitando throttle.
  useEffect(() => {
    if (!enabled) return;
    if (!restoredRef.current) return; // ainda não restaurou — evita sobrescrever
    const now = Date.now();
    if (now - lastSavedRef.current < intervalMs) return;
    const ok = writeDraft(key, values);
    if (ok) lastSavedRef.current = now;
  }, [key, values, intervalMs, enabled]);

  const clear = useCallback(() => {
    clearDraft(key);
    lastSavedRef.current = 0;
  }, [key]);

  return {
    clear,
    get lastSavedAt() {
      return lastSavedRef.current;
    },
  };
}
