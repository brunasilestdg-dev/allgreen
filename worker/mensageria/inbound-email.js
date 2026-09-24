// ===== Normalização de e-mail recebido por webhook =====
// Camada pura (sem Cloudflare) para o handler `/api/inbound/email` entender
// tanto o formato GENÉRICO (campos no topo, um e-mail por requisição) quanto o
// do Brevo Inbound Parsing, que agrupa as mensagens num array `items[]` com
// chaves PascalCase (`From`/`To`/`Subject`/`RawTextBody`/`RawHtmlBody`) e manda
// `From` como objeto `{Name, Address}` e `To` como array desses objetos.
// Mantida fora do worker.js para ser testável isoladamente.

// Extrai { name, address } de:
//   - string "Fulano <a@b.com>" ou "a@b.com" (ou lista separada por vírgula)
//   - objeto { Name, Address } / { name, address } / { Email } (Brevo e afins)
//   - array desses (usa o primeiro)
// O endereço volta em minúsculas, para casar com o roteamento por destinatário.
export function parseEmailAddress(value) {
  if (!value) return { name: "", address: "" };
  if (Array.isArray(value)) return parseEmailAddress(value[0]);
  if (typeof value === "object") {
    const address = String(
      value.Address || value.address || value.Email || value.email || "",
    )
      .trim()
      .toLowerCase();
    const name = String(value.Name || value.name || "").trim();
    return { name, address };
  }
  const str = String(value).trim();
  const withName = str.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (withName)
    return {
      name: withName[1].trim(),
      address: withName[2].trim().toLowerCase(),
    };
  const address = str.split(",")[0].trim().toLowerCase();
  return { name: "", address };
}

function normalizeOne(rec) {
  if (!rec || typeof rec !== "object") {
    return { to: "", fromName: "", fromAddress: "", subject: "", text: "", html: "", messageId: "" };
  }
  const to = parseEmailAddress(
    rec.To ?? rec.to ?? rec.recipient ?? rec.envelope?.to ?? rec.headers?.to ?? "",
  ).address;
  const from = parseEmailAddress(
    rec.From ?? rec.from ?? rec.sender ?? rec.headers?.from ?? "",
  );
  const subject = String(rec.Subject ?? rec.subject ?? "").slice(0, 200);
  const text = String(
    rec.RawTextBody ??
      rec.ExtractedMarkdownMessage ??
      rec.text ??
      rec["body-plain"] ??
      rec["stripped-text"] ??
      rec.plain ??
      "",
  ).trim();
  const html = String(rec.RawHtmlBody ?? rec.html ?? rec["body-html"] ?? "");
  const messageId = String(
    rec.MessageId ?? rec["message-id"] ?? rec.messageId ?? "",
  );
  return { to, fromName: from.name, fromAddress: from.address, subject, text, html, messageId };
}

// Devolve SEMPRE um array de mensagens normalizadas. Descarta o que não tem
// destinatário (sem ele não há como rotear para um workspace).
export function normalizeInboundEmails(body) {
  if (!body || typeof body !== "object") return [];
  const records = Array.isArray(body.items) ? body.items : [body];
  return records.map(normalizeOne).filter((msg) => msg.to);
}
