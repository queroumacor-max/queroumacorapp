// Redirect de compatibilidade: /orcamento/novo não é uma rota real (o cliente
// pede orçamento pelo botão "Pedir orçamento" no perfil de um profissional,
// que abre o OrcamentoSheet). Links/deep-links antigos ou adivinhados pra
// /orcamento/novo caíam em 404 — aqui mandamos pra lista de orçamentos.
import { redirect } from 'next/navigation';

export default function OrcamentoNovoRedirect() {
  redirect('/orcamentos');
}
