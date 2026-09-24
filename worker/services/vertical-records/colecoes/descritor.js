// ===== Registros da vertical: o contrato do descritor de coleção =====
//
// Cada coleção de /api/todogreen/records/<nome> é um DESCRITOR: um objeto
// literal, sem classe nem herança, lido pela esteira genérica (../crud.js,
// ../acesso.js e o roteador da fachada). O formato abaixo é o contrato; o teste
// src/features/logistics/verticalRecordsContract.test.js percorre TODAS as
// coleções de ./index.js e reprova a que sair dele.
//
// Obrigatórios
//   tabela            tabela do D1 (`todogreen_*`). Entra INTERPOLADA no SQL —
//                     por isso é constante do código, nunca dado do pedido.
//   permissao         capacidade de ESCRITA (`dominio:acao`), conferida pelo
//                     roteador antes de POST, PATCH e DELETE.
//   ordem             ORDER BY sobre colunas da própria tabela
//                     ("coluna ASC|DESC[, ...]"); também interpolado.
//   daLinha(linha)    o `map`: linha do D1 → registro da API. Pura; roda dentro
//                     de Array#map, então ignora os argumentos extras. Devolve
//                     ao menos id, revision, criadoEm e atualizadoEm.
//   colunas(corpo, { email, access, user, novo })
//                     o `encode`: corpo → { coluna: valor } do INSERT/UPDATE.
//                     Pura e total: não lança, e todo valor é texto, número
//                     finito ou null. Nunca devolve as colunas da esteira
//                     (COLUNAS_DA_ESTEIRA). No PATCH recebe
//                     `{ ...daLinha(atual), ...corpo }`, então
//                     colunas(daLinha(linha)) precisa reproduzir a linha — é o
//                     que impede um PATCH parcial de reescrever o que não mudou.
//                     Fica de fora só a coluna que a `guardaDeEscrita` carimba a
//                     partir do banco (o status do pré-flight da rota).
//   exigido(corpo)    "" quando o registro está completo; senão a mensagem do
//                     400. Recusa o corpo vazio. Roda antes das travas de
//                     negócio e da guarda.
//
// Opcionais
//   permissoesLeitura capacidades que abrem a LEITURA (basta uma). Ausente, vale
//                     só `permissao`; presente, inclui `permissao` — quem
//                     escreve lê. Toda capacidade citada (escrita ou leitura)
//                     precisa ser concedida por algum papel da vertical além do
//                     curinga, senão a coleção só funciona para quem testa
//                     como dona.
//   escopoDeCarteira  só `false` tem efeito: cadastro da empresa, sem recorte de
//                     carteira. Ausente, a coleção pertence a um cliente — a
//                     tabela tem `client_id` e o vendedor só alcança a própria
//                     carteira (leitura e escrita).
//   guardaDeEscrita(env, { access, email, user, corpo, id })
//                     regra que precisa do BANCO para decidir (ciclo de pasta,
//                     conflito de reserva, pré-flight da rota). Devolve ou
//                     resolve "" para seguir, ou a mensagem do 409. `id` é "" na
//                     criação. Pode completar `corpo` com o que ela mesma
//                     conferiu no banco (o pré-flight que a rota carimba).
//   filtrarLeitura(registros, { access, email })
//                     quarto corte, em JS, depois do SQL. É EXCEÇÃO, não padrão:
//                     só `documentFolders` usa (a visibilidade sobe a linhagem).
//                     Quando existe, o `total` da listagem é o tamanho filtrado.
//
// Invariantes de autorização que valem para toda coleção, fora do descritor:
// tenant, espaço (`workspace_owner_id` do vínculo) e arquivado são cortados no
// SQL da esteira — nenhum descritor escolhe escopo. Um campo com nome errado
// (`filtraLeitura`, `escopoCarteira`) seria ignorado em silêncio pela esteira;
// por isso campo desconhecido reprova o descritor.

