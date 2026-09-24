// ===== Transcrição de áudio (/api/transcribe) =====
//
// Contrato
// - Recebe: `request` (POST `{ audio }`, base64 de até ~8 MB) e `env`.
// - Devolve: `{ text, words }`; 503 sem Workers AI; 413 para áudio longo
//   demais; 422 quando o áudio não é entendido; 502 se o Whisper falhar.
// - Quem chama: a tabela de rotas autenticadas (exige sessão; não exige
//   banco). Também é reexportado por worker.js para os testes.
// - Autorização: qualquer pessoa com sessão; o áudio não é guardado.

import { json } from "../lib/http.js";

// Transcreve áudio com Whisper no Workers AI. O áudio é gravado ou escolhido no
// navegador e chega aqui em base64; nada é armazenado no servidor.
export async function handleTranscribe(request, env) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  if (!env.AI)
    return json(
      { error: "Transcrição indisponível: Workers AI não está configurado." },
      503,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }
  const base64 = String(body?.audio || "");
  if (!base64) return json({ error: "Nenhum áudio recebido." }, 400);
  // ~8 MB de base64 (aprox. 6 MB de áudio) é o teto por envio.
  if (base64.length > 8_000_000)
    return json(
      { error: "Áudio muito longo. Divida em partes de até 5 minutos." },
      413,
    );
  let bytes;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return json({ error: "Áudio em formato inválido." }, 400);
  }
  try {
    const result = await env.AI.run("@cf/openai/whisper", {
      audio: [...bytes],
    });
    const text = String(result?.text || "").trim();
    if (!text)
      return json({ error: "Não foi possível entender o áudio." }, 422);
    return json({
      text,
      words: result?.word_count ?? null,
    });
  } catch (error) {
    console.error("Transcribe error", error);
    return json({ error: "Não foi possível transcrever este áudio." }, 502);
  }
}
