// k6 load test — ramp-up de 0→20 VUs em 30s, plateau de 50 VUs por 2min,
// ramp-down em 30s. Threshold p95<500ms / p99<1500ms / falha<1%. Sai !=0
// se threshold quebrar, falhando o workflow.
//
// Rodar local: BASE_URL=https://app2.queroumacor.com.br k6 run scripts/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://app2.queroumacor.com.br';

export default function () {
  const r1 = http.get(`${BASE_URL}/api/health`);
  check(r1, { 'health 200': (r) => r.status === 200 });

  const r2 = http.get(`${BASE_URL}/api/cidades?uf=SP`);
  check(r2, { 'cidades 200': (r) => r.status === 200 });

  sleep(1);
}
