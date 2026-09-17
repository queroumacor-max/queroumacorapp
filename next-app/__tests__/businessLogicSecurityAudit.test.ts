// Guarda de CONTEÚDO da migration
// 2026-09-16-business-logic-security-audit.sql (auditoria de negócio:
// abuso de fluxo, manipulação de estado, race conditions, entitlement).
//
// Mesma filosofia de chatSafetyHardening.test.ts: a lógica de verdade vive
// inteira em SQL (triggers/RPCs/policies), não em TypeScript exercitável
// num teste de unidade normal. Este teste lê o arquivo e trava os
// invariantes de segurança que não podem regredir silenciosamente numa
// edição futura do SQL — não substitui rodar a migration de verdade contra
// um banco (isso é responsabilidade do usuário, como em toda migration
// deste repo), mas garante que o TEXTO que será rodado continua dizendo o
// que promete.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(
  new URL(
    '../../migrations/2026-09-16-business-logic-security-audit.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('A. PRO permanente grátis — pro_expires_at/pro_grace_until protegidos', () => {
  it('protect_profile_columns reverte pro_expires_at e pro_grace_until fora de admin/service_role', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS protect_profile_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/OLD\.pro_expires_at\s+IS DISTINCT FROM NEW\.pro_expires_at\s+THEN NEW\.pro_expires_at\s+:= OLD\.pro_expires_at/);
    expect(fnBody).toMatch(/OLD\.pro_grace_until\s+IS DISTINCT FROM NEW\.pro_grace_until\s+THEN NEW\.pro_grace_until\s+:= OLD\.pro_grace_until/);
    // INSERT também zera as duas datas quando setadas por não-admin.
    expect(fnBody).toMatch(/NEW\.pro_expires_at := NULL/);
    expect(fnBody).toMatch(/NEW\.pro_grace_until := NULL/);
  });

  it('cria uma trigger canônica única (derruba os dois nomes históricos)', () => {
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS protect_profile_columns ON public\.profiles/);
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public\.profiles/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_protect_profile_columns\s*\n\s*BEFORE INSERT OR UPDATE ON public\.profiles/);
  });

  // Achado de revisão (Codex, PR #319): checar `auth.role()` quebra
  // `redeem_pro_with_points` — essa RPC é SECURITY DEFINER chamada por um
  // usuário comum (GRANT ... TO authenticated), e `auth.role()` dentro
  // dela CONTINUA 'authenticated' (é o role do JWT original, não muda com
  // SECURITY DEFINER). Só `current_user` muda pro dono da função. Sem
  // essa correção, a trigger reverteria a ativação de PRO da própria RPC
  // que deveria concedê-la — debitando pontos sem dar nada em troca.
  it('confia em current_user (não auth.role()) pra reconhecer escrita vinda de dentro de uma RPC SECURITY DEFINER', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS protect_profile_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/current_user NOT IN \('anon', 'authenticated'\)/);
    expect(fnBody).not.toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  });
});

describe('B. auto-promoção a admin via user_type', () => {
  it('sync_role_from_user_type exclui explicitamente \'admin\'', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.sync_role_from_user_type()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_sync_role_from_user_type', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/NEW\.user_type <> 'admin'/);
  });
});

describe('C+D+E. cadeia de farm de pontos via quotes → PRO grátis', () => {
  it('quotes_insert_participants bloqueia client_id = painter_id (auto-orçamento)', () => {
    const idx = SQL.indexOf('CREATE POLICY quotes_insert_participants');
    const block = SQL.slice(idx, idx + 500);
    expect(block).toMatch(/painter_id <> client_id/);
  });

  it('trigger de ownership de quotes trava client_id/painter_id pós-criação', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_protect_quote_ownership\s*\n\s*BEFORE UPDATE ON public\.quotes/);
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_quote_ownership()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_quote_ownership', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/NEW\.client_id := OLD\.client_id/);
    expect(fnBody).toMatch(/NEW\.painter_id := OLD\.painter_id/);
    // Admin/service_role têm bypass explícito (fluxo legítimo de correção).
    expect(fnBody).toMatch(/is_portal_admin\(\)/);
    expect(fnBody).toMatch(/auth\.role\(\) = 'service_role'/);
  });

  it('award_quote_request_points passa por check_rate_limit antes de creditar', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.award_quote_request_points()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_award_quote_request_points', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/check_rate_limit\(NEW\.client_id::text, 'quote-request-points', 5, 1\)/);
    // Estourou o limite → NÃO insere pontos, mas a quote em si continua
    // sendo criada (não há RAISE EXCEPTION nesta função).
    expect(fnBody).not.toMatch(/RAISE EXCEPTION/);
  });
});

