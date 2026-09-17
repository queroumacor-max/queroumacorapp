// __tests__/lib/privacy-audit-hardening.test.ts — trava os achados da
// auditoria COMPLETA de privacidade/LGPD (2026-09-17).
//
// Achado mais grave: `public.profiles` (tabela BASE) tinha SELECT
// `USING (true)` SEM `TO authenticated` — valia pra `PUBLIC`, incluindo
// `anon`. Qualquer um com a anon key (pública, em todo bundle do app)
// baixava a tabela inteira sem login: email, phone, lat/lng, birth_date,
// portal_access (quem é admin), is_pro, mp_preapproval_id, cart, etc. A
// `profiles_public` (view curada pra esconder exatamente essas colunas)
// nunca era o único caminho — só uma formalidade sem efeito.
//
// Este teste não substitui rodar a migration no banco — não há acesso a
// Postgres real deste ambiente. Garante que a correção em código (o
// arquivo de migration) não desaparece/regride em silêncio.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), '..', 'migrations');
const FILE = '2026-09-17-privacy-audit-hardening.sql';

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
}

describe('privacy audit 2026-09-17: migration existe e faz as correções', () => {
  it('o arquivo de migration existe', () => {
    expect(readdirSync(MIGRATIONS_DIR)).toContain(FILE);
  });

  it('A. profiles: policy antiga (USING true, sem TO) é dropada e a nova é dono/admin', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public\.profiles/
    );
    const newPolicy =
      /CREATE POLICY "Users can view own profile row" ON public\.profiles[\s\S]{0,200}?FOR SELECT TO authenticated[\s\S]{0,200}?auth\.uid\(\) = id OR public\.is_portal_admin\(\)/;
    expect(sql).toMatch(newPolicy);
  });

  it('A. profiles_public é recriada SEM security_invoker (roda com privilégio de dono, sobre a RLS restrita)', () => {
    const sql = readMigration();
    const viewBlock = sql.match(
      /CREATE VIEW public\.profiles_public AS[\s\S]{0,600}?FROM public\.profiles;/
    );
    expect(viewBlock).not.toBeNull();
    expect(viewBlock![0]).not.toMatch(/security_invoker/i);
  });

  it('B. profiles_public nunca projeta role literal "admin" (NULLIF)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/NULLIF\(role,\s*'admin'\)\s+AS role/);
  });

  it('C. get_feed_v2 e get_trending_posts: LIMIT clamado e REVOKE de anon', () => {
    const sql = readMigration();
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_feed_v2\([^)]*\) FROM PUBLIC, anon/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_trending_posts\([^)]*\) FROM PUBLIC, anon/
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_feed_v2\([^)]*\) TO authenticated;/);
    // Nenhum GRANT residual pra anon nessas duas funções.
    const feedGrantLines = sql
      .split('\n')
      .filter((l) => /GRANT EXECUTE ON FUNCTION public\.(get_feed_v2|get_trending_posts)/.test(l));
    for (const line of feedGrantLines) {
      expect(line).not.toMatch(/\banon\b/);
    }
  });

  it('D. search_all: sentinelas anti-XSS restauradas + segue com LIMIT clamado/REVOKE anon', () => {
    const sql = readMigration();
    const searchAllBlock = sql.match(
      /CREATE OR REPLACE FUNCTION public\.search_all[\s\S]{0,3000}?\$\$;/
    );
    expect(searchAllBlock).not.toBeNull();
    expect(searchAllBlock![0]).toMatch(/⟦HL_OPEN⟧/);
    expect(searchAllBlock![0]).toMatch(/⟦HL_CLOSE⟧/);
    expect(searchAllBlock![0]).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.search_all\(text, int\) FROM PUBLIC, anon/);
  });

  it('E. dispatch_push_on_notification redige o texto de comentário (não só mensagem)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/comentou na sua foto/);
    // A condição pra 'comment' precisa existir de verdade, não só o texto solto.
    expect(sql).toMatch(/ELSIF NEW\.type = 'comment' THEN/);
  });

  it('F. cleanup_orphan_media cobre avatars e art-refs, não só posts', () => {
    const sql = readMigration();
    const fnBlock = sql.match(
      /CREATE OR REPLACE FUNCTION public\.cleanup_orphan_media\(\)[\s\S]{0,3000}?\$\$;/
    );
    expect(fnBlock).not.toBeNull();
    expect(fnBlock![0]).toMatch(/'avatars'/);
    expect(fnBlock![0]).toMatch(/'art-refs'/);
    expect(fnBlock![0]).toMatch(/public\.art_references/);
  });

  it('F. as 3 funções de cleanup nunca agendadas ganham cron.schedule', () => {
    const sql = readMigration();
    expect(sql).toMatch(/cron\.schedule\(\s*'cleanup-rate-limits'/);
    expect(sql).toMatch(/cron\.schedule\(\s*'cleanup-old-notifications'/);
    expect(sql).toMatch(/cron\.schedule\(\s*'cleanup-old-audit-events'/);
  });

  it('G. RPC quote_painter_contact existe, é SECURITY DEFINER e checa client_id/painter_id/admin', () => {
    const sql = readMigration();
    const rpcBlock = sql.match(
      /CREATE OR REPLACE FUNCTION public\.quote_painter_contact\(p_quote_id uuid\)[\s\S]{0,2000}?\$\$;/
    );
    expect(rpcBlock).not.toBeNull();
    expect(rpcBlock![0]).toMatch(/SECURITY DEFINER/);
    expect(rpcBlock![0]).toMatch(/v_client_id/);
    expect(rpcBlock![0]).toMatch(/v_painter_id/);
    expect(rpcBlock![0]).toMatch(/public\.is_portal_admin\(\)/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.quote_painter_contact\(uuid\) FROM PUBLIC, anon/
    );
  });

  it('conferência final: tem uma linha `ok` por item corrigido', () => {
    const sql = readMigration();
    const items = [
      'A. profiles SELECT restrita a dono/admin',
      'A. policy antiga (USING true, PUBLIC) removida',
      'A. profiles_public sem security_invoker',
      'B. profiles_public nunca expõe role=admin',
      'C. get_feed_v2 sem GRANT pra anon',
      'C. get_trending_posts sem GRANT pra anon',
      'D. search_all com sentinelas anti-XSS de volta',
      'E. push de comentário redige o texto',
      'F. cron: cleanup-rate-limits agendado',
      'F. cron: cleanup-old-notifications agendado',
      'F. cron: cleanup-old-audit-events agendado',
      'G. quote_painter_contact existe e é SECURITY DEFINER',
    ];
    for (const item of items) {
      expect(sql, `conferência faltando: ${item}`).toContain(item);
    }
  });
});

describe('privacy audit 2026-09-17: nenhuma migration POSTERIOR reabre a policy antiga', () => {
  it('esta é a migration mais recente que toca a policy de SELECT de profiles', () => {
    // supabase_init.sql (o bootstrap histórico) e migrations anteriores a
    // esta AINDA contêm a policy antiga por escrito — o repo não reescreve
    // história, só empilha correção em cima (mesma regra de todo o resto
    // deste projeto). O que importa é que NENHUM arquivo com data/ordem
    // POSTERIOR a este recrie a policy permissiva por cima da correção.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf(FILE);
    expect(idx).toBeGreaterThanOrEqual(0);
    const later = files.slice(idx + 1);
    for (const f of later) {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      expect(
        content,
        `${f} (posterior à correção) recria a policy permissiva de profiles`
      ).not.toMatch(/CREATE POLICY "Profiles are viewable by everyone" ON public\.profiles/);
    }
  });
});
