import { configure } from "@testing-library/dom";

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
