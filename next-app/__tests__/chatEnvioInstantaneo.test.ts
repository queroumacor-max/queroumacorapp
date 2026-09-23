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

  it('moderação é pedida ao SERVIDOR depois do envio (não roda no navegador)', () => {
    // Achado do Codex (PR #394): moderar no cliente morria junto com o app.
    expect(hook).toContain('pedirModeracao(real.id)');
    expect(hook).toContain("'/api/chat/moderate-message'");
    expect(hook).toContain('keepalive: true');
  });

  it('destinatário recebe a remoção por broadcast e refaz a consulta', () => {
    const rt = readFileSync(resolve(__dirname, '../lib/hooks/useChatRealtime.ts'), 'utf8');
    expect(rt).toContain("{ event: 'msg-removed' }");
    expect(rt).toMatch(/msg-removed[\s\S]*invalidateQueries\(\{ queryKey: \['chat', 'messages', p\.conversationId\] \}\)/);
  });

  it('send não é barrado por mutation.isPending', () => {
    expect(hook).not.toMatch(/if \(mutation\.isPending\) return;/);
  });

  it('composer não trava o campo enquanto envia', () => {
    expect(composer).not.toMatch(/const busy = sending/);
    expect(composer).not.toMatch(/if \(sending \|\| disabled\) return/);
  });
});
