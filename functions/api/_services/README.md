# `_services/` — business logic puro

Cada módulo aqui exporta funções puras (sem `Request`/`Response`) que recebem
dados já parseados e retornam dados ou `throw new ServiceError(msg, status, extra)`.
Os controllers em `functions/api/<endpoint>.js` ficam ≤30 linhas e só fazem:
parse body → chamar service → formatar resposta com `jsonResponse`/`serviceErrorResponse`.
Helpers de auth/rate-limit/erro tipado vivem em `../_security.js` — services
NÃO devem importar `_security.js` (separation of concerns: services só
conhecem regras de negócio, controllers conhecem HTTP + segurança).
