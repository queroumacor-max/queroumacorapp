// Schema do POST /api/whatsapp/send — o `leadId` (2026-09-09) é o que amarra
// o wamid ao lead pra confirmação da Meta chegar até a tela de Leads.
import { describe, it, expect } from 'vitest';
import { whatsappSendSchema } from '@/lib/api/schemas/whatsapp-send';

describe('whatsappSendSchema — leadId', () => {
  const base = { to: '5511988887777', type: 'template', template: 'calicolors_nome' };

  it('aceita leadId uuid e passa adiante', () => {
    const r = whatsappSendSchema.safeParse({ ...base, leadId: '0b0f4a1e-1111-4222-8333-444455556666' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.leadId).toBe('0b0f4a1e-1111-4222-8333-444455556666');
  });

  it('leadId continua opcional (aba WhatsApp e follow-up mandam sem)', () => {
    const r = whatsappSendSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.leadId).toBeUndefined();
  });

  it('leadId que não é uuid → recusado (a coluna é uuid; texto solto viraria 400 do banco)', () => {
    expect(whatsappSendSchema.safeParse({ ...base, leadId: 'lead-1' }).success).toBe(false);
  });
});
