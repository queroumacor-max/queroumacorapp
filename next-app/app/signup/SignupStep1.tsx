'use client';
// SignupStep1 — role selector. Único campo é o `userType`, que vira o
// `user_type` dos metadados do Supabase Auth (`signUp.options.data.user_type`)
// e, via trigger handle_new_user no Postgres, popula `profiles.user_type`.
//
// As 5 opções vêm do vanilla (modules/signup-flow.js _roleSpecs + HTML
// signup-step1). 'funileiro' é tratado pelo banco como variação de
// 'automotivo', mas o vanilla expõe a opção; mantemos paridade.
import { useState } from 'react';
import type { UserRole } from '@/lib/types';

export interface Step1Data {
  userType: UserRole;
}

interface RoleOption {
  value: UserRole;
  icon: string;
  label: string;
  description: string;
}

const ROLES: RoleOption[] = [
  { value: 'pintor', icon: '🖌️', label: 'Pintor', description: 'Pintura residencial e comercial' },
  { value: 'grafiteiro', icon: '🎨', label: 'Grafiteiro / Muralista', description: 'Arte urbana, murais, painéis e arte pra venda' },
  { value: 'automotivo', icon: '🚗', label: 'Funileiro / Estética Automotiva', description: 'Funilaria, pintura, envelopamento, polimento' },
  { value: 'cliente', icon: '🏠', label: 'Cliente', description: 'Encontrar profissionais e pedir orçamentos' },
];

interface Props {
  initialValue?: UserRole;
  onNext: (data: Step1Data) => void;
}

export function SignupStep1({ initialValue, onNext }: Props) {
  const [selected, setSelected] = useState<UserRole>(initialValue ?? 'pintor');

  return (
    <div>
      <h1
        className="text-2xl font-bold mb-1"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Você é…
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-5">
        Escolha como vai usar o QueroUmaCor
      </p>

      <div className="grid grid-cols-2 gap-3 mb-5" role="radiogroup" aria-label="Tipo de conta">
        {ROLES.map((role) => {
          const active = role.value === selected;
          return (
            <button
              key={role.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(role.value)}
              className={
                'text-left p-3 rounded-xl border-2 transition-colors ' +
                (active
                  ? 'border-[color:var(--color-p1)] bg-[color:var(--color-p1)]/5'
                  : 'border-[color:var(--color-border)] bg-white hover:border-[color:var(--color-p1)]/40')
              }
            >
              <div className="text-2xl mb-1" aria-hidden="true">
                {role.icon}
              </div>
              <div className="text-sm font-bold text-[color:var(--color-ink)]">
                {role.label}
              </div>
              <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                {role.description}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onNext({ userType: selected })}
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold text-base hover:opacity-90 transition-opacity"
      >
        Continuar →
      </button>
    </div>
  );
}
