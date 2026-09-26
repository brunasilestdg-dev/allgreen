import { describe, expect, it } from "vitest";
import {
  isBlockedHost,
  isPrivateIpv6Literal,
  isTrack3rOutboundTokenKey,
  isTrackerEnvKey,
  isTrackerOutboundTokenKey,
  safeExternalUrl,
} from "../worker/lib/net.js";

// worker/lib/net.js é a fonte única das defesas contra SSRF usadas pelos
// conectores (TRACK3R, rastreador, MCP) e pelo webhook de saída. O caminho de
// produção sempre passa por `new URL()` antes da checagem, e o `new URL()`
// reescreve o host: estes testes passam pelo mesmo caminho, e não só pela
// string que a pessoa digitou.
const hostDe = (url) => new URL(url).hostname;

describe("host bloqueado: o endereço que o servidor não pode chamar", () => {
  it.each([
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:192.168.0.10]/",
    "https://[::127.0.0.1]/",
    "https://[::ffff:0:7f00:1]/",
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://[64:ff9b:1::1]/",
    "https://[2002:7f00:1::]/",
    "https://[fe80::1]/",
    "https://[fd12:3456::1]/",
    "https://[fec0::1]/",
    "https://[ff02::1]/",
    "https://[::1]/",
    "https://[::]/",
    "https://127.0.0.1/",
    "https://0.0.0.0/",
    "https://100.100.100.200/",
    "https://224.0.0.1/",
    "https://api.internal/",
    "https://servidor.local/",
  ])("bloqueia %s", (url) => {
    expect(isBlockedHost(hostDe(url))).toBe(true);
    expect(() => safeExternalUrl(url, "/x")).toThrow();
  });

  it.each([
    "https://[2606:4700:4700::1111]/",
    "https://[2001:4860:4860::8888]/",
    "https://[::ffff:8.8.8.8]/",
    "https://8.8.8.8/",
    "https://api.exemplo.com.br/",
  ])("deixa passar o endereço público %s", (url) => {
    expect(isBlockedHost(hostDe(url))).toBe(false);
    expect(safeExternalUrl(url, "/x").pathname).toBe("/x");
  });

  it("entende o IPv4 pontuado dentro do IPv6, como a pessoa digita", () => {
    expect(isPrivateIpv6Literal("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6Literal("[::ffff:169.254.169.254]")).toBe(true);
    expect(isPrivateIpv6Literal("::ffff:8.8.8.8")).toBe(false);
  });

  it("recusa o que não consegue entender, em vez de chutar", () => {
    expect(isPrivateIpv6Literal("1:2:3:4:5:6:7:8:9")).toBe(true);
    expect(isPrivateIpv6Literal("::ffff:999.0.0.1")).toBe(true);
    expect(isPrivateIpv6Literal("gggg::1")).toBe(true);
  });
});

describe("segredo que um conector pode mandar para fora", () => {
  it("TRACK3R: o token de saída nunca é uma credencial de entrada", () => {
    expect(isTrack3rOutboundTokenKey("TODOGREEN_TRACK3R_API_TOKEN")).toBe(true);
    expect(isTrack3rOutboundTokenKey("TODOGREEN_TRACK3R_API_TOKEN_FILIAL")).toBe(true);
    for (const entrada of [
      "TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET",
      "TODOGREEN_TRACK3R_TOKEN_CTES",
      "TODOGREEN_TRACK3R_TOKEN_FATURAS",
      "TODOGREEN_TRACK3R_WEBHOOK_SECRET",
      "BREVO_API_KEY",
    ])
      expect({ entrada, ok: isTrack3rOutboundTokenKey(entrada) }).toEqual({ entrada, ok: false });
  });

  it("rastreador: só segredos do próprio conector, e o do webhook não sai", () => {
    expect(isTrackerOutboundTokenKey("TODOGREEN_TRACKER_API_TOKEN")).toBe(true);
    expect(isTrackerOutboundTokenKey("TODOGREEN_TRACKER_WEBHOOK_SECRET")).toBe(false);
    expect(isTrackerEnvKey("TODOGREEN_TRACKER_WEBHOOK_SECRET")).toBe(true);
    for (const alheio of ["BREVO_API_KEY", "GEMINI_API_KEY", "WORKSPACE_AI_VAULT_KEY", "NFE_CERT_PASSWORD", ""])
      expect({ alheio, ok: isTrackerOutboundTokenKey(alheio) }).toEqual({ alheio, ok: false });
  });
});
