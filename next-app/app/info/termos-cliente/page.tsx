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
      <LegalUpd>Última atualização: 17 de junho de 2026</LegalUpd>
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
        O QueroUmaCor processa apenas os pagamentos do <b>Plano PRO</b>, via
        Mercado Pago. As negociações e os pagamentos dos serviços são de
        responsabilidade exclusiva das partes (cliente e profissional).
      </LegalP>

      <LegalH>3. Avaliações</LegalH>
      <LegalP>
        As avaliações devem ser honestas e baseadas em experiências reais.
        Avaliações falsas ou difamatórias serão removidas.
      </LegalP>

      <LegalH>4. Direito de arrependimento</LegalH>
      <LegalP>
        Você tem <b>7 dias corridos</b> para desistir do Plano PRO, com
        reembolso integral, conforme o Art. 49 do Código de Defesa do
        Consumidor.
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
        Não use a plataforma para fins que não sejam a contratação de serviços.
      </LegalP>
    </InfoSubPage>
  );
}
