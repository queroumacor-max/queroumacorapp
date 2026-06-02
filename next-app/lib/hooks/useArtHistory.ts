// useArtHistory — armazena artes geradas pelo arte-ig em localStorage
// pra não perder se o user (a) navega/fecha aba antes de aparecer, (b)
// faz uma geração nova e quer voltar pra anterior, ou (c) bate erro 502
// no meio (a anterior bem-sucedida fica salva).
//
// Storage:
//  - localStorage key `quc:art-history:v1` (TTL implícito via cap de itens)
//  - max 12 itens (queue FIFO — descarta o mais antigo quando cheio)
//  - cada item: data URL da imagem + caption + style + aspect + createdAt
//  - tamanho típico: ~150kb por item (PNG base64 de 512x512). 12 itens
//    = ~2MB no localStorage. Aceitável até o user limpar.
//
// API espelha o pattern do useNotes/useNotifications.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtStyle, ArtAspect } from '@/lib/services/aiArt';

const STORAGE_KEY = 'quc:art-history:v1';
const MAX_ITEMS = 12;

export interface ArtHistoryItem {
  id: string;
  imageDataUrl: string;
  caption: string;
  style: ArtStyle;
  aspect: ArtAspect;
  createdAt: number;
  bizName?: string;
}

function readStore(): ArtHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ArtHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function writeStore(items: ArtHistoryItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // QuotaExceededError: limpa metade e tenta de novo.
    try {
      const trimmed = items.slice(0, Math.floor(items.length / 2));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Sem espaço — desiste silenciosamente.
    }
  }
}

export interface UseArtHistoryResult {
  items: ArtHistoryItem[];
  add: (item: Omit<ArtHistoryItem, 'id' | 'createdAt'>) => ArtHistoryItem;
  remove: (id: string) => void;
  clear: () => void;
}

export function useArtHistory(): UseArtHistoryResult {
  const [items, setItems] = useState<ArtHistoryItem[]>(() => readStore());
  // Skip first effect run — items já hidratado via useState init.
  const isMountedRef = useRef(false);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    writeStore(items);
  }, [items]);

  // Listener pra mudanças cross-tab (outra aba salva uma arte → essa atualiza)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setItems(readStore());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback(
    (input: Omit<ArtHistoryItem, 'id' | 'createdAt'>) => {
      const item: ArtHistoryItem = {
        ...input,
        id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      };
      setItems((prev) => [item, ...prev].slice(0, MAX_ITEMS));
      return item;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  return { items, add, remove, clear };
}
