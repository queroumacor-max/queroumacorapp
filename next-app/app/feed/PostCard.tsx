// PostCard — renderiza um post individual do feed.
// Espelha EXATO o `buildFeedPostHTML` do vanilla (modules/feed.js linha
// 400+) e o CSS `.mpost*` (styles.css linha 95+):
//   - card branco com border-radius 18px + shadow + margin entre cards;
//   - header com `.av-ring` (gradient conic) envolvendo `.av-inner`
//     (branco) com avatar dentro;
//   - 5 botões de ação (Curtir / Comentar / Compartilhar / Orçar /
//     Salvar). Orçar SÓ aparece se o post NÃO é do user atual. Cada botão
//     com ícone EM CIMA e label EMBAIXO (flex-direction: column);
//   - linha "N curtidas" (oculta se 0);
//   - legenda (caption) com nome em bold;
//   - lista de comentários carregados;
//   - timestamp em uppercase ("AGORA", "HÁ 2 MIN").
//
// Botões Curtir/Salvar usam `useLike`/`useSavedPosts` pra estado real;
// Compartilhar usa Web Share API com fallback pra clipboard; Orçar abre
// chat com o autor pra pedir orçamento.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { CommentForm } from '@/components/CommentForm';
import { useAuth } from '@/components/AuthProvider';
import { useLike, useSavedPosts, useComments } from '@/lib/hooks/usePostInteractions';
import { showToast } from '@/lib/toast';
import { BottomSheet } from '@/components/BottomSheet';
import { OrcamentoSheet } from '@/components/OrcamentoSheet';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { getTimeAgo } from '@/lib/utils';
import { PostMedia } from './PostMedia';
import type { FeedPost } from '@/lib/services/feed';

export interface PostCardProps {
  post: FeedPost;
  muted: boolean;
  onToggleMute: () => void;
}

const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function displayName(profile: FeedPost['profile']): string {
  let name = profile.name || (profile.tag ? '@' + profile.tag : 'Usuário');
  if (name.includes('@') && !profile.tag) {
    name = name.split('@')[0] || 'Usuário';
  }
  return name;
}

