import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Download,
  Edit3,
  FileText,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { DOCUMENT_TEMPLATES, fillDocTemplate, makeSignature, verifySignature, signatureStatus, signatureBlockText, applyMergeFields, recordLabel, formatCellValue } from "../../domain.js";
import { documentBlocksToText, normalizeDocumentBlocks, normalizeSyncedBlock, textToDocumentBlocks } from "./blockDocumentDomain.js";
import Modal from "../../components/Modal.jsx";
import { Button, Empty, Field, LIST_PAGE_SIZE, LoadMoreButton, PageTitle } from "../../components/ui.jsx";
import { aiWorkspaceContext, trackProductEvent } from "../../session/telemetria.js";
import { authHeaders } from "../../session/armazenamento.js";
import { slugify } from "../../components/formato.js";
import { DOCUMENT_ACCEPT, DOCUMENT_FORMATS_HINT, describeOcrProgress, documentTitleFromFilename, extractDocumentText } from "../../components/leituraDeArquivo.js";
import SharingFields from "../../components/SharingFields.jsx";
import { uid } from "../../domain.js";

const BlockDocumentEditor = lazy(
  () => import("./BlockDocumentEditor.jsx"),
);

const createBlankDocument = () => ({
  title: "",
  type: "Proposta comercial",
  content: "",
  blocks: [],
  signatures: [],
  visibility: "privado",
  sharingPermission: "visualizar",
  sharedWith: [],
  sharedTeams: [],
  project: "",
  linkedEntities: [],
});

const mergeValuesFromBase = (base, row, bases) => {
  const values = {};
  for (const f of base.fields || []) {
    const raw = row.cells?.[f.id];
    values[f.name] =
      f.type === "relation"
        ? recordLabel((bases || []).find((b) => b.id === f.targetBaseId), raw) || ""
        : formatCellValue(f.type, raw) || "";
  }
  return values;
};

const mergeValuesFromContact = (contact) => ({
  nome: contact.name || "",
  contato: contact.phone || contact.email || contact.contact || "",
  empresa: contact.company || contact.business || "",
  observacao: contact.notes || contact.note || "",
});

