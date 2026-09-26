import { afterEach, describe, expect, it, vi } from "vitest";
import { probeMcpServer } from "../worker/services/mcp-connections.js";

describe("conexão MCP da To Do Green", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "http://mcp.example.com",
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://10.0.0.10/mcp",
    "https://172.16.0.1/mcp",
    "https://192.168.1.10/mcp",
    "https://metadata.local/mcp",
    // A lista antiga comparava prefixos de texto e deixava estes passarem.
    "https://0.0.0.0/mcp",
    "https://100.100.100.200/mcp",
    "https://servidor.internal/mcp",
    "https://[::ffff:169.254.169.254]/mcp",
    "https://[::ffff:127.0.0.1]/mcp",
    "https://usuario:senha@mcp.example.com/mcp",
  ])("bloqueia endpoint inseguro ou privado: %s", async (url) => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const result = await probeMcpServer({ url });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/URL pública HTTPS|rede privada|locais/i);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("não segue redirecionamento: o 302 para a rede interna é recusa", async () => {
    // A checagem do endereço só vale para o primeiro salto. Se o fetch
    // seguisse o 302, um host público levaria o servidor para 127.0.0.1.
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }),
    );
    const result = await probeMcpServer({ url: "https://mcp.example.com/mcp" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/redirecionar/i);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
});
