-- 2026-11-10 — catálogo ampliado de murais de condomínio (lista levantada
-- pelo usuário: 82 murais da plataforma Vida de Síndico em Guarulhos e São
-- Paulo; ele informou que a plataforma autorizou a leitura).
--
-- Entram 78 (os 4 primeiros já estão cadastrados pela migration -c; a lista
-- os traz com "www" em um caso, e cadastrar a MESMA página com outra URL
-- duplicaria os pedidos, porque a chave do anúncio inclui a URL da fonte).
-- Os 48 que tinham anúncios entram ATIVOS; os 30 que estavam vazios entram
-- PAUSADOS (dá pra reativar pelo portal).
--
-- Com 52 murais ativos, o cron passa de 1x/dia pra de 4 em 4 horas: cada
-- rodada lê 12 em rodízio (o que está há mais tempo sem ler primeiro), então
-- cada mural é lido pelo menos uma vez por dia.
-- Rodar DEPOIS de 2026-11-10-c-oportunidades-fontes.sql.

INSERT INTO public.oportunidade_fontes (nome, url, cidade, ativo) VALUES
('Condomínio Parque Residence', 'https://condominioparqueresidence.com.br/classificados', 'Guarulhos', true),
('Edifício Fatto Reserva Vila Rio', 'https://www.fattoreserva.com.br/classificados', 'Guarulhos', true),
('Condomínio Vida Plena Guarulhos', 'https://vidaplenaguarulhos.com.br/classificados', 'Guarulhos', true),
('Pateo Dona Tecla', 'https://www.donatecla.com.br/classificados', 'Guarulhos', true),
('Varandas Residências Iluminadas', 'https://www.varandasiluminadas.com.br/classificados', 'Guarulhos', true),
('Condomínio Premium Guarulhos', 'https://www.condominiopremiumguarulhos.com.br/classificados', 'Guarulhos', false),
('Condomínio Residencial Altavista', 'https://www.residencialaltavistasp.com.br/classificados', 'Guarulhos', false),
('Condomínio Ello Home Club', 'https://www.elloclube.com.br/classificados', 'São Paulo', true),
('Residencial IN SP Vilaboim', 'https://www.inspvilaboim.com.br/classificados', 'São Paulo', true),
('Condomínio Espaço Contemporâneo', 'https://espacocontemporaneo.com.br/classificados', 'São Paulo', true),
('Edifício Estação Gabriele', 'https://estacaogabriele.com.br/classificados', 'São Paulo', true),
('Condomínio Buritis', 'https://buritissp.com.br/classificados', 'São Paulo', true),
('Condomínio Vila Socorro', 'https://condominiovilasocorro.com.br/classificados', 'São Paulo', true),
('Downtown Smart Living', 'https://www.condominiodowntown.com.br/classificados', 'São Paulo', true),
('Edifício Art Pompéia', 'https://www.artpompeia.com.br/classificados', 'São Paulo', true),
('Edifício Marquesa e Santos', 'https://www.condominiomarquesaesantos.com.br/classificados', 'São Paulo', true),
('Condomínio Reserva do Alto', 'https://www.reservadoaltosp.com.br/classificados', 'São Paulo', true),
('Nik Paulista', 'https://www.niksp.com.br/classificados', 'São Paulo', true),
('Condomínio Praça das Águas', 'https://pracadasaguas.com.br/classificados', 'São Paulo', true),
('Edifícios San Sebastian e San Paolo', 'https://sansebastianesanpaolo.com.br/classificados', 'São Paulo', true),
('Edifício Palazzo Dell''Arte', 'https://palazzodellarte.com.br/classificados', 'São Paulo', true),
('Condomínio Le Havre', 'https://www.condominiolehavre.com.br/classificados', 'São Paulo', true),
('Infini Vila Mariana', 'https://www.condinfinivilamariana.com.br/classificados', 'São Paulo', true),
('Way Butantã', 'https://www.waybutantasp.com.br/classificados', 'São Paulo', true),
('Edifício EXT Campo Belo', 'https://www.extcampobelo.com.br/classificados', 'São Paulo', false),
('Condomínio Super Class Lago dos Patos', 'https://www.superclasslagodospatos.com.br/classificados', 'Guarulhos', true),
('Condomínio Clip Design', 'https://www.clipdesignguarulhos.com.br/classificados', 'Guarulhos', false),
('Condomínio Residencial Los Rosales', 'https://www.losrosales.com.br/classificados', 'Guarulhos', false),
('Residencial Flor de Liz', 'https://www.residencialflordelizsp.com.br/classificados', 'Guarulhos', false),
('Residencial Santa Sofia', 'https://www.residencialsantasofia.com.br/classificados', 'Guarulhos', false),
('Bem Viver Praça Buarque', 'https://bvpracabuarque.com.br/classificados', 'São Paulo', true),
('Condomínio Air Campo Belo', 'https://condaircampobelo.com.br/classificados', 'São Paulo', true),
('Condomínio Bem Viver General', 'https://www.condominiobemvivergeneral.com.br/classificados', 'São Paulo', true),
('Condomínio Chácara das Flores', 'https://www.edificiochacaradasflores.com.br/classificados', 'São Paulo', true),
('Condomínio Edifício Image', 'https://www.condominioimage.com.br/classificados', 'São Paulo', true),
('Condomínio Edifício Itapema', 'https://www.edificioitapema.com.br/classificados', 'São Paulo', true),
('Condomínio Família Santa Archélia', 'https://santaarchelia.com.br/classificados', 'São Paulo', true),
('Condomínio Grand Mooca', 'https://www.condominiograndmooca.com.br/classificados', 'São Paulo', true),
('Condomínio Home Club Carrão', 'https://www.condominiohomeclubcarrao.com.br/classificados', 'São Paulo', true),
('Condomínio Mansão Butantã', 'https://mansaodobutanta.com.br/classificados', 'São Paulo', true),
('Condomínio Mirante do Tatuape', 'https://mirantetatuape.com.br/classificados', 'São Paulo', true),
('Condomínio Mixer Jump', 'https://mixerjump.com.br/classificados', 'São Paulo', true),
('Condomínio My Space', 'https://www.condominiomyspace.com.br/classificados', 'São Paulo', true),
('Condomínio Retrato Paulista', 'https://www.condominioretratopaulista.com.br/classificados', 'São Paulo', true),
('Duetto Damebe Residence', 'https://www.duettodameberesidence.com.br/classificados', 'São Paulo', true),
('Edificio Boulevard Itararé', 'https://www.edificioboulevarditarare.com.br/classificados', 'São Paulo', true),
('In Parque Belém Perdizes', 'https://www.inbelemperdizes.com.br/classificados', 'São Paulo', true),
('IN SP Villa Lobos', 'https://www.inspvillalobos.com.br/classificados', 'São Paulo', true),
('Residencial Garden Itaquera', 'https://www.residencialgardenitaquera.com.br/classificados', 'São Paulo', true),
('Residencial IN SP Ibirapuera', 'https://inspibirapuerasp.com.br/classificados', 'São Paulo', true),
('Residencial Mérito Aricanduva', 'https://www.meritoaricanduva.com.br/classificados', 'São Paulo', true),
('Residencial My Click', 'https://residencialmyclick.com.br/classificados', 'São Paulo', true),
('Residencial Portal de Barcelos', 'https://www.portaldebarcelos.com.br/classificados', 'São Paulo', true),
('Universo Tatuapé - Condomínio Estrela', 'https://www.universoestrela.com.br/classificados', 'São Paulo', true),
('Verita Residencial Freguesia', 'https://www.veritafreguesia.com.br/classificados', 'São Paulo', true),
('Bem Viver Cesário Mota', 'https://www.bvcesariomota.com.br/classificados', 'São Paulo', false),
('Bem Viver Itu', 'https://www.bvitu.com.br/classificados', 'São Paulo', false),
('Bem Viver Santa Cecilia', 'https://www.bvsantacecilia.com.br/classificados', 'São Paulo', false),
('Condomínio 360°', 'https://www.condominio360sp.com.br/classificados', 'São Paulo', false),
('Condomínio Brooklin Park Spa & Club', 'https://www.brooklinparkspa.com.br/classificados', 'São Paulo', false),
('Condomínio Edifício Cadmus', 'https://www.edificiocadmus.com.br/classificados', 'São Paulo', false),
('Condomínio Edifício Ginza', 'https://www.edificioginza.com.br/classificados', 'São Paulo', false),
('Condomínio Edifício Jamaica', 'https://www.condominiojamaica.com.br/classificados', 'São Paulo', false),
('Condomínio Edifício São Martinho', 'https://www.condominiosaomartinho.com.br/classificados', 'São Paulo', false),
('Condomínio Edifício You link Saúde', 'https://www.condominioyoulinksaude.com.br/classificados', 'São Paulo', false),
('Condomínio Mariz Vila Mariana', 'https://www.condominiomarizvilamariana.com.br/classificados', 'São Paulo', false),
('Condomínio Quartier Klabin', 'https://www.quartierklabin.com.br/classificados', 'São Paulo', false),
('Condomínio Villagio Giardino', 'https://villagiogiardino.com.br/classificados', 'São Paulo', false),
('Edifício Costa Smeralda', 'https://www.edificiocostasmeralda.com.br/classificados', 'São Paulo', false),
('Edificio Fatto Unique Vila Sonia', 'https://www.fattouniquevilasonia.com.br/classificados', 'São Paulo', false),
('Edifício Gran Paradiso', 'https://www.condominiogranparadiso.com.br/classificados', 'São Paulo', false),
('Edifício Maison Montparnasse', 'https://www.maisonmontparnasse.com.br/classificados', 'São Paulo', false),
('Edifício Morada do Alto', 'https://www.moradadoalto.com.br/classificados', 'São Paulo', false),
('Edifício Saint Germain', 'https://www.edificiosaintgermain.com.br/classificados', 'São Paulo', false),
('Insight Vila Leopoldina', 'https://www.insightvilaleopoldina.com.br/classificados', 'São Paulo', false),
('Modern Life Vila Mariana', 'https://www.condominiomodernlife.com.br/classificados', 'São Paulo', false),
('Pamplona Studios By Setin', 'https://www.pamplonastudios.com.br/classificados', 'São Paulo', false),
('Residencial Plaza de Carmona', 'https://www.residencialplazacarmona.com.br/classificados', 'São Paulo', false)
ON CONFLICT (url) DO NOTHING;

SELECT cron.schedule('oportunidades-varredura', '17 */4 * * *', $$SELECT public.run_oportunidades_varredura();$$);

-- Conferência: as 3 linhas devem voltar ok = true.
SELECT 'murais cadastrados (82)' AS item, (SELECT count(*) FROM public.oportunidade_fontes) >= 82 AS ok
UNION ALL SELECT 'murais ativos (52)', (SELECT count(*) FROM public.oportunidade_fontes WHERE ativo) >= 52
UNION ALL SELECT 'cron de 4 em 4 horas', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oportunidades-varredura' AND schedule = '17 */4 * * *');
