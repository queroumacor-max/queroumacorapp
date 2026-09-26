-- Chave de idempotência do pedido da loja (2026-09-26).
--
-- O app manda `idempotency_key` no INSERT de `orders`. Repetir o envio do
-- mesmo carrinho (resposta perdida na rede, toque de novo depois do erro)
-- manda a MESMA chave, e o índice único abaixo recusa o segundo INSERT com
-- 23505 — o app então devolve o pedido que já existe.
--
-- Rodar UMA LINHA POR VEZ no SQL Editor. Idempotente: rodar de novo não faz
-- nada. O código tolera a coluna ausente (grava sem a chave), então a ordem
-- deploy × SQL não quebra o pedido.

-- 1) Coluna (nullable: pedidos antigos ficam sem chave).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;

-- 2) Único por usuário. Parcial: NULL (pedido antigo / app antigo) não conflita.
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_key_uniq ON public.orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3) Teto de tamanho (a chave vem do cliente). NOT VALID: não há linha antiga com chave.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_idempotency_key_len') THEN ALTER TABLE public.orders ADD CONSTRAINT orders_idempotency_key_len CHECK (idempotency_key IS NULL OR char_length(idempotency_key) <= 100) NOT VALID; END IF; END $$;

-- Conferência (3 linhas, todas ok = true):
SELECT 'coluna idempotency_key' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='idempotency_key') AS ok
UNION ALL SELECT 'indice unico', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='orders_user_idempotency_key_uniq')
UNION ALL SELECT 'check de tamanho', EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_idempotency_key_len');
