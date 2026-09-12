// ===== Cofre interno: guardar bytes (parte compartilhada) =====
//
// O que era inline no todogreen-file-vault agora mora aqui, para o POD do
// motorista (#120b) guardar a foto/assinatura do jeito EXATO do cofre — mesmo
// chunking, mesmo sha256, mesma tabela — sem uma segunda cópia da lógica. O
// file-vault continua dono da permissão, da pasta e da versão; aqui fica só o
// "escreve bytes → devolve id/hash".

import { TENANT_ID } from "./todogreen-access.js";
import { validarImagemDataUrl, BYTES_MAXIMOS_IMAGEM } from "../../src/features/logistics/podCaptura.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHUNK_BYTES = 320 * 1024;

// Object storage da Cloudflare (R2). "Prepared-and-off": só é usado quando o
// binding existir no Worker; sem ele, a mídia continua no D1 (chunks base64),
// que é o teto de escala que isto vem aliviar. A chave é determinística e
// escopada ao dono para nunca colidir entre espaços.
export const R2_BUCKET_BINDING = "MEDIA_BUCKET";
export const chaveR2 = (ownerId, id) => `todogreen/${String(ownerId || "sem-dono")}/${id}`;
const bucketR2 = (env) => env?.[R2_BUCKET_BINDING] || null;

export const sha256 = async (bytes) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary);
};

export const base64ToBytes = (base64) => {
  const binary = atob(String(base64 ?? "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Guarda bytes no cofre (uma linha em todogreen_internal_files + os pedaços em
// todogreen_internal_file_chunks) numa única transação. Devolve { id, sha256,
// byteSize }. NÃO valida permissão nem escopo — quem chama já resolveu isso.
export const armazenarArquivoInterno = async (env, {
  ownerId, clientId = null, workflowId = null, contextType = null, contextId = null,
  folderId = "", fileName, contentType = "application/octet-stream", bytes,
  source = "internal_upload", externalUrl = "", version = 1, createdBy,
}) => {
  const id = crypto.randomUUID();
  const digest = await sha256(bytes);
  const now = new Date().toISOString();
  const bucket = bucketR2(env);
  const tipo = contentType || "application/octet-stream";

  // Caminho R2 (quando o binding existe): grava os bytes no object storage
  // PRIMEIRO — se falhar, nem chega a criar a linha órfã — e a metadata (com o
  // r2_key) numa única inserção, sem chunks. É aqui que a mídia deixa de pesar
  // no D1. A leitura casa pelo r2_key (ver o download do file-vault).
  if (bucket) {
    const r2Key = chaveR2(ownerId, id);
    await bucket.put(r2Key, bytes, { httpMetadata: { contentType: tipo } });
    await env.DB.prepare(
      `INSERT INTO todogreen_internal_files
         (id,tenant_id,workspace_owner_id,client_id,workflow_id,context_type,context_id,
          file_name,content_type,byte_size,sha256,version,source,external_url,folder_id,
          created_by,created_at,archived_at,r2_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    ).bind(
      id, TENANT_ID, ownerId, clientId || null, workflowId || null, contextType || null,
      contextId || null, fileName, tipo, bytes.length,
      digest, version, source, externalUrl || "", folderId || "", createdBy, now, r2Key,
    ).run();
    return { id, sha256: digest, byteSize: bytes.length, r2Key };
  }

  // Caminho legado (sem R2): metadata + chunks base64 no D1, numa transação.
  const statements = [
    env.DB.prepare(
      `INSERT INTO todogreen_internal_files
         (id,tenant_id,workspace_owner_id,client_id,workflow_id,context_type,context_id,
          file_name,content_type,byte_size,sha256,version,source,external_url,folder_id,
          created_by,created_at,archived_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
    ).bind(
      id, TENANT_ID, ownerId, clientId || null, workflowId || null, contextType || null,
      contextId || null, fileName, tipo, bytes.length,
      digest, version, source, externalUrl || "", folderId || "", createdBy, now,
    ),
  ];
  let index = 0;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
    statements.push(
      env.DB.prepare("INSERT INTO todogreen_internal_file_chunks (file_id,chunk_index,content_base64) VALUES (?,?,?)")
        .bind(id, index, bytesToBase64(chunk)),
    );
    index += 1;
  }
  await env.DB.batch(statements);
  return { id, sha256: digest, byteSize: bytes.length };
};

// Descarta arquivos internos por id (e seus pedaços) — usado para limpar imagens
// que foram guardadas antes de um evento que acabou não entrando (corrida do
// idempotente, falha do batch). Apaga os chunks explicitamente porque o D1 não
// garante o ON DELETE CASCADE sem PRAGMA foreign_keys. Escopado ao dono.
export const descartarArquivos = async (env, ownerId, ids = []) => {
  const lista = (ids || []).filter(Boolean);
  if (!lista.length) return;
  // Objeto no R2 primeiro (chave determinística; apagar chave de arquivo legado
  // que nunca existiu no R2 é no-op idempotente). Melhor-esforço: um R2 fora do
  // ar não pode travar a limpeza da metadata/chunks no D1.
  const bucket = bucketR2(env);
  if (bucket) await Promise.all(lista.map((id) => bucket.delete(chaveR2(ownerId, id)).catch(() => {})));
  const marcadores = lista.map(() => "?").join(",");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM todogreen_internal_file_chunks WHERE file_id IN (${marcadores})`).bind(...lista),
    env.DB.prepare(`DELETE FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND id IN (${marcadores})`).bind(TENANT_ID, ownerId, ...lista),
  ]);
};

const EXTENSAO_POR_MIME = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

// Recebe um data URL de imagem (a foto/assinatura que o motorista capturou e
// reduziu no celular), valida (é imagem? cabe no teto?) e guarda no cofre.
// Devolve { url, hash, id } com a URL de download do cofre — ou lança um Error
// com a mensagem de recusa (o chamador vira 400). O front sempre manda imagem
// pequena e válida; esta validação é a defesa do servidor.
export const armazenarImagemBase64 = async (env, {
  ownerId, clientId = null, contextId = null, contextType = "operation_proof",
  dataUrl, createdBy, prefixoNome = "comprovante", bytesMaximos = BYTES_MAXIMOS_IMAGEM,
}) => {
  const validado = validarImagemDataUrl(dataUrl, bytesMaximos);
  if (typeof validado === "string") throw new Error(validado);
  const bytes = base64ToBytes(validado.base64);
  const extensao = EXTENSAO_POR_MIME[validado.mime] || "bin";
  const guardado = await armazenarArquivoInterno(env, {
    ownerId, clientId, contextType, contextId,
    fileName: `${prefixoNome}-${Date.now()}.${extensao}`,
    contentType: validado.mime, bytes, createdBy,
  });
  return { url: `/api/todogreen/file-vault/${guardado.id}/download`, hash: guardado.sha256, id: guardado.id };
};
