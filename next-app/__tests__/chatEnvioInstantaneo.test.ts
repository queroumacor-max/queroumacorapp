// Trava o envio instantâneo do chat (2026-09-23): a moderação por IA não
// pode voltar a rodar ANTES do INSERT (custava ~5s por mensagem), e o
// composer não pode voltar a travar enquanto a mensagem anterior está no ar.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(resolve(__dirname, '../lib/hooks/useChat.ts'), 'utf8');
const composer = readFileSync(
  resolve(__dirname, '../app/chat/[convId]/MessageComposer.tsx'),
  'utf8',
);

function mutationFnDoSend(): string {
  const ini = hook.indexOf('export function useSendMessage(');
  const fn = hook.indexOf('mutationFn:', ini);
  const fim = hook.indexOf('onMutate:', fn);
  return hook.slice(fn, fim);
}

describe('chat — envio instantâneo', () => {
  it('mutationFn do envio não chama /api/moderate', () => {
    expect(mutationFnDoSend()).not.toContain('/api/moderate');
    expect(mutationFnDoSend()).toContain('sendMessage(');
  });

  it('moderação roda depois do envio e apaga a reprovada', () => {
    expect(hook).toContain('moderarDepoisDeEnviar(real');
    expect(hook).toMatch(/async function moderarDepoisDeEnviar[\s\S]*softDeleteMessageSvc/);
  });

  it('send não é barrado por mutation.isPending', () => {
    expect(hook).not.toMatch(/if \(mutation\.isPending\) return;/);
  });

  it('composer não trava o campo enquanto envia', () => {
    expect(composer).not.toMatch(/const busy = sending/);
    expect(composer).not.toMatch(/if \(sending \|\| disabled\) return/);
  });
});
