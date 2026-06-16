-- 2026-06-16 — orders_status_check: aceitar status de fulfillment do portal.
--
-- O portal "Pedidos da Loja" oferece os status de fulfillment (Em andamento,
-- Enviado, Concluído, Cancelado) que o operador seta manualmente. O constraint
-- antigo só aceitava os status de PAGAMENTO (setados pelo webhook do MP), então
-- mudar o status no portal estourava:
--   new row for relation "orders" violates check constraint "orders_status_check"
--
-- Expande o constraint pra aceitar os dois vocabulários. Grafia 'canceled'
-- (1 L) pra casar com o webhook/portal. Superset do anterior → não viola
-- nenhuma linha existente.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending','paid','amount_mismatch','refunded','canceled',
    'processing','shipped','completed'
  ));
