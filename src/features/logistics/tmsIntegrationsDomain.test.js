import { describe, expect, it } from "vitest";
import { ACOES_TMS, linhasDeIntegracaoTms } from "./tmsIntegrationsDomain.js";

const linha = (integrations, id) => linhasDeIntegracaoTms(integrations).find((item) => item.id === id);

describe("integrações do TMS", () => {
  it("toda linha tem uma ação de verdade — nenhuma é só texto com selo", () => {
    const linhas = linhasDeIntegracaoTms({});
    expect(linhas).toHaveLength(4);
    for (const item of linhas) {
      expect(item.acao.rotulo).toBeTruthy();
      expect(Object.values(ACOES_TMS)).toContain(item.acao.tipo);
      if (item.acao.tipo === ACOES_TMS.abrirNoErp) expect(item.acao.rota).toMatch(/^\/todogreen\//);
    }
  });

  it("sem configuração, diz que não está configurada em vez de fingir estado", () => {
    expect(linha({}, "ciot").estado).toBe("Ainda não configurada.");
    expect(linha({}, "ciot").status).toBe("nao_configurada");
    // "Rascunho" (o `draft` da tabela) não pode vazar como selo: não diz nada
    // para quem opera, e sugere que existe algo pronto quando não existe.
    expect(linha({ ciot: { status: "draft", configured: false } }, "ciot").status).toBe("pendente");
    expect(linha({ ciot: { status: "ready", configured: true } }, "ciot").status).toBe("ativa");
    expect(linha({}, "fiscal").estado).toBe("Ainda não configurada.");
  });

  it("CIOT pela metade diz exatamente o que falta", () => {
    const parcial = linha({ ciot: { status: "draft", configured: false, connectorConfigured: true, certificateConfigured: false } }, "ciot");
    expect(parcial.estado).toContain("Falta o certificado");
    expect(parcial.acao.rotulo).toBe("Configurar CIOT");
    const cru = linha({ ciot: { status: "draft", configured: false } }, "ciot");
    expect(cru.estado).toContain("Falta o conector e o certificado");
  });

  it("CIOT pronto abre a tela de CIOT, não a de configuração", () => {
    const pronto = linha({ ciot: { status: "ready", configured: true } }, "ciot");
    expect(pronto.acao.rotulo).toBe("Abrir CIOT");
    expect(pronto.estado).toBe("Em operação.");
  });

  it("erro do conector aparece para quem opera, não fica só no log", () => {
    const comErro = linha({ track3r: { status: "erro", lastError: "token recusado" } }, "track3r");
    expect(comErro.estado).toBe("Último erro: token recusado");
    expect(comErro.status).toBe("erro");
  });

  it("certificado fiscal vencido não passa por configurado", () => {
    const vencido = linha({ fiscal: { status: "configurar", certificateStatus: "vencido" } }, "fiscal");
    expect(vencido.estado).toContain("Certificado vencido");
    expect(vencido.acao.rotulo).toBe("Configurar fiscal");
  });

  it("API sem chave ativa avisa em vez de parecer ligada", () => {
    expect(linha({ api: { status: "configurar", activeKeys: 0 } }, "api").estado).toContain("Nenhuma chave ativa");
    expect(linha({ api: { status: "ativa", activeKeys: 2, configured: true } }, "api").estado).toBe("Em operação.");
  });
});
