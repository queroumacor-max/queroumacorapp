import { describe, it, expect } from 'vitest';
import { boasVindasAgora, pacotesIniciante, type EntradaBoasVindas } from '@/lib/boasVindasCompra';

const futuro = new Date(Date.now() + 20 * 864e5).toISOString();
const base: EntradaBoasVindas = {
  user: { id: 'u1', is_pro: false },
  perfilCarregado: true,
  creditos: 0,
  jaViuPro: false,
  ultimosCreditos: 0,
};

describe('boasVindasAgora', () => {
  it('PRO novo vê parabéns com a data de fim', () => {
    const r = boasVindasAgora({ ...base, user: { id: 'u1', is_pro: true, pro_expires_at: futuro } });
    expect(r).toEqual({ tipo: 'pro', fim: Date.parse(futuro) });
  });
  it('PRO sem data: fim null', () => {
    const r = boasVindasAgora({ ...base, user: { id: 'u1', is_pro: true } });
    expect(r).toEqual({ tipo: 'pro', fim: null });
  });
  it('PRO que já viu não vê de novo (renovação não repete)', () => {
    const r = boasVindasAgora({ ...base, jaViuPro: true, user: { id: 'u1', is_pro: true, pro_expires_at: futuro } });
    expect(r).toBeNull();
  });
  it('perfil ainda carregando: nada', () => {
    const r = boasVindasAgora({ ...base, perfilCarregado: false, user: { id: 'u1', is_pro: true } });
    expect(r).toBeNull();
  });
  it('admin nunca vê', () => {
    const r = boasVindasAgora({ ...base, user: { id: 'u1', is_admin: true, is_pro: true }, creditos: 40 });
    expect(r).toBeNull();
  });
  it('PRO vencido não vê parabéns', () => {
    const passado = new Date(Date.now() - 10 * 864e5).toISOString();
    const r = boasVindasAgora({ ...base, user: { id: 'u1', is_pro: true, pro_expires_at: passado } });
    expect(r).toBeNull();
  });
  it('créditos subiram: mostra total e quanto ganhou', () => {
    expect(boasVindasAgora({ ...base, creditos: 45, ultimosCreditos: 5 })).toEqual({ tipo: 'creditos', total: 45, ganhou: 40 });
  });
  it('primeira leitura com créditos conta como compra', () => {
    expect(boasVindasAgora({ ...base, creditos: 40, ultimosCreditos: null })).toEqual({ tipo: 'creditos', total: 40, ganhou: 40 });
  });
  it('gastar crédito não mostra nada', () => {
    expect(boasVindasAgora({ ...base, creditos: 3, ultimosCreditos: 5 })).toBeNull();
  });
  it('saldo ainda não chegou: nada', () => {
    expect(boasVindasAgora({ ...base, creditos: null, ultimosCreditos: null })).toBeNull();
  });
});

describe('pacotesIniciante', () => {
  it('conta pacotes de 40', () => {
    expect(pacotesIniciante(40)).toBe(1);
    expect(pacotesIniciante(80)).toBe(2);
    expect(pacotesIniciante(1)).toBeNull();
    expect(pacotesIniciante(41)).toBeNull();
  });
});
