import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const text = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 320 * 1024;

const canRead = (access) => ["owner","admin"].includes(access.role) || ["evidence:manage","proposal:manage","deal:review","deal:approve","audit:read"].some((p) => podeNaVertical(access,p));
const canWrite = (access) => ["owner","admin"].includes(access.role) || ["evidence:manage","proposal:manage","deal:review"].some((p) => podeNaVertical(access,p));

const sha256 = async (bytes) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join("");
};
const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return btoa(binary);
};
const base64ToBytes = (base64) => {
  const binary=atob(base64); const bytes=new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
  return bytes;
};
const mapRow = (row) => ({
  id: row.id, clientId: row.client_id || "", workflowId: row.workflow_id || "", fileName: row.file_name,
  contentType: row.content_type, byteSize: row.byte_size, sha256: row.sha256, version: row.version,
  source: row.source, externalUrl: row.external_url || "", createdBy: row.created_by, createdAt: row.created_at,
});

async function list(env, access, url) {
  if (!canRead(access)) return json({ error: "Seu acesso não permite consultar documentos internos." },403);
  const clientId=text(url.searchParams.get("client"),120);
  const params=[TENANT_ID,access.ownerId];
  const filter=clientId ? "AND client_id=?" : ""; if(clientId) params.push(clientId);
  const {results}=await env.DB.prepare(`SELECT * FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL ${filter} ORDER BY created_at DESC LIMIT 300`).bind(...params).all();
  return json({ files:(results||[]).map(mapRow), maxFileBytes:MAX_FILE_BYTES });
}

async function createReference(env, access, user, body) {
  if(!canWrite(access)) return json({error:"Seu acesso não permite cadastrar documentos."},403);
  const url=text(body.externalUrl,2000); try { const parsed=new URL(url); if(!["http:","https:"].includes(parsed.protocol)) throw new Error(); } catch { return json({error:"Informe um link http/https válido."},400); }
  const fileName=text(body.fileName,240) || "Documento do cliente"; const clientId=text(body.clientId,120); const now=new Date().toISOString();
  const id=crypto.randomUUID();
  const versionRow=await env.DB.prepare("SELECT MAX(version) AS v FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND file_name=?").bind(TENANT_ID,access.ownerId,clientId,fileName).first();
  await env.DB.prepare(`INSERT INTO todogreen_internal_files (id,tenant_id,workspace_owner_id,client_id,workflow_id,file_name,content_type,byte_size,sha256,version,source,external_url,created_by,created_at,archived_at) VALUES (?,?,?,?,?,?, 'text/uri-list',0,'',?,'client_reference',?,?,?,NULL)`)
    .bind(id,TENANT_ID,access.ownerId,clientId||null,text(body.workflowId,120)||null,fileName,Number(versionRow?.v||0)+1,url,user.id,now).run();
  return json({file:mapRow(await env.DB.prepare("SELECT * FROM todogreen_internal_files WHERE id=?").bind(id).first())},201);
}

async function upload(env, access, user, request) {
  if(!canWrite(access)) return json({error:"Seu acesso não permite enviar documentos."},403);
  const form=await request.formData().catch(()=>null); if(!form) return json({error:"Envie o arquivo como multipart/form-data."},400);
  const file=form.get("file"); if(!(file instanceof File)) return json({error:"Selecione um arquivo."},400);
  if(file.size<=0) return json({error:"O arquivo está vazio."},400);
  if(file.size>MAX_FILE_BYTES) return json({error:"O arquivo passa de 10 MB. Para arquivos maiores, use referência externa."},413);
  const clientId=text(form.get("clientId"),120); const workflowId=text(form.get("workflowId"),120);
  const bytes=new Uint8Array(await file.arrayBuffer()); const digest=await sha256(bytes); const now=new Date().toISOString(); const id=crypto.randomUUID();
  const versionRow=await env.DB.prepare("SELECT MAX(version) AS v FROM todogreen_internal_files WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND file_name=?").bind(TENANT_ID,access.ownerId,clientId,file.name).first();
  const statements=[env.DB.prepare(`INSERT INTO todogreen_internal_files (id,tenant_id,workspace_owner_id,client_id,workflow_id,file_name,content_type,byte_size,sha256,version,source,external_url,created_by,created_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,'internal_upload','',?,?,NULL)`)
    .bind(id,TENANT_ID,access.ownerId,clientId||null,workflowId||null,text(file.name,240),text(file.type,160)||"application/octet-stream",file.size,digest,Number(versionRow?.v||0)+1,user.id,now)];
  let index=0;
  for(let offset=0;offset<bytes.length;offset+=CHUNK_BYTES){ const chunk=bytes.subarray(offset,Math.min(offset+CHUNK_BYTES,bytes.length)); statements.push(env.DB.prepare("INSERT INTO todogreen_internal_file_chunks (file_id,chunk_index,content_base64) VALUES (?,?,?)").bind(id,index,bytesToBase64(chunk))); index+=1; }
  await env.DB.batch(statements);
  return json({file:mapRow(await env.DB.prepare("SELECT * FROM todogreen_internal_files WHERE id=?").bind(id).first())},201);
}

async function download(env, access, id) {
  if(!canRead(access)) return json({error:"Seu acesso não permite baixar documentos."},403);
  const row=await env.DB.prepare("SELECT * FROM todogreen_internal_files WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL").bind(id,TENANT_ID,access.ownerId).first();
  if(!row) return json({error:"Documento não encontrado."},404);
  if(row.source==="client_reference") return json({externalUrl:row.external_url,reference:true});
  const {results}=await env.DB.prepare("SELECT content_base64 FROM todogreen_internal_file_chunks WHERE file_id=? ORDER BY chunk_index").bind(id).all();
  const chunks=(results||[]).map((item)=>base64ToBytes(item.content_base64));
  const blob=new Blob(chunks,{type:row.content_type||"application/octet-stream"});
  return new Response(blob,{status:200,headers:{"content-type":row.content_type||"application/octet-stream","content-length":String(row.byte_size),"content-disposition":`attachment; filename="${String(row.file_name).replace(/["\\]/g,"")}"`,"cache-control":"no-store","x-content-type-options":"nosniff","x-document-sha256":row.sha256}});
}

export async function handleTodoGreenFileVault(request,env,access,user){
  if(!env.DB) return json({error:"Banco indisponível."},503);
  const url=new URL(request.url); const parts=url.pathname.split("/").filter(Boolean); const id=text(parts[3],120); const action=text(parts[4],40);
  if(request.method==="GET"&&!id) return list(env,access,url);
  if(request.method==="POST"&&!id){ const type=request.headers.get("content-type")||""; return type.includes("multipart/form-data")?upload(env,access,user,request):createReference(env,access,user,await request.json().catch(()=>({}))); }
  if(request.method==="GET"&&id&&action==="download") return download(env,access,id);
  if(request.method==="DELETE"&&id){ if(!canWrite(access)) return json({error:"Sem permissão para arquivar."},403); const result=await env.DB.prepare("UPDATE todogreen_internal_files SET archived_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL").bind(new Date().toISOString(),id,TENANT_ID,access.ownerId).run(); return result?.meta?.changes?json({ok:true}):json({error:"Documento não encontrado."},404); }
  return json({error:"Rota ou método não suportado."},405);
}