function MailMergeModal({ db, business, onClose, onGenerate, setToast }) {
  const bases = (db.databases || []).filter(
    (b) => !business || b.businessId === business.id,
  );
  const sources = [
    { id: "contatos", name: "Contatos", fields: ["nome", "contato", "empresa", "observacao"] },
    ...bases.map((b) => ({
      id: b.id,
      name: b.name,
      fields: (b.fields || []).map((f) => f.name),
      base: b,
    })),
  ];
  const [sourceId, setSourceId] = useState(sources[0]?.id || "contatos");
  const [titlePattern, setTitlePattern] = useState("Carta — {{nome}}");
  const [template, setTemplate] = useState(
    "Olá {{nome}},\n\nEscreva aqui sua mensagem personalizada.\n\nAtenciosamente,",
  );

  const source = sources.find((s) => s.id === sourceId) || sources[0];
  const records = source?.base
    ? (source.base.rows || []).map((r) =>
        mergeValuesFromBase(source.base, r, bases),
      )
    : (db.contacts || [])
        .filter((c) => !business || !c.businessId || c.businessId === business.id)
        .map(mergeValuesFromContact);

  const insertField = (name) => setTemplate((t) => `${t}{{${name}}}`);
  const preview = records[0]
    ? applyMergeFields(template, records[0])
    : "(sem registros nesta fonte)";

  const generate = () => {
    if (records.length === 0) {
      setToast("Essa fonte não tem registros.");
      return;
    }
    const docs = records.map((values) => ({
      title: applyMergeFields(titlePattern, values).trim() || "Documento",
      content: applyMergeFields(template, values),
    }));
    onGenerate(docs);
  };

  return (
    <Modal title="Mala direta" wide onClose={onClose}>
      <div className="modal-body">
        <div className="notice">
          <FileText />
          <span>
            Escreva um modelo com campos entre chaves e gere um documento
            personalizado para cada registro da fonte escolhida.
          </span>
        </div>
        <div className="form-grid">
          <Field label="Fonte dos dados">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Título de cada documento">
            <input
              value={titlePattern}
              onChange={(e) => setTitlePattern(e.target.value)}
            />
          </Field>
        </div>
        <div className="merge-fields">
          <span>Inserir campo:</span>
          {(source?.fields || []).map((name) => (
            <button
              key={name}
              type="button"
              className="chip-btn"
              onClick={() => insertField(name)}
            >
              {`{{${name}}}`}
            </button>
          ))}
        </div>
        <Field label="Modelo do documento">
          <textarea
            rows={7}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </Field>
        <div className="merge-preview">
          <span className="merge-preview-label">
            Prévia (1º de {records.length} registro{records.length === 1 ? "" : "s"})
          </span>
          <pre>{preview}</pre>
        </div>
        <div className="form-actions">
          <button
            className="btn primary"
            onClick={generate}
            disabled={records.length === 0}
          >
            Gerar {records.length} documento{records.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </Modal>
  );
}


// Área de desenho da assinatura (mouse ou toque). Degrada com elegância quando
// o navegador/ambiente não oferece canvas: a assinatura pelo nome continua valendo.
function SignaturePad({ onInkChange, padRef }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  const context = () => {
    try {
      return canvasRef.current?.getContext?.("2d") || null;
    } catch {
      return null;
    }
  };
  const pointOf = (event) => {
    const canvas = canvasRef.current;
    if (!canvas?.getBoundingClientRect) return null;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;
    if (clientX == null || clientY == null) return null;
    return {
      x: ((clientX - rect.left) / (rect.width || 1)) * canvas.width,
      y: ((clientY - rect.top) / (rect.height || 1)) * canvas.height,
    };
  };
  const start = (event) => {
    drawing.current = true;
    last.current = pointOf(event);
  };
  const move = (event) => {
    if (!drawing.current) return;
    const ctx = context();
    const point = pointOf(event);
    if (!ctx || !point) return;
    event.preventDefault?.();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current?.x ?? point.x, last.current?.y ?? point.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
    if (!hasInk) {
      setHasInk(true);
      onInkChange?.(true);
    }
  };
  const stop = () => {
    drawing.current = false;
    last.current = null;
  };
  const clear = () => {
    const ctx = context();
    const canvas = canvasRef.current;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onInkChange?.(false);
  };
  const readImage = () => {
    if (!hasInk) return "";
    try {
      return canvasRef.current?.toDataURL?.("image/png") || "";
    } catch {
      return "";
    }
  };

  return (
    <div className="sign-pad">
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          if (node) node.readSignature = readImage;
          if (padRef) padRef.current = node;
        }}
        width={560}
        height={180}
        aria-label="Área para desenhar a assinatura"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
      />
      <div className="sign-pad-actions">
        <small>Desenhe sua assinatura com o dedo ou o mouse (opcional).</small>
        <button type="button" className="btn ghost sm" onClick={clear}>
          <Trash2 size={14} /> Limpar
        </button>
      </div>
    </div>
  );
}

