import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import readXlsxFile from "read-excel-file/node";

const here = path.dirname(fileURLToPath(import.meta.url));
const command = String(process.argv[2] || "sync").toLowerCase();
const configPath = path.resolve(
  process.env.TRACK3R_BRIDGE_CONFIG || path.join(here, "config.local.json"),
);

const log = (event, data = {}) => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
};

const readJson = async (file, fallback = null) => {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
};

const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const absoluteFromConfig = (config, value, fallbackName) => {
  const candidate = value || fallbackName;
  return path.isAbsolute(candidate) ? candidate : path.resolve(here, candidate);
};

const normalizeHeader = (value, index) => {
  const clean = String(value ?? "").trim();
  return clean || `coluna_${index + 1}`;
};

const rowsToObjects = (rows = []) => {
  const useful = rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""));
  if (useful.length < 2) return [];
  const headers = useful[0].map(normalizeHeader);
  return useful.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
};

const detectDelimiter = (line) => {
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: line.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ";";
};

const parseDelimited = (text) => {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source.split(/\r?\n/, 1)[0] || "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rowsToObjects(rows);
};

const extractAtPath = (payload, dottedPath) => {
  if (!dottedPath) return payload;
  return String(dottedPath).split(".").filter(Boolean).reduce(
    (current, key) => current?.[key],
    payload,
  );
};

const parseDownloadedFile = async (file) => {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".xlsx") return rowsToObjects(await readXlsxFile(file));
  if ([".csv", ".txt"].includes(extension)) return parseDelimited(await fs.readFile(file, "utf8"));
  if (extension === ".json") {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    if (Array.isArray(payload)) return payload;
    return payload.data || payload.items || payload.registros || payload.result || [];
  }
  throw new Error(`Formato de relatório não suportado: ${extension || "sem extensão"}.`);
};

const ensureConfig = async () => {
  const config = await readJson(configPath);
  if (!config) {
    throw new Error(
      `Configuração não encontrada em ${configPath}. Copie config.example.json para config.local.json e preencha os endereços.`,
    );
  }
  if (!config.portalUrl) throw new Error("portalUrl é obrigatório.");
  if (command === "sync" && !config.erpBridgeUrl) throw new Error("erpBridgeUrl é obrigatório para sincronizar.");
  return config;
};

const browserContext = async (config, { headless } = {}) => {
  const profileDir = absoluteFromConfig(config, config.profileDir, ".track3r-profile");
  await fs.mkdir(profileDir, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    headless: headless ?? Boolean(config.headless),
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
};

const go = async (page, url, config) => {
  page.setDefaultTimeout(Number(config.navigationTimeoutMs) || 45_000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(config.navigationTimeoutMs) || 45_000 });
};

const login = async (config) => {
  const context = await browserContext(config, { headless: false });
  const page = context.pages()[0] || await context.newPage();
  await go(page, config.portalUrl, config);
  log("login_window_opened", { profile: absoluteFromConfig(config, config.profileDir, ".track3r-profile") });
  console.log("Faça o login no TRACK3R nesta janela e, quando terminar, feche a janela do navegador.");
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
  await context.close().catch(() => {});
};

const probe = async (config) => {
  const context = await browserContext(config, { headless: false });
  const page = context.pages()[0] || await context.newPage();
  const candidates = new Map();

  page.on("response", async (response) => {
    const type = String(response.headers()["content-type"] || "").toLowerCase();
    if (!type.includes("json")) return;
    const request = response.request();
    candidates.set(response.url(), {
      url: response.url(),
      status: response.status(),
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });

  await go(page, config.reportUrl || config.portalUrl, config);
  console.log("Use o TRACK3R normalmente: aplique filtros, abra a consulta e exporte se quiser. Feche a janela quando terminar.");
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});

  const probeFile = absoluteFromConfig(config, config.probeFile, ".track3r-network-candidates.json");
  await writeJson(probeFile, [...candidates.values()]);
  log("probe_saved", { file: probeFile, candidates: candidates.size });
  await context.close().catch(() => {});
};

const collectByDownload = async (page, config) => {
  if (!config.downloadSelector) throw new Error("downloadSelector é obrigatório para strategy=download.");
  await go(page, config.reportUrl || config.portalUrl, config);
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: Number(config.downloadTimeoutMs) || 45_000 }),
    page.locator(config.downloadSelector).first().click(),
  ]).then(([item]) => item);

  const dir = absoluteFromConfig(config, config.downloadDir, ".track3r-downloads");
  await fs.mkdir(dir, { recursive: true });
  const suggested = download.suggestedFilename() || `track3r-${Date.now()}.xlsx`;
  const target = path.join(dir, `${Date.now()}-${suggested}`);
  await download.saveAs(target);
  return { rows: await parseDownloadedFile(target), sourceFile: path.basename(target) };
};