export const CAMPOS_DO_DESCRITOR = Object.freeze({
  tabela: { obrigatorio: true, tipo: "string" },
  permissao: { obrigatorio: true, tipo: "string" },
  ordem: { obrigatorio: true, tipo: "string" },
  daLinha: { obrigatorio: true, tipo: "function", aridade: [1] },
  colunas: { obrigatorio: true, tipo: "function", aridade: [1, 2] },
  exigido: { obrigatorio: true, tipo: "function", aridade: [1] },
  permissoesLeitura: { obrigatorio: false, tipo: "array" },
  escopoDeCarteira: { obrigatorio: false, tipo: "boolean" },
  guardaDeEscrita: { obrigatorio: false, tipo: "function", aridade: [2] },
  filtrarLeitura: { obrigatorio: false, tipo: "function", aridade: [2] },
});

// Colunas que a esteira grava sozinha. Um descritor que as devolvesse em
// `colunas` duplicaria a coluna no INSERT — ou deixaria o corpo do pedido
// escolher espaço, autor ou revisão.
export const COLUNAS_DA_ESTEIRA = Object.freeze([
  "id", "tenant_id", "workspace_owner_id", "revision",
  "created_by", "updated_by", "created_at", "updated_at", "archived_at",
]);

const TABELA = /^todogreen_[a-z0-9_]+$/;
const PERMISSAO = /^[a-z]+:[a-z]+$/;
const ORDEM = /^[a-z_]+ (ASC|DESC)(, [a-z_]+ (ASC|DESC))*$/;

const tipoDe = (valor) => (Array.isArray(valor) ? "array" : typeof valor);

// Confere a FORMA de um descritor, sem chamar as funções dele. Devolve a lista
// de problemas — vazia quando o descritor cumpre o contrato.
export const problemasDoDescritor = (descritor) => {
  if (!descritor || tipoDe(descritor) !== "object") return ["o descritor precisa ser um objeto"];
  const problemas = [];
  for (const campo of Object.keys(descritor))
    if (!Object.hasOwn(CAMPOS_DO_DESCRITOR, campo))
      problemas.push(`campo desconhecido "${campo}" — a esteira o ignoraria em silêncio`);
  for (const [campo, regra] of Object.entries(CAMPOS_DO_DESCRITOR)) {
    const valor = descritor[campo];
    if (valor === undefined) {
      if (regra.obrigatorio) problemas.push(`falta "${campo}"`);
      continue;
    }
    if (tipoDe(valor) !== regra.tipo) {
      problemas.push(`"${campo}" deveria ser ${regra.tipo}`);
      continue;
    }
    if (regra.aridade && !regra.aridade.includes(valor.length))
      problemas.push(`"${campo}" deveria receber ${regra.aridade.join(" ou ")} argumento(s)`);
  }
  if (typeof descritor.tabela === "string" && !TABELA.test(descritor.tabela))
    problemas.push(`tabela "${descritor.tabela}" fora do padrão todogreen_*`);
  if (typeof descritor.permissao === "string" && !PERMISSAO.test(descritor.permissao))
    problemas.push(`permissão "${descritor.permissao}" fora do padrão dominio:acao`);
  if (typeof descritor.ordem === "string" && !ORDEM.test(descritor.ordem))
    problemas.push(`ordem "${descritor.ordem}" fora do padrão "coluna ASC|DESC[, ...]"`);
  if (Array.isArray(descritor.permissoesLeitura)) {
    if (!descritor.permissoesLeitura.length)
      problemas.push("permissoesLeitura vazia fecharia a leitura para todo mundo");
    for (const permissao of descritor.permissoesLeitura)
      if (typeof permissao !== "string" || !PERMISSAO.test(permissao))
        problemas.push(`permissão de leitura "${permissao}" fora do padrão dominio:acao`);
    if (!descritor.permissoesLeitura.includes(descritor.permissao))
      problemas.push("permissoesLeitura precisa incluir a permissão de escrita (quem escreve lê)");
  }
  if (descritor.escopoDeCarteira === true)
    problemas.push("escopoDeCarteira só aceita false — ausente já é o recorte de carteira");
  return problemas;
};
