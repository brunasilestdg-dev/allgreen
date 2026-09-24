// ===== Site público =====
//
// A página que o visitante do site vê (renderPublicSite entra por outro
// caminho) e a loja virtual embutida nela: catálogo do dono, formatação de
// produto para o carrinho e o HTML/CSS/JS da vitrine.
//
// Extraído de worker.js, que misturava isso a milhares de linhas de outras
// rotas sem nenhuma relação com site público.

import { randomHex, sha256 } from "../auth/credenciais.js";
import { moneyBRL } from "../lib/format.js";
import { allowed, json } from "../lib/http.js";
import {
  caixaDoTurnstile,
  cspComTurnstile,
  exigirTurnstile,
  scriptDoTurnstile,
} from "../lib/turnstile.js";
import { escMail } from "../mensageria/envio.js";
import { insertInteraction } from "./omnichannel.js";

function publicSiteResponse(site, env = {}) {
  const nonce = randomHex(16);
  const endpoint = `/api/public-sites/${encodeURIComponent(site.slug)}/leads`;
  // O HTML do site é da dona; a caixa do anti-robô entra pelo script, antes do
  // botão de envio do formulário de contato. O widget cria dentro do form o
  // campo `cf-turnstile-response`, que segue no FormData.
  const caixa = caixaDoTurnstile(env, "site");
  const script = `<script nonce="${nonce}">(()=>{const f=document.querySelector('[data-sf-lead-form]');if(!f)return;const s=f.querySelector('[data-sf-lead-status]');const caixa=${JSON.stringify(caixa).replace(/</g, "\\u003c")};if(caixa){const alvo=f.querySelector('[type=submit],button:not([type])');alvo?alvo.insertAdjacentHTML('beforebegin',caixa):f.insertAdjacentHTML('beforeend',caixa)}f.addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(f).entries());if(s)s.textContent='Enviando...';try{const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível enviar.');f.reset();window.turnstile?.reset();if(s)s.textContent='Mensagem enviada. Em breve entraremos em contato.'}catch(x){window.turnstile?.reset();if(s)s.textContent=x.message||'Não foi possível enviar agora.'}})})()</script>`;
  // O script do widget vem DEPOIS do nosso: quando ele carrega, a caixa já
  // está no formulário.
  const scripts = `${script}${scriptDoTurnstile(env, nonce)}`;
  const html = site.html.match(/<\/body\s*>/i)
    ? site.html.replace(/<\/body\s*>/i, `${scripts}</body>`)
    : `${site.html}${scripts}`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "content-security-policy": cspComTurnstile(
        `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src 'self'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors *`,
        env,
      ),
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

async function productsForOwner(env, ownerId) {
  const row = await env.DB.prepare(
    "SELECT data FROM workspaces WHERE user_id = ?",
  )
    .bind(ownerId)
    .first();
  if (!row) return [];
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return [];
  }
  return Array.isArray(data?.products) ? data.products : [];
}

function storefrontProduct(p) {
  const variants = Array.isArray(p.variants)
    ? p.variants
        .filter((v) => Number(v.stock) > 0)
        .map((v) => ({
          id: String(v.id),
          name: String(v.name || "").slice(0, 80),
          price: Number(v.price) || 0,
          stock: Number(v.stock) || 0,
        }))
    : [];
  const stock = variants.length
    ? variants.reduce((sum, v) => sum + v.stock, 0)
    : Number(p.stock) || 0;
  if (stock <= 0) return null;
  return {
    id: String(p.id),
    name: String(p.name || "").slice(0, 120),
    price: Number(p.price) || 0,
    variants,
  };
}

