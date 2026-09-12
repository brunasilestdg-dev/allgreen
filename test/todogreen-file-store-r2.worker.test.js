import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  armazenarArquivoInterno,
  descartarArquivos,
  chaveR2,
} from "../worker/services/todogreen-file-store.js";

// Mídia do cofre em R2 (prepared-and-off): o mesmo código grava no R2 quando o
// binding MEDIA_BUCKET existe e cai no D1 (chunks) quando não.

const bucketFake = () => {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) { store.set(key, { value, opts }); },
    async get(key) { return store.has(key) ? { body: store.get(key).value } : null; },
    async delete(key) { store.delete(key); },
  };
};

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const owner = "r2-owner";

const contarChunks = async (id) =>
  Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM todogreen_internal_file_chunks WHERE file_id=?").bind(id).first())?.n || 0);
const lerArquivo = async (id) =>
  env.DB.prepare("SELECT r2_key, byte_size, content_type FROM todogreen_internal_files WHERE id=?").bind(id).first();

describe("cofre interno com R2", () => {
  it("com binding: grava no R2, marca r2_key e NÃO cria chunks no D1", async () => {
    const bucket = bucketFake();
    const guardado = await armazenarArquivoInterno(
      { DB: env.DB, MEDIA_BUCKET: bucket },
      { ownerId: owner, fileName: "cnh.jpg", contentType: "image/jpeg", bytes, createdBy: owner },
    );
    expect(guardado.r2Key).toBe(chaveR2(owner, guardado.id));
    expect(bucket.store.has(guardado.r2Key)).toBe(true);
    expect(await contarChunks(guardado.id)).toBe(0);
    const row = await lerArquivo(guardado.id);
    expect(row.r2_key).toBe(guardado.r2Key);
    expect(row.byte_size).toBe(bytes.length);
  });

  it("sem binding: cai no D1 com chunks e r2_key nulo", async () => {
    const guardado = await armazenarArquivoInterno(
      { DB: env.DB },
      { ownerId: owner, fileName: "pod.jpg", contentType: "image/jpeg", bytes, createdBy: owner },
    );
    expect(guardado.r2Key).toBeUndefined();
    expect(await contarChunks(guardado.id)).toBeGreaterThan(0);
    expect((await lerArquivo(guardado.id)).r2_key).toBeNull();
  });

  it("descartar apaga o objeto no R2 e a metadata", async () => {
    const bucket = bucketFake();
    const env2 = { DB: env.DB, MEDIA_BUCKET: bucket };
    const guardado = await armazenarArquivoInterno(env2, { ownerId: owner, fileName: "x.jpg", contentType: "image/jpeg", bytes, createdBy: owner });
    expect(bucket.store.has(guardado.r2Key)).toBe(true);
    await descartarArquivos(env2, owner, [guardado.id]);
    expect(bucket.store.has(guardado.r2Key)).toBe(false);
    expect(await lerArquivo(guardado.id)).toBeNull();
  });
});
