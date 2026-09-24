import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

let requestNumber = 0;
const nextIp = () => {
  requestNumber += 1;
  return `192.0.2.${(requestNumber % 250) + 1}`;
};

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createUser(id) {
  const token = `token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, `Pessoa ${id}`, `${id}@example.com`, "hash", "salt", now)
    .run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(`session-${id}`, id, await sha256(token), "2099-01-01T00:00:00.000Z", now)
    .run();
  return { id, token };
}

async function mapInbound(ownerId, provider, providerAccountId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO inbound_channels
      (id, workspace_owner_id, provider, provider_account_id, label, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      `${provider}-${providerAccountId}`,
      ownerId,
      provider,
      providerAccountId,
      providerAccountId,
      now,
      now,
    )
    .run();
}

function inboxRequest(user) {
  return worker.fetch(
    new Request("https://app.test/api/inbox", {
      headers: {
        authorization: `Bearer ${user.token}`,
        "cf-connecting-ip": nextIp(),
      },
    }),
    env,
  );
}

const readJson = async (response) => ({
  status: response.status,
  body: await response.json(),
});

describe("recepção omnichannel por webhook", () => {
  it("verifica e recebe mensagens do WhatsApp Cloud API", async () => {
    const owner = await createUser("inbound-wa-owner");
    await mapInbound(owner.id, "whatsapp", "phone-123");

    const verify = await worker.fetch(
      new Request(
        "https://app.test/api/inbound/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=abc123",
        { headers: { "cf-connecting-ip": nextIp() } },
      ),
      env,
    );
    expect(await verify.text()).toBe("abc123");

    const received = await readJson(
      await worker.fetch(
        new Request("https://app.test/api/inbound/whatsapp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": nextIp(),
          },
          body: JSON.stringify({
            entry: [
              {
                changes: [
                  {
                    value: {
                      metadata: { phone_number_id: "phone-123" },
                      contacts: [
                        { wa_id: "5511999999999", profile: { name: "Cliente WA" } },
                      ],
                      messages: [
                        {
                          id: "wamid.inbound",
                          from: "5511999999999",
                          type: "text",
                          text: { body: "Quero saber o preço." },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          }),
        }),
        env,
      ),
    );
    expect(received.status).toBe(200);
    expect(received.body.inserted).toBe(1);

    const inbox = await readJson(await inboxRequest(owner));
    expect(inbox.body.items[0]).toMatchObject({
      channel: "whatsapp",
      direction: "in",
      contactName: "Cliente WA",
      contactHandle: "5511999999999",
      subject: "WhatsApp recebido",
      body: "Quero saber o preço.",
      readAt: null,
    });
    expect(inbox.body.items[0].meta).toMatchObject({
      provider: "whatsapp_cloud_api",
      providerMessageId: "wamid.inbound",
      providerAccountId: "phone-123",
    });
    expect(inbox.body.items[0].conversationId).toBeTruthy();

    const delivery = await env.DB.prepare(
      `SELECT provider, provider_message_id, status FROM message_deliveries
        WHERE workspace_owner_id = ?
        LIMIT 1`,
    )
      .bind(owner.id)
      .first();
    expect(delivery).toMatchObject({
      provider: "whatsapp_cloud_api",
      provider_message_id: "wamid.inbound",
      status: "received",
    });
  });

  it("recebe e-mail por webhook e roteia pelo destinatário", async () => {
    const owner = await createUser("inbound-email-owner");
    await mapInbound(owner.id, "email", "contato@seudominio.com");

    const received = await readJson(
      await worker.fetch(
        new Request("https://app.test/api/inbound/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-sf-inbound-secret": "email-inbound-secret",
            "cf-connecting-ip": nextIp(),
          },
          body: JSON.stringify({
            to: "contato@seudominio.com",
            from: "cliente@example.com",
            subject: "Orçamento",
            text: "Pode me mandar uma proposta?",
            messageId: "email-inbound-1",
          }),
        }),
        env,
      ),
    );
    expect(received.status).toBe(200);
    expect(received.body.inserted).toBe(1);

    const inbox = await readJson(await inboxRequest(owner));
    expect(inbox.body.items[0]).toMatchObject({
      channel: "email",
      direction: "in",
      contactName: "cliente@example.com",
      contactHandle: "cliente@example.com",
      subject: "Orçamento",
      body: "Pode me mandar uma proposta?",
      readAt: null,
    });
    expect(inbox.body.items[0].meta).toMatchObject({
      provider: "inbound_email_webhook",
      providerAccountId: "contato@seudominio.com",
      messageId: "email-inbound-1",
    });
    expect(inbox.body.items[0].conversationId).toBeTruthy();

    const conversation = await env.DB.prepare(
      `SELECT unread_count, last_message_preview FROM conversations
        WHERE workspace_owner_id = ?
        LIMIT 1`,
    )
      .bind(owner.id)
      .first();
    expect(conversation).toMatchObject({
      unread_count: 1,
      last_message_preview: "Pode me mandar uma proposta?",
    });
  });

  it("recebe e-mail no formato Brevo (items[]) com segredo pela URL", async () => {
    const owner = await createUser("inbound-brevo-owner");
    await mapInbound(owner.id, "email", "atendimento@seudominio.com");

    const received = await readJson(
      await worker.fetch(
        new Request(
          "https://app.test/api/inbound/email?key=email-inbound-secret",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": nextIp(),
            },
            body: JSON.stringify({
              items: [
                {
                  From: { Name: "Maria Cliente", Address: "maria@example.com" },
                  To: [{ Name: "Atendimento", Address: "atendimento@seudominio.com" }],
                  Subject: "Dúvida sobre o frete",
                  RawTextBody: "Qual o prazo de entrega?",
                  RawHtmlBody: "<p>Qual o prazo de entrega?</p>",
                  MessageId: "brevo-msg-1",
                },
              ],
            }),
          },
        ),
        env,
      ),
    );
    expect(received.status).toBe(200);
    expect(received.body.inserted).toBe(1);

    const inbox = await readJson(await inboxRequest(owner));
    expect(inbox.body.items[0]).toMatchObject({
      channel: "email",
      direction: "in",
      contactName: "Maria Cliente",
      contactHandle: "maria@example.com",
      subject: "Dúvida sobre o frete",
      body: "Qual o prazo de entrega?",
      readAt: null,
    });
    expect(inbox.body.items[0].meta).toMatchObject({
      provider: "inbound_email_webhook",
      providerAccountId: "atendimento@seudominio.com",
      messageId: "brevo-msg-1",
    });
  });

  it("recusa o webhook de e-mail quando o segredo está errado", async () => {
    const recusado = await readJson(
      await worker.fetch(
        new Request("https://app.test/api/inbound/email?key=errado", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": nextIp(),
          },
          body: JSON.stringify({ items: [] }),
        }),
        env,
      ),
    );
    expect(recusado.status).toBe(403);
  });
});