// Modal de assinatura eletrônica simples de um documento.
function SignDocumentModal({ doc, user, onClose, onSign }) {
  const [form, setForm] = useState({
    signerName: user?.name || "",
    signerEmail: user?.email || "",
    signerRole: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const padRef = useRef(null);
  const signatures = doc.signatures || [];

  const submit = (event) => {
    event.preventDefault();
    if (!form.signerName.trim() || !confirmed) return;
    const imageDataUrl = padRef.current?.readSignature?.() || "";
    onSign(
      makeSignature({
        id: uid(),
        signerName: form.signerName,
        signerEmail: form.signerEmail,
        signerRole: form.signerRole,
        content: doc.content,
        imageDataUrl,
      }),
    );
  };

  return (
    <Modal title={`Assinar “${doc.title}”`} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <p className="sign-explain">
          A assinatura registra quem assinou, quando, e guarda uma impressão
          digital do texto. Se o documento for editado depois, o app avisa que
          ele mudou. É uma <strong>assinatura eletrônica simples</strong> (Lei
          14.063/2020) — não substitui certificado digital ICP-Brasil quando a
          lei exigir um.
        </p>
        <div className="form-grid">
          <Field label="Quem está assinando">
            <input
              required
              autoFocus
              value={form.signerName}
              onChange={(e) => setForm({ ...form, signerName: e.target.value })}
            />
          </Field>
          <Field label="E-mail (opcional)">
            <input
              type="email"
              value={form.signerEmail}
              onChange={(e) => setForm({ ...form, signerEmail: e.target.value })}
            />
          </Field>
          <Field label="Papel no documento (opcional)">
            <input
              placeholder="Contratada, cliente, testemunha..."
              value={form.signerRole}
              onChange={(e) => setForm({ ...form, signerRole: e.target.value })}
            />
          </Field>
        </div>
        <SignaturePad padRef={padRef} />
        <label className="sign-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Li o documento e concordo com o seu conteúdo, assinando
            eletronicamente.
          </span>
        </label>
        {signatures.length > 0 && (
          <p className="sign-existing">
            Este documento já tem {signatures.length}{" "}
            {signatures.length === 1 ? "assinatura" : "assinaturas"}.
          </p>
        )}
        <footer className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" type="submit" disabled={!confirmed}>
            <PenLine size={15} /> Assinar documento
          </button>
        </footer>
      </form>
    </Modal>
  );
}

// Lista das assinaturas de um documento, com conferência de integridade.
function SignatureList({ doc, onRemove }) {
  const signatures = doc.signatures || [];
  if (signatures.length === 0) return null;
  return (
    <div className="sign-list">
      <h4>Assinaturas</h4>
      {signatures.map((sig) => {
        const check = verifySignature(sig, doc.content);
        return (
          <article
            key={sig.id}
            className={`sign-item ${check.valid ? "ok" : "warn"}`}
          >
            {sig.imageDataUrl ? (
              <img src={sig.imageDataUrl} alt={`Assinatura de ${sig.signerName}`} />
            ) : null}
            <div>
              <strong>
                {sig.signerName}
                {sig.signerRole ? ` — ${sig.signerRole}` : ""}
              </strong>
              {sig.signerEmail && <small>{sig.signerEmail}</small>}
              <small>{new Date(sig.signedAt).toLocaleString("pt-BR")}</small>
              <small className="sign-code">Código: {sig.code}</small>
              <small className={check.valid ? "sign-ok" : "sign-warn"}>
                {check.valid ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}{" "}
                {check.message}
              </small>
            </div>
            {onRemove && (
              <button
                type="button"
                className="btn ghost sm danger"
                onClick={() => onRemove(sig.id)}
                title="Remover assinatura"
              >
                <X size={14} />
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Documents({
  db,
  update,
  business,
  setToast,
  go,
  searchSeed,
  clearSearchSeed,
  AreaToolkit = null,
  hideMailMerge = false,
  initialDocumentId = "",
  onNavigate,
  eyebrow = "DOCUMENTOS",
  title = "Crie, edite e leve seu trabalho com você",
  text = "Propostas, planos, relatórios e materiais ficam organizados por negócio.",
  headingLevel = "h1",
}) {
  const inBusiness = (record) => !business || record?.businessId === business.id;
  const documentList = db.documents || [];
  const editorDb = {
    ...db,
    syncedBlocks: (db.syncedBlocks || []).filter(inBusiness),
    databases: (db.databases || []).filter(inBusiness),
    publicForms: (db.publicForms || []).filter(inBusiness),
    documents: documentList.filter(inBusiness),
    projects: (db.projects || []).filter(inBusiness),
    tasks: (db.tasks || []).filter(inBusiness),
  };
  const blockContext = {
    syncedBlocks: editorDb.syncedBlocks,
    databases: editorDb.databases,
    forms: editorDb.publicForms,
    documents: editorDb.documents,
    projects: editorDb.projects,
  };
  const resolvedDocumentContent = (document) =>
    Array.isArray(document?.blocks) && document.blocks.length
      ? documentBlocksToText(document.blocks, blockContext)
      : document?.content || "";
  const blankDocument = createBlankDocument();
  const initialDocument = initialDocumentId
    ? documentList.find((document) => document.id === initialDocumentId && inBusiness(document))
    : null;
  const initialForm = () => {
    const next = initialDocument
      ? { ...blankDocument, ...initialDocument }
      : { ...blankDocument };
    next.blocks = normalizeDocumentBlocks(initialDocument?.blocks, initialDocument?.content);
    next.content = resolvedDocumentContent(next);
    return next;
  };
  const [modal, setModal] = useState(Boolean(initialDocument)),
    [editing, setEditing] = useState(initialDocument?.id || null),
    [search, setSearch] = useState(""),
    [aiBusy, setAiBusy] = useState(false),
    [exportBusy, setExportBusy] = useState(""),
    [uploading, setUploading] = useState(false),
    [uploadErrors, setUploadErrors] = useState([]),
    [ocrStatus, setOcrStatus] = useState(""),
    [templatePicker, setTemplatePicker] = useState(false),
    [mergeOpen, setMergeOpen] = useState(false),
    [signingId, setSigningId] = useState(null),
    [dragging, setDragging] = useState(false);
  const searchTerm = searchSeed || search;
  useEffect(() => {
    if (!searchSeed) return undefined;
    const id = setTimeout(() => {
      clearSearchSeed?.();
    }, 0);
    return () => clearTimeout(id);
  }, [clearSearchSeed, searchSeed]);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  useEffect(() => {
    const id = setTimeout(() => setVisibleCount(LIST_PAGE_SIZE), 0);
    return () => clearTimeout(id);
  }, [searchTerm]);
  const uploadRef = useRef(null);
  const docs = documentList.filter(
    (document) =>
      (!business || document.businessId === business.id) &&
      `${document.title} ${document.type || ""} ${
        document.originalFileName || ""
      } ${resolvedDocumentContent(document)}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()),
  );
  const [form, setForm] = useState(initialForm);
  const taskProjects = [
    ...new Set([
      ...editorDb.projects.map((p) => p.name),
      ...editorDb.tasks.map((t) => t.project).filter(Boolean),
    ]),
  ];
  const open = (d) => {
    const next = d ? { ...blankDocument, ...d } : { ...blankDocument };
    next.blocks = normalizeDocumentBlocks(d?.blocks, d?.content);
    next.content = resolvedDocumentContent(next);
    setForm(next);
    setEditing(d?.id || null);
    setModal(true);
  };
  const signingRecord = documentList.find((d) => d.id === signingId && inBusiness(d)) || null;
  const signingDoc = signingRecord
    ? { ...signingRecord, content: resolvedDocumentContent(signingRecord) }
    : null;
  const patchDocument = (id, updater) =>
    update((prev) => ({
      ...prev,
      documents: prev.documents.map((d) => (d.id === id ? updater(d) : d)),
    }));
  const addSignature = (signature) => {
    patchDocument(signingId, (d) => ({
      ...d,
      signatures: [...(d.signatures || []), signature],
    }));
    setSigningId(null);
    setToast(`Documento assinado — código ${signature.code}`);
    trackProductEvent("document_signed", { module: "documentos" });
  };
  const removeSignature = (docId, signatureId) => {
    if (!window.confirm("Remover esta assinatura do documento?")) return;
    patchDocument(docId, (d) => ({
      ...d,
      signatures: (d.signatures || []).filter((s) => s.id !== signatureId),
    }));
  };

  const applyTemplate = (template) => {
    setTemplatePicker(false);
    open({
      ...blankDocument,
      title: template.name,
      type: template.type,
      content: fillDocTemplate(template, { business: business?.name }),
      blocks: textToDocumentBlocks(
        fillDocTemplate(template, { business: business?.name }),
      ),
    });
    trackProductEvent("document_template_used", {
      module: "documentos",
      template: template.id,
    });
  };
  const generateMerge = (docs) => {
    const now = new Date().toISOString();
    const created = docs.map((d) => ({
      ...blankDocument,
      id: uid(),
      title: d.title,
      type: "Mala direta",
      content: d.content,
      blocks: textToDocumentBlocks(d.content),
      businessId: business?.id || null,
      ownerId: db.user.id,
      updatedAt: now,
    }));
    update((prev) => ({ ...prev, documents: [...created, ...prev.documents] }));
    trackProductEvent("mail_merge_generated", {
      module: "documentos",
      count: created.length,
    });
    setMergeOpen(false);
    setToast(`${created.length} documentos gerados`);
  };
  const importFiles = async (fileList) => {
    const files = [...(fileList || [])].slice(0, 10);
    if (!files.length || uploading) return;
    setUploading(true);
    setUploadErrors([]);
    const imported = [];
    const errors = [];
    for (const file of files) {
      try {
        const extracted = await extractDocumentText(file, {
          onProgress: (andamento) => setOcrStatus(describeOcrProgress(file.name, andamento)),
        });
        imported.push({
          id: uid(),
          title: documentTitleFromFilename(file.name),
          type: extracted.kind.label,
          content: extracted.content,
          // Texto lido de imagem é sugestão, não verdade: o aviso do documento
          // pede conferência de nomes, datas e valores.
          importedWithOcr: Boolean(extracted.ocr),
          importedOcrPages: extracted.ocr,
          blocks: textToDocumentBlocks(extracted.content),
          originalFileName: file.name,
          originalMimeType: file.type || "application/octet-stream",
          originalSize: file.size,
          importedAt: new Date().toISOString(),
          importedContentTruncated: extracted.truncated,
          businessId: business?.id || null,
          ownerId: db.user.id,
          updatedAt: new Date().toISOString(),
          versions: [],
        });
      } catch (error) {
        errors.push({ name: file.name, message: error.message });
      }
    }
    if (imported.length)
      update((d) => ({
        ...d,
        documents: [...imported, ...d.documents],
      }));
    setUploadErrors(errors);
    if (imported.length && !errors.length)
      setToast(
        imported.length === 1
          ? "Documento importado e pronto para editar"
          : `${imported.length} documentos importados`,
      );
    else if (imported.length)
      setToast(
        `${imported.length} importados; ${errors.length} não puderam ser lidos`,
      );
    else setToast("Nenhum documento pôde ser importado");
    trackProductEvent("import_completed", {
      module: "documentos",
      count: imported.length,
      success: imported.length > 0,
    });
    setUploading(false);
    setOcrStatus("");
    if (uploadRef.current) uploadRef.current.value = "";
  };
  const save = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const previous = editing
      ? db.documents.find((x) => x.id === editing)
      : null;
    const blocks = normalizeDocumentBlocks(form.blocks, form.content);
    const content = documentBlocksToText(blocks, blockContext);
    const previousBlocks = previous
      ? normalizeDocumentBlocks(previous.blocks, previous.content)
      : [];
    const changed =
      previous &&
      (previous.title !== form.title ||
        previous.type !== form.type ||
        previous.content !== content ||
        JSON.stringify(previousBlocks) !== JSON.stringify(blocks));
    const item = {
      ...form,
      blocks,
      content,
      id: editing || uid(),
      businessId: business?.id || null,
      ownerId: form.ownerId || db.user.id,
      updatedAt: new Date().toISOString(),
      versions: changed
        ? [
            ...(previous.versions || []),
            {
              title: previous.title,
              type: previous.type,
              content: previous.content,
              blocks: previousBlocks,
              at: new Date().toISOString(),
            },
          ]
        : previous?.versions || [],
    };
    update((d) => ({
      ...d,
      documents: editing
        ? d.documents.map((x) => (x.id === editing ? item : x))
        : [item, ...d.documents],
    }));
    setModal(false);
    setToast("Documento salvo");
  };
  const saveBlob = (blob, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const download = async (d, format) => {
    if (!format) return;
    setExportBusy(`${d.id}:${format}`);
    try {
      const content = resolvedDocumentContent(d);
      const signBlock = signatureBlockText(d.signatures, content);
      const body = signBlock ? `${content}\n\n${signBlock}` : content;
      if (format === "txt") {
        saveBlob(
          new Blob([`${d.title}\n\n${body}`], {
            type: "text/plain;charset=utf-8",
          }),
          `${slugify(d.title)}.txt`,
        );
      } else if (format === "docx") {
        const { Document, Packer, Paragraph, HeadingLevel } =
          await import("docx");
        const file = new Document({
          sections: [
            {
              children: [
                new Paragraph({ text: d.title, heading: HeadingLevel.TITLE }),
                new Paragraph({
                  text: d.type,
                  heading: HeadingLevel.HEADING_2,
                }),
                ...String(body || "")
                  .split("\n")
                  .map((line) => new Paragraph({ text: line || " " })),
              ],
            },
          ],
        });
        saveBlob(await Packer.toBlob(file), `${slugify(d.title)}.docx`);
      } else {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text(pdf.splitTextToSize(d.title, 175), 18, 20);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(95);
        pdf.text(d.type, 18, 31);
        pdf.setTextColor(25);
        pdf.setFontSize(11);
        const lines = pdf.splitTextToSize(String(body || ""), 175);
        let y = 42;
        lines.forEach((line) => {
          if (y > 282) {
            pdf.addPage();
            y = 18;
          }
          pdf.text(line, 18, y);
          y += 5.5;
        });
        pdf.save(`${slugify(d.title)}.pdf`);
      }
      setToast(`Documento exportado em ${format.toUpperCase()}`);
      trackProductEvent("export_completed", {
        module: "documentos",
        kind: format,
        success: true,
      });
    } catch {
      setToast("Não foi possível exportar este documento");
    } finally {
      setExportBusy("");
    }
  };
  const refine = async () => {
    const currentContent =
      form.content || documentBlocksToText(form.blocks, blockContext);
    if (aiBusy || !currentContent.trim()) return;
    setAiBusy(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          specialist: "Conteúdo",
          prompt: `Aprimore o documento abaixo. Preserve todos os fatos, números e compromissos informados; corrija clareza, estrutura e linguagem. Não invente dados. Entregue somente a versão final do documento em Markdown.\n\nTítulo: ${form.title}\nTipo: ${form.type}\n\n${currentContent}`,
          ...aiWorkspaceContext(business),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao aprimorar");
      setForm((current) => ({
        ...current,
        content: data.content || current.content,
        blocks: data.content
          ? textToDocumentBlocks(data.content)
          : current.blocks,
      }));
      setToast("Versão aprimorada no editor; salve para registrar a alteração");
    } catch (error) {
      setToast(error.message || "Não foi possível aprimorar agora");
    } finally {
      setAiBusy(false);
    }
  };
  const createSyncedBlock = () => {
    const record = normalizeSyncedBlock(
      {
        name: "Novo conteúdo reutilizável",
        content: "",
        businessId: business?.id || null,
        ownerId: db.user.id,
        visibility: form.visibility,
        sharingPermission: form.sharingPermission,
        sharedWith: form.sharedWith,
        sharedTeams: form.sharedTeams,
        project: form.project,
      },
      {
        businessId: business?.id || null,
        ownerId: db.user.id,
      },
    );
    update((current) => ({
      ...current,
      syncedBlocks: [record, ...(current.syncedBlocks || [])],
    }));
    return record.id;
  };
  const updateSyncedBlock = (id, patch) =>
    update((current) => ({
      ...current,
      syncedBlocks: (current.syncedBlocks || []).map((record) =>
        record.id === id
          ? normalizeSyncedBlock(
              { ...record, ...patch, id: record.id },
              {
                businessId: record.businessId || business?.id || null,
                ownerId: record.ownerId || db.user.id,
              },
            )
          : record,
      ),
    }));
  return (
    <PageTitle
      eyebrow={eyebrow}
      title={title}
      text={text}
      headingLevel={headingLevel}
      action={
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={uploading ? RefreshCw : Upload}
            disabled={uploading}
            onClick={() => uploadRef.current?.click()}
          >
            {uploading ? "Importando..." : "Enviar arquivos"}
          </Button>
          <Button
            variant="secondary"
            icon={FileText}
            onClick={() => setTemplatePicker(true)}
          >
            Modelos prontos
          </Button>
          {!hideMailMerge && (
            <Button
              variant="secondary"
              icon={Users}
              onClick={() => setMergeOpen(true)}
            >
              Mala direta
            </Button>
          )}
          <Button icon={Plus} onClick={() => open(null)}>
            Novo documento
          </Button>
        </div>
      }
    >
      {mergeOpen && (
        <MailMergeModal
          db={db}
          business={business}
          setToast={setToast}
          onClose={() => setMergeOpen(false)}
          onGenerate={generateMerge}
        />
      )}
      {templatePicker && (
        <Modal
          title="Comece de um modelo pronto"
          wide
          onClose={() => setTemplatePicker(false)}
        >
          <div className="modal-body">
            <div className="notice">
              <FileText />
              <span>
                Escolha um modelo, preencha os campos entre [colchetes] e ajuste
                à sua realidade. Não é aconselhamento jurídico — revise antes de
                usar.
              </span>
            </div>
            <div className="template-grid">
              {DOCUMENT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  onClick={() => applyTemplate(template)}
                >
                  <span className="template-card-type">{template.type}</span>
                  <strong>{template.name}</strong>
                  <span className="template-card-seg">{template.segment}</span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {AreaToolkit && (
        <AreaToolkit
          area="documentos"
          db={db}
          update={update}
          business={business}
          setToast={setToast}
          go={go}
        />
      )}
      <div id="document-library" />
      <input
        ref={uploadRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        aria-label="Selecionar documentos para enviar"
        onChange={(event) => importFiles(event.target.files)}
      />
      <button
        type="button"
        className={`document-dropzone ${dragging ? "dragging" : ""}`}
        onClick={() => uploadRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          if (!event.currentTarget.contains(event.relatedTarget))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          importFiles(event.dataTransfer.files);
        }}
        disabled={uploading}
      >
        <span className="document-upload-icon">
          {uploading ? <RefreshCw /> : <Upload />}
        </span>
        <span>
          <strong>
            {uploading
              ? ocrStatus || "Lendo e organizando seus arquivos..."
              : "Arraste documentos para cá ou clique para escolher"}
          </strong>
          <small>{DOCUMENT_FORMATS_HINT} · até 10 MB por arquivo</small>
        </span>
      </button>
      {uploadErrors.length > 0 && (
        <div className="document-upload-errors" role="alert">
          <strong>Alguns arquivos não foram importados:</strong>
          {uploadErrors.map((error) => (
            <span key={`${error.name}-${error.message}`}>
              <b>{error.name}</b>: {error.message}
            </span>
          ))}
        </div>
      )}
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            value={searchTerm}
            onChange={(e) => {
              setSearch(e.target.value);
              clearSearchSeed?.();
            }}
            placeholder="Pesquisar documentos"
          />
        </div>
      </div>
      {docs.length === 0 ? (
        <Empty
          icon={FileText}
          title="Nenhum documento criado"
          text="Envie um arquivo ou crie um documento editável, refine com assistência inteligente e exporte em PDF, DOCX ou TXT."
          action="Criar documento"
          onAction={() => open(null)}
        />
      ) : (
        <div className="document-grid">
          {docs.slice(0, visibleCount).map((d) => (
            <article key={d.id}>
              <span className="doc-icon">
                <FileText />
              </span>
              <span className="tag">{d.type}</span>
              <h3>{d.title}</h3>
              <p>
                {resolvedDocumentContent(d).slice(0, 100) || "Documento vazio"}
              </p>
              {(d.linkedEntities || []).length > 0 && (
                <div className="nt-linked-entities" aria-label="Registros conectados">
                  {(d.linkedEntities || []).map((entity) => (
                    <button
                      type="button"
                      key={`${entity.type}-${entity.id}`}
                      onClick={() => entity.route && onNavigate?.(entity.route)}
                      disabled={!entity.route || !onNavigate}
                    >
                      {entity.type === "client" ? "Cliente" : "Oportunidade"}: {entity.name}
                    </button>
                  ))}
                </div>
              )}
              {d.originalFileName && (
                <small className="document-source">
                  <Upload /> {d.originalFileName} ·{" "}
                  {d.originalSize < 1024 * 1024
                    ? `${Math.max(1, Math.round(d.originalSize / 1024))} KB`
                    : `${(d.originalSize / (1024 * 1024)).toFixed(1)} MB`}
                </small>
              )}
              <small>
                Atualizado {new Date(d.updatedAt).toLocaleString("pt-BR")}
              </small>
              {(() => {
                const status = signatureStatus(
                  d.signatures,
                  resolvedDocumentContent(d),
                );
                if (status.state === "sem-assinatura") return null;
                return (
                  <small
                    className={`doc-sign-badge ${status.state}`}
                    title={
                      status.state === "assinado"
                        ? "Documento íntegro desde a assinatura"
                        : "O texto mudou depois de assinado"
                    }
                  >
                    {status.state === "assinado" ? (
                      <BadgeCheck size={13} />
                    ) : (
                      <AlertTriangle size={13} />
                    )}
                    {status.state === "assinado"
                      ? `Assinado (${status.total})`
                      : "Alterado após assinar"}
                  </small>
                );
              })()}
              <footer>
                <button onClick={() => open(d)}>
                  <Edit3 />
                  Editar
                </button>
                <button onClick={() => setSigningId(d.id)}>
                  <PenLine />
                  Assinar
                </button>
                <label className="compact-export">
                  <Download />
                  <select
                    aria-label={`Exportar ${d.title}`}
                    value=""
                    disabled={exportBusy.startsWith(`${d.id}:`)}
                    onChange={(event) => download(d, event.target.value)}
                  >
                    <option value="">
                      {exportBusy.startsWith(`${d.id}:`)
                        ? "Exportando..."
                        : "Exportar"}
                    </option>
                    <option value="pdf">PDF</option>
                    <option value="docx">DOCX</option>
                    <option value="txt">TXT</option>
                  </select>
                </label>
                <button
                  className="danger"
                  onClick={() =>
                    update((x) => ({
                      ...x,
                      documents: x.documents.filter((y) => y.id !== d.id),
                    }))
                  }
                >
                  <Trash2 />
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <LoadMoreButton
          shown={Math.min(visibleCount, docs.length)}
          total={docs.length}
          onClick={() => setVisibleCount((c) => c + LIST_PAGE_SIZE)}
        />
      )}
      {modal && (
        <Modal
          title={editing ? "Editar documento" : "Novo documento"}
          onClose={() => setModal(false)}
          wide
        >
          <form className="modal-body" onSubmit={save}>
            <div className="form-grid">
              <Field label="Título">
                <input
                  required
                  autoFocus
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Field>
              <Field label="Tipo">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {[
                    "Proposta comercial",
                    "Plano de negócio",
                    "Plano de marketing",
                    "Orçamento",
                    "Relatório",
                    "Checklist",
                    "Procedimento",
                    "Apresentação",
                    "Briefing",
                    "Plano de ação",
                    "Página de conhecimento",
                    "Documento Word",
                    "PDF importado",
                    "Documento importado",
                    "Planilha CSV",
                    "Imagem (texto lido por OCR)",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </div>
            {form.originalFileName && (
              <div className="notice document-origin-notice">
                <Upload />
                <span>
                  Conteúdo importado de <strong>{form.originalFileName}</strong>
                  {form.importedOcrPages &&
                  form.importedOcrPages.pages < form.importedOcrPages.totalPages
                    ? `. Foram lidas as primeiras ${form.importedOcrPages.pages} de ${form.importedOcrPages.totalPages} páginas.`
                    : form.importedContentTruncated
                      ? ". O texto era muito extenso e foi limitado para manter a sincronização segura."
                      : ". Você pode editar, aprimorar e exportar normalmente."}
                  {form.importedWithOcr &&
                    " O texto foi lido da imagem por OCR: confira nomes, datas e valores antes de usar."}
                </span>
              </div>
            )}
            {(form.linkedEntities || []).length > 0 && (
              <div className="nt-linked-entities" aria-label="Registros conectados">
                {(form.linkedEntities || []).map((entity) => (
                  <button
                    type="button"
                    key={`${entity.type}-${entity.id}`}
                    onClick={() => entity.route && onNavigate?.(entity.route)}
                    disabled={!entity.route || !onNavigate}
                  >
                    {entity.type === "client" ? "Cliente" : "Oportunidade"}: {entity.name}
                  </button>
                ))}
              </div>
            )}
            <Field label="Conteúdo">
              <Suspense
                fallback={
                  <div className="inbox-loading">
                    Carregando editor universal...
                  </div>
                }
              >
                <BlockDocumentEditor
                  blocks={form.blocks}
                  onChange={(blocks) =>
                    setForm((current) => ({
                      ...current,
                      blocks,
                      content: documentBlocksToText(blocks, blockContext),
                    }))
                  }
                  db={editorDb}
                  business={business}
                  syncedBlocks={editorDb.syncedBlocks}
                  onCreateSyncedBlock={createSyncedBlock}
                  onUpdateSyncedBlock={updateSyncedBlock}
                />
              </Suspense>
            </Field>
            <div className="editor-tools">
              <Button
                type="button"
                variant="secondary"
                icon={aiBusy ? RefreshCw : WandSparkles}
                disabled={aiBusy || !form.content.trim()}
                onClick={refine}
              >
                {aiBusy ? "Aprimorando..." : "Aprimorar texto"}
              </Button>
              <small>
                O texto atual permanece no histórico quando você salva a nova
                versão.
              </small>
            </div>
            {editing && (form.versions || []).length > 0 && (
              <section className="version-history">
                <strong>Versões anteriores</strong>
                <p>Restaure uma versão para o editor antes de salvar.</p>
                <div>
                  {[...(form.versions || [])]
                    .reverse()
                    .map((version, index) => (
                      <button
                        type="button"
                        key={`${version.at}-${index}`}
                        onClick={() =>
                          setForm((current) => {
                            const blocks = normalizeDocumentBlocks(
                              version.blocks,
                              version.content,
                            );
                            return {
                              ...current,
                              title: version.title || current.title,
                              type: version.type || current.type,
                              blocks,
                              content: documentBlocksToText(
                                blocks,
                                blockContext,
                              ),
                            };
                          })
                        }
                      >
                        <RotateCcw />
                        {new Date(version.at).toLocaleString("pt-BR")}
                      </button>
                    ))}
                </div>
              </section>
            )}
            {editing && (
              <SignatureList
                doc={{ ...form, id: editing }}
                onRemove={(sigId) => removeSignature(editing, sigId)}
              />
            )}
            <SharingFields
              value={{
                visibility: form.visibility,
                sharingPermission: form.sharingPermission,
                sharedWith: form.sharedWith,
                sharedTeams: form.sharedTeams,
                project: form.project,
              }}
              onChange={(next) => setForm({ ...form, ...next })}
              teams={db.teams}
              projectOptions={taskProjects}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                Salvar documento
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {signingDoc && (
        <SignDocumentModal
          doc={signingDoc}
          user={db.user}
          onClose={() => setSigningId(null)}
          onSign={addSignature}
        />
      )}
    </PageTitle>
  );
}

export default Documents;
