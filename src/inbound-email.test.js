import { describe, expect, it } from "vitest";
import {
  normalizeInboundEmails,
  parseEmailAddress,
} from "../worker/mensageria/inbound-email.js";

describe("parseEmailAddress", () => {
  it("lê 'Nome <email>' separando nome e endereço em minúsculas", () => {
    expect(parseEmailAddress('"Maria Cliente" <Maria@Example.com>')).toEqual({
      name: "Maria Cliente",
      address: "maria@example.com",
    });
  });

  it("lê e-mail puro e pega o primeiro de uma lista", () => {
    expect(parseEmailAddress("a@b.com, c@d.com")).toEqual({
      name: "",
      address: "a@b.com",
    });
  });

  it("lê objeto do Brevo {Name, Address} e array (usa o primeiro)", () => {
    expect(parseEmailAddress({ Name: "Fulano", Address: "F@Ex.com" })).toEqual({
      name: "Fulano",
      address: "f@ex.com",
    });
    expect(
      parseEmailAddress([{ Address: "x@y.com" }, { Address: "z@w.com" }]),
    ).toEqual({ name: "", address: "x@y.com" });
  });

  it("devolve vazio para valor ausente", () => {
    expect(parseEmailAddress("")).toEqual({ name: "", address: "" });
    expect(parseEmailAddress(null)).toEqual({ name: "", address: "" });
  });
});

describe("normalizeInboundEmails", () => {
  it("normaliza o formato Brevo (items[]) e descarta mensagem sem destinatário", () => {
    const out = normalizeInboundEmails({
      items: [
        {
          From: { Name: "Maria", Address: "maria@example.com" },
          To: [{ Address: "atendimento@meu.com" }],
          Subject: "Frete",
          RawTextBody: "Prazo?",
          RawHtmlBody: "<p>Prazo?</p>",
          MessageId: "m1",
        },
        { Subject: "sem destinatário", RawTextBody: "ignora" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      to: "atendimento@meu.com",
      fromName: "Maria",
      fromAddress: "maria@example.com",
      subject: "Frete",
      text: "Prazo?",
      messageId: "m1",
    });
  });

  it("normaliza o formato genérico (campos no topo)", () => {
    const out = normalizeInboundEmails({
      to: "Contato@Meu.com",
      from: "cliente@example.com",
      subject: "Orçamento",
      text: "Manda proposta?",
      messageId: "g1",
    });
    expect(out[0]).toMatchObject({
      to: "contato@meu.com",
      fromAddress: "cliente@example.com",
      subject: "Orçamento",
      text: "Manda proposta?",
      messageId: "g1",
    });
  });

  it("devolve lista vazia para corpo inválido", () => {
    expect(normalizeInboundEmails(null)).toEqual([]);
    expect(normalizeInboundEmails("x")).toEqual([]);
  });
});