describe('F. self-review + duplicação de avaliação', () => {
  it('remove duplicatas existentes antes de travar a UNIQUE (não quebra em dado já corrompido)', () => {
    const idx = SQL.indexOf('DELETE FROM public.reviews r');
    expect(idx).toBeGreaterThan(-1);
    const uniqueIdx = SQL.indexOf('idx_reviews_unique_reviewer_quote');
    expect(uniqueIdx).toBeGreaterThan(idx);
  });

  it('índice único cobre (quote_id, reviewer_id)', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_reviewer_quote\s*\n\s*ON public\.reviews\(quote_id, reviewer_id\) WHERE quote_id IS NOT NULL/);
  });

  it('submit_review bloqueia auto-avaliação (client_id = painter_id do orçamento)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.submit_review(');
    const fnEnd = SQL.indexOf('GRANT EXECUTE ON FUNCTION public.submit_review', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/v_painter IS NOT NULL AND v_owner = v_painter THEN\s*\n\s*RAISE EXCEPTION 'Não é possível avaliar um orçamento próprio'/);
  });

  it('submit_review serializa por advisory lock (quote_id + reviewer) antes do check de duplicata', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.submit_review(');
    const fnEnd = SQL.indexOf('GRANT EXECUTE ON FUNCTION public.submit_review', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const lockIdx = fnBody.indexOf('pg_advisory_xact_lock');
    const dupCheckIdx = fnBody.indexOf('Você já avaliou este orçamento');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(dupCheckIdx);
  });

  it('captura unique_violation como rede de segurança adicional', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.submit_review(');
    const fnEnd = SQL.indexOf('GRANT EXECUTE ON FUNCTION public.submit_review', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/EXCEPTION WHEN unique_violation THEN/);
  });
});

describe('G. orders — pagamento/status protegidos, total sempre recalculado', () => {
  it('protect_order_columns reverte status/paid_amount/tx_id/payment_method/gateway/user_id fora de admin/service_role', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_order_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_order_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    for (const col of ['status', 'paid_amount', 'paid_at', 'tx_id', 'payment_method', 'gateway', 'user_id']) {
      expect(fnBody).toContain(`NEW.${col}`);
    }
    expect(fnBody).toMatch(/v_trusted := public\.is_portal_admin\(\) OR current_user NOT IN \('anon', 'authenticated'\)/);
  });

  // Achado de revisão (Codex, PR #319): a 1ª versão só cobria UPDATE —
  // `orders_insert_own` deixava criar a order JÁ como status='paid' com
  // metadado de pagamento arbitrário, pulando a proteção inteira.
  it('trigger cobre INSERT também (não só UPDATE) e força status=pending + payment fields NULL nesse caminho', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_protect_order_columns\s*\n\s*BEFORE INSERT OR UPDATE ON public\.orders/);
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_order_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_order_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const insertBranchStart = fnBody.indexOf("IF TG_OP = 'INSERT' THEN");
    const insertBranchEnd = fnBody.indexOf("UPDATE: mesma proteção");
    const insertBranch = fnBody.slice(insertBranchStart, insertBranchEnd);
    expect(insertBranch).toMatch(/NEW\.status\s+:= 'pending'/);
    expect(insertBranch).toMatch(/NEW\.paid_amount\s+:= NULL/);
    expect(insertBranch).not.toMatch(/OLD\./); // OLD não existe em INSERT
  });

  it('items continua livre (fluxo legítimo "editar pedido") — não aparece na lista de reversão', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_order_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_order_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const guardBlockEnd = fnBody.indexOf('total nunca é aceito cru');
    const guardBlock = fnBody.slice(0, guardBlockEnd);
    expect(guardBlock).not.toMatch(/NEW\.items\s+IS DISTINCT FROM OLD\.items\s+THEN NEW\.items/);
  });

  it('total é recomputado a partir de items quando items muda', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_order_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_order_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/IF NEW\.items IS DISTINCT FROM OLD\.items THEN/);
    expect(fnBody).toMatch(/jsonb_array_elements\(COALESCE\(NEW\.items, '\[\]'::jsonb\)\)/);
    expect(fnBody).toMatch(/NEW\.total := v_total/);
  });
});

