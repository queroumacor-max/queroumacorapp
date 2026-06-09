// ChecklistView — client component pra checklist. Carrega a linha mais
// recente do user no mount, mantém items em state local, persiste de
// forma enfileirada pra não criar linhas duplicadas em cliques rápidos
// (mesma defesa do modules/checklist.js).
'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ListSkeleton } from '@/components/Skeletons';
import {
  CHECKLIST_TEMPLATES,
  loadChecklist,
  saveChecklist,
  type ChecklistItem,
} from '@/lib/services/checklist';

export function ChecklistView() {
  const { user } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [rowId, setRowId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);

  // Fila de saves serializada — primeiro INSERT termina e fixa rowId
  // antes do próximo, evita linhas duplicadas.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    loadChecklist(user.id)
      .then((row) => {
        if (cancel) return;
        if (row) {
          setRowId(row.id);
          setItems(row.items);
        }
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  function persist(next: ChecklistItem[]) {
    if (!user) return;
    const snapshot = JSON.parse(JSON.stringify(next)) as ChecklistItem[];
    const currentRowId = rowId;
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        try {
          const id = await saveChecklist(user.id, currentRowId, snapshot);
          if (!currentRowId && id) setRowId(id);
        } catch (e) {
          console.warn('saveChecklist:', e);
        }
      })
      .catch(() => {
        /* swallow */
      });
  }

  function toggleDone(idx: number) {
    setItems((prev) => {
      const next = prev.map((it, i) =>
        i === idx ? { ...it, done: !it.done } : it,
      );
      persist(next);
      return next;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      persist(next);
      return next;
    });
  }

  function addItem() {
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    setItems((prev) => {
      const next = [...prev, { text, done: false }];
      persist(next);
      return next;
    });
  }

  function loadTemplate(type: keyof typeof CHECKLIST_TEMPLATES) {
    const tpl = CHECKLIST_TEMPLATES[type];
    if (!tpl) return;
    const next = tpl.map((text) => ({ text, done: false }));
    setItems(next);
    persist(next);
  }

  return (
    <div className="px-3.5 pt-4 pb-8">
      <h1
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          marginBottom: 14,
          color: 'var(--color-ink)',
        }}
      >
        ✅ Checklist de Obra
      </h1>

      <div style={{ marginBottom: 12 }}>
        {loading ? (
          <div aria-label="Carregando checklist" className="py-2">
            <ListSkeleton count={4} itemHeight={62} />
          </div>
        ) : items.length === 0 ? (
          <div
            className="bg-white text-center"
            style={{
              borderRadius: 14,
              padding: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,.05)',
            }}
          >
            <div className="text-3xl mb-2">📋</div>
            <div
              className="font-bold"
              style={{ fontSize: 14, color: 'var(--color-ink)' }}
            >
              Checklist vazio
            </div>
            <div
              className="mt-1"
              style={{ fontSize: 12, color: 'var(--color-muted)' }}
            >
              Adicione itens manualmente ou escolha um template abaixo.
            </div>
          </div>
        ) : (
          <div className="bg-white" style={{ borderRadius: 14, padding: '6px 14px' }}>
            {items.map((item, idx) => (
              <div
                key={`${idx}-${item.text}`}
                className="flex items-center"
                style={{
                  gap: 10,
                  padding: '10px 0',
                  borderBottom:
                    idx === items.length - 1
                      ? 'none'
                      : '1px solid var(--color-border)',
                }}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleDone(idx)}
                  style={{ width: 18, height: 18, accentColor: 'var(--color-p1)' }}
                />
                <span
                  className="flex-1"
                  style={{
                    fontSize: 13,
                    textDecoration: item.done ? 'line-through' : 'none',
                    color: item.done ? 'var(--color-muted)' : 'var(--color-ink)',
                  }}
                >
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  aria-label="Remover item"
                  style={{
                    color: 'var(--color-muted)',
                    fontSize: 18,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2" style={{ marginBottom: 16 }}>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addItem();
          }}
          placeholder="Novo item..."
          className="flex-1 bg-white"
          style={{
            padding: 12,
            borderRadius: 12,
            border: '1.5px solid var(--color-border)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={addItem}
          className="text-white font-bold"
          style={{
            padding: '10px 18px',
            background: 'var(--color-ink)',
            borderRadius: 10,
            fontSize: 18,
            cursor: 'pointer',
            border: 'none',
          }}
        >
          +
        </button>
      </div>

      <div
        style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8 }}
      >
        Templates rápidos:
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['pintura', '🎨 Pintura'],
            ['textura', '🖌️ Textura'],
            ['epoxi', '🏗️ Epóxi'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => loadTemplate(key)}
            style={{
              fontSize: 12,
              padding: '7px 12px',
              background: 'var(--color-cream)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
