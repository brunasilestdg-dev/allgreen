import { describe, expect, it } from "vitest";
import {
  SYSPAG_TOKEN_ENV_KEY,
  SYSPAG_BASE_URL_ENV_KEY,
  SYSPAG_PENDENCIAS,
  montarPagamentoSyspag,
  validarPagamentoSyspag,
  prontidaoSyspag,
} from "./syspagDomain.js";

describe("SysPag — payload canônico do repasse", () => {
  it("mapeia o lote para o payload, com valor em centavos arredondado", () => {
    const p = montarPagamentoSyspag({
      settlementId: "lote-1",
      motoristaId: "drv-1",
      motoristaNome: "João",
      valor: 129.005,
      chavePix: "joao@pix.com",
      referencia: "Semana 37",
    });
    expect(p.referenciaExterna).toBe("lote-1");
    expect(p.metodo).toBe("pix");
    expect(p.favorecido).toEqual({ id: "drv-1", nome: "João", chavePix: "joao@pix.com" });
    expect(p.valor).toBe(129.01);
    expect(p.descricao).toBe("Semana 37");
  });

  it("descrição padrão quando não vem referência", () => {
    expect(montarPagamentoSyspag({ valor: 10 }).descricao).toMatch(/Repasse GreenPay/);
  });
});

describe("SysPag — validação (nunca dispara pagamento incompleto)", () => {
  const base = montarPagamentoSyspag({ settlementId: "l1", valor: 50, chavePix: "x@y.z" });

  it("payload completo é válido", () => {
    expect(validarPagamentoSyspag(base).valido).toBe(true);
  });

  it("valor zero, sem referência ou sem chave PIX é recusado com os motivos", () => {
    expect(validarPagamentoSyspag({ ...base, valor: 0 }).erros).toContain("Valor do repasse precisa ser maior que zero.");
    expect(validarPagamentoSyspag({ ...base, referenciaExterna: "" }).valido).toBe(false);
    const semChave = montarPagamentoSyspag({ settlementId: "l1", valor: 50 });
    expect(validarPagamentoSyspag(semChave).erros).toContain("Falta a chave PIX do motorista.");
  });
});

describe("SysPag — prontidão da conexão (dormente por ausência de segredo)", () => {
  it("sem token nem URL, não habilita e lista o que falta", () => {
    const r = prontidaoSyspag({ tokenPresente: false, baseUrlPresente: false });
    expect(r.habilitado).toBe(false);
    expect(r.faltando).toHaveLength(2);
    expect(r.faltando.join(" ")).toContain(SYSPAG_TOKEN_ENV_KEY);
    expect(r.faltando.join(" ")).toContain(SYSPAG_BASE_URL_ENV_KEY);
    expect(r.mensagem).toMatch(/razão interno/i);
  });

  it("com token e URL, habilita", () => {
    const r = prontidaoSyspag({ tokenPresente: true, baseUrlPresente: true });
    expect(r.habilitado).toBe(true);
    expect(r.faltando).toHaveLength(0);
    expect(r.mensagem).toMatch(/pronta/i);
  });

  it("só token (sem URL) ainda não habilita", () => {
    expect(prontidaoSyspag({ tokenPresente: true, baseUrlPresente: false }).habilitado).toBe(false);
  });
});

describe("SysPag — pendências para a titular", () => {
  it("lista as perguntas a levar à SysPag", () => {
    expect(SYSPAG_PENDENCIAS.length).toBeGreaterThanOrEqual(4);
    expect(SYSPAG_PENDENCIAS.join(" ")).toMatch(/webhook/i);
  });
});
