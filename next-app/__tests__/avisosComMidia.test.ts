// Avisos do portal com foto/vídeo + aparecendo no app (2026-11-06).
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { avisoDeLinha } from '@/lib/services/announcements';

type Arq = { type?: string; name?: string };
let tipoDeMidiaDoAviso: (f: Arq) => 'image' | 'video' | null;
let mimeDoAviso: (f: Arq, t: string) => string;

const portal = () => readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');

beforeAll(() => {
  const src = portal();
  const ini = src.indexOf('// [teste:aviso-midia-inicio]');
  const fim = src.indexOf('// [teste:aviso-midia-fim]');
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  const trecho = src.slice(ini, fim);
  expect(trecho).not.toMatch(/<[A-Za-z]/); // só JS, sem JSX
  const fn = new Function(`${trecho}; return { tipoDeMidiaDoAviso, mimeDoAviso };`);
  ({ tipoDeMidiaDoAviso, mimeDoAviso } = fn());
});

describe('tipoDeMidiaDoAviso (portal)', () => {
  it('reconhece foto e vídeo pelo tipo declarado', () => {
    expect(tipoDeMidiaDoAviso({ type: 'image/png', name: 'a.png' })).toBe('image');
    expect(tipoDeMidiaDoAviso({ type: 'video/quicktime', name: 'a.mov' })).toBe('video');
  });
  it('cai na extensão quando o tipo vem vazio ou genérico', () => {
    expect(tipoDeMidiaDoAviso({ type: '', name: 'promo.JPG' })).toBe('image');
    expect(tipoDeMidiaDoAviso({ type: 'application/octet-stream', name: 'v.mp4' })).toBe('video');
    expect(mimeDoAviso({ type: '', name: 'v.mov' }, 'video')).toBe('video/quicktime');
  });
  it('recusa o que não é foto/vídeo aceito pelo bucket', () => {
    expect(tipoDeMidiaDoAviso({ type: 'application/pdf', name: 'a.pdf' })).toBeNull();
    expect(tipoDeMidiaDoAviso({ type: 'image/svg+xml', name: 'a.svg' })).toBeNull();
    expect(tipoDeMidiaDoAviso({ type: '', name: 'sem-extensao' })).toBeNull();
  });
});

describe('portal: upload e gravação', () => {
  it('sobe no path do próprio uid (Wave 27) e grava media_url/media_type', () => {
    const src = portal();
    expect(src).toContain("user.id + '/avisos/'");
    expect(src).toContain('linha.media_url = midia.url');
    expect(src).toContain('linha.media_type = midia.tipo');
  });
  it('o SRI do index bate com o app.js compilado', () => {
    const html = readFileSync(join(process.cwd(), 'public/portal/index.html'), 'utf8');
    const js = readFileSync(join(process.cwd(), 'public/portal/app.js'));
    const h = createHash('sha384').update(js).digest('base64');
    expect(html).toContain(`sha384-${h}`);
  });
});

describe('app: avisoDeLinha', () => {
  it('lê a linha com mídia', () => {
    const a = avisoDeLinha({ id: 'x', title: 'T', message: 'M', created_at: '2026-11-06T10:00:00Z', media_url: 'https://h/v.mp4', media_type: 'video' });
    expect(a).toMatchObject({ id: 'x', media_url: 'https://h/v.mp4', media_type: 'video' });
  });
  it('sem a coluna (SQL pendente) fica sem mídia, mas o aviso aparece', () => {
    expect(avisoDeLinha({ id: 'y', title: 'T', message: 'M', created_at: '2026-11-06T10:00:00Z' }))
      .toMatchObject({ id: 'y', media_url: null, media_type: null });
  });
  it('tipo inválido ou URL vazia não vira mídia; linha sem id é descartada', () => {
    expect(avisoDeLinha({ id: 'z', media_url: ' ', media_type: 'video' })?.media_type).toBeNull();
    expect(avisoDeLinha({ id: 'w', media_url: 'https://h/a.jpg', media_type: 'gif' })?.media_type).toBeNull();
    expect(avisoDeLinha({ title: 'sem id' })).toBeNull();
  });
});

describe('a tela de notificações mostra os avisos', () => {
  it('NotificationsList monta <AvisosDaLoja>', () => {
    const src = readFileSync(join(process.cwd(), 'app/notificacoes/NotificationsList.tsx'), 'utf8');
    expect((src.match(/<AvisosDaLoja \/>/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
