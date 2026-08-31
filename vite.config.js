import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gitVersion = () => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return `local-${Date.now()}`;
  }
};

const appVersion = gitVersion();
const buildTime = new Date().toISOString();

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
