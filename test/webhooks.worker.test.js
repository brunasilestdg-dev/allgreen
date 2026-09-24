import { describe, expect, it } from "vitest";
import {
  MAX_ENVIOS_POR_MINUTO,
  TIMEOUT_MS,
  WEBHOOK_EVENTS,
  buildPayload,
  diffNewItems,
  eventById,
  isKnownEvent,
  isPrivateIpv4,
  isPrivateIpv6,
  pickFields,
  signPayload,
  validateWebhookUrl,
} from "../worker/services/webhooks.js";

describe("endereço do webhook: barreira contra SSRF", () => {
  // A partir do momento em que o nosso servidor busca um endereço escolhido
  // por quem usa, ele vira uma ponte para a rede interna. Cada caso abaixo é
  // uma forma conhecida de atravessar essa ponte.

  it("aceita um endereço público comum", () => {
    const r = validateWebhookUrl("https://hooks.zapier.com/abc123");
    expect(r.ok).toBe(true);
    expect(r.url).toContain("hooks.zapier.com");
  });

  it("recusa http, que trafega aberto", () => {
    const r = validateWebhookUrl("http://exemplo.com/hook");
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("https");
  });

  it("recusa a própria máquina", () => {
    for (const alvo of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://127.1.1.1/x",
      "https://[::1]/x",
    ])
      expect({ alvo, ok: validateWebhookUrl(alvo).ok }).toEqual({ alvo, ok: false });
  });

  it("recusa as faixas de rede privada", () => {
    for (const alvo of [
      "https://10.0.0.5/x",
      "https://192.168.1.1/x",
      "https://172.16.0.1/x",
      "https://172.31.255.255/x",
    ])
      expect({ alvo, ok: validateWebhookUrl(alvo).ok }).toEqual({ alvo, ok: false });
  });

  it("recusa o endereço de metadados da nuvem", () => {
    // 169.254.169.254 é onde as nuvens entregam credenciais da máquina. É o
    // alvo clássico de SSRF.
    expect(validateWebhookUrl("https://169.254.169.254/latest/meta-data/").ok).toBe(
      false,
    );
    expect(validateWebhookUrl("https://metadata.google.internal/x").ok).toBe(false);
  });

  it("recusa IPv6 interno, inclusive o que embrulha um IPv4", () => {
    expect(isPrivateIpv6("fd00::1")).toBe(true);
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    // ::ffff:127.0.0.1 é 127.0.0.1 escrito de outro jeito.
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("2606:4700::1111")).toBe(false);
  });

  it("recusa nome que só existe dentro da rede", () => {
    for (const alvo of [
      "https://servidor.local/x",
      "https://api.internal/x",
      "https://maquina.home.arpa/x",
    ])
      expect({ alvo, ok: validateWebhookUrl(alvo).ok }).toEqual({ alvo, ok: false });
  });

  it("recusa usuário e senha embutidos no endereço", () => {
    expect(validateWebhookUrl("https://admin:1234@exemplo.com/x").ok).toBe(false);
  });

  it("recusa porta fora da padrão, que costuma ser serviço interno", () => {
    expect(validateWebhookUrl("https://exemplo.com:8080/x").ok).toBe(false);
    expect(validateWebhookUrl("https://exemplo.com:443/x").ok).toBe(true);
  });

  it("recusa apontar para o próprio aplicativo", () => {
    // Senão o nosso servidor viraria uma ponte para a nossa própria API, com
    // a identidade dele.
    const opts = { selfHost: "orianone.app" };
    expect(
      validateWebhookUrl("https://orianone.app/api/ai", opts).ok,
    ).toBe(false);
    expect(validateWebhookUrl("https://exemplo.com/x", opts).ok).toBe(true);
  });

  it("recusa lixo e endereço vazio sem quebrar", () => {
    expect(validateWebhookUrl("").ok).toBe(false);
    expect(validateWebhookUrl(null).ok).toBe(false);
    expect(validateWebhookUrl("não é endereço").ok).toBe(false);
    expect(validateWebhookUrl(`https://exemplo.com/${"a".repeat(500)}`).ok).toBe(false);
  });

  it("recusa número de IP impossível em vez de tentar interpretar", () => {
    expect(isPrivateIpv4("999.1.1.1")).toBe(true);
  });

  it("deixa passar IP público de verdade", () => {
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("172.32.0.1")).toBe(false);
    expect(isPrivateIpv4("192.169.0.1")).toBe(false);
  });
});

