// NotesView — client component pra /notes. Usa o hook useNotes (já
// existente) que cobre list/save/softDelete/undo.
'use client';

import { useState } from 'react';
import { useNotes } from '@/lib/hooks/useNotes';
import { useAudioRecording } from '@/lib/hooks/useAudioRecording';
import { transcribeAudio } from '@/lib/services/audioStt';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { showToast } from '@/lib/toast';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }) + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function NotesView() {
  const { notes, loading, save, update, remove, undoRemove, isSaving, isUpdating } = useNotes();
  const [draft, setDraft] = useState('');
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const policyUser = usePolicyUser();
  const isPro = canSeeProFeature(policyUser);

  function startEdit(id: string, body: string) {
    setEditingId(id);
    setEditBody(body);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditBody('');
  }
  async function saveEdit() {
    if (!editingId) return;
    const body = editBody.trim();
    if (!body) return;
    try {
      await update({ noteId: editingId, body });
      setEditingId(null);
      setEditBody('');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao atualizar', 'error');
    }
  }

  // Gravação de áudio → transcrição (vanilla notes.js iniciarGravacaoNota).
  // Pro user → gravar → /api/transcribe → texto vai no draft (append).
  const rec = useAudioRecording({
    onStop: async (blob) => {
      if (!blob) return;
      setTranscribing(true);
      showToast('Transcrevendo áudio…', 'info');
      try {
        const text = await transcribeAudio(blob);
        const trimmed = (text || '').trim();
        if (trimmed) {
          setDraft((prev) => (prev ? prev + ' ' + trimmed : trimmed));
          showToast('Transcrição pronta!', 'success');
        } else {
          showToast('Não consegui transcrever esse áudio', 'error');
        }
      } catch (e) {
        showToast((e as Error).message || 'Erro ao transcrever', 'error');
      } finally {
        setTranscribing(false);
      }
    },
  });

  function handleMicClick() {
    if (!isPro) {
      showToast('Recurso PRO — assine para liberar', 'info');
      return;
    }
    if (rec.recording) {
      rec.stop();
    } else {
      rec.start();
    }
  }

  async function handleSave() {
    const body = draft.trim();
    if (!body) return;
    try {
      await save(body);
      setDraft('');
    } catch (e) {
      console.warn('saveNote:', e);
    }
  }

  async function handleDelete(noteId: string) {
    try {
      await remove(noteId);
      setLastDeleted(noteId);
      // Auto-clear undo button após 10s.
      setTimeout(() => {
        setLastDeleted((cur) => (cur === noteId ? null : cur));
      }, 10_000);
    } catch (e) {
      console.warn('deleteNote:', e);
    }
  }

  async function handleUndo() {
    if (!lastDeleted) return;
    try {
      await undoRemove(lastDeleted);
      setLastDeleted(null);
    } catch (e) {
      console.warn('undoNote:', e);
    }
  }

  return (
    <div className="px-3.5 pt-4 pb-8">
      <h1
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          marginBottom: 6,
          color: 'var(--color-ink)',
        }}
      >
        📝 Minhas Anotações
      </h1>
      <p
        style={{
          fontSize: 12,
          color: 'var(--color-muted)',
          marginBottom: 12,
        }}
      >
        Lembretes, medidas e recados de obra — fica salvo no seu perfil.
      </p>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Escreva uma anotação..."
        rows={3}
        className="w-full bg-white"
        style={{
          padding: 12,
          borderRadius: 12,
          border: '1.5px solid var(--color-border)',
          fontSize: 14,
          resize: 'vertical',
          marginBottom: 8,
          outline: 'none',
          fontFamily: 'var(--font-body)',
        }}
      />

      {/* 🎤 Gravar áudio e transcrever (vanilla notes.js iniciarGravacaoNota).
          PRO gate. Toggle: grava ao clicar, para no próximo click → manda
          o blob pra /api/transcribe, texto vai no draft. */}
      <button
        type="button"
        onClick={handleMicClick}
        disabled={transcribing}
        className="w-full font-bold flex items-center justify-center gap-2"
        style={{
          padding: 11,
          borderRadius: 10,
          fontSize: 13,
          marginBottom: 8,
          border: rec.recording
            ? '1.5px solid var(--color-danger)'
            : '1.5px solid var(--color-border)',
          background: rec.recording ? 'rgba(230,57,70,.08)' : 'var(--color-cream)',
          color: rec.recording ? 'var(--color-danger)' : 'var(--color-ink)',
          cursor: transcribing ? 'wait' : 'pointer',
        }}
      >
        {transcribing
          ? 'Transcrevendo…'
          : rec.recording
            ? `🔴 Gravando · ${rec.elapsedSec}s · Parar`
            : '🎤 Gravar áudio e transcrever'}
        {!isPro ? (
          <span
            className="text-white font-extrabold"
            style={{
              background: 'linear-gradient(135deg, var(--color-p5), var(--color-p1))',
              fontSize: 9,
              padding: '2px 7px',
              borderRadius: 10,
              letterSpacing: '.05em',
            }}
          >
            PRO
          </span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving || !draft.trim()}
        className="w-full text-white font-bold"
        style={{
          padding: 11,
          background: 'var(--color-ink)',
          borderRadius: 10,
          fontSize: 13,
          cursor: isSaving || !draft.trim() ? 'not-allowed' : 'pointer',
          opacity: isSaving || !draft.trim() ? 0.5 : 1,
          border: 'none',
          marginBottom: 14,
        }}
      >
        {isSaving ? 'Salvando…' : 'Salvar anotação'}
      </button>

      {lastDeleted ? (
        <div
          className="flex items-center justify-between"
          style={{
            background: 'var(--color-ink)',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 10,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <span>Anotação removida</span>
          <button
            type="button"
            onClick={handleUndo}
            className="font-bold"
            style={{
              color: 'var(--color-p1)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            DESFAZER
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-center text-sm text-[color:var(--color-muted)] py-6">
          Carregando…
        </p>
      ) : notes.length === 0 ? (
        <div
          className="bg-white text-center"
          style={{
            borderRadius: 14,
            padding: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,.05)',
          }}
        >
          <div className="text-3xl mb-2">📝</div>
          <div
            className="font-bold"
            style={{ fontSize: 14, color: 'var(--color-ink)' }}
          >
            Sem anotações ainda
          </div>
          <div
            className="mt-1"
            style={{ fontSize: 12, color: 'var(--color-muted)' }}
          >
            Use o campo acima pra salvar lembretes e medidas.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => {
            const isEditing = editingId === n.id;
            return (
              <div
                key={n.id}
                className="bg-white"
                style={{
                  borderRadius: 12,
                  padding: 14,
                  boxShadow: '0 1px 4px rgba(0,0,0,.04)',
                }}
              >
                {isEditing ? (
                  <>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className="w-full bg-white"
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: '1.5px solid var(--color-border)',
                        fontSize: 14,
                        resize: 'vertical',
                        marginBottom: 8,
                        outline: 'none',
                        fontFamily: 'var(--font-body)',
                      }}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="font-bold"
                        style={{
                          color: 'var(--color-muted)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: '4px 8px',
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={isUpdating || !editBody.trim()}
                        className="font-bold text-white"
                        style={{
                          background: 'var(--color-ink)',
                          border: 'none',
                          borderRadius: 8,
                          cursor: isUpdating || !editBody.trim() ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                          padding: '6px 12px',
                          opacity: isUpdating || !editBody.trim() ? 0.5 : 1,
                        }}
                      >
                        {isUpdating ? 'Salvando…' : 'Salvar'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: 14,
                        color: 'var(--color-ink)',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5,
                        marginBottom: 8,
                      }}
                    >
                      {n.body}
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        {formatDate(n.created_at)}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(n.id, n.body)}
                          className="font-bold"
                          style={{
                            color: 'var(--color-p1)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(n.id)}
                          className="font-bold"
                          style={{
                            color: 'var(--color-danger)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          Apagar
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
