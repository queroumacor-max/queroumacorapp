-- Mais 3 murais (Vida de Síndico) do 5º arquivo do usuário (2026-11-11):
-- Camping Nossa Terra (com anúncios, ativo) e 2 vazios na Mooca/Vila Prudente
-- (pausados). O Parque Santa Clara veio no arquivo mas JÁ existe: não
-- recadastrar. Endereço é do PRÉDIO/clube (público). Total 120.
-- Idempotente (ON CONFLICT na url).
INSERT INTO public.oportunidade_fontes (nome, url, cidade, bairro, endereco, cep, ativo) VALUES ('Edifício Timing Mooca', 'https://www.timingmooca.com.br/classificados', 'São Paulo', 'Mooca', 'Rua Francisco Otaviano, 19', '03111-020', false), ('Condomínio Galleria Mooca', 'https://www.galleriamooca.com.br/classificados', 'São Paulo', 'Vila Prudente', 'Praça Wilhelm Bernauer, 98', '03126-090', false), ('Clube de Camping Nossa Terra', 'https://campingnossaterra.com.br/classificados', 'Cabreúva', 'Várzea', 'Estrada dos Romeiros, km 73', '13315-000', true) ON CONFLICT (url) DO NOTHING;

-- Conferência: deve voltar ok = true (120 murais).
SELECT 'murais cadastrados >= 120' AS item, (SELECT count(*) FROM public.oportunidade_fontes) >= 120 AS ok;
