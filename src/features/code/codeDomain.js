// ===== Editor de código com prévia ao vivo =====
// Camada pura: monta o documento, valida e organiza os projetos. Nada aqui
// toca no DOM nem executa código.
//
// A decisão que manda em tudo neste arquivo é de segurança. A prévia roda
// dentro de um iframe com `sandbox="allow-scripts"` e SEM `allow-same-origin`.
// Os dois juntos anulariam a caixa: o código escrito na tela passaria a rodar
// na mesma origem do app e poderia ler o `localStorage` — onde está o token de
// login — e chamar /api com a sessão de quem está usando. Como o app é
// multiusuário, isso não é "risco teórico": é conta de uma pessoa acessando o
// negócio de outra. Ver `SANDBOX` e o teste que o trava.

export const SANDBOX = "allow-scripts";

// Guarda explícita para quem mexer aqui depois. `allow-same-origin` junto de
// `allow-scripts` devolve ao código previsualizado a origem do app inteiro.
export const isSandboxSafe = (valor) => {
  const partes = String(valor || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.includes("allow-scripts")) return true; // sem script, sem risco
  return !partes.includes("allow-same-origin");
};

const texto = (v) => String(v ?? "");

// ---------------------------------------------------------------------------
// Projeto
// ---------------------------------------------------------------------------