function storefrontResponse(site, products, env = {}) {
  const nonce = randomHex(16);
  const endpoint = `/api/public-sites/${encodeURIComponent(site.slug)}/checkout`;
  const productsJson = JSON.stringify(products).replace(/</g, "\\u003c");
  const title = escMail(site.name || "Loja virtual");
  const script = `<script nonce="${nonce}">(()=>{
const PRODUCTS=${productsJson};
const cart={};
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const grid=document.getElementById('sf-products');
const cartBox=document.getElementById('sf-cart');
const totalBox=document.getElementById('sf-total');
const form=document.getElementById('sf-checkout');
const status=document.getElementById('sf-status');
function lineKey(pid,vid){return pid+'|'+(vid||'')}
function cartTotal(){return Object.values(cart).reduce((s,l)=>s+l.price*l.qty,0)}
function renderCart(){
  cartBox.innerHTML='';
  const lines=Object.values(cart);
  if(!lines.length){cartBox.textContent='Seu carrinho está vazio.';totalBox.textContent='';form.hidden=true;return}
  form.hidden=false;
  lines.forEach(l=>{
    const row=document.createElement('div');
    row.className='sf-cart-row';
    const label=document.createElement('span');
    label.textContent=l.qty+'x '+l.name+' — '+money(l.price*l.qty);
    const remove=document.createElement('button');
    remove.type='button';remove.textContent='Remover';
    remove.addEventListener('click',()=>{delete cart[lineKey(l.productId,l.variantId)];renderCart()});
    row.appendChild(label);row.appendChild(remove);
    cartBox.appendChild(row);
  });
  totalBox.textContent='Total: '+money(cartTotal());
}
function addToCart(product,variant,qty){
  if(qty<=0)return;
  const key=lineKey(product.id,variant?variant.id:null);
  const price=variant?variant.price:product.price;
  const name=variant?product.name+' - '+variant.name:product.name;
  const existing=cart[key];
  cart[key]=existing?{...existing,qty:existing.qty+qty}:{productId:product.id,variantId:variant?variant.id:null,name,price,qty};
  renderCart();
}
PRODUCTS.forEach(p=>{
  const card=document.createElement('article');card.className='sf-card';
  const h=document.createElement('h3');h.textContent=p.name;card.appendChild(h);
  const priceLine=document.createElement('p');
  priceLine.textContent=p.variants.length?('a partir de '+money(Math.min(...p.variants.map(v=>v.price)))):money(p.price);
  card.appendChild(priceLine);
  let variantSelect=null;
  if(p.variants.length){
    variantSelect=document.createElement('select');
    p.variants.forEach(v=>{
      const opt=document.createElement('option');opt.value=v.id;opt.textContent=v.name+' — '+money(v.price);variantSelect.appendChild(opt);
    });
    card.appendChild(variantSelect);
  }
  const qtyInput=document.createElement('input');
  qtyInput.type='number';qtyInput.min='1';qtyInput.value='1';
  card.appendChild(qtyInput);
  const addButton=document.createElement('button');addButton.type='button';addButton.textContent='Adicionar ao carrinho';
  addButton.addEventListener('click',()=>{
    const variant=variantSelect?p.variants.find(v=>v.id===variantSelect.value):null;
    addToCart(p,variant,Number(qtyInput.value)||0);
  });
  card.appendChild(addButton);
  grid.appendChild(card);
});
renderCart();
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const items=Object.values(cart).map(l=>({productId:l.productId,variantId:l.variantId,quantity:l.qty}));
  if(!items.length)return;
  const b=Object.fromEntries(new FormData(form).entries());
  // A caixa do anti-robô fica fora do formulário (que nasce oculto); o token
  // vem do campo que o widget cria nela.
  b.turnstileToken=(document.querySelector('#sf-turnstile [name="cf-turnstile-response"]')||{}).value||'';
  status.textContent='Enviando pedido...';
  try{
    const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...b,items})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Não foi possível enviar.');
    form.reset();
    Object.keys(cart).forEach(k=>delete cart[k]);
    renderCart();
    window.turnstile?.reset();
    status.textContent='Pedido enviado! Em breve entraremos em contato para confirmar.';
  }catch(x){window.turnstile?.reset();status.textContent=x.message||'Não foi possível enviar agora.'}
});
})()</script>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
body{font-family:Arial,sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#211846;background:#faf9fd}
h1{font-size:22px}
#sf-products{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin:20px 0}
.sf-card{border:1px solid #ddd6f3;border-radius:12px;padding:14px;background:#fff;display:grid;gap:8px}
.sf-card select,.sf-card input,.sf-card button{width:100%;padding:8px;border-radius:8px;border:1px solid #ccc}
#sf-cart-panel{border:1px solid #ddd6f3;border-radius:12px;padding:16px;background:#fff;margin-top:24px}
.sf-cart-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #eee}
#sf-checkout{display:grid;gap:8px;margin-top:12px}
#sf-checkout input,#sf-checkout textarea{padding:8px;border-radius:8px;border:1px solid #ccc}
#sf-checkout button{padding:10px;border-radius:8px;border:0;background:#5b3df0;color:#fff;cursor:pointer}
</style></head><body>
<h1>${title}</h1>
<p>Escolha os produtos, monte seu pedido e finalize abaixo.</p>
<div id="sf-products"></div>
<div id="sf-cart-panel">
<h2>Seu carrinho</h2>
<div id="sf-cart"></div>
<p id="sf-total"></p>
<div id="sf-turnstile">${caixaDoTurnstile(env, "loja")}</div>
<form id="sf-checkout" hidden>
<input name="name" placeholder="Seu nome" required maxlength="100">
<input name="phone" placeholder="WhatsApp">
<input name="email" type="email" placeholder="E-mail (opcional se informar WhatsApp)">
<textarea name="notes" placeholder="Observações (opcional)" maxlength="500"></textarea>
<button type="submit">Finalizar pedido</button>
<p id="sf-status" role="status"></p>
</form>
</div>
${script}
${scriptDoTurnstile(env, nonce)}
</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": cspComTurnstile(
        `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src 'self'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'; frame-ancestors *`,
        env,
      ),
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handlePublicSite(request, env, url) {
  if (!env.DB) return json({ error: "Publicação indisponível." }, 503);

  const storeMatch = url.pathname.match(/^\/loja\/([a-z0-9-]+)\/?$/i);
  if (storeMatch && request.method === "GET") {
    const site = await env.DB.prepare(
      "SELECT id, owner_id, slug, name FROM public_sites WHERE slug = ? AND published = 1",
    )
      .bind(storeMatch[1])
      .first();
    if (!site)
      return new Response(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Loja indisponível</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#211846"><h1>Esta loja não está disponível</h1><p>O endereço pode estar incorreto ou a página foi despublicada.</p></body></html>',
        {
          status: 404,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    const rawProducts = await productsForOwner(env, site.owner_id);
    const products = rawProducts
      .map(storefrontProduct)
      .filter((p) => p !== null);
    return storefrontResponse(site, products, env);
  }

  const checkoutMatch = url.pathname.match(
    /^\/api\/public-sites\/([a-z0-9-]+)\/checkout\/?$/i,
  );
  if (checkoutMatch) {
    if (request.method !== "POST")
      return json({ error: "Método não permitido." }, 405);
    const ip = request.headers.get("cf-connecting-ip") || "public";
    if (!allowed(`site-checkout:${ip}`, 5))
      return json(
        { error: "Muitos envios em pouco tempo. Aguarde e tente novamente." },
        429,
      );
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Dados inválidos." }, 400);
    }
    const barradoNaLoja = await exigirTurnstile(request, env, body, {
      acao: "loja",
      responder: json,
    });
    if (barradoNaLoja) return barradoNaLoja;
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase().slice(0, 160)
        : "";
    const phone =
      typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
    if (name.length < 2) return json({ error: "Informe seu nome." }, 400);
    if (email && !/^\S+@\S+\.\S+$/.test(email))
      return json({ error: "Informe um e-mail válido." }, 400);
    if (!email && !phone)
      return json(
        { error: "Informe um e-mail ou telefone para contato." },
        400,
      );
    if (!items.length)
      return json({ error: "Seu carrinho está vazio." }, 400);
    const site = await env.DB.prepare(
      "SELECT id, owner_id FROM public_sites WHERE slug = ? AND published = 1",
    )
      .bind(checkoutMatch[1])
      .first();
    if (!site) return json({ error: "Esta loja não está disponível." }, 404);
    const rawProducts = await productsForOwner(env, site.owner_id);
    const lines = [];
    let total = 0;
    for (const line of items) {
      const productId =
        typeof line.productId === "string" ? line.productId : "";
      const variantId =
        typeof line.variantId === "string" && line.variantId
          ? line.variantId
          : null;
      const quantity = Number(line.quantity) || 0;
      const product = rawProducts.find((p) => p.id === productId);
      if (!product || quantity <= 0)
        return json({ error: "Item do carrinho inválido." }, 400);
      const variant = variantId
        ? (product.variants || []).find((v) => v.id === variantId)
        : null;
      if (variantId && !variant)
        return json({ error: "Variação do produto inválida." }, 400);
      const stock = variant ? Number(variant.stock) : Number(product.stock);
      if (quantity > stock)
        return json(
          { error: `Estoque insuficiente para ${product.name}.` },
          409,
        );
      const price = variant ? Number(variant.price) : Number(product.price);
      const label = variant ? `${product.name} - ${variant.name}` : product.name;
      lines.push(`${quantity}x ${label} (${moneyBRL(price * quantity)})`);
      total += price * quantity;
    }
    const message = `Pedido pela loja virtual: ${lines.join(", ")}. Total: ${moneyBRL(total)}.${notes ? ` Observações: ${notes}` : ""}`;
    const day = new Date().toISOString().slice(0, 10);
    const dedupe = await sha256(
      `${site.id}|${ip}|${email}|${phone}|${message}|${day}`,
    );
    await env.DB.prepare(
      `INSERT OR IGNORE INTO public_site_leads (id, site_id, owner_id, name, email, phone, message, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        site.id,
        site.owner_id,
        name,
        email,
        phone,
        message,
        dedupe,
        new Date().toISOString(),
      )
      .run();
    return json({ ok: true });
  }

  const pageMatch = url.pathname.match(
    /^\/s\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/i,
  );
  if (pageMatch && request.method === "GET") {
    const site = await env.DB.prepare(
      "SELECT id, slug, name, html, pages_json AS pagesJson FROM public_sites WHERE slug = ? AND published = 1",
    )
      .bind(pageMatch[1])
      .first();
    if (!site)
      return new Response(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Página indisponível</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#211846"><h1>Esta página não está disponível</h1><p>O endereço pode estar incorreto ou o site foi despublicado.</p><a href="/">Voltar ao Seu Funcionário</a></body></html>',
        {
          status: 404,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    let html = site.html;
    if (pageMatch[2]) {
      let pages = [];
      try {
        pages = JSON.parse(site.pagesJson || "[]");
      } catch {}
      const selected = pages.find((page) => page.slug === pageMatch[2]);
      if (!selected)
        return new Response("Página não encontrada.", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      html = selected.html;
    }
    return publicSiteResponse({ ...site, html }, env);
  }

  const leadMatch = url.pathname.match(
    /^\/api\/public-sites\/([a-z0-9-]+)\/leads\/?$/i,
  );
  if (!leadMatch) return null;
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`site-lead:${ip}`, 5))
    return json(
      { error: "Muitos envios em pouco tempo. Aguarde e tente novamente." },
      429,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const barradoNoSite = await exigirTurnstile(request, env, body, {
    acao: "site",
    responder: json,
  });
  if (barradoNoSite) return barradoNoSite;
  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase().slice(0, 160)
      : "";
  const phone =
    typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (name.length < 2) return json({ error: "Informe seu nome." }, 400);
  if (email && !/^\S+@\S+\.\S+$/.test(email))
    return json({ error: "Informe um e-mail válido." }, 400);
  if (!email && !phone)
    return json({ error: "Informe um e-mail ou telefone para contato." }, 400);
  const site = await env.DB.prepare(
    "SELECT id, owner_id FROM public_sites WHERE slug = ? AND published = 1",
  )
    .bind(leadMatch[1])
    .first();
  if (!site) return json({ error: "Esta página não está disponível." }, 404);
  const day = new Date().toISOString().slice(0, 10);
  const dedupe = await sha256(
    `${site.id}|${ip}|${email}|${phone}|${message}|${day}`,
  );
  const leadResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO public_site_leads (id, site_id, owner_id, name, email, phone, message, dedupe_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      site.id,
      site.owner_id,
      name,
      email,
      phone,
      message,
      dedupe,
      new Date().toISOString(),
    )
    .run();
  // Jornada transversal: a mensagem do formulário do site cai também na caixa
  // de entrada unificada (canal de entrada real, sem serviço pago). Só quando
  // o lead é genuinamente novo, para respeitar a deduplicação diária.
  if (leadResult.meta?.changes > 0) {
    try {
      await insertInteraction(env, site.owner_id, site.owner_id, {
        channel: "form",
        direction: "in",
        contactName: name,
        contactHandle: email || phone,
        subject: "Mensagem pelo site",
        body: message || "(sem mensagem)",
      });
    } catch (error) {
      console.error("inbox from site form", error);
    }
  }
  return json({ ok: true });
}
