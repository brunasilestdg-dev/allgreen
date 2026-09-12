import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { arquivosVisiveis, pastasVisiveis } from "../../src/features/logistics/pastasDomain.js";
// O "escreve bytes → devolve id/hash" (chunking, sha256, base64) mora no
// file-store, compartilhado com o POD do motorista (#120b). Aqui fica a
// permissão, a pasta e a versão — o que é do cofre.
import { MAX_FILE_BYTES, base64ToBytes, armazenarArquivoInterno, R2_BUCKET_BINDING } from "./todogreen-file-store.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const text = (value, max = 1000) => String(value ?? "").trim().slice(0, max);

const canRead = (access) => ["owner","admin"].includes(access.role) || ["evidence:manage","proposal:manage","deal:review","deal:approve","audit:read"].some((p) => podeNaVertical(access,p));
const canWrite = (access) => ["owner","admin"].includes(access.role) || ["evidence:manage","proposal:manage","deal:review"].some((p) => podeNaVertical(access,p));

const mapRow = (row) => ({
  id: row.id, clientId: row.client_id || "", workflowId: row.workflow_id || "", fileName: row.file_name,
  contentType: row.content_type, byteSize: row.byte_size, sha256: row.sha256, version: row.version,
  source: row.source, externalUrl: row.external_url || "", folderId: row.folder_id || "",
  contextType: row.context_type || "", contextId: row.context_id || "",
  createdBy: row.created_by, createdAt: row.created_at,
});

