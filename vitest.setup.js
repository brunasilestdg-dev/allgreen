import { configure } from "@testing-library/dom";

// Fuso fixo em UTC para os testes. A produção roda em Cloudflare Workers, que é
// SEMPRE UTC, e as asserções de data foram escritas para esse fuso. Sem fixar
// aqui, a suíte quebra em qualquer máquina fora de UTC (ex.: a máquina da
// titular, em America/Sao_Paulo, fazia `new Date("…T08:00")` virar `11:00Z` e
// reprovava `marketSignalDomain`). Reatribuir `process.env.TZ` em runtime é
// respeitado pelo Node antes da próxima leitura de `Date`.
process.env.TZ = "UTC";

// A testing-library tem DOIS prazos, e o repositório só tinha ajustado um.
// `testTimeout` (20s, em vite.config.js) é quanto o teste inteiro pode durar;
// `asyncUtilTimeout` é quanto um `findBy*`/`waitFor` espera antes de desistir —
// e o padrão dele é 1 SEGUNDO.
//
// É esse segundo que estoura no runner da CI, nunca aqui: dois testes de tela
// do aplicativo (modelo de documento e estrutura de trabalho) reprovaram
// exatamente assim, cada um esperando um painel que abre num segundo passo de
// render, enquanto passavam local e em repetição. Esperar mais não afrouxa
// asserção nenhuma — o que era exigido continua sendo exigido, só cabe uma
// máquina lenta no meio.
configure({ asyncUtilTimeout: 5000 });
