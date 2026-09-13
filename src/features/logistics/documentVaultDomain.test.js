import { describe, expect, it } from "vitest";
import {
  PREFIXO_ARQUIVO_INTERNO,
  VALIDADE_DO_LINK_MINUTOS,
  documentoValido,
  ehTipoValido,
  enderecoAceito,
  idDeArquivoInterno,
  linkExpirado,
  refDeArquivoAceita,
  tamanhoLegivel,
  validadeDoLink,
} from "./documentVaultDomain.js";

describe("comprovante do cofre interno (POD)", () => {
  it("extrai o id do caminho de download do cofre", () => {
    expect(idDeArquivoInterno("/api/todogreen/file-vault/abc-123/download")).toBe("abc-123");
    // Tolera origem absoluta e barra final.
    expect(idDeArquivoInterno("https://app.exemplo.com/api/todogreen/file-vault/xyz_9/download/")).toBe("xyz_9");
  });

  it("reconhece o sentinela guardado na concessão", () => {
    expect(idDeArquivoInterno(`${PREFIXO_ARQUIVO_INTERNO}dossie-1`)).toBe("dossie-1");
  });

  it("devolve vazio para endereço externo ou lixo (aí vale o enderecoAceito)", () => {
    expect(idDeArquivoInterno("https://arquivos.exemplo.com/pod.pdf")).toBe("");
    expect(idDeArquivoInterno("")).toBe("");
    expect(idDeArquivoInterno("/api/todogreen/outra-coisa")).toBe("");
  });
});

describe("endereço do arquivo", () => {
  it("aceita http e https públicos", () => {
    expect(enderecoAceito("https://arquivos.exemplo.com/nf-123.pdf").ok).toBe(true);
    expect(enderecoAceito("http://arquivos.exemplo.com/nf.pdf").ok).toBe(true);
  });

  it("recusa o que não é URL", () => {
    expect(enderecoAceito("nf-123.pdf").ok).toBe(false);
    expect(enderecoAceito("").motivo).toMatch(/Informe o endereço/);
  });

  it("recusa protocolo que não é web", () => {
    expect(enderecoAceito("file:///etc/passwd").ok).toBe(false);
    expect(enderecoAceito("gopher://exemplo.com/x").ok).toBe(false);
  });

  it("recusa rede interna — o worker não vira porta de entrada", () => {
    for (const host of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://172.16.0.9/x",
      "http://169.254.169.254/latest/meta-data",
      "http://cofre.internal/x",
    ]) {
      expect(enderecoAceito(host).ok).toBe(false);
    }
  });
});

describe("refDeArquivoAceita (URL de comprovante na escrita)", () => {
  it("aceita http(s) público, referência interna e vazio", () => {
    expect(refDeArquivoAceita("https://arquivos.exemplo.com/pod.pdf").ok).toBe(true);
    expect(refDeArquivoAceita("/api/todogreen/file-vault/abc123/download").ok).toBe(true);
    expect(refDeArquivoAceita("")).toMatchObject({ ok: true, url: "" });
  });

  it("data:image só passa com permissão explícita", () => {
    expect(refDeArquivoAceita("data:image/png;base64,AAAA", { permitirImagemInline: true }).ok).toBe(true);
    expect(refDeArquivoAceita("data:image/png;base64,AAAA").ok).toBe(false);
  });

  it("recusa javascript, HTML inline, host interno e protocol-relative", () => {
    expect(refDeArquivoAceita("javascript:alert(1)").ok).toBe(false);
    expect(refDeArquivoAceita("data:text/html,<script>x</script>", { permitirImagemInline: true }).ok).toBe(false);
    expect(refDeArquivoAceita("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(refDeArquivoAceita("http://127.0.0.1/x").ok).toBe(false);
    expect(refDeArquivoAceita("//evil.com/x").ok).toBe(false);
    expect(refDeArquivoAceita("/api/outra-coisa").ok).toBe(false);
  });
});

describe("documento", () => {
  const base = {
    titulo: "NF 12345",
    clientId: "c1",
    tipo: "nota_fiscal",
    arquivoUrl: "https://arquivos.exemplo.com/nf.pdf",
  };

  it("completo passa", () => {
    expect(documentoValido(base).valido).toBe(true);
  });

  it("cada parte que falta é dita por nome", () => {
    const r = documentoValido({});
    expect(r.valido).toBe(false);
    expect(r.problemas).toHaveLength(4);
  });

  it("tipo inventado não passa", () => {
    expect(ehTipoValido("qualquer")).toBe(false);
    expect(documentoValido({ ...base, tipo: "qualquer" }).valido).toBe(false);
  });
});

describe("validade do link", () => {
  const AGORA = "2026-08-07T10:00:00.000Z";

  it("vale quinze minutos", () => {
    expect(validadeDoLink(AGORA)).toBe(
      new Date(new Date(AGORA).getTime() + VALIDADE_DO_LINK_MINUTOS * 60000).toISOString(),
    );
  });

  it("dentro do prazo, abre", () => {
    expect(linkExpirado({ expiraEm: validadeDoLink(AGORA) }, AGORA)).toBe(false);
  });

  it("passou o prazo, não abre", () => {
    const depois = new Date(new Date(AGORA).getTime() + 16 * 60000).toISOString();
    expect(linkExpirado({ expiraEm: validadeDoLink(AGORA) }, depois)).toBe(true);
  });

  it("revogado não abre, mesmo dentro do prazo", () => {
    expect(linkExpirado({ expiraEm: validadeDoLink(AGORA), revogadoEm: AGORA }, AGORA)).toBe(true);
  });

  it("concessão inexistente não abre", () => {
    expect(linkExpirado(null, AGORA)).toBe(true);
  });
});

describe("tamanho legível", () => {
  it("mostra unidade em vez de contagem crua", () => {
    expect(tamanhoLegivel(512)).toBe("512 B");
    expect(tamanhoLegivel(2048)).toBe("2,0 KB");
    expect(tamanhoLegivel(2517143)).toBe("2,4 MB");
  });

  it("sem arquivo, traço", () => {
    expect(tamanhoLegivel(0)).toBe("—");
    expect(tamanhoLegivel(undefined)).toBe("—");
  });
});