describe('H. CSAM — hash blocklist bloqueia post no banco, qualquer caminho de insert', () => {
  it('trigger dispara em INSERT e em UPDATE de media_hash', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_enforce_media_hash_blocklist\s*\n\s*BEFORE INSERT OR UPDATE OF media_hash ON public\.posts/);
  });

  it('bate na blocklist → RAISE EXCEPTION (bloqueia o INSERT inteiro, não é best-effort)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.enforce_media_hash_blocklist()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_enforce_media_hash_blocklist', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/EXISTS \(\s*\n\s*SELECT 1 FROM public\.media_hash_blocklist WHERE hash = NEW\.media_hash\s*\n\s*\) THEN\s*\n\s*RAISE EXCEPTION/);
  });
});

describe('I. messages — colunas protegidas por papel (sender vs receiver)', () => {
  it('content/sender_id/receiver_id/conversation_id/type são imutáveis fora de admin/service_role', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_message_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_message_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    for (const col of ['content', 'sender_id', 'receiver_id', 'conversation_id', 'type']) {
      expect(fnBody).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}\\s+THEN NEW\\.${col}\\s+:= OLD\\.${col}`));
    }
  });

  it('deleted_at só muda se o caller é o sender ORIGINAL (não o receiver)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_message_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_message_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/NEW\.deleted_at IS DISTINCT FROM OLD\.deleted_at AND auth\.uid\(\) IS DISTINCT FROM OLD\.sender_id/);
  });

  it('read_at só muda se o caller é o receiver ORIGINAL (não o sender)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_message_columns()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_protect_message_columns', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/NEW\.read_at IS DISTINCT FROM OLD\.read_at AND auth\.uid\(\) IS DISTINCT FROM OLD\.receiver_id/);
  });
});

describe('J. messages — bloqueio impede chat nos dois sentidos + teto agregado por remetente', () => {
  it('rate_limit_messages nega o INSERT se existe bloqueio em qualquer direção', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.rate_limit_messages()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_rate_limit_messages', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/blocker_id = NEW\.sender_id AND blocked_id = NEW\.receiver_id/);
    expect(fnBody).toMatch(/blocker_id = NEW\.receiver_id AND blocked_id = NEW\.sender_id/);
  });

  // Achado de revisão (Codex, PR #319): `type` é coluna livre do client
  // (sem CHECK constraint) — se o early-return de type='system' vier
  // ANTES do check de bloqueio, um usuário bloqueado contorna os dois só
  // mandando type:'system'. O check de bloqueio tem que rodar SEMPRE,
  // e só o RATE LIMIT (não o bloqueio) pode ser pulado pra mensagem de
  // sistema.
  it('o check de bloqueio roda ANTES do early-return de type=system (não pode ser contornado com type:"system")', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.rate_limit_messages()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_rate_limit_messages', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const blockCheckIdx = fnBody.indexOf('FROM public.blocks');
    const systemBypassIdx = fnBody.indexOf("COALESCE(NEW.type, 'text') = 'system'");
    expect(blockCheckIdx).toBeGreaterThan(-1);
    expect(systemBypassIdx).toBeGreaterThan(-1);
    expect(blockCheckIdx).toBeLessThan(systemBypassIdx);
  });

  it('mantém o teto por PAR (30/min) e soma um teto AGREGADO por remetente (60/min)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.rate_limit_messages()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_rate_limit_messages', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/check_rate_limit\(v_key, 'chat-message', 30, 1\)/);
    expect(fnBody).toMatch(/check_rate_limit\(NEW\.sender_id::text, 'chat-message-global', 60, 1\)/);
  });
});

describe('K. reports — rate limit (sem dedup por target — review e perfil colidiam)', () => {
  // Achado de revisão (Codex, PR #319): `reports` não tem coluna pra
  // identificar QUAL review foi denunciada (só o texto livre `reason`) —
  // denúncia de perfil e de review usam o MESMO target_user_id, então um
  // índice único (reporter_id, target_user_id) bloqueava denunciar uma 2ª
  // review diferente da mesma pessoa, ou o perfil dela depois de já ter
  // denunciado uma review. Removido; o índice antigo (se já criado por
  // uma execução anterior desta migration) é derrubado explicitamente.
  it('derruba o índice único problemático em vez de recriá-lo', () => {
    expect(SQL).toMatch(/DROP INDEX IF EXISTS idx_reports_unique_per_target/);
    expect(SQL).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_per_target/);
  });

  it('trigger de rate limit em reports existe e usa check_rate_limit', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_rate_limit_reports\s*\n\s*BEFORE INSERT ON public\.reports/);
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.rate_limit_reports()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_rate_limit_reports', fnStart);
    expect(SQL.slice(fnStart, fnEnd)).toMatch(/check_rate_limit\(NEW\.reporter_id::text, 'report', 10, 1\)/);
  });
});

describe('L. cleanup_orphan_media cobre carrossel (media_urls[])', () => {
  it('NOT EXISTS varre posts.media_urls via unnest', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.cleanup_orphan_media()');
    const fnEnd = SQL.indexOf('-- ════', fnStart + 10);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/unnest\(p2\.media_urls\)/);
  });

  it('continua cobrindo os guards anteriores (brand_logos/business_logo_url/products.image_url)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.cleanup_orphan_media()');
    const fnEnd = SQL.indexOf('-- ════', fnStart + 10);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/brand_logos/);
    expect(fnBody).toMatch(/business_logo_url/);
    expect(fnBody).toMatch(/products pd/);
  });
});

describe('M. follows — sem self-follow', () => {
  it('limpa dados existentes antes de travar a CHECK constraint', () => {
    const deleteIdx = SQL.indexOf('DELETE FROM public.follows WHERE follower_id = following_id');
    const constraintIdx = SQL.indexOf('follows_no_self');
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeLessThan(constraintIdx);
  });

  it('CHECK constraint follower_id <> following_id existe', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.follows ADD CONSTRAINT follows_no_self CHECK \(follower_id <> following_id\)/);
  });
});

describe('N. ai_usage_this_month / is_pro_active não vazam dado de outro usuário', () => {
  it('ai_usage_this_month só responde de verdade pro próprio uid, service_role ou admin', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.ai_usage_this_month(');
    const fnEnd = SQL.indexOf('GRANT EXECUTE ON FUNCTION public.ai_usage_this_month', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/auth\.role\(\) = 'service_role' OR p_user_id = auth\.uid\(\) OR public\.is_portal_admin\(\)/);
    expect(fnBody).toMatch(/ELSE 0/);
  });

  it('is_pro_active só responde de verdade pro próprio uid, service_role ou admin', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.is_pro_active(');
    const fnEnd = SQL.indexOf('GRANT EXECUTE ON FUNCTION public.is_pro_active', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/auth\.role\(\) = 'service_role' OR p_user_id = auth\.uid\(\) OR public\.is_portal_admin\(\)/);
    expect(fnBody).toMatch(/ELSE false/);
  });
});

describe('O. reserve_ai_usage — cota mensal de IA atômica', () => {
  it('check + INSERT numa transação só, serializada por advisory lock por usuário', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.reserve_ai_usage(');
    const fnEnd = SQL.indexOf('REVOKE ALL ON FUNCTION public.reserve_ai_usage', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    const lockIdx = fnBody.indexOf('pg_advisory_xact_lock');
    const selectIdx = fnBody.indexOf('SELECT COALESCE(SUM(cost_units)');
    const insertIdx = fnBody.indexOf('INSERT INTO public.ai_usage');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(selectIdx);
    expect(selectIdx).toBeLessThan(insertIdx);
    expect(fnBody).toMatch(/IF v_used \+ v_cost > p_limit THEN/);
  });

  it('só service_role pode chamar (nunca authenticated/anon direto)', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.reserve_ai_usage\(uuid, text, integer, integer\) FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.reserve_ai_usage\(uuid, text, integer, integer\) TO service_role/);
  });
});

describe('P. bump_wa_ai_reply_count — teto diário do responder de WhatsApp atômico', () => {
  it('UPSERT com CASE de virada de dia numa transação só', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.bump_wa_ai_reply_count(');
    const fnEnd = SQL.indexOf('REVOKE ALL ON FUNCTION public.bump_wa_ai_reply_count', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/ON CONFLICT \(wa_id\) DO UPDATE SET/);
    expect(fnBody).toMatch(/WHEN public\.whatsapp_ai_state\.replies_date IS DISTINCT FROM p_today THEN 1/);
    expect(fnBody).toMatch(/RETURNING replies_today INTO v_count/);
  });

  it('só service_role pode chamar', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.bump_wa_ai_reply_count\(text, integer, date\) FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.bump_wa_ai_reply_count\(text, integer, date\) TO service_role/);
  });
});
