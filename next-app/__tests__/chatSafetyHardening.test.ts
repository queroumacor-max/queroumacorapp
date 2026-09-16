// Guarda de CONTEÚDO da migration 2026-09-15-chat-safety-hardening.sql.
//
// A lógica de verdade (rate limit por par remetente→destinatário em
// `messages`, redação do texto da mensagem no push) vive inteira em SQL —
// não há código TS pra exercitar num teste de unidade normal. Este teste lê
// o arquivo e trava os invariantes que não podem regredir silenciosamente
// numa edição futura do SQL: o trigger existe, chama check_rate_limit com
// os parâmetros certos, e o push de mensagem não carrega mais `NEW.body`
// (o texto real da conversa) — só um rótulo genérico.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(
  new URL('../../migrations/2026-09-15-chat-safety-hardening.sql', import.meta.url),
  'utf8',
);

describe('rate limit de mensagens (parte A)', () => {
  it('cria o trigger BEFORE INSERT em messages', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_rate_limit_messages/);
    expect(SQL).toMatch(/BEFORE INSERT ON public\.messages/);
  });

  it('chama check_rate_limit com a chave por PAR remetente>destinatário, não só o remetente', () => {
    expect(SQL).toMatch(/NEW\.sender_id::text \|\| '>' \|\| NEW\.receiver_id::text/);
    expect(SQL).toMatch(/check_rate_limit\(v_key, 'chat-message', 30, 1\)/);
  });

  it('isenta mensagens type=system do limite (marcadores internos, ex. __STORE_ADDED__)', () => {
    expect(SQL).toMatch(/COALESCE\(NEW\.type, 'text'\) = 'system'/);
  });

  it('a mensagem de erro contém "rate limit" — precisa continuar batendo com o pattern de lib/errors-friendly.ts', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'rate limit:/);
  });

  it('falha da própria checagem (função indisponível) não bloqueia o envio', () => {
    expect(SQL).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*RETURN NEW; -- infra indisponível/);
  });
});

describe('push de mensagem sem o texto da conversa (parte B)', () => {
  it('recria dispatch_push_on_notification com um ramo dedicado pra type=message', () => {
    expect(SQL).toMatch(/IF NEW\.type = 'message' THEN/);
  });

  it('o corpo do push pra mensagem NUNCA referencia NEW.body (o texto real)', () => {
    const fnStart = SQL.indexOf('CREATE OR REPLACE FUNCTION public.dispatch_push_on_notification');
    const fnEnd = SQL.indexOf('DROP TRIGGER IF EXISTS trg_dispatch_push_notification', fnStart);
    const fnBody = SQL.slice(fnStart, fnEnd);
    // No ramo de message: só o nome do ator + rótulo fixo. NEW.body só pode
    // aparecer no ramo ELSE (demais tipos de notificação, que não carregam
    // texto de conversa privada).
    expect(fnBody).toMatch(/v_push_body := COALESCE\(v_actor_name, 'Alguém'\) \|\| ' enviou uma mensagem';/);
    // Garante que a atribuição de NEW.body só existe uma vez (no ramo ELSE).
    const bodyAssignments = fnBody.match(/COALESCE\(NEW\.body, ''\)/g) ?? [];
    expect(bodyAssignments.length).toBe(1);
  });

  it('mantém o teto por destinatário (push-dispatch) da auditoria FCM/push anterior', () => {
    expect(SQL).toMatch(/check_rate_limit\(NEW\.user_id::text, 'push-dispatch', 20, 1\)/);
  });

  it('notifications.body (usado na tela /notificacoes dentro do app) não é alterado — só o texto que SAI pelo push', () => {
    // A tabela `notifications` em si (INSERT feito pelas triggers de
    // notify_on_message etc.) não é tocada por este arquivo — confirma que
    // este arquivo não faz nenhum UPDATE/ALTER na tabela notifications.
    expect(SQL).not.toMatch(/UPDATE public\.notifications/);
    expect(SQL).not.toMatch(/ALTER TABLE public\.notifications/);
  });
});
