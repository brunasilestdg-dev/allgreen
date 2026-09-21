import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Trava de numeração das migrações.
//
// O Cloudflare D1 registra cada migração aplicada pelo NOME do arquivo na
// tabela `d1_migrations`. Renomear uma migração já aplicada faz o wrangler
// enxergá-la como nova e reaplicá-la — DDL rodando de novo contra produção.
// Por isso as colisões de número que já foram para produção são história
// imutável: não se renomeia, anistia-se aqui. A trava existe para impedir que
// uma NOVA colisão entre despercebida (duas pessoas/sessões pegando o mesmo
// número em paralelo é o caminho fácil para o bug).
//
// Ordem de aplicação: o wrangler ordena por nome completo do arquivo, então
// mesmo entre duplicados a ordem é determinística — o risco real de números
// repetidos é a ambiguidade para quem lê e a chance de sobrescrita futura.

const dir = new URL("../migrations/", import.meta.url);

// Colisões que já existiam antes desta trava e JÁ FORAM APLICADAS em produção.
// Não mexer sem antes conferir `wrangler d1 migrations list allgreen-db --remote`.
const COLISOES_HISTORICAS = new Set([
  "0022_free_suite.sql",
  "0022_plan_usage.sql",
  "0086_todogreen_access_requests.sql",
  "0086_todogreen_pricing_parameters_workspace.sql",
  "0087_todogreen_operations_dispatch_coords.sql",
  "0087_todogreen_purchase_request_triagem.sql",
  "0088_todogreen_access_invites.sql",
  "0088_todogreen_internal_files_context.sql",
  "0088_todogreen_tms_public_api.sql",
  "0107_todogreen_fleet_vehicle_telemetry.sql",
  "0107_todogreen_tracker_position_retention.sql",
  "0112_drop_todogreen_operations.sql",
  "0112_todogreen_internal_files_r2.sql",
]);

const arquivos = readdirSync(dir).filter((nome) => nome.endsWith(".sql"));

const agruparPorNumero = () => {
  const porNumero = new Map();
  for (const nome of arquivos) {
    const numero = nome.slice(0, 4);
    if (!porNumero.has(numero)) porNumero.set(numero, []);
    porNumero.get(numero).push(nome);
  }
  return porNumero;
};

describe("numeração das migrações", () => {
  it("todo arquivo segue o padrão NNNN_nome.sql", () => {
    const foraDoPadrao = arquivos.filter(
      (nome) => !/^\d{4}_[a-z0-9_]+\.sql$/i.test(nome),
    );
    expect(foraDoPadrao).toEqual([]);
  });

  it("nenhuma colisão NOVA de número (as históricas ficam anistiadas)", () => {
    const colisoesNovas = [];
    for (const [, nomes] of agruparPorNumero()) {
      if (nomes.length < 2) continue;
      for (const nome of nomes) {
        if (!COLISOES_HISTORICAS.has(nome)) colisoesNovas.push(nome);
      }
    }
    expect(colisoesNovas.sort()).toEqual([]);
  });

  it("a lista de anistia não guarda entrada obsoleta", () => {
    // Se um arquivo anistiado foi removido/renomeado, ou já não colide com
    // ninguém, a lista tem que ser limpa — senão ela vira um cheque em branco.
    const porNumero = agruparPorNumero();
    const numerosDuplicados = new Set(
      [...porNumero].filter(([, nomes]) => nomes.length > 1).map(([n]) => n),
    );
    const obsoletas = [...COLISOES_HISTORICAS].filter(
      (nome) => !arquivos.includes(nome) || !numerosDuplicados.has(nome.slice(0, 4)),
    );
    expect(obsoletas.sort()).toEqual([]);
  });
});
