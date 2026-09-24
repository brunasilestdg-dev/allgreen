/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcceptInvite from "./AcceptInvite.jsx";
import FirstAccessPassword from "./FirstAccessPassword.jsx";
import Login from "./Login.jsx";
import { useEntradaPorConvite } from "./useEntradaPorConvite.js";

// As telas de acesso saíram do App.jsx e agora são testadas diretamente, sem
// montar o app inteiro. Cada teste descreve um caminho real de quem entra.

const TOKEN_KEY = "seu-funcionario-auth-token";
const json = (data, { ok = true, status = 200 } = {}) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(data) });

// Resposta por rota; o que não estiver no mapa responde `{}`.
const rotas = (mapa) =>
  vi.fn((url, options = {}) => {
    const chave = Object.keys(mapa).find((rota) => String(url).startsWith(rota));
    if (!chave) return json({});
    const valor = mapa[chave];
    return typeof valor === "function" ? valor(url, options) : json(valor);
  });

const corpoDa = (fetchMock, rota) => {
  const chamada = fetchMock.mock.calls.find(([url]) => String(url).startsWith(rota));
  return chamada ? JSON.parse(chamada[1].body) : undefined;
};

beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll('script[src*="accounts.google.com"]').forEach((s) => s.remove());
});

describe("entrada da To Do Green", () => {
  it("recupera a senha pelo código e entra direto na vertical", async () => {
    const fetchMock = rotas({
      "/api/auth/forgot": { ok: true },
      "/api/auth/reset": { token: "tok-reset", user: { id: "u1", name: "Ana", email: "ana@empresa.com" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const update = vi.fn();
    const onAuthenticated = vi.fn();
    render(<Login update={update} vertical onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: " Ana@Empresa.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Alterar senha inicial" }));
    await screen.findByRole("heading", { name: "Redefinir senha" });
    expect(corpoDa(fetchMock, "/api/auth/forgot")).toEqual({ email: "ana@empresa.com" });

    const codigo = screen.getByLabelText("Código de 6 dígitos");
    fireEvent.change(codigo, { target: { value: "12a3-4567" } });
    expect(codigo).toHaveValue("123456");
    fireEvent.change(screen.getByLabelText(/Nova senha/), { target: { value: "curta" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir e entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A nova senha precisa ter pelo menos 8 caracteres.");

    fireEvent.change(screen.getByLabelText(/Nova senha/), { target: { value: "senha-nova-segura" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir e entrar" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(corpoDa(fetchMock, "/api/auth/reset")).toEqual({
      email: "ana@empresa.com",
      code: "123456",
      password: "senha-nova-segura",
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok-reset");
    expect(window.location.pathname).toBe("/todogreen");
    // Quem entra pela To Do Green nunca cai no onboarding de negócio genérico.
    const sessao = update.mock.calls[0][0]();
    expect(sessao.user.id).toBe("u1");
    expect(sessao.preferences.needsBusinessOnboardingCandidate).toBe(false);
  });

  it("servidor fora do ar vira mensagem em português", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<Login update={vi.fn()} vertical />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@empresa.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
    fireEvent.submit(screen.getByLabelText("E-mail").closest("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível conectar ao servidor. Tente novamente.",
    );
  });

  it("quem não tem conta pede acesso ali mesmo", async () => {
    const fetchMock = rotas({ "/api/todogreen/solicitar-acesso": { ok: true } });
    vi.stubGlobal("fetch", fetchMock);
    render(<Login update={vi.fn()} vertical />);

    fireEvent.click(screen.getByRole("button", { name: "Ainda não tem acesso? Solicitar acesso" }));
    const pedido = screen.getByText("Solicitar acesso à To Do Green").closest("form");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Bia" } });
    fireEvent.change(screen.getByLabelText("E-mail corporativo"), { target: { value: "bia@cliente.com" } });
    fireEvent.change(screen.getByLabelText("Por que precisa de acesso?"), { target: { value: "Sou do financeiro." } });
    fireEvent.submit(pedido);

    expect(await screen.findByText(/Pedido enviado\. Você receberá um convite/)).toBeInTheDocument();
    expect(corpoDa(fetchMock, "/api/todogreen/solicitar-acesso")).toEqual({
      nome: "Bia",
      email: "bia@cliente.com",
      empresa: "",
      telefone: "",
      mensagem: "Sou do financeiro.",
    });
  });

  it("recusa do pedido aparece no formulário, que continua aberto", async () => {
    vi.stubGlobal(
      "fetch",
      rotas({
        "/api/todogreen/solicitar-acesso": () =>
          json({ error: "Já existe um pedido para este e-mail." }, { ok: false, status: 409 }),
      }),
    );
    render(<Login update={vi.fn()} vertical />);
    fireEvent.click(screen.getByRole("button", { name: "Ainda não tem acesso? Solicitar acesso" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Bia" } });
    fireEvent.change(screen.getByLabelText("E-mail corporativo"), { target: { value: "bia@cliente.com" } });
    fireEvent.submit(screen.getByText("Solicitar acesso à To Do Green").closest("form"));
    expect(await screen.findByText("Já existe um pedido para este e-mail.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeEnabled();
  });

  it("portal externo não oferece pedido de acesso nem consulta o Google", async () => {
    const fetchMock = rotas({});
    vi.stubGlobal("fetch", fetchMock);
    render(<Login update={vi.fn()} entryPortal="cliente" />);
    expect(screen.getByText("PORTAL DO CLIENTE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Solicitar acesso/ })).toBeNull();
    // A entrada da To Do Green não desenha o botão do Google: não há por que
    // buscar o client id nem carregar o script de terceiros ali.
    expect(fetchMock).not.toHaveBeenCalledWith("/api/config");
    expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
    expect(document.title).toBe("To Do Green | Portal do Cliente");
  });
});

describe("acesso geral", () => {
  beforeEach(() => history.replaceState({}, "", "/acesso-geral"));

  it("cria a conta, confirma o e-mail pelo código e entra sem trocar de rota", async () => {
    const fetchMock = rotas({
      "/api/config": {},
      "/api/auth/register": { pending: true, email: "maria@example.com" },
      "/api/auth/resend": { ok: true },
      "/api/auth/verify": { token: "tok-novo", user: { id: "u2", name: "Maria", email: "maria@example.com" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const update = vi.fn();
    render(<Login update={update} />);

    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "maria@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: "senha-bem-segura" } });
    fireEvent.submit(screen.getByLabelText("Seu nome").closest("form"));

    await screen.findByRole("heading", { name: "Confirme seu e-mail" });
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    const confirmar = screen.getByRole("button", { name: "Confirmar e entrar" });
    expect(confirmar).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Novo código enviado. Confira seu e-mail.");
    expect(corpoDa(fetchMock, "/api/auth/resend")).toEqual({ email: "maria@example.com" });

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "654321" } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBe("tok-novo"));
    expect(corpoDa(fetchMock, "/api/auth/verify")).toEqual({ email: "maria@example.com", code: "654321" });
    expect(window.location.pathname).toBe("/acesso-geral");
    // Conta nova no acesso geral é candidata ao onboarding de negócio.
    expect(update.mock.calls[0][0]().preferences.needsBusinessOnboardingCandidate).toBe(true);
  });

  it("desenha o botão do Google quando o Worker publica o client id", async () => {
    vi.stubGlobal("fetch", rotas({ "/api/config": { googleClientId: "cliente-google" } }));
    const { container } = render(<Login update={vi.fn()} />);
    await waitFor(() => expect(container.querySelector(".google-btn")).not.toBeNull());
    expect(screen.getByText("ou use e-mail")).toBeInTheDocument();
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull();
  });
});

describe("convite de colaboração", () => {
  const convite = { name: "Beto", email: "beto@empresa.com", role: "gestor", ownerName: "Ana", hasAccount: false };

  it("quem ainda não tem conta cria a senha e entra no espaço", async () => {
    const fetchMock = rotas({
      "/api/collab/invite-info": convite,
      "/api/collab/invite/accept": {
        token: "tok-convite",
        user: { id: "u3", name: "Beto", email: "beto@empresa.com" },
        ownerId: "owner-ana",
        ownerName: "Ana",
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAuthenticated = vi.fn();
    render(<AcceptInvite db={{ user: null }} update={vi.fn()} token="tok/123" onAuthenticated={onAuthenticated} />);

    expect(await screen.findByRole("heading", { name: "Você foi convidado(a) como Gestor" })).toBeInTheDocument();
    expect(screen.getByText("CONVITE DE ANA")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/collab/invite-info?token=tok%2F123");
    const aceitar = screen.getByRole("button", { name: "Criar conta e aceitar convite" });
    expect(aceitar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Crie uma senha/), { target: { value: "senha-do-beto" } });
    fireEvent.click(aceitar);

    expect(await screen.findByRole("heading", { name: "Bem-vindo(a) ao espaço de Ana" })).toBeInTheDocument();
    expect(corpoDa(fetchMock, "/api/collab/invite/accept")).toEqual({ token: "tok/123", password: "senha-do-beto" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok-convite");
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it("logado com outra conta, só oferece sair", async () => {
    vi.stubGlobal("fetch", rotas({ "/api/collab/invite-info": { ...convite, hasAccount: true } }));
    render(<AcceptInvite db={{ user: { id: "x", email: "outra@empresa.com" } }} update={vi.fn()} token="t" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Você está logado(a) como outra@empresa.com");
    expect(screen.getByRole("button", { name: "Sair e entrar com outra conta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar convite" })).toBeNull();
  });

  it("convite recusado pelo servidor mostra o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      rotas({ "/api/collab/invite-info": () => json({ error: "Este convite expirou." }, { ok: false, status: 410 }) }),
    );
    render(<AcceptInvite db={{ user: null }} update={vi.fn()} token="t" />);
    expect(await screen.findByRole("heading", { name: "Não foi possível abrir este convite" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Este convite expirou.");
  });

  it("resposta que não é JSON cai no erro em vez de quebrar a tela", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("html")) })),
    );
    render(<AcceptInvite db={{ user: null }} update={vi.fn()} token="t" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o convite.");
  });
});

describe("primeiro acesso com senha provisória", () => {
  const preencher = (atual, nova, confirmacao) => {
    fireEvent.change(screen.getByLabelText("Senha provisória"), { target: { value: atual } });
    fireEvent.change(screen.getByLabelText(/Nova senha/), { target: { value: nova } });
    fireEvent.change(screen.getByLabelText("Confirme a nova senha"), { target: { value: confirmacao } });
    fireEvent.submit(screen.getByLabelText("Senha provisória").closest("form"));
  };

  it("confere a senha nova antes de ir ao servidor", async () => {
    const fetchMock = rotas({});
    vi.stubGlobal("fetch", fetchMock);
    render(<FirstAccessPassword db={{ user: { name: "Ana" } }} update={vi.fn()} />);
    expect(screen.getByText(/Olá, Ana\. Você entrou com uma senha provisória\./)).toBeInTheDocument();

    preencher("Prov-1234", "SenhaNova#1", "Outra#1234");
    expect(await screen.findByRole("alert")).toHaveTextContent("A confirmação não confere com a nova senha.");
    preencher("Prov-1234", "Prov-1234", "Prov-1234");
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha uma senha diferente da provisória.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa do servidor aparece e a marca de troca continua", async () => {
    vi.stubGlobal(
      "fetch",
      rotas({ "/api/auth/password": () => json({ error: "Senha provisória incorreta." }, { ok: false, status: 401 }) }),
    );
    const update = vi.fn();
    render(<FirstAccessPassword db={{ user: { name: "Ana" } }} update={update} />);
    preencher("errada-123", "SenhaNova#1", "SenhaNova#1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Senha provisória incorreta.");
    expect(update).not.toHaveBeenCalled();
  });

  it("troca aceita tira a marca do usuário", async () => {
    vi.stubGlobal("fetch", rotas({ "/api/auth/password": { ok: true } }));
    const update = vi.fn();
    render(<FirstAccessPassword db={{ user: { name: "Ana" } }} update={update} />);
    preencher("Prov-1234", "SenhaNova#1", "SenhaNova#1");
    await waitFor(() => expect(update).toHaveBeenCalled());
    const depois = update.mock.calls[0][0]({ user: { id: "u1", name: "Ana", mustChangePassword: true } });
    expect(depois.user).toEqual({ id: "u1", name: "Ana" });
  });
});

describe("entrada por código de convite na URL", () => {
  it("troca o código pela entrada no espaço e limpa a URL", async () => {
    history.replaceState({}, "", "/?convite=COD%20123");
    const fetchMock = rotas({ "/api/collab/join": { ownerId: "owner-ana", ownerName: "Ana" } });
    vi.stubGlobal("fetch", fetchMock);
    const setToast = vi.fn();
    renderHook(() => useEntradaPorConvite({ id: "u1" }, setToast));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith("Você entrou no espaço de Ana"));
    expect(corpoDa(fetchMock, "/api/collab/join")).toEqual({ code: "COD 123" });
    expect(window.location.search).toBe("");
  });

  it("sem pessoa logada o código espera na URL", () => {
    history.replaceState({}, "", "/?convite=abc");
    const fetchMock = rotas({});
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useEntradaPorConvite(null, vi.fn()));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?convite=abc");
  });
});
