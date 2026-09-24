import { describe, expect, it } from "vitest";
import {
  codigoDeConviteDaUrl,
  destinoAposLogin,
  ehEntradaToDoGreen,
  emailValido,
  ENTRADA_DO_ERP,
  exigeTrocaDeSenha,
  mensagemDeFalha,
  normalizarCodigo,
  normalizarEmail,
  portalDeEntrada,
  PORTAIS_DE_ENTRADA,
  ROTAS_SEM_TROCA_DE_SENHA,
  validarCredenciais,
  validarPedidoDeRecuperacao,
  validarRedefinicao,
  validarTrocaDeSenhaProvisoria,
} from "./authDomain.js";

describe("portas de entrada", () => {
  it("cada portal externo leva ao próprio portal depois do login", () => {
    expect(destinoAposLogin({ entradaToDoGreen: true, entryPortal: "cliente" })).toBe("/portal-cliente");
    expect(destinoAposLogin({ entradaToDoGreen: true, entryPortal: "motorista" })).toBe("/portal-motorista");
    expect(destinoAposLogin({ entradaToDoGreen: true, entryPortal: "tms" })).toBe("/portal-tms");
    expect(destinoAposLogin({ entradaToDoGreen: true, entryPortal: "colaborador" })).toBe("/portal-colaborador");
  });

  it("a entrada do ERP leva à vertical e o acesso geral não redireciona", () => {
    expect(destinoAposLogin({ entradaToDoGreen: true, entryPortal: "" })).toBe("/todogreen");
    expect(destinoAposLogin({ entradaToDoGreen: false, entryPortal: "" })).toBe("");
  });

  it("portal desconhecido cai na entrada do ERP, nunca num destino inventado", () => {
    expect(portalDeEntrada("qualquer")).toBe(ENTRADA_DO_ERP);
    expect(portalDeEntrada()).toBe(ENTRADA_DO_ERP);
  });

  it("é entrada To Do Green pela flag, pelo portal ou pelo caminho /todogreen", () => {
    expect(ehEntradaToDoGreen({ vertical: true })).toBe(true);
    expect(ehEntradaToDoGreen({ entryPortal: "tms" })).toBe(true);
    expect(ehEntradaToDoGreen({ pathname: "/todogreen" })).toBe(true);
    expect(ehEntradaToDoGreen({ pathname: "/todogreen/clientes" })).toBe(true);
    expect(ehEntradaToDoGreen({ pathname: "/todogreenx" })).toBe(false);
    expect(ehEntradaToDoGreen({ pathname: "/acesso-geral" })).toBe(false);
    expect(ehEntradaToDoGreen()).toBe(false);
  });

  it("todo portal declara destino, título, aba e os três textos da tela", () => {
    for (const portal of [...Object.values(PORTAIS_DE_ENTRADA), ENTRADA_DO_ERP]) {
      for (const campo of ["destino", "titulo", "aba", "kicker", "helper", "secondary"])
        expect(portal[campo], campo).toBeTruthy();
      expect(portal.aba.startsWith("To Do Green")).toBe(true);
    }
  });
});

