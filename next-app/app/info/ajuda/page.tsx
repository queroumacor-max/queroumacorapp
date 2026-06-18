// Página /info/ajuda — Central de Ajuda (FAQ). Conteúdo idêntico ao
// vanilla index.html linha 1144-1162.
import type { Metadata } from 'next';
import { InfoSubPage, FaqItem } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Central de Ajuda | QueroUmaCor',
  description:
    'Perguntas frequentes sobre cadastro, orçamentos, portfólio e mais.',
};

export default function AjudaPage() {
  return (
    <InfoSubPage title="Central de Ajuda">
      <FaqItem
        q="O que é o QueroUmaCor?"
        a="É um aplicativo que conecta clientes a profissionais de pintura — pintores residenciais e comerciais, grafiteiros e muralistas, pintores automotivos e funileiros. Você encontra profissionais perto de você, vê portfólios, pede orçamentos e conversa pelo chat."
      />
      <FaqItem
        q="Como faço meu cadastro?"
        a="O cadastro é gratuito e aberto a todos. Basta abrir a tela de cadastro, escolher se você é cliente ou profissional, preencher seus dados e pronto. Se você chegou pelo link de perfil de alguém que já usa o app, essa pessoa ganha um bônus de indicação — mas isso é opcional."
      />
      <FaqItem
        q="Como peço um orçamento?"
        a={`Abra o perfil de um profissional e toque em "Solicitar Orçamento". Informe o tipo de serviço, a metragem, o endereço e os detalhes. O profissional recebe o pedido e responde pelo chat.`}
      />
      <FaqItem
        q="Como compartilho o meu perfil?"
        a={`Na sua tela de perfil, toque em "Compartilhar". O app monta um resumo do seu trabalho com um link. Quem abrir o link já entra direto na criação de conta.`}
      />
      <FaqItem
        q="O app é gratuito?"
        a="Sim. Criar uma conta e usar as funções principais é gratuito. Alguns recursos avançados (PRO) podem ter custo, sempre informado antes."
      />
      <FaqItem
        q="Como adiciono fotos ao meu portfólio?"
        a={`Na sua tela de perfil, na seção "Meu Portfólio", toque em "+ Adicionar" e envie fotos ou vídeos dos seus trabalhos.`}
      />
      <FaqItem
        q="Esqueci minha senha. E agora?"
        a="Na tela de login, toque na opção de recuperação de senha e informe seu e-mail. Você receberá uma mensagem com o passo a passo para criar uma nova senha."
      />
      <FaqItem
        q="Não encontrei o que eu procurava."
        a={`Sem problema — fale com a gente em "Fale Conosco" e teremos prazer em ajudar.`}
      />
    </InfoSubPage>
  );
}
