// PublicacaoAviso — o lado "global" da publicação em segundo plano
// (lib/publicacaoFila.ts). Montado no AppShell: avisa quando terminou ou
// falhou, atualiza o feed/perfil/stories e registra a falha no
// /admin/errors — vale em qualquer tela, não só no feed onde está o anel.

'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { usePublicacao } from '@/lib/publicacaoFila';
import { showToast } from '@/lib/toast';
import { hapticNotify } from '@/lib/native';
import { reportFailure } from '@/lib/utils/reportFailure';

export function PublicacaoAviso() {
  const estado = usePublicacao();
  const qc = useQueryClient();
  const { user } = useAuth();
  const anterior = useRef(estado.status);

  useEffect(() => {
    const antes = anterior.current;
    anterior.current = estado.status;
    if (antes !== 'enviando') return;
    if (estado.status === 'pronto') {
      hapticNotify('success');
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile-posts', user?.id] });
      qc.invalidateQueries({ queryKey: ['stories'] });
      showToast(estado.mediaType === 'story' ? 'Story publicado ✓' : 'Publicado ✓', 'success');
    } else if (estado.status === 'erro') {
      reportFailure('publish-fail', estado.erro, { userId: user?.id, ctx: 'segundo-plano' });
      showToast(
        `${estado.mensagem} Toque no seu círculo, no Início, pra tentar de novo.`,
        'error',
      );
    }
  }, [estado, qc, user?.id]);

  return null;
}
