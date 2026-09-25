// ===== Transcrição de áudio (/api/transcribe) =====
//
// Contrato
// - Recebe: `request` (POST `{ audio, hint? }`, base64 de até ~8 MB; `hint`
//   são nomes próprios que ajudam o modelo) e `env`.
// - Devolve: `{ text, words }`; 503 sem Workers AI; 400 para base64
//   inválido; 413 para áudio longo demais; 422 quando o áudio não é
//   entendido; 502 se o Whisper falhar. Usa o large-v3-turbo em português e
//   cai para o Whisper antigo só se o turbo falhar.
// - Quem chama: a tabela de rotas autenticadas (exige sessão; não exige
//   banco). Também é reexportado por worker.js para os testes.
// - Autorização: qualquer pessoa com sessão; o áudio não é guardado.

import { json } from "../lib/http.js";

// Transcrição no Workers AI (já no plano, sem serviço externo). O turbo custa
// ~13% mais neurons por minuto que o antigo e acerta mais português.
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
const WHISPER_FALLBACK_MODEL = "@cf/openai/whisper";
const BASE64_AUDIO = /^[A-Za-z0-9+/]+={0,2}$/;

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
  // Confere o formato sem decodificar: a regex é nativa e linear, enquanto o
  // `atob` + laço byte a byte + `[...bytes]` de antes montava um array JS de
  // milhões de itens — o bastante para estourar os 10 ms de CPU do plano Free.
  if (!BASE64_AUDIO.test(base64))
    return json({ error: "Áudio em formato inválido." }, 400);
  // Nomes próprios que a pessoa informou (participantes, cliente): o Whisper
  // erra nome com frequência, e o `initial_prompt` é a dica de contexto dele.
  const dica = String(body?.hint || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
  try {
    let result;
    try {
      // large-v3-turbo aceita o base64 direto e o idioma — o `whisper` antigo
      // não tinha parâmetro de idioma e adivinhava a língua a cada áudio.
      result = await env.AI.run(WHISPER_MODEL, {
        audio: base64,
        language: "pt",
        vad_filter: true,
        ...(dica ? { initial_prompt: dica } : {}),
      });
    } catch (error) {
      // Contingência: o modelo antigo, que exige os bytes. Só entra quando o
      // turbo falha, então o custo de CPU da conversão fica fora do caminho
      // normal.
      console.error("Transcribe turbo error", error);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      result = await env.AI.run(WHISPER_FALLBACK_MODEL, { audio: [...bytes] });
    }
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