const collectByTable = async (page, config) => {
  await go(page, config.reportUrl || config.portalUrl, config);
  const selector = config.tableSelector || "table";
  const rows = await page.locator(selector).first().evaluate((table) => {
    const trs = [...table.querySelectorAll("tr")];
    return trs.map((tr) => [...tr.querySelectorAll("th,td")].map((cell) => cell.textContent?.trim() || ""));
  });
  return { rows: rowsToObjects(rows), sourceFile: "html-table" };
};

const collectByJsonEndpoint = async (page, config) => {
  const endpoint = config.jsonEndpoint || {};
  if (!endpoint.url) throw new Error("jsonEndpoint.url é obrigatório para strategy=json-endpoint.");
  await go(page, config.reportUrl || config.portalUrl, config);
  const payload = await page.evaluate(async (options) => {
    const response = await fetch(options.url, {
      method: options.method || "GET",
      headers: { accept: "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
    });
    if (!response.ok) throw new Error(`TRACK3R respondeu HTTP ${response.status}`);
    return response.json();
  }, endpoint);
  const collection = extractAtPath(payload, endpoint.collectionPath);
  const rows = Array.isArray(collection)
    ? collection
    : collection?.data || collection?.items || collection?.registros || collection?.result || [];
  if (!Array.isArray(rows)) throw new Error("O endpoint interno não devolveu uma lista reconhecível.");
  return { rows, sourceFile: `json:${endpoint.url}` };
};

const collect = async (config) => {
  const context = await browserContext(config);
  const page = context.pages()[0] || await context.newPage();
  try {
    const strategy = String(config.strategy || "download").toLowerCase();
    if (strategy === "table") return collectByTable(page, config);
    if (strategy === "json-endpoint") return collectByJsonEndpoint(page, config);
    return collectByDownload(page, config);
  } finally {
    await context.close().catch(() => {});
  }
};

const sendToErp = async (config, rows, meta) => {
  const token = String(process.env.TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET || "").trim();
  if (!token) throw new Error("Defina TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET na máquina.");

  const maxRows = Math.max(1, Math.min(300, Number(config.maxRowsPerBatch) || 250));
  const batches = [];
  for (let i = 0; i < rows.length; i += maxRows) batches.push(rows.slice(i, i + maxRows));

  const results = [];
  for (const [index, batch] of batches.entries()) {
    const response = await fetch(config.erpBridgeUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        rows: batch,
        machineId: config.machineId || process.env.COMPUTERNAME || "track3r-local",
        sourceFile: meta.sourceFile,
        exportedAt: meta.exportedAt,
        datasetHash: meta.datasetHash,
        batch: index + 1,
        totalBatches: batches.length,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `ERP respondeu HTTP ${response.status}.`);
    results.push(result);
    log("batch_synced", { batch: index + 1, totalBatches: batches.length, received: batch.length, stored: result.gravados });
  }
  return results;
};

const sync = async (config) => {
  const stateFile = absoluteFromConfig(config, config.stateFile, ".track3r-state.json");
  const previous = await readJson(stateFile, {});
  const collected = await collect(config);
  const rows = Array.isArray(collected.rows) ? collected.rows.filter((row) => row && typeof row === "object") : [];
  if (!rows.length) throw new Error("A coleta terminou sem linhas. Verifique o relatório, filtro ou seletor configurado.");

  const canonical = JSON.stringify(rows);
  const datasetHash = sha256(canonical);
  if (previous?.lastSuccessfulHash === datasetHash) {
    log("no_changes", { rows: rows.length, datasetHash });
    return;
  }

  const exportedAt = new Date().toISOString();
  const results = await sendToErp(config, rows, {
    sourceFile: collected.sourceFile || "track3r",
    exportedAt,
    datasetHash,
  });

  await writeJson(stateFile, {
    lastSuccessfulHash: datasetHash,
    lastSuccessfulAt: new Date().toISOString(),
    rows: rows.length,
    sourceFile: collected.sourceFile || "track3r",
    batches: results.length,
  });
  log("sync_complete", { rows: rows.length, datasetHash, batches: results.length });
};

try {
  const config = await ensureConfig();
  if (command === "login") await login(config);
  else if (command === "probe") await probe(config);
  else if (command === "sync") await sync(config);
  else throw new Error(`Comando desconhecido: ${command}. Use login, probe ou sync.`);
} catch (error) {
  log("error", { message: error?.message || String(error) });
  process.exitCode = 1;
}
