// Página /info/termos-cliente — Termos de Uso específicos do Cliente.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Termos de Uso - Cliente | QueroUmaCor',
  description: 'Termos de uso específicos para clientes do QueroUmaCor.',
};

export default function TermosClientePage() {
  return (
    <InfoSubPage title="Termos de Uso - Cliente">
      <LegalUpd>Última atualização: 26 de setembro de 2026</LegalUpd>
      <LegalP>
        Estes Termos complementam os{' '}
        <a
          href="/info/termos"
          style={{ color: 'var(--color-p1)', fontWeight: 600 }}
        >
          Termos de Uso gerais
        </a>{' '}
        e aplicam-se especificamente aos clientes que contratam serviços na
        plataforma QueroUmaCor.
      </LegalP>

      <LegalH>1. Responsabilidade pela contratação</LegalH>
      <LegalP>
        O cliente é responsável por descrever claramente o serviço desejado. O
        contrato é firmado diretamente entre cliente e profissional; o
        QueroUmaCor não é parte nessa relação.
      </LegalP>

      <LegalH>2. Pagamentos</LegalH>
      <LegalP>
        <b>Não há cobrança nem pagamento dentro do aplicativo.</b> O Plano PRO
        é ativado pela troca de pontos acumulados no app (ver o item 13 dos
        Termos de Uso gerais) e os pedidos feitos na loja são fechados
        diretamente com a Cali Colors, fora do aplicativo. As negociações e os
        pagamentos dos serviços são de responsabilidade exclusiva das partes
        (cliente e profissional).
      </LegalP>

      <LegalH>3. Avaliações</LegalH>
      <LegalP>
        As avaliações devem ser honestas e baseadas em experiências reais.
        Avaliações falsas ou difamatórias serão removidas.
      </LegalP>

      <LegalH>4. Direito de arrependimento</LegalH>
      <LegalP>
        Como o Plano PRO é obtido por troca de pontos e não envolve pagamento
        em dinheiro, não há cobrança, fatura nem reembolso associados a ele. As
        compras feitas diretamente com a loja Cali Colors, fora do aplicativo,
        seguem os seus direitos de consumidor, inclusive o prazo de{' '}
        <b>7 dias corridos</b> para arrependimento em compras a distância
        (Art. 49 do Código de Defesa do Consumidor).
      </LegalP>

      <LegalH>5. Resolução de problemas</LegalH>
      <LegalP>
        Em caso de problemas, tente resolver diretamente com o profissional
        primeiro. Não havendo acordo, abra uma disputa pelo e-mail{' '}
        <b>loja@calicolors.com.br</b> ou pelo WhatsApp{' '}
        <b>(11) 95976-5031</b>. O QueroUmaCor atuará como mediador.
      </LegalP>

      <LegalH>6. Uso aceitável</LegalH>
      <LegalP>
        Use a plataforma para encontrar, contratar e acompanhar serviços e para
        interagir com a comunidade, respeitando os Termos de Uso gerais. Se um
        profissional vincular você a uma obra, você passa a ver o status, a
        agenda e quem foi escalado nela; peça a ele para remover o vínculo se
        não quiser mais acompanhar.
      </LegalP>
    </InfoSubPage>
  );
}