// ===== Pastas: o corte que protege de verdade =====
//
// A pasta só serve para algo se o ARQUIVO dentro dela também ficar escondido.
// Esconder a pasta e listar o conteúdo é pior que não ter pasta: dá a impressão
// de privacidade que não existe.
//
// A visibilidade depende de toda a linhagem da pasta (uma subpasta "do espaço"
// dentro de uma privada continua invisível), o que é recursivo sobre um
// conjunto pequeno — por isso o corte é em JS sobre as pastas do espaço, e
// nunca sobre os arquivos: os três cortes de escopo do arquivo seguem no SQL.
const pastasDoEspaco = async (env, access) => {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, parent_id, name, visibility, members_json, area_permission, owner_email
         FROM todogreen_document_folders
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL LIMIT 500`,
    ).bind(TENANT_ID, access.ownerId).all();
    return (results || []).map((row) => ({
      id: row.id,
      paiId: row.parent_id || "",
      nome: row.name || "",
      visibilidade: row.visibility || "private",
      membros: (() => { try { return JSON.parse(row.members_json || "[]"); } catch { return []; } })(),
      permissaoDaArea: row.area_permission || "",
      donoEmail: row.owner_email || "",
    }));
  } catch (erro) {
    // Falha ao ler pastas NÃO pode abrir o cofre. Devolver [] fecha o acesso a
    // tudo o que está em pasta e mantém o que está fora dela — o lado seguro.
    console.error("cofre: pastas indisponíveis", erro?.message || erro);
    return [];
  }
};

// Um arquivo está na vista quando não tem pasta (o acervo de sempre) ou quando
// a pasta dele é visível pela linhagem inteira.
const arquivoNaVista = async (env, access, email, row) => {
  const pastaId = text(row?.folder_id ?? row?.folderId, 120);
  if (!pastaId) return true;
  const pastas = await pastasDoEspaco(env, access);
  return pastasVisiveis(pastas, quemPergunta(access, email)).some((pasta) => pasta.id === pastaId);
};

const quemPergunta = (access, email) => ({
  email,
  papel: access?.role,
  permissoes: Array.isArray(access?.permissions) ? access.permissions : [],
});

async function list(env, access, url, email) {
  if (!canRead(access)) return json({ error: "Seu acesso não permite consultar documentos internos." },403);
  const clientId=text(url.searchParams.get("client"),120);
  const contextType=text(url.searchParams.get("contextType"),40);
  const contextId=text(url.searchParams.get("contextId"),120);
  const params=[TENANT_ID,access.ownerId];
  const clauses=[];
  if(clientId){ clauses.push("client_id=?"); params.push(clientId); }
  // Anexos de uma requisição/processo: filtra pelo par de contexto (#99).
  if(contextType && contextId){ clauses.push("context_type=? AND context_id=?"); params.push(contextType, contextId); }
  const filter=clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const {results}=await env.DB.prepare(`SELECT * FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL ${filter} ORDER BY created_at DESC LIMIT 300`).bind(...params).all();
  const pastas = await pastasDoEspaco(env, access);
  const quem = quemPergunta(access, email);
  const todos = (results||[]).map(mapRow);
  return json({
    files: arquivosVisiveis(todos, pastas, quem),
    // As pastas vêm na mesma resposta: a tela precisa da árvore para montar a
    // navegação, e pedir duas vezes deixaria a lista aparecer antes das pastas.
    folders: pastasVisiveis(pastas, quem),
    maxFileBytes: MAX_FILE_BYTES,
  });
}

async function createReference(env, access, user, body, email) {
  if(!canWrite(access)) return json({error:"Seu acesso não permite cadastrar documentos."},403);
  const url=text(body.externalUrl,2000); try { const parsed=new URL(url); if(!["http:","https:"].includes(parsed.protocol)) throw new Error(); } catch { return json({error:"Informe um link http/https válido."},400); }
  const fileName=text(body.fileName,240) || "Documento do cliente"; const clientId=text(body.clientId,120); const now=new Date().toISOString();
  // Guardar numa pasta que a pessoa não vê a faria perder o próprio arquivo.
  const folderId=text(body.folderId,120);
  if(folderId && !(await arquivoNaVista(env,access,email,{folder_id:folderId})))
    return json({error:"A pasta escolhida não existe aqui."},404);
  const id=crypto.randomUUID();
  const versionRow=await env.DB.prepare("SELECT MAX(version) AS v FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND file_name=?").bind(TENANT_ID,access.ownerId,clientId,fileName).first();
  await env.DB.prepare(`INSERT INTO todogreen_internal_files (id,tenant_id,workspace_owner_id,client_id,workflow_id,context_type,context_id,file_name,content_type,byte_size,sha256,version,source,external_url,folder_id,created_by,created_at,archived_at) VALUES (?,?,?,?,?,?,?,?, 'text/uri-list',0,'',?,'client_reference',?,?,?,?,NULL)`)
    .bind(id,TENANT_ID,access.ownerId,clientId||null,text(body.workflowId,120)||null,text(body.contextType,40)||null,text(body.contextId,120)||null,fileName,Number(versionRow?.v||0)+1,url,folderId,user.id,now).run();
  return json({file:mapRow(await env.DB.prepare("SELECT * FROM todogreen_internal_files WHERE id=?").bind(id).first())},201);
}

async function upload(env, access, user, request, email) {
  if(!canWrite(access)) return json({error:"Seu acesso não permite enviar documentos."},403);
  const form=await request.formData().catch(()=>null); if(!form) return json({error:"Envie o arquivo como multipart/form-data."},400);
  const file=form.get("file"); if(!(file instanceof File)) return json({error:"Selecione um arquivo."},400);
  if(file.size<=0) return json({error:"O arquivo está vazio."},400);
  if(file.size>MAX_FILE_BYTES) return json({error:"O arquivo passa de 10 MB. Para arquivos maiores, use referência externa."},413);
  const clientId=text(form.get("clientId"),120); const workflowId=text(form.get("workflowId"),120);
  const contextType=text(form.get("contextType"),40); const contextId=text(form.get("contextId"),120);
  // Guardar numa pasta que a pessoa não vê a faria perder o próprio arquivo.
  const folderId=text(form.get("folderId"),120);
  if(folderId && !(await arquivoNaVista(env,access,email,{folder_id:folderId})))
    return json({error:"A pasta escolhida não existe aqui."},404);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const versionRow=await env.DB.prepare("SELECT MAX(version) AS v FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND file_name=?").bind(TENANT_ID,access.ownerId,clientId,file.name).first();
  const guardado=await armazenarArquivoInterno(env,{
    ownerId:access.ownerId, clientId:clientId||null, workflowId:workflowId||null,
    contextType:contextType||null, contextId:contextId||null, folderId:folderId||null,
    fileName:text(file.name,240), contentType:text(file.type,160)||"application/octet-stream",
    bytes, version:Number(versionRow?.v||0)+1, createdBy:user.id,
  });
  return json({file:mapRow(await env.DB.prepare("SELECT * FROM todogreen_internal_files WHERE id=?").bind(guardado.id).first())},201);
}

async function download(env, access, id, email) {
  if(!canRead(access)) return json({error:"Seu acesso não permite baixar documentos."},403);
  const row=await env.DB.prepare("SELECT * FROM todogreen_internal_files WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL").bind(id,TENANT_ID,access.ownerId).first();
  if(!row) return json({error:"Documento não encontrado."},404);
  // Esconder na lista e liberar no download é pior do que não ter pasta: dá a
  // impressão de privacidade que não existe, e o id de um arquivo circula por
  // link, histórico e print. A resposta é 404, não 403 — 403 confirmaria que o
  // documento existe naquela pasta.
  if(!(await arquivoNaVista(env, access, email, row))) return json({error:"Documento não encontrado."},404);
  if(row.source==="client_reference") return json({externalUrl:row.external_url,reference:true});
  const baixarHeaders={"content-type":row.content_type||"application/octet-stream","content-length":String(row.byte_size),"content-disposition":`attachment; filename="${String(row.file_name).replace(/["\\]/g,"")}"`,"cache-control":"no-store","x-content-type-options":"nosniff","x-document-sha256":row.sha256};
  // Mídia no R2 (r2_key preenchido): serve o objeto direto. Sem o binding ou sem
  // o objeto, o arquivo não pode ser entregue — 404, não um corpo vazio que
  // passaria por comprovante válido.
  if(row.r2_key){
    const bucket=env[R2_BUCKET_BINDING];
    const objeto=bucket?await bucket.get(row.r2_key):null;
    if(!objeto) return json({error:"Documento não encontrado."},404);
    return new Response(objeto.body,{status:200,headers:baixarHeaders});
  }
  const {results}=await env.DB.prepare("SELECT content_base64 FROM todogreen_internal_file_chunks WHERE file_id=? ORDER BY chunk_index").bind(id).all();
  const chunks=(results||[]).map((item)=>base64ToBytes(item.content_base64));
  const blob=new Blob(chunks,{type:row.content_type||"application/octet-stream"});
  return new Response(blob,{status:200,headers:baixarHeaders});
}

