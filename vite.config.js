import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const git = (args) => {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

// SHA do build: o CI (Cloudflare Workers Builds ou GitHub Actions) informa o
// commit; fora dele, o git local. É o que `/api/status`, `/api/system/version`
// e a tela "Saúde do sistema" mostram para comparar LOCAL × MAIN × PRODUÇÃO.
const ciSha = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "";
const gitVersion = () => (ciSha ? ciSha.slice(0, 12) : git("rev-parse --short=12 HEAD") || `local-${Date.now()}`);
const gitBranch = () => process.env.WORKERS_CI_BRANCH || process.env.GITHUB_REF_NAME || git("rev-parse --abbrev-ref HEAD") || "";
const ciProvider = () => (process.env.WORKERS_CI ? "cloudflare-workers-builds" : process.env.GITHUB_ACTIONS ? "github-actions" : "");

// O que ESTE código espera do banco. O Worker compara com o que o D1 tem
// aplicado e alerta "backend novo com D1 antigo" (ou o inverso) em vez de
// deixar uma coluna ausente virar um zero na tela.
const migrationsManifest = () => {
  try {
    const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
    return { count: files.length, last: files.at(-1)?.replace(/\.sql$/, "") ?? null };
  } catch {
    return { count: null, last: null };
  }
};

const appVersion = gitVersion();
const buildTime = new Date().toISOString();
const buildBranch = gitBranch();
const buildCi = ciProvider();

const versionManifest = () => ({
  name: "seu-funcionario-version",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify(
        {
          version: appVersion,
          buildTime,
          branch: buildBranch || null,
          ci: buildCi || null,
          publishedBy: buildCi || "manual",
          migrations: migrationsManifest(),
        },
        null,
        2,
      ),
    });
  },
});

export default defineConfig({
  plugins: [react(), versionManifest()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
  },
  build: {
    rollupOptions: {
      output: {
        // Separa dependências de terceiros estáveis (React, ícones) do código
        // do app: elas mudam raramente entre deploys, então o navegador pode
        // reaproveitar o cache desse chunk mesmo quando src/App.jsx muda.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    // A interface completa e os parsers de documentos tornam alguns fluxos
    // jsdom mais pesados. Limitar a concorrência evita que vários renders do
    // aplicativo disputem memória e estourem o prazo apenas por carga da máquina.
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // O prazo de espera das consultas assíncronas da testing-library (findBy,
    // waitFor) é OUTRO, e o padrão de 1s é o que estourava só na CI. Fica no
    // setup para valer em todo teste, não em quem lembrar de passar a opção.
    setupFiles: ["./vitest.setup.js"],
  },
})