export const makeProject = ({ id, name, html, css, js } = {}) => ({
  id: id || `code-${Math.random().toString(36).slice(2, 10)}`,
  name: texto(name).trim().slice(0, 60) || "Sem título",
  html: texto(html),
  css: texto(css),
  js: texto(js),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const renameProject = (projeto, nome) => ({
  ...projeto,
  name: texto(nome).trim().slice(0, 60) || projeto?.name || "Sem título",
  updatedAt: new Date().toISOString(),
});

export const duplicateProject = (projeto) => ({
  ...makeProject(projeto),
  id: `code-${Math.random().toString(36).slice(2, 10)}`,
  name: `${projeto?.name || "Sem título"} (cópia)`.slice(0, 60),
});

export const upsertProject = (lista = [], projeto) => {
  const atual = Array.isArray(lista) ? lista : [];
  if (!projeto?.id) return atual;
  return atual.some((p) => p?.id === projeto.id)
    ? atual.map((p) => (p?.id === projeto.id ? projeto : p))
    : [projeto, ...atual];
};

export const removeProject = (lista = [], id) =>
  (Array.isArray(lista) ? lista : []).filter((p) => p?.id !== id);

// ---------------------------------------------------------------------------
// Pontos de partida
// ---------------------------------------------------------------------------

// Não são exemplos de programador: são peças que a To Do Green realmente
// publica — logística de frota elétrica para embarcadores, não um negócio
// genérico. Quem nunca escreveu código troca o texto e usa. O WhatsApp é o
// comercial de verdade (55 11 95100-6360), o mesmo da tela de entrada.
export const TEMPLATES = [
  {
    id: "vazio",
    label: "Em branco",
    html: "<h1>To Do Green</h1>\n<p>Mudando o mundo a cada entrega.</p>",
    css: "body { font-family: system-ui; padding: 24px; color:#14201a; }",
    js: "",
  },
  {
    id: "cartao",
    label: "Cartão de serviço",
    html: `<main class="cartao">
  <span class="marca">To Do Green</span>
  <h1>Logística com frota 100% elétrica</h1>
  <p>Entregamos com redução comprovada de CO₂ na cadeia do seu cliente.</p>
  <a class="zap" href="https://wa.me/5511951006360">Solicitar uma cotação</a>
</main>`,
    css: `body { margin:0; min-height:100vh; display:grid; place-items:center;
  font-family: system-ui; background:#e8f4ec; }
.cartao { text-align:center; padding:40px 28px; border-radius:20px; max-width:420px;
  background:#fff; box-shadow:0 18px 50px rgba(15,122,61,.16); }
.marca { font-weight:800; letter-spacing:.02em; color:#0a5c2e; }
.cartao h1 { margin:10px 0 6px; font-size:24px; color:#14201a; }
.cartao p { color:#5a6b62; margin:0 0 20px; }
.zap { display:inline-block; padding:12px 22px; border-radius:12px;
  background:#25d366; color:#08351f; text-decoration:none; font-weight:800; }`,
    js: "",
  },
  {
    id: "formulario",
    label: "Pedido de cotação",
    html: `<form id="cotacao">
  <h2>Peça uma cotação de frete</h2>
  <label>Empresa <input name="empresa" required></label>
  <label>Seu nome <input name="nome" required></label>
  <label>Origem (cidade/UF) <input name="origem" required></label>
  <label>Destino (cidade/UF) <input name="destino" required></label>
  <label>Entregas por mês <input name="volume" type="number" min="1" value="1000"></label>
  <label>Tipo de operação
    <select name="operacao">
      <option>Last Mile</option>
      <option>Middle Mile</option>
      <option>Operação dedicada</option>
      <option>Transferência entre CDs</option>
    </select>
  </label>
  <button>Enviar pelo WhatsApp</button>
</form>`,
    css: `body { font-family: system-ui; padding:24px; background:#f2fbf8; }
form { display:grid; gap:12px; max-width:420px; margin:0 auto; padding:24px;
  background:#fff; border-radius:16px; }
h2 { margin:0 0 4px; color:#0a5c2e; }
label { display:grid; gap:5px; font-size:14px; font-weight:600; color:#3e4e45; }
input, select { padding:10px; border:1px solid #d7e3db; border-radius:9px; font:inherit; }
button { padding:12px; border:0; border-radius:10px; background:#0f7a3d;
  color:#fff; font-weight:700; cursor:pointer; }`,
    js: `document.getElementById("cotacao").addEventListener("submit", (e) => {
  e.preventDefault();
  const d = new FormData(e.target);
  const texto = \`Olá! Sou \${d.get("nome")}, da \${d.get("empresa")}. \` +
    \`Quero cotar \${d.get("operacao")}: \${d.get("origem")} → \${d.get("destino")}, \` +
    \`~\${d.get("volume")} entregas/mês.\`;
  // Abre o WhatsApp do comercial da To Do Green com a mensagem pronta.
  window.open("https://wa.me/5511951006360?text=" + encodeURIComponent(texto), "_blank");
});`,
  },
  {
    id: "precos",
    label: "Serviços",
    html: `<section class="precos">
  <article><h3>Last Mile</h3><strong>por entrega</strong><p>Entrega ao consumidor final, medida em pacotes e taxa de sucesso.</p></article>
  <article class="destaque"><h3>Middle Mile</h3><strong>por rota</strong><p>Transferência entre CD e hub, alto volume e janela previsível.</p></article>
  <article><h3>Operação dedicada</h3><strong>sob consulta</strong><p>Frota e motoristas exclusivos, cobrada por mensalidade.</p></article>
</section>`,
    css: `body { font-family: system-ui; padding:24px; background:#e8f4ec; }
.precos { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr)); }
article { padding:22px; border-radius:16px; background:#fff; text-align:center; }
h3 { margin:0; color:#14201a; }
.destaque { outline:2px solid #0f7a3d; }
strong { display:block; font-size:22px; margin:8px 0; color:#0f7a3d; }
p { color:#5a6b62; margin:0; font-size:14px; }`,
    js: "",
  },
];

export const templateById = (id) =>
  TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

// ---------------------------------------------------------------------------
// Montagem do documento
// ---------------------------------------------------------------------------

// `</script>` dentro de uma string de JS fecha a tag do documento inteiro e
// quebra a prévia de um jeito que ninguém entende. Escapar a barra resolve sem
// mudar o que o código faz.
export const escapeScript = (js) => texto(js).replace(/<\/(script)/gi, "<\\/$1");

// Ponte do console: o código da prévia roda numa caixa isolada, então a única
// forma de a pessoa ver um erro é mandarmos a mensagem para fora. Sem isso, o
// erro acontece e a tela simplesmente não faz nada.
const PONTE = `<script>(function(){
  var envia=function(nivel,args){
    try{
      parent.postMessage({__seufuncionario:"console",nivel:nivel,
        texto:Array.prototype.map.call(args,function(a){
          try{return typeof a==="string"?a:JSON.stringify(a);}catch(e){return String(a);}
        }).join(" ")},"*");
    }catch(e){}
  };
  ["log","warn","error","info"].forEach(function(n){
    var orig=console[n];
    console[n]=function(){envia(n,arguments);try{orig.apply(console,arguments);}catch(e){}};
  });
  window.addEventListener("error",function(e){envia("error",[e.message+" (linha "+e.lineno+")"]);});
  window.addEventListener("unhandledrejection",function(e){envia("error",["Promessa rejeitada: "+e.reason]);});
})();</script>`;

export const buildDocument = ({ html = "", css = "", js = "" } = {}, opcoes = {}) => {
  const comPonte = opcoes.console !== false;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${texto(css)}</style>
</head>
<body>
${texto(html)}
${comPonte ? PONTE : ""}
<script>${escapeScript(js)}</script>
</body>
</html>`;
};

// Arquivo único para baixar: sem a ponte do console, que só serve dentro do app.
export const exportHtml = (projeto = {}) =>
  buildDocument(projeto, { console: false });

export const exportName = (nome) =>
  `${texto(nome)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 60) || "pagina"}.html`;

// ---------------------------------------------------------------------------
// Mensagens vindas da prévia
// ---------------------------------------------------------------------------

// A prévia não tem origem própria (o navegador dá a ela a origem opaca "null"),
// então conferir `event.origin` não protege nada. Quem chama precisa conferir
// a IDENTIDADE da janela — `event.source === iframe.contentWindow` — e este
// parse ainda descarta qualquer coisa fora do nosso formato, para uma extensão
// ou outra aba não conseguir injetar linha falsa no console.
export const parseConsoleMessage = (data) => {
  if (!data || typeof data !== "object") return null;
  if (data.__seufuncionario !== "console") return null;
  const nivel = ["log", "warn", "error", "info"].includes(data.nivel)
    ? data.nivel
    : "log";
  return { nivel, texto: texto(data.texto).slice(0, 2000) };
};

export const MAX_LOGS = 60;

export const appendLog = (logs = [], entrada) => {
  if (!entrada) return Array.isArray(logs) ? logs : [];
  const lista = [...(Array.isArray(logs) ? logs : []), { ...entrada, id: `${Date.now()}-${Math.random()}` }];
  // Corta pelo começo: um laço acidental joga milhares de linhas e travaria a
  // tela se a gente guardasse tudo.
  return lista.slice(-MAX_LOGS);
};

// ---------------------------------------------------------------------------
// Conferências antes de rodar
// ---------------------------------------------------------------------------

// Não é um validador de verdade — é um punhado de avisos para quem está
// começando não ficar meia hora olhando uma tela branca sem entender.
export const describeIssues = ({ html = "", css = "", js = "" } = {}) => {
  const avisos = [];
  const h = texto(html);
  const c = texto(css);
  const j = texto(js);

  const abre = (c.match(/\{/g) || []).length;
  const fecha = (c.match(/\}/g) || []).length;
  if (abre !== fecha)
    avisos.push({
      onde: "CSS",
      texto: `Há ${abre} "{" e ${fecha} "}". Falta fechar alguma chave — o resto do estilo depois disso não vale.`,
    });

  for (const tag of ["div", "section", "form", "main", "article", "p"]) {
    const a = (h.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
    const f = (h.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (a > f)
      avisos.push({
        onde: "HTML",
        texto: `A tag <${tag}> foi aberta ${a}x e fechada ${f}x.`,
      });
  }

  if (/\blocalStorage\b|\bdocument\.cookie\b|\bsessionStorage\b/.test(j))
    avisos.push({
      onde: "JavaScript",
      texto:
        "localStorage e cookie não funcionam na prévia: ela roda numa caixa isolada, de propósito, para o código não alcançar os seus dados. Na sua hospedagem vai funcionar.",
    });

  if (/http:\/\//.test(h + c + j))
    avisos.push({
      onde: "Endereço",
      texto:
        "Há um endereço http:// (sem s). Navegador moderno bloqueia isso dentro de uma página segura. Use https://.",
    });

  if (/\balert\s*\(/.test(j))
    avisos.push({
      onde: "JavaScript",
      texto: "alert() é bloqueado na prévia. Use console.log() para ver o valor.",
    });

  return avisos;
};

// ---------------------------------------------------------------------------
// Tamanho
// ---------------------------------------------------------------------------

export const projectSize = (projeto = {}) =>
  texto(projeto.html).length + texto(projeto.css).length + texto(projeto.js).length;

export const MAX_PROJECT_CHARS = 120_000;

export const canSaveProject = (projeto) =>
  projectSize(projeto) <= MAX_PROJECT_CHARS;

export const LANGUAGES = [
  { id: "html", label: "HTML", hint: "O conteúdo da página" },
  { id: "css", label: "CSS", hint: "A aparência" },
  { id: "js", label: "JavaScript", hint: "O comportamento" },
];
