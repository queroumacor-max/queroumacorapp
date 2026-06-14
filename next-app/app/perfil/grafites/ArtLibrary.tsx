// ArtLibrary — biblioteca de artes do user. Grid de thumbnails + upload
// + apagar. Sprint 2 vai conectar com WallARView (clique numa arte abre
// AR overlay).

'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { useArtReferences } from '@/lib/hooks/useArtReferences';
import { readImageDimensions, type ArtReference } from '@/lib/services/artReferences';
import { showToast } from '@/lib/toast';
import { cfImg } from '@/lib/cfImg';
import { ArtAROverlay } from './ArtAROverlay';
import { ArtArWebXR } from './ArtArWebXR';
import { useWebXrSupport } from '@/lib/hooks/useWebXrSupport';

const BRL = new Intl.NumberFormat('pt-BR');

export function ArtLibrary() {
  const { user } = useAuth();
  const dialog = useDialog();
  const {
    items,
    loading,
    error,
    upload,
    isUploading,
    remove,
    isDeleting,
  } = useArtReferences();

  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [arRef, setArRef] = useState<ArtReference | null>(null);
  // AR world-locked (WebXR) — só Android/ARCore. iOS/desktop usa o 2D.
  const [arXrRef, setArXrRef] = useState<ArtReference | null>(null);
  const xrSupported = useWebXrSupport() === 'supported';
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">
          Faça login pra gerenciar sua biblioteca.
        </p>
      </div>
    );
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dims = await readImageDimensions(file);
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      await upload({
        file,
        title: title.trim() || null,
        tags,
        dimensions: dims,
      });
      setTitle('');
      setTagsInput('');
      showToast('Arte salva!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha no upload', 'error');
    }
  }

  async function handleDelete(ref: ArtReference) {
    const ok = await dialog.confirm(
      `Apagar "${ref.title || 'arte'}"? Não dá pra desfazer.`,
      { title: 'Confirmar', okLabel: 'Apagar' },
    );
    if (!ok) return;
    try {
      await remove(ref);
      showToast('Arte removida.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao apagar.', 'error');
    }
  }

  return (
    <>
      {/* Form de upload */}
      <div className="bg-white border border-[color:var(--color-border)] rounded-xl p-4 mb-6">
        <h2 className="text-base font-bold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
          Adicionar nova arte
        </h2>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título (ex.: Tigre azul)"
          aria-label="Título"
          className="w-full px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg mb-2 bg-[color:var(--color-white)] text-[color:var(--color-ink)]"
        />
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Tags separadas por vírgula (animal, urbano)"
          aria-label="Tags"
          className="w-full px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg mb-3 bg-[color:var(--color-white)] text-[color:var(--color-ink)]"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          className="w-full px-4 py-2.5 text-sm font-semibold bg-[color:var(--color-p1)] text-white rounded-lg disabled:opacity-60"
        >
          {isUploading ? 'Enviando…' : 'Selecionar imagem (JPG/PNG/WebP, até 20MB)'}
        </button>
        <p className="text-xs text-[color:var(--color-muted)] mt-2">
          PNG com fundo transparente fica melhor pro overlay AR.
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-sm text-[color:var(--color-muted)]">Carregando…</div>
      ) : error ? (
        <div className="text-sm text-red-600">Erro: {error.message}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-5xl mb-2" aria-hidden="true">🎨</div>
          <p className="text-sm text-[color:var(--color-muted)]">
            Sem artes ainda. Suba a primeira acima.
          </p>
        </div>
      ) : (
        <>
          <div className="text-xs text-[color:var(--color-muted)] mb-2">
            {BRL.format(items.length)} {items.length === 1 ? 'arte' : 'artes'}
          </div>
          <ul className="grid grid-cols-2 gap-3">
            {items.map((ref) => (
              <li key={ref.id}>
                <ArtCard
                  ref_={ref}
                  onDelete={() => handleDelete(ref)}
                  onProject={() => setArRef(ref)}
                  onProjectXr={xrSupported ? () => setArXrRef(ref) : undefined}
                  disabled={isDeleting}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {arRef ? (
        <ArtAROverlay
          open={!!arRef}
          imageUrl={arRef.image_url}
          title={arRef.title}
          onClose={() => setArRef(null)}
        />
      ) : null}

      {arXrRef ? (
        <ArtArWebXR
          open={!!arXrRef}
          imageUrl={arXrRef.image_url}
          title={arXrRef.title}
          onClose={() => setArXrRef(null)}
        />
      ) : null}
    </>
  );
}

function ArtCard({
  ref_,
  onDelete,
  onProject,
  onProjectXr,
  disabled,
}: {
  ref_: ArtReference;
  onDelete: () => void;
  onProject: () => void;
  /** Só definido quando o device suporta WebXR AR (Android/ARCore). */
  onProjectXr?: () => void;
  disabled: boolean;
}) {
  return (
    <article className="bg-white border border-[color:var(--color-border)] rounded-xl overflow-hidden">
      <div
        className="aspect-square bg-[color:var(--color-border)] relative"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cfImg(ref_.image_url, { width: 320, fit: 'cover' })}
          alt={ref_.title ?? 'Arte sem título'}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== ref_.image_url) img.src = ref_.image_url;
          }}
        />
      </div>
      <div className="p-2.5">
        <div className="text-xs font-semibold text-[color:var(--color-ink)] truncate">
          {ref_.title || <span className="text-[color:var(--color-muted)]">Sem título</span>}
        </div>
        {ref_.tags.length > 0 ? (
          <div className="text-[10px] text-[color:var(--color-muted)] mt-0.5 truncate">
            {ref_.tags.map((t) => '#' + t).join(' ')}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onProject}
          disabled={disabled}
          className="mt-2 w-full px-2 py-1.5 text-[11px] font-bold bg-[color:var(--color-p1)] text-white rounded disabled:opacity-60"
        >
          🪄 Projetar na parede
        </button>
        {onProjectXr ? (
          <button
            type="button"
            onClick={onProjectXr}
            disabled={disabled}
            className="mt-1 w-full px-2 py-1.5 text-[11px] font-bold rounded disabled:opacity-60"
            style={{ background: 'var(--color-ink)', color: '#fff' }}
          >
            📌 Fixar na parede (AR)
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="mt-1 w-full px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 rounded disabled:opacity-60"
        >
          Apagar
        </button>
      </div>
    </article>
  );
}
