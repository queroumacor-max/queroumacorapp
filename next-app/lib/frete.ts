// Cálculo de frete (custo de deslocamento até a obra) — pedido do usuário
// em 2026-09-24: "calcular KM por litro vs valor do litro".
//
// Conta pura, sem rede nem banco: a tela (`app/frete/FreteView.tsx`) e
// qualquer outro lugar (orçamento, gestão de obras) usam a MESMA função,
// pra o número que o pintor vê ser o que vai pro orçamento.

export interface FreteInput {
  /** Distância de UM trajeto (casa/loja → obra), em km. */
  kmTrajeto: number;
  /** true = conta ida E volta (o trajeto vale 2x por viagem). */
  idaEVolta: boolean;
  /** Quantas viagens (ex.: dias de obra). Mínimo 1. */
  viagens: number;
  /** Consumo do veículo, em km por litro. */
  kmPorLitro: number;
  /** Preço do litro do combustível, em R$. */
  precoLitro: number;
  /** Pedágio + estacionamento POR VIAGEM, em R$ (opcional). */
  extrasPorViagem?: number;
}

export interface FreteResultado {
  kmTotal: number;
  litros: number;
  custoCombustivel: number;
  custoExtras: number;
  custoTotal: number;
  /** Quanto custa cada km rodado só de combustível (preço ÷ consumo). */
  custoPorKm: number;
  custoPorViagem: number;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Devolve `null` quando falta dado pra conta fazer sentido (consumo ou
 * preço zerados, distância vazia) — a tela mostra "preencha" em vez de
 * R$ 0,00, que pareceria frete de graça.
 */
export function calcularFrete(input: FreteInput): FreteResultado | null {
  const km = Number(input.kmTrajeto);
  const kmL = Number(input.kmPorLitro);
  const preco = Number(input.precoLitro);
  const viagens = Math.max(1, Math.floor(Number(input.viagens) || 1));
  const extras = Math.max(0, Number(input.extrasPorViagem) || 0);
  if (!(km > 0) || !(kmL > 0) || !(preco > 0)) return null;

  const kmTotal = km * (input.idaEVolta ? 2 : 1) * viagens;
  const litros = kmTotal / kmL;
  const custoCombustivel = litros * preco;
  const custoExtras = extras * viagens;
  const custoTotal = custoCombustivel + custoExtras;
  return {
    kmTotal: centavos(kmTotal),
    litros: centavos(litros),
    custoCombustivel: centavos(custoCombustivel),
    custoExtras: centavos(custoExtras),
    custoTotal: centavos(custoTotal),
    custoPorKm: centavos(preco / kmL),
    custoPorViagem: centavos(custoTotal / viagens),
  };
}

/** Lê número digitado no teclado BR ("6,19" ou "6.19"). Vazio → NaN. */
export function lerNumero(texto: string): number {
  const t = String(texto ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  // Com vírgula: ela é o decimal e ponto é milhar ("1.234,5").
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}
