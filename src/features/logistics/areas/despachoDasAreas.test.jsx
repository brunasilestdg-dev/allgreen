/* @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { Children } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogisticsVertical from "../LogisticsVertical.jsx";
import { MODULE_IMPLEMENTATION } from "../shell/catalogoDeModulos.js";
import { PRIMARY_NAVIGATION } from "../shell/navegacao.js";
import TelasAdministracao from "./TelasAdministracao.jsx";
import TelasComercial from "./TelasComercial.jsx";
import TelasEspacoDeTrabalho from "./TelasEspacoDeTrabalho.jsx";
import TelasEsg from "./TelasEsg.jsx";
import TelasEstudio from "./TelasEstudio.jsx";
import TelasFinanceiro from "./TelasFinanceiro.jsx";
import TelasGreenTechCore from "./TelasGreenTechCore.jsx";
import TelasOperacao from "./TelasOperacao.jsx";
import TelasPessoas from "./TelasPessoas.jsx";
import TelasPrincipal from "./TelasPrincipal.jsx";
import TelasRecarga from "./TelasRecarga.jsx";

// O despacho das telas saiu de um bloco único do LogisticsVertical.jsx para um
// componente por área do menu. Estes testes prendem o que a divisão não podia
// mudar: toda tela continua saindo de um lugar só, a mesma página chamada de
// dois grupos continua sendo o MESMO componente, e re-renderizar a mesma
// página não remonta a tela (quem digitou não perde o que digitou).

const GRUPOS = {
  TelasPrincipal,
  TelasGreenTechCore,
  TelasEspacoDeTrabalho,
  TelasEstudio,
  TelasComercial,
  TelasOperacao,
  TelasRecarga,
  TelasEsg,
  TelasFinanceiro,
  TelasPessoas,
  TelasAdministracao,
};

const nada = () => {};
const contextoDaPagina = (page) => ({
  db: { user: { id: "u1" }, tasks: [], preferences: {}, businesses: [] },
  update: nada,
  setToast: nada,
  authHeaders: () => ({}),
  path: `/todogreen/${page}`,
  remoteAccess: { permissions: [], ownerId: "" },
  role: "",
  page,
  secaoDeCadastro: "",
  primaryNavigation: PRIMARY_NAVIGATION[0],
  ehDev: false,
  registros: { financial: [], operations: [], contracts: [] },
  criar: nada,
  atualizar: nada,
  arquivar: nada,
  registrarPagamento: nada,
  estornarPagamento: nada,
  registrarEventoOperacao: nada,
  listarSubrecurso: nada,
  pedidosDeAprovacao: [],
  clientes: [],
  setClientes: nada,
  verticalData: { opportunities: [], pricingScenarios: [], comments: [], interactions: [] },
  dashboard: {},
  saveHomePreferences: nada,
});
// Os grupos não têm estado nem efeito: chamá-los como função devolve o
// fragmento com a tela da página (ou nada), sem montar nenhuma tela.
const gruposQueDesenham = (page) =>
  Object.entries(GRUPOS)
    .filter(([, Grupo]) => Children.toArray(Grupo({ contexto: contextoDaPagina(page) }).props.children).length > 0)
    .map(([nome]) => nome);

describe("despacho das telas por área", () => {
  it("toda tela do catálogo sai de exatamente um grupo", () => {
    const fora = Object.keys(MODULE_IMPLEMENTATION)
      .map((page) => [page, gruposQueDesenham(page)])
      .filter(([, grupos]) => grupos.length !== 1);
    expect(fora).toEqual([]);
  });

  it("página fora do catálogo não sai de grupo nenhum — é o painel de gerenciamento que cobre", () => {
    expect(gruposQueDesenham("pagina-que-nao-existe")).toEqual([]);
  });

  it("um módulo de página é carregado por import() dinâmico uma vez só", () => {
    // Dois lazy() do mesmo módulo são dois componentes diferentes: a tela do
    // segundo grupo mostraria "Carregando..." com o código já baixado, e trocar
    // entre elas remontaria o que hoje é o mesmo componente. A conferência é
    // pelo import() e não pelo nome `lazy`, para um apelido não escapar.
    const pasta = path.dirname(new URL(import.meta.url).pathname);
    const raiz = path.dirname(pasta);
    const arquivos = [
      path.join(raiz, "LogisticsVertical.jsx"),
      ...["areas", "journeys"].flatMap((sub) =>
        fs
          .readdirSync(path.join(raiz, sub))
          .filter((nome) => /\.jsx?$/.test(nome) && !/\.test\.jsx?$/.test(nome))
          .map((nome) => path.join(raiz, sub, nome)),
      ),
    ];
    const declaracoes = arquivos.flatMap((arquivo) =>
      [...fs.readFileSync(arquivo, "utf8").matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((achado) =>
        path.resolve(path.dirname(arquivo), achado[1]),
      ),
    );
    expect(declaracoes.length).toBeGreaterThan(60);
    const repetidas = declaracoes.filter((alvo, i) => declaracoes.indexOf(alvo) !== i);
    // O App.jsx é a exceção de propósito: dois lazy() dele, cada um pegando
    // um export diferente (Análise de textos e Mapa de ideias).
    expect(repetidas.filter((alvo) => !alvo.endsWith(`${path.sep}App.jsx`))).toEqual([]);
  });
});

// ===== Estado da tela entre re-renderizações =====

const baseDb = {
  user: { id: "u1", name: "Renata", email: "renata@example.com" },
  businesses: [],
  tasks: [],
  notifications: [],
};
const jsonOk = (corpo) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } }));
const authHeaders = () => ({ authorization: "Bearer teste" });

describe("a mesma página não remonta a tela", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const caminho = String(url);
        if (caminho.startsWith("/api/todogreen/access?"))
          return jsonOk({ tenant: { slug: "todogreen" }, role: "admin", permissions: ["*"], ownerId: "u1" });
        if (caminho === "/api/todogreen/records")
          return jsonOk({ opportunities: [], proposals: [], operations: [], financial: [], scenarios: [] });
        return jsonOk({});
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  const irPara = (rota) =>
    act(() => {
      window.history.pushState({}, "", rota);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

  it("re-renderizar mantém o que foi digitado; sair e voltar começa de novo", async () => {
    const props = { update: vi.fn(), setToast: vi.fn(), authHeaders };
    const { rerender } = render(<LogisticsVertical db={baseDb} {...props} />);
    await waitFor(() => expect(screen.queryByText(/Confirmando permissão/)).toBeNull());

    fireEvent.change(screen.getByLabelText(/^Cliente/), { target: { value: "Distribuidora Alfa" } });
    // Um `db` novo refaz os dados da vertical e o contexto das telas inteiro.
    rerender(<LogisticsVertical db={{ ...baseDb, tasks: [] }} {...props} />);
    expect(screen.getByLabelText(/^Cliente/).value).toBe("Distribuidora Alfa");

    irPara("/todogreen/propostas");
    expect(screen.queryByRole("button", { name: /Salvar simulação/ })).toBeNull();
    irPara("/todogreen/precificacao");
    expect(screen.getByLabelText(/^Cliente/).value).toBe("");
  });
});