describe("validações do formulário", () => {
  it("e-mail é conferido já normalizado", () => {
    expect(normalizarEmail("  Ana@Empresa.COM ")).toBe("ana@empresa.com");
    expect(emailValido(" ana@empresa.com ")).toBe(true);
    expect(emailValido("ana@empresa")).toBe(false);
  });

  it("login e criação de conta reclamam na ordem e-mail, senha, nome", () => {
    expect(validarCredenciais({ email: "x", password: "12345678" })).toBe("Informe um e-mail válido.");
    expect(validarCredenciais({ email: "a@b.co", password: "1234567" })).toBe(
      "A senha precisa ter pelo menos 8 caracteres.",
    );
    expect(validarCredenciais({ email: "a@b.co", password: "12345678", name: " A ", mode: "register" })).toBe(
      "Informe seu nome.",
    );
    // No login o nome não é pedido.
    expect(validarCredenciais({ email: "a@b.co", password: "12345678", name: "", mode: "login" })).toBe("");
    expect(validarCredenciais({ email: "a@b.co", password: "12345678", name: "Ana", mode: "register" })).toBe("");
  });

  it("recuperação usa o e-mail já digitado no login", () => {
    expect(validarPedidoDeRecuperacao("")).toBe("Digite seu e-mail no campo acima e clique de novo.");
    expect(validarPedidoDeRecuperacao("a@b.co")).toBe("");
  });

  it("redefinição exige o código completo antes da senha", () => {
    expect(validarRedefinicao({ code: "123", password: "12345678" })).toBe("Digite o código de 6 dígitos.");
    expect(validarRedefinicao({ code: "123456", password: "1234" })).toBe(
      "A nova senha precisa ter pelo menos 8 caracteres.",
    );
    expect(validarRedefinicao({ code: "123456", password: "12345678" })).toBe("");
  });

  it("a senha nova do primeiro acesso tem tamanho, confirmação e não repete a provisória", () => {
    expect(validarTrocaDeSenhaProvisoria({ current: "Prov-1234", next: "curta", confirm: "curta" })).toBe(
      "A nova senha precisa ter pelo menos 8 caracteres.",
    );
    expect(validarTrocaDeSenhaProvisoria({ current: "Prov-1234", next: "SenhaNova#1", confirm: "Outra#1234" })).toBe(
      "A confirmação não confere com a nova senha.",
    );
    expect(validarTrocaDeSenhaProvisoria({ current: "Prov-1234", next: "Prov-1234", confirm: "Prov-1234" })).toBe(
      "Escolha uma senha diferente da provisória.",
    );
    expect(validarTrocaDeSenhaProvisoria({ current: "Prov-1234", next: "SenhaNova#1", confirm: "SenhaNova#1" })).toBe("");
  });

  it("o campo do código guarda só os seis dígitos, mesmo colando o texto do e-mail", () => {
    expect(normalizarCodigo("Seu código: 12-34 56 (vale 10 min)")).toBe("123456");
    expect(normalizarCodigo("98765432")).toBe("987654");
    expect(normalizarCodigo()).toBe("");
  });
});

describe("mensagens de falha", () => {
  it("falha de rede do navegador nunca aparece em inglês", () => {
    expect(mensagemDeFalha(new TypeError("Failed to fetch"))).toBe(
      "Não foi possível conectar ao servidor. Tente novamente.",
    );
  });

  it("a mensagem do servidor passa como veio e o vazio cai no padrão", () => {
    expect(mensagemDeFalha(new Error("Senha incorreta."))).toBe("Senha incorreta.");
    expect(mensagemDeFalha(new Error(""), "Padrão.")).toBe("Padrão.");
    expect(mensagemDeFalha(undefined, "Padrão.")).toBe("Padrão.");
  });
});

describe("primeiro acesso com senha provisória", () => {
  const user = { id: "u1", mustChangePassword: true };

  it("trava o app só com a sessão confirmada pelo servidor", () => {
    expect(exigeTrocaDeSenha({ user, sessionStatus: "authenticated", routeKind: "workspace" })).toBe(true);
    expect(exigeTrocaDeSenha({ user, sessionStatus: "checking", routeKind: "workspace" })).toBe(false);
    expect(exigeTrocaDeSenha({ user, sessionStatus: "anonymous", routeKind: "todogreen" })).toBe(false);
  });

  it("não trava site público nem convites", () => {
    for (const routeKind of ROTAS_SEM_TROCA_DE_SENHA)
      expect(exigeTrocaDeSenha({ user, sessionStatus: "authenticated", routeKind })).toBe(false);
    expect(exigeTrocaDeSenha({ user, sessionStatus: "authenticated", routeKind: "customer-portal" })).toBe(true);
  });

  it("conta sem a marca segue direto", () => {
    expect(exigeTrocaDeSenha({ user: { id: "u1" }, sessionStatus: "authenticated", routeKind: "workspace" })).toBe(false);
    expect(exigeTrocaDeSenha({ user: null, sessionStatus: "authenticated", routeKind: "workspace" })).toBe(false);
  });
});

describe("código de convite na URL", () => {
  it("lê e decodifica o parâmetro convite", () => {
    expect(codigoDeConviteDaUrl("?convite=ABC%20123")).toBe("ABC 123");
    expect(codigoDeConviteDaUrl("?x=1&convite=abc&y=2")).toBe("abc");
    expect(codigoDeConviteDaUrl("?convite=%20abc%20")).toBe("abc");
    expect(codigoDeConviteDaUrl("?x=1")).toBe("");
    expect(codigoDeConviteDaUrl("")).toBe("");
  });

  it("código com % solto é ignorado, sem derrubar a tela", () => {
    expect(codigoDeConviteDaUrl("?convite=100%")).toBe("");
  });
});
