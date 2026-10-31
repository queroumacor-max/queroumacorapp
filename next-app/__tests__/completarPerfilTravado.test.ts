// "Está travado. Não consigo sair disso." (2026-10-31) — a 1ª tentativa do
// /completar-perfil gravava o perfil e a tela não saía; tocar de novo dava
// "Esse @ já está em uso" com a @ da PRÓPRIA conta. Só saía fechando o app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const form = readFileSync(join(__dirname, '../app/completar-perfil/CompleteProfileForm.tsx'), 'utf8');
const hook = readFileSync(join(__dirname, '../lib/hooks/useProfile.ts'), 'utf8');

describe('/completar-perfil não prende quem já gravou', () => {
  it('a checagem do @ ignora a própria conta', () => {
    expect(form).toMatch(/checkTagAvailability\(normalizedTag,\s*user\?\.id\)/);
  });
  it('a @ já gravada volta no campo', () => {
    expect(form).toMatch(/texto\(p\?\.tag\)\s*\|\|\s*texto\(p\?\.username\)/);
  });
  it('a releitura depois de salvar tem teto', () => {
    expect(form).toMatch(/Promise\.race\(\[\s*qc\.refetchQueries/);
  });
  it('o cache recebe o perfil salvo mesmo quando era null', () => {
    expect(hook).toMatch(/old \?\? \{ id: user!\.id \}/);
  });
});
