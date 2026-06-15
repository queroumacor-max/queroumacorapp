// QualsSection — client component que renderiza a lista de formações +
// formulário inline pra adicionar uma nova. Espelha o output de
// `loadQualsList()` + UX de `addQualification()` em modules/quals-courses.js.
//
// Diferenças vs vanilla:
//  - sem modal: o form fica inline no topo (rota dedicada não precisa
//    sobreposição);
//  - submit usa <form onSubmit> + uncontrolled inputs com `defaultValue`
//    limpos por `e.currentTarget.reset()` (em vez do vanilla que limpa cada
//    input via getElementById);
//  - estados de loading/empty/error consistentes com NotificationsList.

'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useQualifications } from '@/lib/hooks/useQualifications';
import type { Qualification, UpdateQualInput } from '@/lib/services/formacao';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse">
      <div className="w-10 h-10 rounded-full bg-[color:var(--color-border)]" />
      <div className="flex-1">
        <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
      </div>
    </div>
  );
}

function QualRow({
  q,
  onRemove,
  onUpdate,
  removing,
  updating,
}: {
  q: Qualification;
  onRemove: (id: string) => void;
  onUpdate: (qualId: string, input: UpdateQualInput) => void;
  removing: boolean;
  updating: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(q.title || '');
  const [editOrg, setEditOrg] = useState(q.org || '');
  const [editYear, setEditYear] = useState(q.year || '');

  function startEdit() {
    setEditTitle(q.title || '');
    setEditOrg(q.org || '');
    setEditYear(q.year || '');
    setEditing(true);
  }

  function handleSave() {
    if (!editTitle.trim()) return;
    onUpdate(q.id, {
      title: editTitle,
      org: editOrg.trim() || null,
      year: editYear.trim() || null,
      icon: q.icon,
      certificate_url: q.certificate_url,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="p-3 rounded-xl bg-white border border-[color:var(--color-p1)] space-y-2">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Título *"
          className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
        />
        <input
          type="text"
          value={editOrg}
          onChange={(e) => setEditOrg(e.target.value)}
          placeholder="Instituição"
          className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
        />
        <input
          type="text"
          inputMode="numeric"
          value={editYear}
          onChange={(e) => setEditYear(e.target.value)}
          placeholder="Ano"
          className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
        />
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={updating || !editTitle.trim()}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--color-p1)' }}
          >
            {updating ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex-1 py-2 rounded-xl text-sm font-semibold border border-[color:var(--color-border)]"
          >
            Cancelar
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)]">
      {q.certificate_url ? (
        <a
          href={q.certificate_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0"
          title="Ver certificado"
        >
          <img
            src={q.certificate_url}
            alt="Certificado"
            className="w-10 h-10 rounded-lg object-cover border border-[color:var(--color-border)]"
          />
        </a>
      ) : (
        <span
          className="w-10 h-10 rounded-full bg-[color:var(--color-bg)] flex items-center justify-center text-lg flex-shrink-0"
          aria-hidden="true"
        >
          {q.icon || '🎓'}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm truncate">
          {q.title || '(sem título)'}
        </span>
        <span className="block text-xs text-[color:var(--color-muted)] truncate">
          {q.org || ''}
          {q.year ? ` · ${q.year}` : ''}
        </span>
        {q.certificate_url && (
          <a
            href={q.certificate_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold"
            style={{ color: 'var(--color-p1)' }}
          >
            Ver certificado →
          </a>
        )}
      </span>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={startEdit}
          disabled={removing || updating}
          className="text-xs font-semibold disabled:opacity-50 px-2 py-1 rounded-lg"
          style={{ color: 'var(--color-p1)', background: 'var(--color-cream)' }}
          aria-label={`Editar ${q.title || 'formação'}`}
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => onRemove(q.id)}
          disabled={removing || updating}
          className="text-xs font-semibold text-red-600 disabled:opacity-50 px-2 py-1"
          aria-label={`Remover ${q.title || 'formação'}`}
        >
          Remover
        </button>
      </div>
    </li>
  );
}

export function QualsSection() {
  const { user, loading: authLoading } = useAuth();
  const {
    qualifications,
    loading,
    error,
    add,
    update,
    remove,
    isAdding,
    isUpdating,
    isRemoving,
    addError,
  } = useQualifications();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPreview, setCertPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function handleCertChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setCertFile(f);
    setCertPreview(URL.createObjectURL(f));
  }

  function removeCert() {
    setCertFile(null);
    if (certPreview) URL.revokeObjectURL(certPreview);
    setCertPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    if (!title) { setSubmitError('Informe o título.'); return; }
    const institution = String(fd.get('institution') || '').trim();
    const year = String(fd.get('year') || '').trim();

    let certificate_url: string | null = null;
    if (certFile && user) {
      setUploading(true);
      try {
        const ext = certFile.name.split('.').pop() || 'jpg';
        const path = `certificates/${user.id}/${Date.now()}.${ext}`;
        const sb = getSupabase();
        const { error: upErr } = await sb.storage.from('posts').upload(path, certFile, {
          contentType: certFile.type || 'image/jpeg',
          upsert: false,
        });
        if (upErr) { setSubmitError('Erro ao enviar imagem: ' + upErr.message); setUploading(false); return; }
        const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
        certificate_url = urlData?.publicUrl ?? null;
      } finally {
        setUploading(false);
      }
    }

    add({ title, org: institution || null, year: year || null, certificate_url });
    form.reset();
    removeCert();
  }

  if (authLoading) {
    return (
      <section aria-labelledby="quals-heading">
        <h2 id="quals-heading" className="text-lg font-semibold mb-3">
          Formações
        </h2>
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section aria-labelledby="quals-heading">
        <h2 id="quals-heading" className="text-lg font-semibold mb-3">
          Formações
        </h2>
        <div className="text-center py-8 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)] mb-3">
            Entre pra cadastrar suas formações.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold"
          >
            Entrar
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="quals-heading">
      <h2 id="quals-heading" className="text-lg font-semibold mb-3">
        Formações
      </h2>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 mb-4 space-y-3"
      >
        <div>
          <label htmlFor="qual-title" className="block text-xs font-semibold mb-1">
            Título *
          </label>
          <input
            id="qual-title"
            name="title"
            type="text"
            required
            placeholder="Ex.: Técnico em Pintura Industrial"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="qual-institution"
            className="block text-xs font-semibold mb-1"
          >
            Instituição
          </label>
          <input
            id="qual-institution"
            name="institution"
            type="text"
            placeholder="Ex.: SENAI"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label htmlFor="qual-year" className="block text-xs font-semibold mb-1">
            Ano
          </label>
          <input
            id="qual-year"
            name="year"
            type="text"
            inputMode="numeric"
            placeholder="Ex.: 2024"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        {/* Upload de certificado (opcional) */}
        <div>
          <label className="block text-xs font-semibold mb-1">
            Foto do certificado <span className="font-normal text-[color:var(--color-muted)]">(opcional)</span>
          </label>
          {certPreview ? (
            <div className="flex items-center gap-3">
              <img
                src={certPreview}
                alt="Prévia do certificado"
                className="w-16 h-16 rounded-lg object-cover border border-[color:var(--color-border)]"
              />
              <button
                type="button"
                onClick={removeCert}
                className="text-xs text-red-500 font-semibold"
              >
                Remover
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full py-2 rounded-lg border border-dashed border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)] font-semibold"
            >
              📎 Adicionar foto do certificado
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCertChange}
          />
        </div>

        {(submitError || addError) ? (
          <p className="text-xs text-red-600">
            {submitError || addError?.message || 'Erro ao salvar.'}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isAdding || uploading}
          className="w-full py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
        >
          {uploading ? 'Enviando imagem…' : isAdding ? 'Salvando...' : 'Adicionar formação'}
        </button>
      </form>

      {loading ? (
        <div className="space-y-2" aria-label="Carregando formações">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-6 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Não foi possível carregar as formações.
          </p>
        </div>
      ) : qualifications.length === 0 ? (
        <div className="text-center py-6 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhuma formação cadastrada ainda.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {qualifications.map((q) => (
            <QualRow
              key={q.id}
              q={q}
              onRemove={remove}
              onUpdate={(qualId, input) => update({ qualId, input })}
              removing={isRemoving}
              updating={isUpdating}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
