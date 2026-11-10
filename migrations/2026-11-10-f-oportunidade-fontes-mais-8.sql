-- Mais 8 murais (Vida de Síndico) do 2º arquivo do usuário (92 murais): 5 com
-- anúncios (ativos) e 3 vazios (pausados). Ficam DE FORA os 2 da plataforma
-- Canal Condomínio (ccportal.com.br): formato e autorização são outros.
INSERT INTO public.oportunidade_fontes (nome, url, cidade, ativo) VALUES ('Condomínio ON Belém View', 'https://www.onbelemview.com.br/classificados', 'São Paulo', true), ('Condomínio Viverde', 'https://www.condominioviverde.com.br/classificados', 'São Paulo', true), ('Condomínio Enjoy Freguesia do Ó', 'https://www.condominioenjoyfreguesia.com.br/classificados', 'São Paulo', true), ('Condomínio Urban Resort', 'https://www.condominiourbanresort.com.br/classificados', 'São Paulo', true), ('Rossi Atual Alto da Lapa', 'https://rossiatualaltodalapa.com.br/classificados', 'São Paulo', true), ('Conjunto Residencial Cupecê', 'https://www.residencialcupece.com.br/classificados', 'São Paulo', false), ('Condomínio Bernardo Serson', 'https://www.bernardoserson.com.br/classificados', 'São Paulo', false), ('Condomínio Praça do Sol', 'https://www.condominiopracadosol.com.br/classificados', 'São Paulo', false) ON CONFLICT (url) DO NOTHING;

-- Conferência: deve voltar ok = true (90 murais).
SELECT 'murais cadastrados >= 90' AS item, (SELECT count(*) FROM public.oportunidade_fontes) >= 90 AS ok;
