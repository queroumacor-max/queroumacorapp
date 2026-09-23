// runAfterResponse — mantém o worker vivo pra terminar o trabalho DEPOIS de
// a resposta já ter saído.
//
// Por que existe (2026-09-05): o webhook do WhatsApp passou a responder 200
// na hora e gravar no Supabase depois. No edge do Cloudflare o worker é
// encerrado assim que a resposta sai — uma promessa solta seria abortada no
// meio, e a mensagem sumiria sem erro nenhum. `ctx.waitUntil` é o que impede
// isso, e ele vive no mesmo símbolo global de onde `getRuntimeEnv` lê as envs.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAfterResponse } from '@/lib/api/env';

const CF = Symbol.for('__cloudflare-request-context__');

function comContexto(waitUntil: (p: Promise<unknown>) => void) {
  (globalThis as Record<symbol, unknown>)[CF] = { env: {}, ctx: { waitUntil } };
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CF];
  vi.restoreAllMocks();
});

describe('runAfterResponse', () => {
  it('entrega o trabalho ao waitUntil do worker', async () => {
    const waitUntil = vi.fn();
    comContexto(waitUntil);

    let terminou = false;
    runAfterResponse(Promise.resolve().then(() => { terminou = true; }));

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(terminou).toBe(true);
  });

  it('sem contexto (dev/vitest) roda mesmo assim, sem lançar', async () => {
    // Não há worker pra manter vivo — o trabalho simplesmente acontece.
    let terminou = false;
    expect(() =>
      runAfterResponse(Promise.resolve().then(() => { terminou = true; })),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(terminou).toBe(true);
  });

  it('trabalho que falha NÃO propaga — vira log', async () => {
    // O ponto todo: a resposta já foi enviada. Uma rejeição aqui não pode
    // virar unhandled rejection e derrubar o worker.
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const waitUntil = vi.fn();
    comContexto(waitUntil);

    runAfterResponse(Promise.reject(new Error('supabase caiu')));

    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();
  });

  // Regressão 2026-09-05 (produção respondeu 500). `waitUntil` era extraído
  // do ctx e chamado solto — o ExecutionContext do workerd é nativo e lança
  // `TypeError: Illegal invocation` sem o `this` certo, de forma SÍNCRONA,
  // dentro do handler. O teste antigo passava porque `vi.fn()` num objeto
  // literal é função JS comum e não liga pro `this`; só um objeto que EXIGE
  // o `this` reproduz o caso.
  it('chama waitUntil com o ctx como `this` (nativo exige)', async () => {
    const recebidos: Array<Promise<unknown>> = [];
    const ctx = {
      marcaDeIdentidade: true,
      waitUntil(this: unknown, p: Promise<unknown>) {
        // É isto que o runtime nativo faz: reclama de `this` errado.
        if (this !== ctx) {
          throw new TypeError(
            'Illegal invocation: function called with incorrect `this` reference',
          );
        }
        recebidos.push(p);
      },
    };
    (globalThis as Record<symbol, unknown>)[CF] = { env: {}, ctx };

    let terminou = false;
    expect(() =>
      runAfterResponse(Promise.resolve().then(() => { terminou = true; })),
    ).not.toThrow();

    expect(recebidos).toHaveLength(1);
    await recebidos[0];
    expect(terminou).toBe(true);
  });

  it('waitUntil que lança NÃO derruba o handler — o trabalho segue', async () => {
    // Mesmo que o runtime recuse o keep-alive, a resposta já estava certa:
    // lançar aqui viraria 500 numa request correta. Degrada, não quebra.
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    comContexto(() => {
      throw new TypeError('Illegal invocation');
    });

    let terminou = false;
    expect(() =>
      runAfterResponse(Promise.resolve().then(() => { terminou = true; })),
    ).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    expect(terminou).toBe(true);
    expect(erro).toHaveBeenCalled();
  });

  it('contexto sem ctx.waitUntil não quebra', () => {
    // next-on-pages nem sempre publica o ctx (build, preview de rota
    // estática). Cair pro caminho de rodar direto é o certo.
    (globalThis as Record<symbol, unknown>)[CF] = { env: {} };
    expect(() => runAfterResponse(Promise.resolve())).not.toThrow();
  });
});

// Regressão 2026-09-23: depois da migração pro @opennextjs/cloudflare o
// contexto passou a morar em `__cloudflare-context__`. Lendo só o symbol
// antigo, o waitUntil nunca era achado e o webhook do WhatsApp perdia a
// gravação da mensagem recebida (promessa solta, cancelada pelo workerd).
describe('runAfterResponse no OpenNext (Workers)', () => {
  const OPENNEXT = Symbol.for('__cloudflare-context__');
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[OPENNEXT];
  });

  it('acha o ctx.waitUntil no symbol do OpenNext', () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[OPENNEXT] = { env: {}, ctx: { waitUntil } };
    runAfterResponse(Promise.resolve());
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('getRuntimeEnv lê o env do symbol do OpenNext', async () => {
    const { getRuntimeEnv } = await import('@/lib/api/env');
    (globalThis as Record<symbol, unknown>)[OPENNEXT] = { env: { X_TESTE_OPENNEXT: 'ok' } };
    expect(getRuntimeEnv('X_TESTE_OPENNEXT')).toBe('ok');
  });
});
