-- 2026-06-16 — orders.shipping_address: endereço de entrega do pedido da loja.
--
-- O checkout passa a capturar o endereço de entrega (texto livre) na tela do
-- carrinho. submitOrder grava nesta coluna; o modal de detalhes do portal
-- ("Pedidos da Loja") já lê `shipping_address` (mostrava placeholder até aqui).
--
-- Texto livre por simplicidade (rua, número, bairro, cidade/UF, CEP,
-- complemento numa string). Estruturar em colunas separadas depois, se preciso.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_address text;
