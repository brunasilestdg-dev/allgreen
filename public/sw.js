const SERVICE_VERSION =
  new URL(self.location.href).searchParams.get("v") || "local";
// O bump do número força quem estiver preso numa versão antiga a descartar o
// cache e baixar a nova: mudar o nome do cache faz o `activate` apagar tudo o
// que não é este cache — cura o caso de telas que "não fazem nada" porque o JS
// em cache aponta para pedaços que já não existem.
const CACHE = `allgreen-v290-${SERVICE_VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // HTML e navegação: sempre da rede, sem cache do navegador, para nunca servir versão antiga
  const isDoc = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isDoc) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((fresh) => {
          caches.open(CACHE).then((c) => c.put(req, fresh.clone()));
          return fresh;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
    );
    return;
  }
  // Demais (JS/CSS com hash, imagens): rede primeiro, cai para cache offline.
  // Duas armadilhas aqui, e as duas produziam o "Algo deu errado":
  //  1. um pedaço com hash some do servidor depois do deploy e volta 404 — o
  //     404 NÃO pode ser guardado no cache, senão a aba fica presa nele;
  //  2. sem rede, devolver o index.html (`cache.match("/")`) para um pedido de
  //     .js faz o navegador tentar executar HTML como módulo e estourar um erro
  //     de sintaxe indecifrável. Melhor deixar a falha ser o que é.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        else if (fresh.status === 404) {
          const cached = await cache.match(req);
          if (cached) return cached;
        }
        return fresh;
      } catch (erro) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw erro;
      }
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const title = data.title || "All Green";
  const link = data.link || "/";
  const extra = data.count > 1 ? ` (+${data.count - 1} outra${data.count > 2 ? "s" : ""})` : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: `${data.body || "Você tem uma novidade."}${extra}`,
      icon: "/notification-icon.png",
      badge: "/notification-badge.png",
      tag: link,
      data: { link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(location.origin) && "focus" in client) {
            client.postMessage({ type: "sf-push-navigate", link });
            return client.focus();
          }
        }
        return self.clients.openWindow(link);
      }),
  );
});