describe("corpo enviado", () => {
  it("leva só os campos do catálogo, não o registro inteiro", () => {
    const item = {
      id: "p1",
      customer: "Ana",
      total: 140,
      status: "novo",
      createdAt: "2026-08-01",
      margemInterna: 0.62,
      custo: 40,
    };
    const corpo = buildPayload("pedido.novo", item, { negocio: "Doces da Ana" });
    expect(corpo.dados).toEqual({
      id: "p1",
      customer: "Ana",
      total: 140,
      status: "novo",
      createdAt: "2026-08-01",
    });
    expect(JSON.stringify(corpo)).not.toContain("margemInterna");
  });

  it("nunca envia campo que pareça segredo ou documento", () => {
    expect(
      pickFields({ id: "x", token: "abc", senha: "123", cpf: "000" }, [
        "id",
        "token",
        "senha",
        "cpf",
      ]),
    ).toEqual({ id: "x" });
  });

  it("campo ausente não vira null no corpo", () => {
    expect(pickFields({ id: "x" }, ["id", "phone"])).toEqual({ id: "x" });
  });

  it("identifica o evento e o negócio", () => {
    const corpo = buildPayload("contato.novo", { id: "c1", name: "Ana" }, {
      negocio: "Doces",
      agora: "2026-08-04T00:00:00.000Z",
    });
    expect(corpo).toMatchObject({
      evento: "contato.novo",
      negocio: "Doces",
      em: "2026-08-04T00:00:00.000Z",
    });
  });

  it("evento desconhecido não vaza dado nenhum", () => {
    expect(buildPayload("inventado", { id: "x", segredo: "y" }).dados).toEqual({});
    expect(isKnownEvent("inventado")).toBe(false);
    expect(eventById("pedido.novo").colecao).toBe("orders");
  });
});

describe("assinatura", () => {
  it("permite ao destino conferir que o aviso veio de nós", async () => {
    const a = await signPayload("segredo", '{"x":1}', "1000");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("segredo diferente gera assinatura diferente", async () => {
    const a = await signPayload("segredo-a", "corpo", "1000");
    const b = await signPayload("segredo-b", "corpo", "1000");
    expect(a).not.toBe(b);
  });

  it("o carimbo entra na assinatura, senão dá para reenviar a mesma mensagem para sempre", async () => {
    const a = await signPayload("s", "corpo", "1000");
    const b = await signPayload("s", "corpo", "2000");
    expect(a).not.toBe(b);
  });

  it("é estável para o mesmo par corpo/carimbo", async () => {
    expect(await signPayload("s", "corpo", "1")).toBe(
      await signPayload("s", "corpo", "1"),
    );
  });
});

describe("descobrir o que é novo", () => {
  const antes = {
    orders: [{ id: "p1", customer: "Ana" }],
    contacts: [{ id: "c1", name: "Ana" }],
  };

  it("avisa só o que apareceu depois", () => {
    const r = diffNewItems(antes, {
      ...antes,
      orders: [...antes.orders, { id: "p2", customer: "Bia" }],
    });
    expect(r).toEqual([{ evento: "pedido.novo", item: { id: "p2", customer: "Bia" } }]);
  });

  it("nada mudou, nada é enviado", () => {
    expect(diffNewItems(antes, antes)).toEqual([]);
  });

  it("item removido não vira aviso", () => {
    expect(diffNewItems(antes, { ...antes, orders: [] })).toEqual([]);
  });

  it("item editado não vira aviso de novo", () => {
    const r = diffNewItems(antes, {
      ...antes,
      orders: [{ id: "p1", customer: "Ana Maria" }],
    });
    expect(r).toEqual([]);
  });

  it("a PRIMEIRA gravação não dispara nada", () => {
    // Senão quem já tem 300 contatos receberia 300 avisos de uma vez ao
    // cadastrar o primeiro envio.
    expect(diffNewItems(null, antes)).toEqual([]);
  });

  it("uma importação de planilha não vira enxurrada", () => {
    const muitos = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}` }));
    const r = diffNewItems({ contacts: [] }, { contacts: muitos });
    expect(r.length).toBeLessThanOrEqual(20);
  });

  it("item sem id é ignorado, para não avisar a mesma coisa sempre", () => {
    expect(diffNewItems({ orders: [] }, { orders: [{ customer: "Ana" }] })).toEqual(
      [],
    );
  });

  it("varre todas as coleções do catálogo", () => {
    const vazio = Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e.colecao, []]));
    const cheio = Object.fromEntries(
      WEBHOOK_EVENTS.map((e) => [e.colecao, [{ id: `${e.colecao}-1` }]]),
    );
    expect(diffNewItems(vazio, cheio).map((x) => x.evento).sort()).toEqual(
      WEBHOOK_EVENTS.map((e) => e.id).sort(),
    );
  });

  it("espaço com formato estranho não quebra a gravação", () => {
    expect(diffNewItems({ orders: "não é lista" }, { orders: null })).toEqual([]);
    expect(diffNewItems({}, {})).toEqual([]);
  });
});

describe("limites", () => {
  it("tem teto de envios por minuto e tempo máximo de espera", () => {
    // Sem teto, um destino lento seguraria a gravação do espaço de trabalho.
    expect(MAX_ENVIOS_POR_MINUTO).toBeGreaterThan(0);
    expect(TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("todo evento do catálogo declara coleção e campos", () => {
    for (const e of WEBHOOK_EVENTS) {
      expect(e.colecao).toBeTruthy();
      expect(e.campos.length).toBeGreaterThan(0);
      expect(e.campos).toContain("id");
    }
  });
});
