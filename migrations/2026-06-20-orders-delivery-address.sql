-- Adiciona coluna de endereço de entrega na tabela orders.
-- Usado pelo carrinho da loja pra salvar CEP, rua, número, cidade e estado
-- que o cliente preenche opcionalmente antes de enviar a lista de pedido.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address text;
