// Guarda de CONTEÚDO da migration
// 2026-09-17-moderation-quota-and-media-hash-coverage.sql — fecha as 2
// pendências deixadas em aberto pela auditoria de negócio de 2026-09-16
// (moderação Gemini não reforçada no publish; blocklist de hash CSAM só em
// posts). Mesma filosofia de businessLogicSecurityAudit.test.ts: a lógica
// de verdade vive em SQL, este teste trava os invariantes que não podem
// regredir silenciosamente — não substitui rodar a migration de verdade.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(
  new URL(
    '../../migrations/2026-09-17-moderation-quota-and-media-hash-coverage.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Q. reserve_moderation_usage — pool de moderação separado do pool geral de IA', () => {
  it('soma só a própria feature (filtro explícito), não o total do usuário', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.reserve_moderation_usage(');
    const fnEnd = SQL.indexOf('REVOKE ALL ON FUNCTION public.reserve_moderation_usage', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/AND feature = p_feature/);
    expect(fnBody).toMatch(/AND used_at >= date_trunc\('month', now\(\)\)/);
  });

  it('é check+INSERT atômico com advisory lock (mesmo padrão de reserve_ai_usage)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.reserve_moderation_usage(');
    const fnEnd = SQL.indexOf('REVOKE ALL ON FUNCTION public.reserve_moderation_usage', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/pg_advisory_xact_lock/);
    expect(fnBody).toMatch(/INSERT INTO public\.ai_usage/);
  });

  it('EXECUTE revogado de PUBLIC/anon/authenticated, concedido só a service_role', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_moderation_usage\(uuid, text, integer, integer\) FROM PUBLIC/,
    );
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_moderation_usage\(uuid, text, integer, integer\) FROM anon, authenticated/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reserve_moderation_usage\(uuid, text, integer, integer\) TO service_role/,
    );
  });
});

describe('R. blocklist de hash CSAM estendida a avatar e art-references', () => {
  it('profiles.avatar_hash: coluna + índice parcial + trigger de blocklist', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS avatar_hash text/);
    expect(SQL).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_profiles_avatar_hash\s*\n\s*ON public\.profiles\(avatar_hash\) WHERE avatar_hash IS NOT NULL/,
    );
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.enforce_avatar_hash_blocklist()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_enforce_avatar_hash_blocklist', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    // Checa contra a MESMA tabela media_hash_blocklist (não uma blocklist
    // paralela) — é a mesma operação admin de banir hash cobrindo mais
    // superfície, não um mecanismo novo e desconectado.
    expect(fnBody).toMatch(/FROM public\.media_hash_blocklist WHERE hash = NEW\.avatar_hash/);
    expect(fnBody).toMatch(/RAISE EXCEPTION/);
    expect(SQL).toMatch(
      /CREATE TRIGGER trg_enforce_avatar_hash_blocklist\s*\n\s*BEFORE INSERT OR UPDATE OF avatar_hash ON public\.profiles/,
    );
  });

  it('art_references.image_hash: coluna + índice parcial + trigger de blocklist', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.art_references ADD COLUMN IF NOT EXISTS image_hash text/);
    expect(SQL).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_art_references_image_hash\s*\n\s*ON public\.art_references\(image_hash\) WHERE image_hash IS NOT NULL/,
    );
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.enforce_art_reference_hash_blocklist()');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_enforce_art_reference_hash_blocklist', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/FROM public\.media_hash_blocklist WHERE hash = NEW\.image_hash/);
    expect(fnBody).toMatch(/RAISE EXCEPTION/);
    expect(SQL).toMatch(
      /CREATE TRIGGER trg_enforce_art_reference_hash_blocklist\s*\n\s*BEFORE INSERT OR UPDATE OF image_hash ON public\.art_references/,
    );
  });

  it('as duas triggers são SECURITY DEFINER com search_path fixo (sem risco de search-path hijacking)', () => {
    for (const fn of ['enforce_avatar_hash_blocklist', 'enforce_art_reference_hash_blocklist']) {
      const idx = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`);
      expect(idx).toBeGreaterThan(-1);
      const nextLines = SQL.slice(idx, idx + 200);
      expect(nextLines).toMatch(/SECURITY DEFINER SET search_path = public/);
    }
  });
});

describe('conferência final cobre as 6 checagens novas', () => {
  it('inclui uma linha SELECT por invariante (Q×2, R×4)', () => {
    const verifySection = SQL.slice(SQL.indexOf('Conferência (só leitura)'));
    expect(verifySection.match(/UNION ALL SELECT/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(verifySection).toMatch(/'Q\. reserve_moderation_usage existe/);
    expect(verifySection).toMatch(/'R\. profiles\.avatar_hash existe'/);
    expect(verifySection).toMatch(/'R\. art_references\.image_hash existe'/);
  });
});
