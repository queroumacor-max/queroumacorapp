// lib/api/_services/receipt-ocr.ts — extrai itens + valores de uma foto de
// recibo/nota fiscal usando gpt-4o-mini Vision. Modelo igual ao
// area-from-photo: multipart com `image`, JSON estrito de saída.

import { ServiceError } from '../security';
import { imageToDataUrl } from '../_ai';

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `Você lê uma foto de RECIBO/NOTA FISCAL/COMPROVANTE em PT-BR e extrai os itens comprados com valores.

REGRAS:
- Leia todos os itens visíveis com seus respectivos preços.
- Ignore informações fiscais (CNPJ, CPF, número da nota, datas) — só queremos itens e valores.
- Se um item tem quantidade, multiplique pelo preço unitário pra ter o total daquele item.
- Some todos os totais individuais pra "total".
- Se a foto não for um recibo legível (foto borrada, sem itens visíveis, paisagem, etc.), devolva items=[] e total=0 com merchant="" e date="".
- Valores em REAIS (R$). Não use R$ no número — só decimal puro (ex.: 12.50).

RESPONDA SOMENTE com JSON estrito no formato:
{
  "merchant": "<nome da loja se visível, senão vazio>",
  "date": "<AAAA-MM-DD se visível, senão vazio>",
  "items": [
    {"description": "<descrição do item>", "qty": <number>, "unit_price": <number>, "total": <number>}
  ],
  "total": <number>,
  "notes": "<observação curta se algum item ficou ambíguo>"
}

Sem markdown. Sem texto antes ou depois. items deve ser array (pode estar vazio). total = soma dos items[].total. Valores são números decimais (12.5, não "R$ 12,50").`;

export interface ReceiptOcrResult {
  merchant: string;
  date: string;
  items: Array<{
    description: string;
    qty: number;
    unit_price: number;
    total: number;
  }>;
  total: number;
  notes: string;
}

export async function ocrReceipt(args: {
  image: File | Blob | FormDataEntryValue | null;
}): Promise<ReceiptOcrResult> {
  const image = args.image;
  if (!image || typeof image === 'string') {
    throw new ServiceError(
      'image obrigatório (multipart com arquivo de imagem)',
      400,
    );
  }
  const file = image as File | Blob;
  const size = file.size || 0;
  if (size <= 0) throw new ServiceError('Imagem vazia', 400);
  if (size > MAX_BYTES) throw new ServiceError('Imagem acima de 8 MB', 413);

  let dataUrl: string;
  try {
    dataUrl = await imageToDataUrl(file);
  } catch (e) {
    throw new ServiceError(
      'Falha ao ler imagem: ' + (e instanceof Error ? e.message : String(e)),
      400,
    );
  }

  const key = process.env.OPENAI_API_KEY;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extraia os itens e valores deste recibo. JSON estrito.',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 300);
      console.warn('receipt-ocr OpenAI error', r.status, errText);
      throw new ServiceError(
        'IA indisponível — tente de novo em instantes',
        502,
      );
    }
    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (data?.choices?.[0]?.message?.content || '').trim();
    if (!raw) throw new ServiceError('IA não retornou conteúdo', 502);

    let parsed: {
      merchant?: unknown;
      date?: unknown;
      items?: unknown;
      total?: unknown;
      notes?: unknown;
    };
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch {
      throw new ServiceError('Resposta da IA não é JSON válido', 502);
    }

    const items = Array.isArray(parsed.items)
      ? (parsed.items as Array<Record<string, unknown>>)
          .map((it) => ({
            description: String(it.description || '').trim().slice(0, 200),
            qty: Number(it.qty) || 1,
            unit_price: Number(it.unit_price) || 0,
            total: Number(it.total) || 0,
          }))
          .filter((it) => it.description && it.total >= 0)
      : [];

    return {
      merchant: String(parsed.merchant || '').trim().slice(0, 120),
      date: String(parsed.date || '').trim().slice(0, 10),
      items,
      total: Number(parsed.total) || items.reduce((s, i) => s + i.total, 0),
      notes: String(parsed.notes || '').trim().slice(0, 240),
    };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('OpenAI timeout (30s) — tente de novo', 504);
    }
    throw new ServiceError(
      'OpenAI: ' + (e instanceof Error ? e.message : String(e)),
      502,
    );
  }
}
