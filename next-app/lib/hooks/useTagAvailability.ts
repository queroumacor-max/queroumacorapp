'use client';
// useTagAvailability — debounced check da disponibilidade de @tag durante
// digitação. Espelha o `checkTagAvailability` debounced de signup-tag.js
// vanilla (que disparava no `onblur`) — aqui usamos debounce real pra dar
// feedback enquanto o usuário ainda digita, com cancelamento pra requests
// stale (o cleanup do useEffect garante que mudanças rápidas só vão pra
// rede uma vez).
//
// Estados:
//  - 'idle':      input vazio ou ainda não checado;
//  - 'invalid':   tag muito curta ou caracteres ilegais (não vai pra rede);
//  - 'checking':  request em voo;
//  - 'available': livre;
//  - 'taken':     já em uso.
import { useEffect, useState } from 'react';
import { checkTagAvailability } from '@/lib/services/signup';

export type TagStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function useTagAvailability(tag: string, debounceMs = 400): TagStatus {
  const [status, setStatus] = useState<TagStatus>('idle');

  useEffect(() => {
    const trimmed = tag.trim();
    if (!trimmed) {
      setStatus('idle');
      return;
    }
    if (trimmed.length < 3) {
      setStatus('invalid');
      return;
    }
    if (!/^[a-z0-9_]+$/i.test(trimmed)) {
      setStatus('invalid');
      return;
    }

    setStatus('checking');
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const available = await checkTagAvailability(trimmed.toLowerCase());
        if (!cancelled) setStatus(available ? 'available' : 'taken');
      } catch {
        if (!cancelled) setStatus('idle');
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [tag, debounceMs]);

  return status;
}
