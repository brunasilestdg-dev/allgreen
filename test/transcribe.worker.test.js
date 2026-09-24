import { describe, expect, it, vi } from "vitest";
import { handleTranscribe } from "../worker.js";

const post = (body) =>
  new Request("https://exemplo.test/api/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// base64 de alguns bytes quaisquer — o conteúdo não importa, o AI é simulado.
const audioBase64 = btoa("audio-falso");

describe("handleTranscribe", () => {
  it("recusa método diferente de POST", async () => {
    const res = await handleTranscribe(
      new Request("https://exemplo.test/api/transcribe"),
      { AI: {} },
    );
    expect(res.status).toBe(405);
  });

  it("avisa quando o Workers AI não está configurado", async () => {
    const res = await handleTranscribe(post({ audio: audioBase64 }), {});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Workers AI/);
  });

  it("recusa envio sem áudio", async () => {
    const res = await handleTranscribe(post({}), { AI: {} });
    expect(res.status).toBe(400);
  });

  it("recusa corpo que não é JSON", async () => {
    const req = new Request("https://exemplo.test/api/transcribe", {
      method: "POST",
      body: "isso não é json",
    });
    const res = await handleTranscribe(req, { AI: {} });
    expect(res.status).toBe(400);
  });

  it("recusa áudio acima do teto de tamanho", async () => {
    const res = await handleTranscribe(
      post({ audio: "A".repeat(8_000_001) }),
      { AI: {} },
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/muito longo/i);
  });

  it("recusa base64 inválido", async () => {
    const res = await handleTranscribe(post({ audio: "!!!não-é-base64!!!" }), {
      AI: {},
    });
    expect(res.status).toBe(400);
  });

  it("devolve o texto transcrito pelo Whisper turbo, em português", async () => {
    const run = vi.fn().mockResolvedValue({ text: "  bom dia a todos  " });
    const res = await handleTranscribe(post({ audio: audioBase64 }), {
      AI: { run },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "bom dia a todos" });
    // O base64 vai direto, sem virar array de bytes no Worker (CPU do Free).
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("@cf/openai/whisper-large-v3-turbo", {
      audio: audioBase64,
      language: "pt",
      vad_filter: true,
    });
  });

  it("passa os nomes informados como dica de contexto ao modelo", async () => {
    const run = vi.fn().mockResolvedValue({ text: "Ana e Joaquim" });
    await handleTranscribe(
      post({ audio: audioBase64, hint: "Participantes: Ana,\nJoaquim" }),
      { AI: { run } },
    );
    expect(run).toHaveBeenCalledWith(
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({ initial_prompt: "Participantes: Ana, Joaquim" }),
    );
  });

  it("cai para o Whisper antigo quando o turbo falha", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("modelo indisponível"))
      .mockResolvedValueOnce({ text: "texto pelo modelo antigo" });
    const res = await handleTranscribe(post({ audio: audioBase64 }), {
      AI: { run },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "texto pelo modelo antigo" });
    expect(run).toHaveBeenLastCalledWith(
      "@cf/openai/whisper",
      expect.objectContaining({ audio: expect.any(Array) }),
    );
  });

  it("avisa quando o áudio não pôde ser entendido", async () => {
    const run = vi.fn().mockResolvedValue({ text: "   " });
    const res = await handleTranscribe(post({ audio: audioBase64 }), {
      AI: { run },
    });
    expect(res.status).toBe(422);
  });

  it("trata falha do modelo sem vazar detalhe interno", async () => {
    const run = vi.fn().mockRejectedValue(new Error("limite da conta excedido"));
    const res = await handleTranscribe(post({ audio: audioBase64 }), {
      AI: { run },
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Não foi possível transcrever este áudio.");
    expect(JSON.stringify(body)).not.toContain("limite da conta");
  });
});
