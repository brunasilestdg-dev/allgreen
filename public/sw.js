const SERVICE_VERSION =
  new URL(self.location.href).searchParams.get("v") || "local";
// v14: nova tela de configuração de busca (Integrações → Busca web) muda o
// bundle; o bump força quem estiver preso na versão antiga a descartar o cache
// e baixar a nova. Mudar o número do cache faz o `activate` apagar tudo o que
// não é este cache — cura o caso de telas que "não fazem nada" porque o JS em
// cache aponta para pedaços que já não existem.
const CACHE = `seu-funcionario-v228-${SERVICE_VERSION}`;

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
  // Demais (JS/CSS com hash, imagens): rede primeiro, cai para cache offline
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(req);
        return cached || cache.match("/");
      }
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const title = data.title || "Seu Funcionário";
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
