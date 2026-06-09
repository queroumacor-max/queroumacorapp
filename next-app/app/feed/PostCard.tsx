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

import { memo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { CommentForm } from '@/components/CommentForm';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { useLike, useSavedPosts, useComments } from '@/lib/hooks/usePostInteractions';
import { useBlockMutations } from '@/lib/hooks/useBlocks';
import { renderRichText } from '@/lib/utils/richText';
import type { PostComment } from '@/lib/services/postInteractions';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { isAdmin } from '@/lib/policies';
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

function PostCardInner({ post, muted, onToggleMute }: PostCardProps) {
  const dialog = useDialog();
  const router = useRouter();
  const { user } = useAuth();
  const policyUser = usePolicyUser();
  const userIsAdmin = isAdmin(policyUser);
  const qc = useQueryClient();
  const name = displayName(post.profile);
  const handle = post.profile.tag ? '@' + post.profile.tag : '';
  const timeAgo = getTimeAgo(post.created_at);

  // Hidrata useLike com `{liked, count}` que já veio do feed (RPC get_feed_v2
  // ou enrichment legacy). Evita 2 round-trips extra (hasLiked + countLikes)
  // por card. staleTime do hook (30s) cuida do refresh natural.
  const { liked, count: likeCount, toggle: toggleLike } = useLike(post.id, {
    liked: post.liked,
    count: post.likeCount,
  });
  const { isSaved, toggle: toggleSave } = useSavedPosts();
  const saved = isSaved(post.id);
  const blockMut = useBlockMutations();
  const [showComment, setShowComment] = useState(false);
  // Comments via hook — assina o cache ['post-comments', id] que a
  // CommentForm invalida após insert. `post.comments` (do feed) é só
  // initialData pra evitar flash de "carregando" no 1º paint; o hook
  // substitui assim que carrega.
  //
  // Pegadinha resolvida (jun/2026): o fallback antigo era
  // `freshComments.length > 0 ? freshComments : post.comments` — tratava
  // "lista carregada vazia" igual "ainda carregando" e voltava pra
  // snapshot velha do feed. Resultado: comment novo (ou apagar comment)
  // não refletia. Fix: usa `loading` pra decidir; depois de carregar,
  // confia no resultado do hook (mesmo se vazio).
  // Hidrata useComments com os top-N comments do feed. PostComment e
  // FeedComment têm o mesmo shape (id/post_id/user_id/text/created_at/author).
  const {
    comments: freshComments,
    loading: commentsLoading,
    remove: removeComment,
    isRemoving: isRemovingComment,
  } = useComments(post.id, post.comments as unknown as PostComment[]);
  const visibleComments = commentsLoading ? post.comments : freshComments;

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

  async function handleBlockUser() {
    setOptsOpen(false);
    if (!user) {
      router.push('/login');
      return;
    }
    const ok = await dialog.confirm(
      `Bloquear ${post.profile.name ?? 'este usuário'}? Você não vai mais ver posts dele.`,
      { title: 'Bloquear', okLabel: 'Bloquear', danger: true },
    );
    if (!ok) return;
    try {
      await blockMut.block(post.user_id);
      showToast('Usuário bloqueado.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao bloquear.', 'error');
    }
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
    const ok = await dialog.confirm(
      'Apagar este post? Você pode desfazer em 30 dias.',
      { title: 'Apagar post', okLabel: 'Apagar', danger: true },
    );
    if (!ok) return;
    if (!user) return;

    // Otimista: remove o post de todas as páginas do feed IMEDIATAMENTE.
    // Guard defensivo pra evitar map em pages/posts undefined.
    type FeedPageShape = { posts?: Array<{ id: string }> };
    type InfData = { pages?: FeedPageShape[]; pageParams?: unknown[] };
    qc.setQueriesData<InfData>({ queryKey: ['feed'] }, (data) => {
      if (!data || !Array.isArray(data.pages)) return data;
      return {
        ...data,
        pages: data.pages.map((p) => {
          if (!p || !Array.isArray(p.posts)) return p;
          return { ...p, posts: p.posts.filter((x) => x.id !== post.id) };
        }),
      };
    });
    qc.setQueriesData<{ id: string }[]>(
      { queryKey: ['profile-posts', user.id] },
      (data) => (Array.isArray(data) ? data.filter((p) => p.id !== post.id) : data),
    );

    try {
      const { deletePost } = await import('@/lib/services/postInteractions');
      await deletePost(user.id, post.id);
      // Confirma com refetch (RLS pode rejeitar e queremos sincronizar).
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile-posts', user.id] });
      showToast('Post apagado', 'success');
    } catch (e) {
      // Rollback: refetch traz o post de volta se o delete falhou.
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile-posts', user.id] });
      showToast((e as Error).message || 'Erro ao apagar', 'error');
    }
  }

  const [orcOpen, setOrcOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(post.caption ?? '');
  const [editSaving, setEditSaving] = useState(false);

  async function handleSaveCaption() {
    if (!user || editSaving) return;
    setEditSaving(true);
    try {
      const { updatePostCaption } = await import('@/lib/services/postInteractions');
      await updatePostCaption(post.id, user.id, editText);

      // Otimista: atualiza o cache do feed pra mostrar caption nova na hora.
      // Guard defensivo — setQueriesData pode matchear queries com shape
      // ligeiramente diferente (ex.: query antiga sem .posts em alguma page).
      type FeedPageShape = { posts?: Array<{ id: string; caption: string | null }> };
      type InfData = { pages?: FeedPageShape[]; pageParams?: unknown[] };
      qc.setQueriesData<InfData>({ queryKey: ['feed'] }, (data) => {
        if (!data || !Array.isArray(data.pages)) return data;
        return {
          ...data,
          pages: data.pages.map((p) => {
            if (!p || !Array.isArray(p.posts)) return p;
            return {
              ...p,
              posts: p.posts.map((x) =>
                x.id === post.id
                  ? { ...x, caption: editText.trim() || null }
                  : x,
              ),
            };
          }),
        };
      });
      showToast('Texto atualizado', 'success');
      setEditOpen(false);
    } catch (e) {
      showToast((e as Error).message || 'Erro ao salvar', 'error');
    } finally {
      setEditSaving(false);
    }
  }
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
            {/* Badge verificado (S1): admin marca contas oficiais via
                profiles.verified. Compat: is_pro também mostra badge
                (foi o critério histórico). Cria divergência semântica
                que admin pode separar depois (remover OR is_pro). */}
            {post.profile?.verified || post.profile?.is_pro ? (
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
            mediaWidth={post.media_width}
            mediaHeight={post.media_height}
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
            onError={(msg) => showToast(msg || 'Erro ao comentar', 'error')}
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
          <b style={{ fontWeight: 600 }}>{name}</b> {renderRichText(post.caption)}
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
            const authorLabel = authorTag || author?.name || 'Usuário';
            // Espelha as 3 policies de DELETE no banco (Wave 9):
            //   - dono do comment
            //   - dono do post
            //   - admin (qualquer comment, qualquer post → moderação direta)
            const canDeleteComment =
              !!user &&
              (user.id === cAny.user_id ||
                user.id === post.user_id ||
                userIsAdmin);
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
                  <b style={{ fontWeight: 600 }}>{authorLabel}</b> {renderRichText(c.text)}
                </span>
                {canDeleteComment ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await dialog.confirm('Apagar comentário?', {
                        title: 'Apagar comentário',
                        okLabel: 'Apagar',
                        danger: true,
                      });
                      if (!ok) return;
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
            <>
              <PostOptRow
                icon="✏️"
                label="Editar texto"
                onClick={() => {
                  setOptsOpen(false);
                  setEditText(post.caption ?? '');
                  setEditOpen(true);
                }}
              />
              <PostOptRow icon="🗑️" label="Apagar post" onClick={handleDelete} danger />
            </>
          ) : (
            <>
              <PostOptRow
                icon="🚫"
                label="Bloquear usuário"
                onClick={handleBlockUser}
                danger
              />
              <PostOptRow icon="⚠️" label="Denunciar" onClick={handleOpenReport} danger />
            </>
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

      <BottomSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        ariaLabel="Editar texto do post"
      >
        <h3
          className="font-extrabold text-center"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            marginBottom: 6,
            color: 'var(--color-ink)',
          }}
        >
          Editar texto
        </h3>
        <p
          className="text-center"
          style={{
            fontSize: 12,
            color: 'var(--color-muted)',
            marginBottom: 14,
          }}
        >
          Mude a legenda. A foto/vídeo continua a mesma.
        </p>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value.slice(0, 2200))}
          rows={5}
          placeholder="Legenda do post"
          className="w-full bg-white"
          style={{
            padding: 12,
            borderRadius: 12,
            border: '1.5px solid var(--color-border)',
            fontSize: 14,
            resize: 'vertical',
            outline: 'none',
            marginBottom: 12,
            fontFamily: 'var(--font-body)',
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(false)}
            disabled={editSaving}
            className="flex-1 font-bold"
            style={{
              padding: 11,
              background: '#fff',
              color: 'var(--color-ink)',
              borderRadius: 10,
              border: '1.5px solid var(--color-border)',
              cursor: editSaving ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSaveCaption}
            disabled={editSaving}
            className="flex-1 text-white font-bold"
            style={{
              padding: 11,
              background: 'var(--color-ink)',
              borderRadius: 10,
              border: 'none',
              cursor: editSaving ? 'wait' : 'pointer',
              opacity: editSaving ? 0.7 : 1,
              fontSize: 13,
            }}
          >
            {editSaving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </BottomSheet>
    </article>
  );
}

// memo evita re-render de todos os PostCards quando FeedView atualiza
// (mudança de filter/scroll). Shallow compare em post (ref estável do server),
// muted (bool), onToggleMute (estabilizado via useCallback).
export const PostCard = memo(PostCardInner);

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
