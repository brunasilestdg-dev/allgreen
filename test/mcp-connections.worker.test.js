import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../worker/services/mcp-connections.js";

describe("conexão MCP da To Do Green", () => {
  it.each([
    "http://mcp.example.com",
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://10.0.0.10/mcp",
    "https://172.16.0.1/mcp",
    "https://192.168.1.10/mcp",
    "https://metadata.local/mcp",
  ])("bloqueia endpoint inseguro ou privado: %s", async (url) => {
    const result = await probeMcpServer({ url });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/URL pública HTTPS|rede privada|locais/i);
  });
});
