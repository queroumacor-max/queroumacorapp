// Página /info/termos — Termos de Uso. Conteúdo idêntico ao vanilla
// index.html linha 1216-1244.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Termos de Uso | QueroUmaCor',
  description:
    'Regras de uso da plataforma e responsabilidades das partes.',
};

export default function TermosPage() {
  return (
    <InfoSubPage title="Termos de Uso">
      <LegalUpd>Última atualização: 26 de outubro de 2026</LegalUpd>

      <LegalH>1. Aceitação dos termos</LegalH>
      <LegalP>
        Ao criar uma conta e usar o QueroUmaCor, você concorda com estes Termos
        de Uso. Se não concordar, não utilize o aplicativo.
      </LegalP>

      <LegalH>2. O que é o QueroUmaCor</LegalH>
      <LegalP>
        O QueroUmaCor é uma plataforma de intermediação que conecta clientes a
        profissionais de pintura e acabamento — pintores, grafiteiros,
        muralistas, pintores automotivos, funileiros, arquitetos e engenheiros —
        e oferece ferramentas de trabalho (orçamentos, agenda, financeiro,
        gestão de obras, assistentes de IA, entre outras). O QueroUmaCor não
        presta esses serviços e não é parte nos contratos firmados entre os
        usuários.
      </LegalP>
      <LegalP>
        Operadora: <b>CALICOLORS TINTAS LTDA</b>, CNPJ <b>47.677.346/0001-92</b>,
        com sede na <b>
          Est. Presidente Juscelino Kubitschek de Oliveira, 1071 – Jardim
          dos Pimentas, Guarulhos/SP – CEP 07.272-345
        </b>. Contato: <b>loja@calicolors.com.br</b>.
      </LegalP>

      <LegalH>3. Cadastro e conta</LegalH>
      <LegalP>
        Você deve fornecer informações verdadeiras e mantê-las atualizadas. A
        conta é pessoal e intransferível. Você é responsável por manter a sua
        senha em sigilo. O uso é permitido somente a maiores de 18 anos, e o
        cadastro exige a data de nascimento.
      </LegalP>

      <LegalH>4. Regras de uso</LegalH>
      <LegalP>
        Você concorda em não publicar conteúdo falso, ofensivo, discriminatório
        ou ilegal; não violar direitos de terceiros; não usar a plataforma para
        spam; e não tentar burlar a segurança do app.
      </LegalP>

      <LegalH>5. Conteúdo do usuário</LegalH>
      <LegalP>
        Você é responsável pelo conteúdo que publica, como fotos de portfólio e
        descrições. Você declara ter os direitos sobre esse conteúdo e concede
        ao QueroUmaCor uma licença para exibi-lo dentro do aplicativo.
      </LegalP>
      <LegalP>
        Todo conteúdo publicado passa por moderação automática por
        inteligência artificial e, quando necessário, por revisão humana. Um
        post só aparece no feed depois de aprovado. Conteúdo que viole estes
        termos ou a lei pode ser recusado ou removido, e conteúdo ilegal pode
        ser comunicado às autoridades. Você pode pedir a revisão de uma decisão
        de moderação pelos canais de suporte. Detalhes na Política de
        Privacidade.
      </LegalP>

      <LegalH>6. Orçamentos e contratações</LegalH>
      <LegalP>
        As negociações, valores, prazos e a execução dos serviços são de
        responsabilidade exclusiva entre o cliente e o profissional. O
        QueroUmaCor não garante a contratação, a qualidade do serviço nem o
        pagamento.
      </LegalP>

      <LegalH>6.1. Loja Cali Colors</LegalH>
      <LegalP>
        Na loja do aplicativo você monta uma lista de pedido e a envia à Cali
        Colors. <b>Os produtos da loja não são pagos dentro do aplicativo</b>: a equipe da loja
        entra em contato (por exemplo, pelo WhatsApp) para confirmar
        disponibilidade, valores e forma de pagamento, e a venda é fechada
        diretamente com a loja, fora do app. Preços e disponibilidade exibidos
        no app são informativos até essa confirmação.
      </LegalP>

      <LegalH>6.2. Ferramentas e conteúdo gerado por IA</LegalH>
      <LegalP>
        Cálculos, tabelas de preço de referência, orçamentos, sugestões e
        textos ou imagens gerados por inteligência artificial são apoio ao seu
        trabalho: confira antes de usar ou enviar a terceiros. Você é
        responsável pelo que envia aos seus clientes e pelos dados de outras
        pessoas que registra nas ferramentas (como clientes e funcionários),
        devendo ter autorização delas para isso.
      </LegalP>

      <LegalH>7. Avaliações</LegalH>
      <LegalP>
        As avaliações devem ser honestas e baseadas em experiências reais.
        Avaliações falsas ou abusivas podem ser removidas.
      </LegalP>

      <LegalH>8. Propriedade intelectual</LegalH>
      <LegalP>
        A marca, o logotipo e o software do QueroUmaCor pertencem ao QueroUmaCor
        e não podem ser usados sem autorização.
      </LegalP>

      <LegalH>9. Limitação de responsabilidade</LegalH>
      <LegalP>
        O aplicativo é fornecido &quot;como está&quot;. Não nos responsabilizamos por
        danos decorrentes de negociações entre usuários ou por eventual
        indisponibilidade temporária do serviço.
      </LegalP>

      <LegalH>10. Suspensão e encerramento</LegalH>
      <LegalP>
        Podemos suspender ou encerrar contas que violem estes termos ou a
        legislação aplicável.
      </LegalP>

      <LegalH>11. Alterações dos termos</LegalH>
      <LegalP>
        Estes termos podem ser atualizados. Mudanças relevantes serão
        comunicadas no aplicativo.
      </LegalP>

      <LegalH>12. Lei aplicável e foro</LegalH>
      <LegalP>
        Estes termos são regidos pelas leis brasileiras. Fica eleito o foro do
        domicílio do consumidor para dirimir eventuais conflitos.
      </LegalP>

      <LegalH>13. Orçamentos, Gestão de Obras e Plano PRO</LegalH>
      <LegalP>
        Toda conta começa com <b>5 orçamentos grátis</b> e <b>1 obra grátis</b>
        na Gestão de Obras. Um orçamento é contado quando você o grava; uma
        obra, quando você a cria (editar não conta). Depois disso, no
        aplicativo instalado pela Google Play ou pela App Store, é possível
        comprar créditos avulsos (1 orçamento, pacote de 40 orçamentos ou 1
        obra extra) ou assinar o <b>Plano PRO</b>, que libera orçamentos e
        obras ilimitados e as ferramentas com inteligência artificial
        enquanto a assinatura estiver ativa. Créditos avulsos não vencem.
      </LegalP>
      <LegalP>
        As ferramentas com inteligência artificial fazem parte do PRO. Quem
        não é PRO pode experimentar cada uma delas gratuitamente, em
        quantidade limitada, uma vez por conta.
      </LegalP>
      <LegalP>
        <b>Os preços são os exibidos pela loja de aplicativos</b> no momento
        da compra, e o pagamento é processado pela Google Play ou pela App
        Store, conforme as regras de cada uma. A assinatura do PRO é mensal e
        <b> renova automaticamente</b> até você cancelar nas configurações de
        assinaturas da loja; o cancelamento vale ao fim do período já pago.
        Reembolsos seguem a política da loja em que a compra foi feita; um
        crédito ou período reembolsado deixa de valer no aplicativo. Use
        &quot;Restaurar compras&quot; na tela de planos para recuperar compras
        feitas na mesma conta da loja.
      </LegalP>
      <LegalP>
        Em caso de dúvida sobre o Plano PRO ou sobre compras, entre em contato
        com o suporte da Cali Colors pelo WhatsApp <b>(11) 95976-5031</b> ou
        pelo e-mail <b>loja@calicolors.com.br</b>.
      </LegalP>
    </InfoSubPage>
  );
}