export function PostCard({ post, muted, onToggleMute }: PostCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const name = displayName(post.profile);
  const handle = post.profile.tag ? '@' + post.profile.tag : '';
  const timeAgo = getTimeAgo(post.created_at);

  const { liked, count: likeCount, toggle: toggleLike } = useLike(post.id);
  const { isSaved, toggle: toggleSave } = useSavedPosts();
  const saved = isSaved(post.id);
  const [showComment, setShowComment] = useState(false);
  // Comments via hook — assina o cache ['post-comments', id] que a
  // CommentForm invalida após insert. `post.comments` (do feed) é só
  // o initialData pra evitar flash de "carregando" no primeiro paint;
  // hook substitui assim que tem dados frescos.
  const { comments: freshComments, remove: removeComment, isRemoving: isRemovingComment } = useComments(post.id);
  const visibleComments =
    freshComments && freshComments.length > 0 ? freshComments : post.comments;

  const isOwn = !!user && user.id === post.user_id;

  const [optsOpen, setOptsOpen] = useState(false);

  async function handleShare() {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/?post=${post.id}`
        : '';
    if (!url) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url, text: post.caption ?? '' });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copiado!', 'success');
      } catch {
        showToast('Erro ao copiar', 'error');
      }
    }
  }

  async function handleCopyLink() {
    if (typeof navigator === 'undefined') return;
    const url = `${window.location.origin}/?post=${post.id}`;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copiado!', 'success');
      } catch {
        showToast('Erro ao copiar', 'error');
      }
    }
    setOptsOpen(false);
  }

  // Denunciar: abre sub-modal com 4 motivos (vanilla #report-reason-modal).
  // submitReport faz INSERT real em `reports` table (Wave 4 SQL ja' criou
  // a tabela com RLS). Antes era só showToast fake — nada chegava no
  // banco e admin não tinha como ver denúncias.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  function handleOpenReport() {
    setOptsOpen(false);
    setReportOpen(true);
  }

  async function submitReport(reason: string) {
    if (reportSubmitting) return;
    if (!user) {
      showToast('Faça login para denunciar', 'info');
      return;
    }
    setReportSubmitting(true);
    setReportOpen(false);
    try {
      const sb = getSupabase();
      // Cast: reports table não está nos types gerados; vanilla insere
      // diretamente com os mesmos 4 campos.
      const sbAny = sb as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      };
      const r = await sbAny.from('reports').insert({
        reporter_id: user.id,
        post_id: post.id,
        target_user_id: post.user_id,
        reason,
      });
      if (r.error) throw new Error('Erro ao enviar denúncia');
      showToast('Denúncia enviada — nossa equipe vai analisar', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao enviar denúncia', 'error');
    } finally {
      setReportSubmitting(false);
    }
  }

  async function handleDelete() {
    setOptsOpen(false);
    if (!window.confirm('Apagar este post? Você pode desfazer em 30 dias.')) return;
    try {
      const { deletePost } = await import('@/lib/services/postInteractions');
      if (!user) return;
      await deletePost(user.id, post.id);
      // Invalida feed pra remover o post da timeline imediatamente.
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile-posts', user.id] });
      showToast('Post apagado', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao apagar', 'error');
    }
  }

  const [orcOpen, setOrcOpen] = useState(false);
  function handleOrcar() {
    if (!user) {
      router.push('/login');
      return;
    }
    setOrcOpen(true);
  }

  return (
    <article
      className="bg-white overflow-hidden mb-3 mx-3"
      data-post-id={post.id}
      data-author-role={post.profile.role ?? ''}
      style={{
        borderRadius: 18,
        boxShadow: '0 2px 12px rgba(0,0,0,.06)',
      }}
    >
      {/* mpost-head — avatar com ring gradient + meta + dots */}
      <header className="flex items-center gap-2.5" style={{ padding: '12px 14px' }}>
        <div
          className="flex-shrink-0"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            padding: 2,
            background:
              'conic-gradient(var(--color-p1), var(--color-p4), var(--color-p5), var(--color-p3), var(--color-p1))',
          }}
        >
          <div
            className="w-full h-full overflow-hidden bg-white"
            style={{ borderRadius: '50%', border: '2px solid #fff' }}
          >
            <Avatar profile={post.profile} size={30} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span
            className="flex items-center gap-1 truncate"
            style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-ink)' }}
          >
            <span className="truncate">{name}</span>
            {/* Badge verificado: PRO benefit (#pro-modal "✓ Badge verificado") */}
            {(post.profile as { is_pro?: boolean | null })?.is_pro ? (
              <span
                aria-label="Verificado"
                title="Perfil verificado"
                className="inline-flex items-center justify-center flex-shrink-0"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#1d9bf0',
                }}
              >
                <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : null}
          </span>
          {handle ? (
            <span
              className="block truncate"
              style={{ fontSize: 11, color: 'var(--color-muted)' }}
            >
              {handle}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOptsOpen(true)}
          aria-label="Opções do post"
          className="text-[color:var(--color-muted)]"
          style={{ fontSize: 18, lineHeight: 1, padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ···
        </button>
      </header>

      {post.media_url ? (
        <div className="relative w-full">
          <PostMedia
            url={post.media_url}
            mediaType={post.media_type}
            muted={muted}
            onToggleMute={onToggleMute}
          />
          {post.for_sale ? (
            <div
              className="absolute top-3 right-3 text-white font-extrabold"
              style={{
                background:
                  'linear-gradient(135deg, #8338ec, var(--color-p1))',
                fontSize: 11,
                padding: '5px 12px',
                borderRadius: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,.3)',
              }}
            >
              🖼️ À VENDA · {BRL_FMT.format(post.price ?? 0)}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* mpost-actions — 5 botões column layout (ícone acima, label abaixo) */}
      <div
        className="flex items-center"
        style={{ padding: '10px 14px 6px', gap: 10 }}
      >
        <ActionButton
          label={`Curtir${likeCount > 0 ? ` · ${likeCount}` : ''}`}
          onClick={toggleLike}
          ariaLabel={liked ? 'Descurtir' : 'Curtir'}
          ariaPressed={liked}
        >
          <BrushIcon active={liked} />
        </ActionButton>

        <ActionButton
          label="Comentar"
          ariaLabel="Comentar"
          onClick={() => setShowComment((v) => !v)}
        >
          <CommentIcon />
        </ActionButton>

        <ActionButton label="Compartilhar" onClick={handleShare} ariaLabel="Compartilhar">
          <ShareIcon />
        </ActionButton>

        {!isOwn ? (
          <ActionButton label="Orçar" onClick={handleOrcar} ariaLabel="Pedir orçamento">
            <DocIcon />
          </ActionButton>
        ) : null}

        <div className="ml-auto">
          <ActionButton
            label="Salvar"
            onClick={() => toggleSave(post.id)}
            ariaLabel={saved ? 'Remover dos salvos' : 'Salvar'}
            ariaPressed={saved}
          >
            <PaletteIcon active={saved} />
          </ActionButton>
        </div>
      </div>

      {showComment ? (
        <div style={{ padding: '4px 14px 8px' }}>
          <CommentForm
            postId={post.id}
            onSuccess={() => setShowComment(false)}
          />
        </div>
      ) : null}

      {likeCount > 0 ? (
        <div
          style={{
            padding: '0 14px 2px',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--color-ink)',
          }}
        >
          {likeCount === 1 ? '1 curtida' : `${likeCount} curtidas`}
        </div>
      ) : null}

      {post.caption ? (
        <div style={{ fontSize: 13.5, padding: '0 14px 6px', lineHeight: 1.5 }}>
          <b style={{ fontWeight: 600 }}>{name}</b> {post.caption}
        </div>
      ) : null}

      {visibleComments.length > 0 ? (
        <ul style={{ padding: '4px 14px 2px' }}>
          {visibleComments.map((c) => {
            const cAny = c as typeof c & {
              author?: { name?: string | null; tag?: string | null } | null;
              user_id?: string;
            };
            const author = cAny.author;
            const authorTag = author?.tag ? '@' + author.tag : null;
            const authorName = author?.name || authorTag || 'Usuário';
            const canDeleteComment =
              !!user && (user.id === cAny.user_id || user.id === post.user_id);
            return (
              <li
                key={c.id}
                style={{
                  fontSize: 13,
                  color: 'var(--color-ink)',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                }}
              >
                <span style={{ flex: 1 }}>
                  <b style={{ fontWeight: 600 }}>{authorName}</b> {c.text}
                </span>
                {canDeleteComment ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Apagar comentário?')) return;
                      try {
                        await removeComment(c.id);
                      } catch (e) {
                        showToast((e as Error).message || 'Erro ao apagar', 'error');
                      }
                    }}
                    disabled={isRemovingComment}
                    aria-label="Apagar comentário"
                    title="Apagar"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-muted)',
                      cursor: 'pointer',
                      fontSize: 16,
                      lineHeight: 1,
                      padding: '0 4px',
                      opacity: isRemovingComment ? 0.5 : 1,
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div
        style={{
          padding: '6px 14px 12px',
          fontSize: 10,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
        }}
      >
        {timeAgo}
      </div>

      <BottomSheet
        open={optsOpen}
        onClose={() => setOptsOpen(false)}
        ariaLabel="Opções do post"
      >
        <h3
          className="font-extrabold text-center"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            marginBottom: 16,
            color: 'var(--color-ink)',
          }}
        >
          Opções
        </h3>
        <div className="flex flex-col gap-1">
          <PostOptRow icon="🔗" label="Copiar link" onClick={handleCopyLink} />
          <PostOptRow icon="↗" label="Compartilhar" onClick={() => { setOptsOpen(false); handleShare(); }} />
          <PostOptRow
            icon={saved ? '🔖' : '📌'}
            label={saved ? 'Remover dos salvos' : 'Salvar post'}
            onClick={() => { toggleSave(post.id); setOptsOpen(false); }}
          />
          {isOwn ? (
            <PostOptRow icon="🗑️" label="Apagar post" onClick={handleDelete} danger />
          ) : (
            <PostOptRow icon="⚠️" label="Denunciar" onClick={handleOpenReport} danger />
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        ariaLabel="Denunciar post"
      >
        <h3
          className="font-extrabold text-center"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            marginBottom: 16,
            color: 'var(--color-ink)',
          }}
        >
          Denunciar post
        </h3>
        <p
          className="text-center"
          style={{
            fontSize: 13,
            color: 'var(--color-muted)',
            marginBottom: 14,
          }}
        >
          Por que você quer denunciar este post?
        </p>
        <div className="flex flex-col gap-1">
          {['Conteúdo impróprio', 'Spam', 'Informação falsa', 'Outro'].map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => submitReport(reason)}
              disabled={reportSubmitting}
              className="text-left font-semibold"
              style={{
                padding: '14px 12px',
                borderRadius: 12,
                background: 'transparent',
                border: 'none',
                cursor: reportSubmitting ? 'wait' : 'pointer',
                fontSize: 15,
                color: 'var(--color-ink)',
              }}
            >
              {reason}
            </button>
          ))}
        </div>
      </BottomSheet>

      <OrcamentoSheet
        open={orcOpen}
        onClose={() => setOrcOpen(false)}
        painterId={post.user_id}
        painterName={name}
        postId={post.id}
      />
    </article>
  );
}

function PostOptRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 text-left"
      style={{
        padding: '14px 12px',
        borderRadius: 12,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: 15,
        fontWeight: 600,
        color: danger ? 'var(--color-danger)' : 'var(--color-ink)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 20 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── action button ────────────────────────────────────────────────────────
// Replica `.act-btn` do vanilla: flex column, ícone em cima, label
// 10px embaixo, min 44x44 pra touch target.

interface ActionButtonProps {
  label: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

function ActionButton({
  label,
  ariaLabel,
  ariaPressed,
  onClick,
  children,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className="flex flex-col items-center justify-center"
      style={{
        gap: 3,
        padding: '4px 2px',
        minWidth: 44,
        minHeight: 44,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--color-muted)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  );
}

// ─── icons ────────────────────────────────────────────────────────────────
// Inline SVG: paths idênticos ao vanilla pra preservar visual.

function BrushIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill={active ? 'var(--color-p4)' : 'none'}
      stroke={active ? 'var(--color-p4)' : 'var(--color-ink)'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 22v-3.5l10.5-10.5 3 3L6.5 22H3z" />
      <path d="m15 6 3-3a2.12 2.12 0 0 1 3 3l-3 3-3-3z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function PaletteIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill={active ? 'var(--color-p1)' : 'none'}
      stroke={active ? 'var(--color-p1)' : 'var(--color-ink)'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="8" cy="9" r="1.5" fill="var(--color-p4)" stroke="none" />
      <circle cx="15" cy="8" r="1.5" fill="var(--color-p5)" stroke="none" />
      <circle cx="16" cy="13" r="1.5" fill="var(--color-p3)" stroke="none" />
      <circle cx="9" cy="14" r="1.5" fill="var(--color-p1)" stroke="none" />
    </svg>
  );
}