export async function handleTodoGreenFileVault(request,env,access,user){
  if(!env.DB) return json({error:"Banco indisponível."},503);
  const url=new URL(request.url); const parts=url.pathname.split("/").filter(Boolean); const id=text(parts[3],120); const action=text(parts[4],40);
  const email=text(user?.email,200).toLowerCase();
  if(request.method==="GET"&&!id) return list(env,access,url,email);
  if(request.method==="POST"&&!id){ const type=request.headers.get("content-type")||""; return type.includes("multipart/form-data")?upload(env,access,user,request,email):createReference(env,access,user,await request.json().catch(()=>({})),email); }
  if(request.method==="GET"&&id&&action==="download") return download(env,access,id,email);
  if(request.method==="DELETE"&&id){
    if(!canWrite(access)) return json({error:"Sem permissão para arquivar."},403);
    // Arquivar documento de pasta que a pessoa não vê é apagar às cegas.
    const alvo=await env.DB.prepare("SELECT folder_id FROM todogreen_internal_files WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL").bind(id,TENANT_ID,access.ownerId).first();
    if(!alvo) return json({error:"Documento não encontrado."},404);
    if(!(await arquivoNaVista(env,access,email,alvo))) return json({error:"Documento não encontrado."},404);
    const result=await env.DB.prepare("UPDATE todogreen_internal_files SET archived_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL").bind(new Date().toISOString(),id,TENANT_ID,access.ownerId).run();
    return result?.meta?.changes?json({ok:true}):json({error:"Documento não encontrado."},404);
  }
  return json({error:"Rota ou método não suportado."},405);
}
