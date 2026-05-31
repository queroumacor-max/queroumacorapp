// Tests do port lib/utils.ts (helpers puros).
// Cobre as funções migradas de /utils.js — DOM-bound (toast, showModal,
// fmtBRL como mutator de input, etc.) NÃO foram portadas, então não há
// teste pra elas aqui (vão pra componentes/hooks numa próxima fase).

import { describe, it, expect, vi } from 'vitest';
import {
  parseBRL,
  fmtBRL,
  escapeHtml,
  escapeJsArg,
  getTimeAgo,
  stripEmail,
  cleanHandle,
  isVideoUrl,
  crmNormName,
  crmMonthsSince,
  hashStr,
  normTxt,
  starStr,
  agYmd,
  throttle,
} from '../lib/utils';

describe('utils — parseBRL/fmtBRL', () => {
  it('parseBRL trata "1.500,50" como 1500.5', () => {
    expect(parseBRL('1.500,50')).toBeCloseTo(1500.5);
  });
  it('parseBRL devolve 0 pra vazio/null', () => {
    expect(parseBRL('')).toBe(0);
    expect(parseBRL(null)).toBe(0);
  });
  it('parseBRL aceita number direto', () => {
    expect(parseBRL(42)).toBe(42);
  });
  it('fmtBRL formata em pt-BR', () => {
    expect(fmtBRL(1500.5)).toBe('1.500,50');
  });
  it('fmtBRL devolve "" para negativo (sentinel)', () => {
    expect(fmtBRL(-1)).toBe('');
  });
});

describe('utils — escapeHtml / escapeJsArg', () => {
  it('escapeHtml escapa todas as 5 entidades', () => {
    expect(escapeHtml('<b>"x"</b> & \'y\'')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;');
  });
  it('escapeJsArg remove < > e escapa aspas', () => {
    const out = escapeJsArg(`it's <bad>`);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain("\\'");
  });
});

describe('utils — getTimeAgo', () => {
  it('< 1min → AGORA', () => {
    expect(getTimeAgo(new Date().toISOString())).toBe('AGORA');
  });
  it('1h atrás → "HA 1 HORA"', () => {
    const d = new Date(Date.now() - 60 * 60 * 1000);
    expect(getTimeAgo(d.toISOString())).toBe('HA 1 HORA');
  });
  it('2 dias atrás → "HA 2 DIAS"', () => {
    const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(getTimeAgo(d.toISOString())).toBe('HA 2 DIAS');
  });
});

describe('utils — stripEmail / cleanHandle', () => {
  it('stripEmail substitui @dominio por @local', () => {
    expect(stripEmail('joao@gmail.com fala com maria@yahoo.com.br')).toBe('@joao fala com @maria');
  });
  it('cleanHandle prioriza tag', () => {
    expect(cleanHandle({ tag: 'joao', name: 'João' })).toBe('@joao');
    expect(cleanHandle({ name: 'João' })).toBe('João');
    expect(cleanHandle(null, 'Anônimo')).toBe('Anônimo');
  });
});

describe('utils — isVideoUrl', () => {
  it('detecta extensões de vídeo', () => {
    expect(isVideoUrl('https://x.com/a.mp4')).toBe(true);
    expect(isVideoUrl('https://x.com/a.MOV?token=1')).toBe(true);
    expect(isVideoUrl('https://x.com/a.jpg')).toBe(false);
    expect(isVideoUrl('')).toBe(false);
    expect(isVideoUrl(null)).toBe(false);
  });
});

describe('utils — crmNormName / crmMonthsSince', () => {
  it('crmNormName normaliza espaços e case', () => {
    expect(crmNormName('  JOÃO   SILVA ')).toBe('joão silva');
  });
  it('crmMonthsSince conta meses inteiros (clamp em 0)', () => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000); // amanhã
    expect(crmMonthsSince(d)).toBe(0);
  });
  it('crmMonthsSince devolve null pra inválido', () => {
    expect(crmMonthsSince(null)).toBeNull();
    expect(crmMonthsSince('lixo')).toBeNull();
  });
});

describe('utils — hashStr / normTxt / starStr / agYmd', () => {
  it('hashStr é determinístico', () => {
    expect(hashStr('foo')).toBe(hashStr('foo'));
    expect(hashStr('foo')).not.toBe(hashStr('bar'));
  });
  it('normTxt remove acentos, baixa caixa e dá padding com espaços', () => {
    expect(normTxt('JOÃO')).toBe(' joao ');
    expect(normTxt('  ').startsWith(' ')).toBe(true);
  });
  it('starStr renderiza estrelas cheias + vazias', () => {
    expect(starStr(3)).toBe('★★★☆☆');
    expect(starStr(0)).toBe('☆☆☆☆☆');
    expect(starStr(5)).toBe('★★★★★');
  });
  it('agYmd devolve YYYY-MM-DD do fuso local', () => {
    expect(agYmd(new Date('2026-05-31T12:00:00'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('utils — throttle', () => {
  it('chama no primeiro call imediatamente', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('rate-limita calls subsequentes', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    t();
    t();
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    // Trailing call dispara após a janela.
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
