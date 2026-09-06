import { useCallback, useEffect, useState } from "react";
import {
  Award,
  BadgeCheck,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  Mail,
  Monitor,
  Palette,
  Plus,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { uid } from "../../domain.js";
import Modal from "../../components/Modal.jsx";
import { Button, Empty, Field, PageTitle } from "../../components/ui.jsx";
import { activeSpaceId, authHeaders } from "../../session/armazenamento.js";
import { aiWorkspaceContext } from "../../session/telemetria.js";
import { escapeHtml, slugify } from "../../components/formato.js";
import SharingFields from "../../components/SharingFields.jsx";

export function looksLikeSiteInstruction(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return (
    /^(crie|criar|gere|gerar|faça|fazer|desenvolva|monte|construa)\b/.test(
      text,
    ) ||
    /\b(o site|a página|landing page) (deve|precisa|tem que)\b/.test(text) ||
    /\b(apresente|explique|mostre|inclua)\b.{0,80}\b(site|página|plataforma)\b/.test(
      text,
    )
  );
}

const siteFallbackDescription = (form) => {
  const name = form.name || "Nosso negócio";
  const segment = form.segment
    ? ` em ${String(form.segment).toLowerCase()}`
    : "";
  return `${name} oferece soluções${segment} com atendimento próximo, clareza e foco no que cada cliente precisa.`;
};

const siteServices = (value) => {
  const source = Array.isArray(value)
    ? value
    : String(
        value ||
          "Atendimento personalizado\nSolução sob medida\nAcompanhamento próximo",
      )
        .split("\n")
        .filter(Boolean);
  return source.slice(0, 8).map((item) =>
    typeof item === "string"
      ? {
          title: item.trim(),
          description:
            "Uma solução conduzida com clareza, cuidado e acompanhamento em cada etapa.",
        }
      : {
          title: String(item?.title || "Solução").trim(),
          description: String(
            item?.description ||
              "Converse conosco para entender como esta solução pode ajudar.",
          ).trim(),
        },
  );
};

export function mergeSiteBrief(base, patch) {
  const allowed = [
    "name",
    "segment",
    "headline",
    "description",
    "aboutTitle",
    "about",
    "services",
    "cta",
    "contact",
    "color",
    "faq",
    "heroStyle",
    "features",
    "homeBlocks",
  ];
  const next = { ...base };
  allowed.forEach((key) => {
    if (patch?.[key] !== undefined && patch[key] !== null)
      next[key] = patch[key];
  });
  if (
    !String(next.description || "").trim() ||
    looksLikeSiteInstruction(next.description)
  )
    next.description = siteFallbackDescription(next);
  if (!/^#[0-9a-f]{6}$/i.test(next.color || "")) next.color = "#0b9f8f";
  return next;
}

const sitePagePath = (slug, page = "") =>
  `/s/${slugify(slug || "meu-site")}${page ? `/${page}` : ""}`;

export const SITE_THEMES = [
  {
    id: "moderno",
    label: "Moderno",
    swatch: "linear-gradient(135deg,#f4f0ff,#fff0f7)",
  },
  {
    id: "escuro",
    label: "Minimalista escuro",
    swatch: "linear-gradient(135deg,#181430,#0f0d1a)",
  },
  {
    id: "vibrante",
    label: "Vibrante",
    swatch: "linear-gradient(135deg,#ff6b57,#ffb648)",
  },
];

const themeTokens = (theme, color) =>
  ({
    moderno: {
      bg: "#fafaff",
      text: "#17152b",
      muted: "#5d576d",
      heroBg: "linear-gradient(135deg,#f4f0ff,#fff0f7)",
      heroText: "#17152b",
      headerBg: "#fff",
      headerBorder: "#ece9f4",
      navText: "#57516b",
      cardBg: "#fff",
      cardBorder: "#e8e5f2",
      contactBg: "#17152b",
      contactText: "#fff",
      font: "Inter,Arial,sans-serif",
      radius: "20px",
    },
    escuro: {
      bg: "#100e1c",
      text: "#f4f2fb",
      muted: "#b6b0c7",
      heroBg: "linear-gradient(135deg,#1a1630,#100e1c)",
      heroText: "#fff",
      headerBg: "#151225",
      headerBorder: "#26213c",
      navText: "#c9c4da",
      cardBg: "#1a1630",
      cardBorder: "#2a2542",
      contactBg: "#000",
      contactText: "#fff",
      font: "'Poppins',Inter,Arial,sans-serif",
      radius: "16px",
    },
    vibrante: {
      bg: "#fffaf2",
      text: "#20160a",
      muted: "#6f5c40",
      heroBg: `linear-gradient(135deg, ${color}, #ff7a44)`,
      heroText: "#fff",
      headerBg: "#fff",
      headerBorder: "#ffe3cc",
      navText: "#6f5c40",
      cardBg: "#fff",
      cardBorder: "#ffe3cc",
      contactBg: color,
      contactText: "#fff",
      font: "'Poppins',Inter,Arial,sans-serif",
      radius: "26px",
    },
  })[theme] || themeTokens("moderno", color);

const isSafeImageUrl = (value) => /^https:\/\/\S+$/i.test(String(value || "").trim());

const siteGallery = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((item) => item && isSafeImageUrl(item.url))
    .slice(0, 8)
    .map((item) => ({
      url: String(item.url).trim(),
      caption: String(item.caption || "").trim().slice(0, 120),
    }));

const siteTestimonials = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((item) => item && String(item.quote || "").trim())
    .slice(0, 6)
    .map((item) => ({
      name: String(item.name || "Cliente").trim().slice(0, 60) || "Cliente",
      role: String(item.role || "").trim().slice(0, 60),
      quote: String(item.quote || "").trim().slice(0, 400),
    }));

const siteFaq = (value) =>
  (Array.isArray(value) ? value : [])
    .filter(
      (item) =>
        item && String(item.question || "").trim() && String(item.answer || "").trim(),
    )
    .slice(0, 6)
    .map((item) => ({
      question: String(item.question).trim().slice(0, 160),
      answer: String(item.answer).trim().slice(0, 400),
    }));

const siteFeatures = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((item) => item && String(item.title || "").trim())
    .slice(0, 4)
    .map((item) => ({
      title: String(item.title).trim().slice(0, 60),
      description: String(item.description || "").trim().slice(0, 200),
    }));

export const HOME_BLOCK_IDS = ["features", "gallery", "testimonials", "cta"];

const sanitizeHomeBlocks = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((id) => HOME_BLOCK_IDS.includes(id))
    .filter((id, index, arr) => arr.indexOf(id) === index)
    .slice(0, HOME_BLOCK_IDS.length);

export const HERO_STYLES = [
  { id: "centrado", label: "Centrado" },
  { id: "dividido", label: "Dividido" },
  { id: "impacto", label: "Impacto" },
];

export function makeSite(form, page = "", siteSlug = "") {
  const title = form.name || "Meu negócio";
  const desc =
    form.description && !looksLikeSiteInstruction(form.description)
      ? form.description
      : siteFallbackDescription(form);
  const color = /^#[0-9a-f]{6}$/i.test(form.color || "")
    ? form.color
    : "#0b9f8f";
  const contact = /^(https?:|mailto:|tel:|#)/i.test(form.contact || "")
    ? form.contact
    : "#contato";
  const slug = siteSlug || slugify(title);
  const services = siteServices(form.services);
  const t = themeTokens(form.theme, color);
  const heroImg = isSafeImageUrl(form.heroImage) ? String(form.heroImage).trim() : "";
  const gallery = siteGallery(form.gallery);
  const testimonials = siteTestimonials(form.testimonials);
  const faq = siteFaq(form.faq);
  const features = siteFeatures(form.features);
  const homeBlocks = sanitizeHomeBlocks(form.homeBlocks);
  const heroStyle = HERO_STYLES.some((s) => s.id === form.heroStyle)
    ? form.heroStyle
    : "centrado";
  const cards = services
    .map(
      (service) =>
        `<article class="card"><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p></article>`,
    )
    .join("");
  const nav = [
    ["", "Início"],
    ["sobre", "Sobre"],
    ["servicos", "Serviços"],
    ["contato", "Contato"],
  ]
    .map(
      ([path, label]) =>
        `<a${page === path ? ' aria-current="page"' : ""} href="${sitePagePath(slug, path)}">${label}</a>`,
    )
    .join("");
  const about =
    form.about ||
    `${title} nasceu para oferecer uma experiência confiável, simples e próxima. Cada atendimento parte do contexto real do cliente para chegar a uma solução adequada.`;
  const heroCopy = `<span>${escapeHtml(form.segment || "Bem-vindo")}</span><h1>${escapeHtml(form.headline || title)}</h1><p>${escapeHtml(desc)}</p><a class="cta" href="${sitePagePath(slug, "contato")}">${escapeHtml(form.cta || "Quero saber mais")}</a>`;
  const heroVisual = heroImg
    ? `<img src="${escapeHtml(heroImg)}" alt="${escapeHtml(title)}" loading="lazy">`
    : `<div class="hero-decor" aria-hidden="true"><span>${escapeHtml((title.trim()[0] || "S").toUpperCase())}</span></div>`;
  const heroSection =
    heroStyle === "impacto"
      ? `<section class="hero style-impacto"><div>${heroCopy}</div></section>`
      : heroStyle === "dividido"
        ? `<section class="hero heroImg style-dividido"><div>${heroCopy}</div>${heroVisual}</section>`
        : heroImg
          ? `<section class="hero heroImg"><div>${heroCopy}</div>${heroVisual}</section>`
          : `<section class="hero"><div>${heroCopy}</div></section>`;
  const gallerySection = gallery.length
    ? `<section class="section gallery"><span class="kicker">GALERIA</span><h2>Um pouco do nosso trabalho</h2><div class="gallery-grid">${gallery
        .map(
          (g) =>
            `<figure><img src="${escapeHtml(g.url)}" alt="${escapeHtml(g.caption || title)}" loading="lazy">${g.caption ? `<figcaption>${escapeHtml(g.caption)}</figcaption>` : ""}</figure>`,
        )
        .join("")}</div></section>`
    : "";
  const testimonialsSection = testimonials.length
    ? `<section class="section testimonials"><span class="kicker">QUEM JÁ CONFIOU</span><h2>O que dizem sobre a gente</h2><div class="cards testi-cards">${testimonials
        .map(
          (item) =>
            `<article class="card testi"><p>&ldquo;${escapeHtml(item.quote)}&rdquo;</p><footer><strong>${escapeHtml(item.name)}</strong>${item.role ? `<span>${escapeHtml(item.role)}</span>` : ""}</footer></article>`,
        )
        .join("")}</div></section>`
    : "";
  const faqSection = faq.length
    ? `<section class="section faq"><span class="kicker">PERGUNTAS FREQUENTES</span><h2>Dúvidas comuns</h2><div class="faq-list">${faq
        .map(
          (item) =>
            `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`,
        )
        .join("")}</div></section>`
    : "";
  const featuresSection = features.length
    ? `<section class="section features"><span class="kicker">POR QUE ESCOLHER A GENTE</span><h2>O que nos diferencia</h2><div class="cards feature-cards">${features
        .map(
          (f, i) =>
            `<article class="card feature"><span class="feature-num">${String(i + 1).padStart(2, "0")}</span><h3>${escapeHtml(f.title)}</h3>${f.description ? `<p>${escapeHtml(f.description)}</p>` : ""}</article>`,
        )
        .join("")}</div></section>`
    : "";
  const ctaBannerSection = `<section class="section cta-banner"><div><h2>Vamos conversar sobre o que ${escapeHtml(title)} pode fazer por você?</h2><a class="cta light" href="${sitePagePath(slug, "contato")}">${escapeHtml(form.cta || "Falar agora")}</a></div></section>`;
  const homeBlockContent = {
    features: featuresSection,
    gallery: gallerySection,
    testimonials: testimonialsSection,
    cta: ctaBannerSection,
  };
  const homeOrder = homeBlocks.length ? homeBlocks : HOME_BLOCK_IDS;
  const renderedHomeIds = new Set();
  const homeExtras = homeOrder
    .filter((id) => homeBlockContent[id])
    .map((id) => {
      renderedHomeIds.add(id);
      return homeBlockContent[id];
    });
  ["gallery", "testimonials"].forEach((id) => {
    if (homeBlockContent[id] && !renderedHomeIds.has(id)) homeExtras.push(homeBlockContent[id]);
  });
  const pageContent =
    {
      "": `${heroSection}<section class="section intro"><span class="kicker">O QUE FAZEMOS</span><h2>Soluções pensadas para necessidades reais</h2><div class="cards">${cards}</div></section>${homeExtras.join("")}`,
      sobre: `<section class="page-hero"><span>QUEM SOMOS</span><h1>${escapeHtml(form.aboutTitle || `Sobre ${title}`)}</h1><p>${escapeHtml(desc)}</p></section><section class="section prose"><h2>Um trabalho construído com você</h2><p>${escapeHtml(about)}</p><a class="cta" href="${sitePagePath(slug, "contato")}">Conversar com a equipe</a></section>${testimonialsSection}`,
      servicos: `<section class="page-hero"><span>NOSSAS SOLUÇÕES</span><h1>Como podemos ajudar</h1><p>Conheça as frentes de trabalho e encontre o melhor ponto de partida.</p></section><section class="section"><div class="cards">${cards}</div></section>${faqSection}`,
      contato: `<section class="section contact" id="contato"><div class="contact-grid"><div><span class="kicker">CONTATO</span><h1>Vamos conversar?</h1><p>Conte o que você precisa. A mensagem chega diretamente à equipe responsável.</p>${contact !== "#contato" ? `<p><a class="cta light" href="${escapeHtml(contact)}">${escapeHtml(form.cta || "Falar agora")}</a></p>` : ""}</div><form class="lead-form" data-sf-lead-form><label>Nome<input name="name" required maxlength="100" autocomplete="name"></label><label>E-mail<input name="email" type="email" maxlength="160" autocomplete="email"></label><label>Telefone<input name="phone" maxlength="40" autocomplete="tel"></label><label>Mensagem<textarea name="message" maxlength="2000"></textarea></label><button type="submit">Enviar mensagem</button><p class="lead-status" data-sf-lead-status aria-live="polite"></p></form></div></section>`,
    }[page] || "";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page ? `${page[0].toUpperCase()}${page.slice(1)} · ${title}` : title)}</title><meta name="description" content="${escapeHtml(desc.slice(0, 150))}"><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:${t.font};color:${t.text};background:${t.bg}}header{display:flex;justify-content:space-between;align-items:center;gap:28px;padding:22px 7%;background:${t.headerBg};border-bottom:1px solid ${t.headerBorder};position:sticky;top:0;z-index:3}header b{font-size:1.2rem}nav{display:flex;align-items:center;gap:24px}nav a{color:${t.navText};text-decoration:none;font-weight:700;font-size:.93rem;transition:color .2s}nav a:hover{color:${color}}nav a[aria-current=page]{color:${color}}a{color:inherit}.cta,button{display:inline-block;background:${color};color:white;padding:14px 22px;border:0;border-radius:12px;text-decoration:none;font-weight:800;cursor:pointer;transition:transform .2s,box-shadow .2s}.cta:hover,button:hover{transform:translateY(-2px);box-shadow:0 12px 26px rgba(0,0,0,.18)}.cta.light{background:#fff;color:#17152b}.hero,.page-hero{padding:100px 7%;background:${t.heroBg};color:${t.heroText};display:grid;align-content:center}.hero{min-height:68vh}.hero>div{max-width:820px}.hero.heroImg{grid-template-columns:1.1fr .9fr;align-items:center;gap:44px;max-width:1280px;margin:0 auto}.hero.heroImg>div{max-width:none}.hero.heroImg img{width:100%;height:380px;object-fit:cover;border-radius:${t.radius}}.hero-decor{width:100%;height:380px;border-radius:${t.radius};background:linear-gradient(135deg, ${color}, ${t.cardBg});display:grid;place-items:center;overflow:hidden}.hero-decor span{font-size:8rem;font-weight:900;color:rgba(255,255,255,.85)}.hero.style-impacto{text-align:center}.hero.style-impacto>div{max-width:900px;margin:0 auto}.hero.style-impacto p{margin-left:auto;margin-right:auto}.hero span,.page-hero span,.kicker{color:${color};font-weight:900;text-transform:uppercase;letter-spacing:.12em}.hero h1,.page-hero h1,.contact h1{font-size:clamp(2.6rem,7vw,5.4rem);line-height:1.02;margin:.25em 0}.hero.style-impacto h1{font-size:clamp(3rem,8vw,6.2rem)}.hero p,.page-hero p{font-size:1.2rem;line-height:1.7;max-width:720px}.page-hero{min-height:48vh}.section{padding:80px 7%}.section>h2{font-size:clamp(2rem,4vw,3.4rem);max-width:780px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:34px}.card{background:${t.cardBg};padding:28px;border:1px solid ${t.cardBorder};border-radius:${t.radius};box-shadow:0 12px 35px rgba(35,25,72,.06);transition:transform .25s,box-shadow .25s}.card:hover{transform:translateY(-5px);box-shadow:0 18px 45px rgba(35,25,72,.12)}.card h3{font-size:1.25rem}.card p,.prose p{color:${t.muted};line-height:1.7}.prose{max-width:920px}.prose p{font-size:1.18rem}.testi p{font-size:1.05rem;font-style:italic;color:${t.text}}.testi footer{margin-top:14px;display:flex;flex-direction:column;gap:2px}.testi footer span{color:${t.muted};font-size:.88rem}.feature-num{font-size:2rem;font-weight:900;color:${color};opacity:.4;display:block;margin-bottom:6px}.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:34px}.gallery-grid figure{margin:0;border-radius:${t.radius};overflow:hidden;background:${t.cardBg}}.gallery-grid img{width:100%;height:220px;object-fit:cover;display:block}.gallery-grid figcaption{padding:10px 14px;font-size:.85rem;color:${t.muted}}.faq-list{margin-top:34px;display:grid;gap:12px;max-width:820px}.faq-list details{background:${t.cardBg};border:1px solid ${t.cardBorder};border-radius:14px;padding:16px 20px}.faq-list summary{cursor:pointer;font-weight:800}.faq-list p{margin:12px 0 0;color:${t.muted};line-height:1.6}.cta-banner{background:${t.contactBg};color:${t.contactText}}.cta-banner div{max-width:640px;margin:0 auto;display:grid;gap:20px;justify-items:center;text-align:center}.cta-banner h2{font-size:clamp(1.8rem,4vw,2.8rem);margin:0}.contact{background:${t.contactBg};color:${t.contactText};min-height:72vh;display:grid;align-content:center}.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:start;max-width:1150px;margin:auto}.lead-form{display:grid;gap:12px;background:#fff;color:#17152b;padding:28px;border-radius:20px}.lead-form label{display:grid;gap:6px;text-align:left;font-weight:700}.lead-form input,.lead-form textarea{width:100%;padding:13px;border:1px solid #d8d4e5;border-radius:10px;font:inherit}.lead-form textarea{min-height:110px;resize:vertical}.lead-status{min-height:22px;margin:0;color:#443d55;font-size:.92rem}footer{padding:28px 7%;text-align:center;color:${t.muted};background:${t.headerBg}}@keyframes sfFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}.hero>div,.hero-decor,.page-hero>*{animation:sfFadeUp .7s ease both}.cards .card{animation:sfFadeUp .6s ease both}.cards .card:nth-child(2){animation-delay:.08s}.cards .card:nth-child(3){animation-delay:.16s}.cards .card:nth-child(4){animation-delay:.24s}@media(max-width:760px){header{padding:18px 5%;align-items:flex-start;flex-direction:column}nav{width:100%;gap:16px;overflow:auto;padding-bottom:3px}.hero,.page-hero,.section{padding:62px 6%}.cards,.contact-grid,.gallery-grid{grid-template-columns:1fr}.hero.heroImg{grid-template-columns:1fr}.hero.heroImg img,.hero-decor{height:240px}}
</style></head><body><header><b>${escapeHtml(title)}</b><nav aria-label="Páginas do site">${nav}</nav></header><main>${pageContent}</main><footer>© ${new Date().getFullYear()} ${escapeHtml(title)}</footer></body></html>`;
}

export function makeSitePages(form, slug) {
  return [
    { slug: "", name: "Início" },
    { slug: "sobre", name: "Sobre" },
    { slug: "servicos", name: "Serviços" },
    { slug: "contato", name: "Contato" },
  ].map((item) => ({
    ...item,
    html: makeSite(form, item.slug, slug),
  }));
}
export function websiteMilestones(site) {
  const brief = site?.brief || {};
  const serviceCount = Array.isArray(brief.services)
    ? brief.services.length
    : (brief.services || "").split("\n").filter((x) => x.trim()).length;
  const reviewed = site?.reviewedDevices || [];
  return [
    {
      id: "created",
      title: "Projeto criado",
      text: "Gerar e salvar uma página funcional.",
      done: !!site,
    },
    {
      id: "brief",
      title: "Briefing consistente",
      text: "Informar nome, segmento e objetivo da página.",
      done: !!(
        site &&
        brief.name &&
        brief.segment &&
        brief.description &&
        !looksLikeSiteInstruction(brief.description)
      ),
    },
    {
      id: "content",
      title: "Conteúdo estruturado",
      text: "Definir título principal e pelo menos dois serviços.",
      done: !!(site && brief.headline && serviceCount >= 2),
    },
    {
      id: "identity",
      title: "Identidade personalizada",
      text: "Personalizar cor, chamada ou conteúdo do código.",
      done: !!(
        site &&
        (site.codeEdited ||
          (brief.color && brief.color !== "#0b9f8f") ||
          (brief.cta && brief.cta !== "Falar com a gente"))
      ),
    },
    {
      id: "responsive",
      title: "Revisão responsiva",
      text: "Conferir o resultado em desktop, tablet e celular.",
      done: ["desktop", "tablet", "mobile"].every((x) => reviewed.includes(x)),
    },
    {
      id: "published",
      title: "Publicação concluída",
      text: "Publicar no servidor e confirmar uma URL pública acessível.",
      done: !!(
        site?.published &&
        site?.serverPublished &&
        site?.publicUrl &&
        site?.publishedAt
      ),
    },
  ];
}

export function parseSiteJson(content) {
  const text = String(content || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("A resposta não trouxe alterações estruturadas.");
  return JSON.parse(match[0]);
}

function SiteVisualEditor({ brief, onChange }) {
  const gallery = brief.gallery || [];
  const testimonials = brief.testimonials || [];
  const patchList = (key, list) => onChange({ [key]: list });
  return (
    <div className="site-visual-editor">
      <Field label="Estilo visual">
        <div className="theme-picker">
          {SITE_THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={(brief.theme || "moderno") === item.id ? "active" : ""}
              style={{ background: item.swatch }}
              onClick={() => onChange({ theme: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="Formato do topo da página"
        hint="Dividido usa imagem de capa (ou um destaque decorativo se não houver). Impacto centraliza um título grande."
      >
        <div className="theme-picker hero-style-picker">
          {HERO_STYLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                (brief.heroStyle || "centrado") === item.id ? "active" : ""
              }
              onClick={() => onChange({ heroStyle: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="Imagem de capa (URL, opcional)"
        hint="Use um link https:// de uma imagem sua. Fica ao lado do título na página inicial."
      >
        <input
          value={brief.heroImage || ""}
          onChange={(e) => onChange({ heroImage: e.target.value })}
          placeholder="https://..."
        />
      </Field>
      <Field label="Galeria de fotos (opcional)">
        <div className="list-editor">
          {gallery.map((item, i) => (
            <div className="list-editor-row" key={i}>
              <input
                value={item.url}
                onChange={(e) =>
                  patchList(
                    "gallery",
                    gallery.map((g, x) => (x === i ? { ...g, url: e.target.value } : g)),
                  )
                }
                placeholder="URL da imagem (https://...)"
              />
              <input
                value={item.caption}
                onChange={(e) =>
                  patchList(
                    "gallery",
                    gallery.map((g, x) =>
                      x === i ? { ...g, caption: e.target.value } : g,
                    ),
                  )
                }
                placeholder="Legenda (opcional)"
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => patchList("gallery", gallery.filter((_, x) => x !== i))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            icon={Plus}
            onClick={() => patchList("gallery", [...gallery, { url: "", caption: "" }])}
          >
            Adicionar foto
          </Button>
        </div>
      </Field>
      <Field label="Depoimentos de clientes (opcional)">
        <div className="list-editor">
          {testimonials.map((item, i) => (
            <div className="list-editor-row testimonial-row" key={i}>
              <input
                value={item.name}
                onChange={(e) =>
                  patchList(
                    "testimonials",
                    testimonials.map((t, x) =>
                      x === i ? { ...t, name: e.target.value } : t,
                    ),
                  )
                }
                placeholder="Nome do cliente"
              />
              <input
                value={item.role}
                onChange={(e) =>
                  patchList(
                    "testimonials",
                    testimonials.map((t, x) =>
                      x === i ? { ...t, role: e.target.value } : t,
                    ),
                  )
                }
                placeholder="Cargo ou empresa (opcional)"
              />
              <textarea
                value={item.quote}
                onChange={(e) =>
                  patchList(
                    "testimonials",
                    testimonials.map((t, x) =>
                      x === i ? { ...t, quote: e.target.value } : t,
                    ),
                  )
                }
                placeholder="O que o cliente disse"
              />
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  patchList("testimonials", testimonials.filter((_, x) => x !== i))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            icon={Plus}
            onClick={() =>
              patchList("testimonials", [
                ...testimonials,
                { name: "", role: "", quote: "" },
              ])
            }
          >
            Adicionar depoimento
          </Button>
        </div>
      </Field>
    </div>
  );
}

function Sites({ db, update, business, setToast, go, AreaToolkit }) {
  const [modal, setModal] = useState(false),
    [preview, setPreview] = useState(null),
    [device, setDevice] = useState("desktop"),
    [editCode, setEditCode] = useState(false),
    [publishing, setPublishing] = useState(false),
    [siteError, setSiteError] = useState(""),
    [leads, setLeads] = useState([]),
    [loadingLeads, setLoadingLeads] = useState(false),
    [generating, setGenerating] = useState(false),
    [siteChatText, setSiteChatText] = useState(""),
    [siteChatBusy, setSiteChatBusy] = useState(false),
    [customizing, setCustomizing] = useState(false),
    [previewPage, setPreviewPage] = useState("");
  const [form, setForm] = useState({
    name: business?.name || "",
    segment: business?.segment || "",
    instructions: "",
    description: "",
    headline: "",
    services: business?.offer || "",
    cta: "Falar com a gente",
    contact: "#contato",
    color: "#0b9f8f",
    theme: "moderno",
    heroStyle: "centrado",
    heroImage: "",
    gallery: [],
    testimonials: [],
    faq: [],
    features: [],
    homeBlocks: [],
  });
  const sites = db.sites.filter(
    (x) => !business || x.businessId === business.id,
  );
  const generate = async (e) => {
    e.preventDefault();
    if (!form.instructions.trim() || generating) return;
    setGenerating(true);
    setSiteError("");
    let generatedBrief = { ...form };
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          specialist: "Criador de Sites",
          ...aiWorkspaceContext(business),
          prompt: `Transforme o briefing abaixo em conteúdo público de um site profissional e único, evitando um layout genérico igual para qualquer negócio. O briefing é uma instrução interna e NUNCA pode aparecer literalmente nos textos do site. Não invente clientes, números, depoimentos ou fatos. Responda SOMENTE com JSON válido, sem Markdown, usando os campos: headline, description (até 240 caracteres, texto para visitantes), aboutTitle, about, services (lista de objetos com title e description), cta, faq (lista de 3 a 5 objetos com question e answer, dúvidas genéricas sobre como funciona o atendimento, sem inventar preços, prazos ou números específicos), features (lista de 3 a 4 objetos com title e description, diferenciais genuínos com base no briefing, sem números inventados), heroStyle (escolha "centrado", "dividido" ou "impacto" conforme o tom do negócio: "impacto" para algo mais ousado/moderno, "dividido" para algo visual, "centrado" para algo clássico/confiável), homeBlocks (lista ordenada com a combinação que fizer mais sentido, usando somente os ids: "features", "gallery", "testimonials", "cta").\n\nNome: ${form.name}\nSegmento: ${form.segment}\nBriefing interno: ${form.instructions.slice(0, 4000)}\nServiços informados: ${String(form.services || "").slice(0, 1600)}\nTexto público informado: ${form.description.slice(0, 800)}`,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.content)
        generatedBrief = mergeSiteBrief(form, parseSiteJson(data.content));
    } catch {
      generatedBrief = mergeSiteBrief(form, {});
    }
    let slug = slugify(form.name || business?.name || "meu-site");
    let n = 2;
    while (db.sites.some((x) => x.slug === slug))
      slug = `${slugify(form.name)}-${n++}`;
    const pages = makeSitePages(generatedBrief, slug);
    const site = {
      id: uid(),
      name: form.name || "Novo site",
      slug,
      html: pages[0].html,
      pages,
      brief: generatedBrief,
      chat: [
        {
          id: uid(),
          role: "assistant",
          content:
            "Seu site foi criado com páginas de Início, Sobre, Serviços e Contato. Peça qualquer alteração por aqui.",
          createdAt: new Date().toISOString(),
        },
      ],
      published: false,
      businessId: business?.id || null,
      ownerId: db.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      leads: [],
      reviewedDevices: [],
      codeEdited: false,
      serverPublished: false,
      publicUrl: null,
      publishedAt: null,
    };
    update((d) => ({ ...d, sites: [site, ...d.sites] }));
    setModal(false);
    setPreview(site.id);
    setToast("Site completo criado e salvo");
    setGenerating(false);
  };
  const current = db.sites.find((x) => x.id === preview);
  const selectedSitePage = current?.pages?.find(
    (item) => item.slug === previewPage,
  );
  const previewHtml = selectedSitePage?.html || current?.html || "";
  useEffect(() => {
    const id = setTimeout(() => setPreviewPage(""), 0);
    return () => clearTimeout(id);
  }, [preview]);
  const ownerId = activeSpaceId() || db.user.id;
  const updateSite = useCallback(
    (id, patch) =>
      update((d) => ({
        ...d,
        sites: d.sites.map((x) =>
          x.id === id
            ? { ...x, ...patch, updatedAt: new Date().toISOString() }
            : x,
        ),
      })),
    [update],
  );
  const siteRequest = useCallback(async (action, body) => {
    const response = await fetch(`/api/sites/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ ...body, ownerId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || "Não foi possível concluir a publicação.");
    return data;
  }, [ownerId]);
  const updateBrief = (patch) => {
    if (!current) return;
    const brief = { ...(current.brief || {}), ...patch };
    const pages = makeSitePages(brief, current.slug);
    updateSite(current.id, {
      brief,
      pages,
      html: pages[0].html,
      serverPublished: false,
    });
  };
  const repairLegacySite = useCallback(async () => {
    if (!current) return;
    const oldBrief = current.brief || {};
    const brief = mergeSiteBrief(
      {
        ...oldBrief,
        instructions: oldBrief.instructions || oldBrief.description || "",
        description: siteFallbackDescription(oldBrief),
      },
      {},
    );
    const pages = makeSitePages(brief, current.slug);
    updateSite(current.id, {
      brief,
      pages,
      html: pages[0].html,
      serverPublished: false,
      chat: [
        ...(current.chat || []),
        {
          id: uid(),
          role: "assistant",
          content:
            "Separei o briefing interno do texto público e reconstruí as páginas sem exibir as instruções.",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    if (current.published && current.serverPublished) {
      setPublishing(true);
      try {
        const data = await siteRequest("publish", {
          id: current.id,
          slug: current.slug,
          name: current.name,
          description: brief.description,
          html: pages[0].html,
          pages,
        });
        updateSite(current.id, {
          published: true,
          serverPublished: true,
          publicUrl: data.url,
          publishedAt: data.publishedAt,
        });
        setToast("Conteúdo corrigido e publicação atualizada");
      } catch (error) {
        setSiteError(
          error.message || "Corrigimos o site, mas falta republicar.",
        );
        setToast("Conteúdo corrigido; revise e atualize a publicação");
      } finally {
        setPublishing(false);
      }
    } else {
      setToast("Briefing removido do conteúdo público");
    }
  }, [current, setToast, siteRequest, updateSite]);
  const requestSiteChange = async () => {
    const request = siteChatText.trim();
    if (!current || !request || siteChatBusy) return;
    const userMessage = {
      id: uid(),
      role: "user",
      content: request,
      createdAt: new Date().toISOString(),
    };
    setSiteChatText("");
    setSiteChatBusy(true);
    setSiteError("");
    updateSite(current.id, {
      chat: [...(current.chat || []), userMessage],
    });
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          specialist: "Criador de Sites",
          ...aiWorkspaceContext(business),
          prompt: `Você está editando um site existente por conversa. Altere APENAS o que o usuário pediu e preserve todo o resto. O pedido é uma instrução interna e nunca deve aparecer como texto do site. Não invente fatos. Você também pode reorganizar a estrutura da página inicial quando pedido (adicionar, remover ou reordenar seções). Responda SOMENTE com um objeto JSON contendo apenas os campos alterados entre: name, segment, headline, description, aboutTitle, about, services (lista de objetos com title e description), cta, contact, color, faq (lista de objetos com question e answer, sem inventar preços, prazos ou números específicos), features (lista de objetos com title e description, diferenciais sem números inventados), heroStyle ("centrado", "dividido" ou "impacto"), homeBlocks (lista ordenada usando somente os ids "features", "gallery", "testimonials", "cta" — inclua só o que deve aparecer na página inicial, na ordem pedida).\n\nSite atual:\n${JSON.stringify(current.brief || {}).slice(0, 10000)}\n\nAlteração pedida: ${request.slice(0, 3000)}`,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Não foi possível aplicar a alteração.");
      const patch = parseSiteJson(data.content);
      const brief = mergeSiteBrief(current.brief || {}, patch);
      const pages = makeSitePages(brief, current.slug);
      updateSite(current.id, {
        name: brief.name || current.name,
        brief,
        pages,
        html: pages[0].html,
        serverPublished: false,
        chat: [
          ...(current.chat || []),
          userMessage,
          {
            id: uid(),
            role: "assistant",
            content:
              "Alteração aplicada. Revise o resultado ao lado; você pode continuar pedindo ajustes.",
            createdAt: new Date().toISOString(),
          },
        ],
      });
      setToast("Alteração aplicada ao site");
    } catch (error) {
      setSiteError(error.message || "Não foi possível alterar o site agora.");
      updateSite(current.id, {
        chat: [
          ...(current.chat || []),
          userMessage,
          {
            id: uid(),
            role: "assistant",
            content:
              "Não consegui aplicar essa alteração agora. Tente descrever o texto, a seção ou a cor que deseja mudar.",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } finally {
      setSiteChatBusy(false);
    }
  };
  useEffect(() => {
    if (!current || !looksLikeSiteInstruction(current.brief?.description))
      return undefined;
    const id = setTimeout(() => {
      repairLegacySite();
    }, 0);
    return () => clearTimeout(id);
  }, [current, current?.id, repairLegacySite]);
  const download = (s) => {
    const blob = new Blob([s.html], { type: "text/html" }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${s.slug}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const publishSite = async () => {
    if (!current || publishing) return;
    setPublishing(true);
    setSiteError("");
    try {
      if (current.published && current.serverPublished) {
        await siteRequest("unpublish", { id: current.id });
        updateSite(current.id, {
          published: false,
          serverPublished: false,
          publicUrl: null,
          publishedAt: null,
        });
        setToast("Site despublicado");
      } else {
        const data = await siteRequest("publish", {
          id: current.id,
          slug: current.slug,
          name: current.name,
          description: current.brief?.description || "",
          html: current.html,
          pages: current.pages || [],
        });
        updateSite(current.id, {
          slug: data.slug,
          published: true,
          serverPublished: true,
          publicUrl: data.url,
          publishedAt: data.publishedAt,
        });
        setToast(
          current.published
            ? "Publicação atualizada"
            : "Site publicado de verdade",
        );
      }
    } catch (error) {
      setSiteError(error.message);
    } finally {
      setPublishing(false);
    }
  };
  const deleteSite = async (site) => {
    if (
      !confirm(
        `Excluir ${site.name}? Esta ação remove também a página pública e os leads recebidos.`,
      )
    )
      return;
    try {
      await siteRequest("delete", { id: site.id });
      update((d) => ({ ...d, sites: d.sites.filter((x) => x.id !== site.id) }));
      if (preview === site.id) setPreview(null);
      setToast("Site excluído");
    } catch (error) {
      setToast(error.message);
    }
  };

  useEffect(() => {
    if (!current?.published) {
      const id = setTimeout(() => setLeads([]), 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const id = setTimeout(() => {
      setLoadingLeads(true);
      fetch(`/api/sites/leads?site_id=${encodeURIComponent(current.id)}`, {
        headers: authHeaders(),
      })
        .then(async (response) => ({
          ok: response.ok,
          data: await response.json().catch(() => ({})),
        }))
        .then(({ ok, data }) => {
          if (cancelled) return;
          if (!ok)
            throw new Error(
              data.error || "Não foi possível carregar os contatos.",
            );
          setLeads(data.leads || []);
        })
        .catch((error) => {
          if (!cancelled) setSiteError(error.message);
        })
        .finally(() => {
          if (!cancelled) setLoadingLeads(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [current?.id, current?.published, current?.publishedAt]);
  if (current) {
    const progress = websiteMilestones(current);
    const completed = progress.filter((x) => x.done).length;
    return (
      <PageTitle
        eyebrow="EDITOR DE SITE"
        title={current.name}
        text={
          current.published && current.serverPublished
            ? `Publicado em ${current.publicUrl || `/s/${current.slug}`}`
            : current.published
              ? "Alterações pendentes de publicação"
              : "Rascunho privado"
        }
        action={
          <Button
            variant="ghost"
            icon={ChevronLeft}
            onClick={() => setPreview(null)}
          >
            Meus sites
          </Button>
        }
      >
        <div className="cert-progress-mini">
          <span className="cert-mini-icon">
            <Award />
          </span>
          <div>
            <strong>Trilha: Criação de Websites No-Code</strong>
            <small>
              {completed} de {progress.length} marcos concluídos para liberar o
              certificado
            </small>
          </div>
          <div className="meter">
            <span
              style={{ width: `${(completed / progress.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="site-toolbar">
          <div className="view-toggle">
            <button
              className={device === "desktop" ? "active" : ""}
              onClick={() => {
                setDevice("desktop");
                updateSite(current.id, {
                  reviewedDevices: [
                    ...new Set([...(current.reviewedDevices || []), "desktop"]),
                  ],
                });
              }}
            >
              <Monitor />
              Desktop
            </button>
            <button
              className={device === "tablet" ? "active" : ""}
              onClick={() => {
                setDevice("tablet");
                updateSite(current.id, {
                  reviewedDevices: [
                    ...new Set([...(current.reviewedDevices || []), "tablet"]),
                  ],
                });
              }}
            >
              <Tablet />
              Tablet
            </button>
            <button
              className={device === "mobile" ? "active" : ""}
              onClick={() => {
                setDevice("mobile");
                updateSite(current.id, {
                  reviewedDevices: [
                    ...new Set([...(current.reviewedDevices || []), "mobile"]),
                  ],
                });
              }}
            >
              <Smartphone />
              Celular
            </button>
          </div>
          <div>
            <Button
              variant="ghost"
              icon={Palette}
              onClick={() => setCustomizing(!customizing)}
            >
              {customizing ? "Fechar personalização" : "Personalizar visual"}
            </Button>
            <Button
              variant="ghost"
              icon={Edit3}
              onClick={() => setEditCode(!editCode)}
            >
              {editCode ? "Ver preview" : "Editar HTML"}
            </Button>
            <Button
              icon={current.published && current.serverPublished ? Eye : Globe2}
              disabled={publishing}
              onClick={publishSite}
            >
              {publishing
                ? "Publicando..."
                : current.published && current.serverPublished
                  ? "Despublicar"
                  : current.published
                    ? "Atualizar publicação"
                    : "Publicar"}
            </Button>
          </div>
        </div>
        {customizing && (
          <div className="site-customize-panel">
            <SiteVisualEditor brief={current.brief || {}} onChange={updateBrief} />
          </div>
        )}
        <div className="site-public-panel">
          <Field label="Endereço público">
            <div className="slug-editor">
              <span>{location.origin}/s/</span>
              <input
                value={current.slug}
                onChange={(event) => {
                  const nextSlug = slugify(event.target.value);
                  const oldPath = `/s/${current.slug}`;
                  const nextPath = `/s/${nextSlug}`;
                  updateSite(current.id, {
                    slug: nextSlug,
                    html: current.html.split(oldPath).join(nextPath),
                    pages: (current.pages || []).map((item) => ({
                      ...item,
                      html: item.html.split(oldPath).join(nextPath),
                    })),
                    serverPublished: false,
                  });
                }}
                aria-label="Endereço público do site"
              />
            </div>
          </Field>
          <SharingFields
            value={{
              visibility: current.visibility,
              sharedWith: current.sharedWith,
              sharedTeams: current.sharedTeams,
              project: current.project,
            }}
            onChange={(next) => updateSite(current.id, next)}
            teams={db.teams}
            projectOptions={[
              ...new Set([
                ...(db.projects || []).map((p) => p.name),
                ...(db.tasks || []).map((t) => t.project).filter(Boolean),
              ]),
            ]}
          />
          {current.published && current.serverPublished && (
            <div className="site-public-actions">
              <span className="publish-state live">
                <BadgeCheck /> Página pública confirmada
              </span>
              <a
                className="button secondary"
                href={current.publicUrl || `/s/${current.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={17} /> Abrir site
              </a>
              <Button
                variant="ghost"
                icon={Copy}
                onClick={() => {
                  navigator.clipboard?.writeText(
                    current.publicUrl || `${location.origin}/s/${current.slug}`,
                  );
                  setToast("Link público copiado");
                }}
              >
                Copiar link
              </Button>
              <a
                className="button secondary"
                href={`/loja/${current.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                <ShoppingBag size={17} /> Ver loja virtual (carrinho)
              </a>
              <Button
                variant="ghost"
                icon={Copy}
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `${location.origin}/loja/${current.slug}`,
                  );
                  setToast("Link da loja virtual copiado");
                }}
              >
                Copiar link da loja
              </Button>
            </div>
          )}
          {current.published && !current.serverPublished && (
            <span className="publish-state pending">
              <Clock3 /> Há mudanças locais. Clique em atualizar publicação.
            </span>
          )}
          {siteError && (
            <div className="ask-error">
              <CircleAlert /> {siteError}
            </div>
          )}
        </div>
        {looksLikeSiteInstruction(current.brief?.description) && (
          <div className="site-repair-notice">
            <CircleAlert />
            <span>
              Este projeto antigo parece exibir o briefing como texto público.
            </span>
            <Button
              variant="ghost"
              icon={WandSparkles}
              onClick={repairLegacySite}
            >
              Corrigir conteúdo
            </Button>
          </div>
        )}
        <div className="site-page-list" aria-label="Páginas do site">
          {(current.pages?.length
            ? current.pages
            : [
                { slug: "", name: "Início" },
                { slug: "sobre", name: "Sobre" },
                { slug: "servicos", name: "Serviços" },
                { slug: "contato", name: "Contato" },
              ]
          ).map((item) => (
            <button
              className={previewPage === item.slug ? "active" : ""}
              key={item.slug || "home"}
              onClick={() => setPreviewPage(item.slug)}
            >
              <FileText /> {item.name}
            </button>
          ))}
        </div>
        <div className="site-workspace">
          <aside className="site-chat">
            <header>
              <span className="site-chat-icon">
                <Sparkles />
              </span>
              <div>
                <strong>Editar por conversa</strong>
                <small>Peça alterações como faria com uma pessoa.</small>
              </div>
            </header>
            <div className="site-chat-messages">
              {(
                current.chat || [
                  {
                    id: "welcome",
                    role: "assistant",
                    content:
                      "Diga o que deseja mudar. Ex.: “deixe o título mais direto” ou “troque a cor para verde”.",
                  },
                ]
              ).map((message) => (
                <div className={message.role} key={message.id}>
                  {message.content}
                </div>
              ))}
              {siteChatBusy && (
                <div className="assistant">Aplicando alteração...</div>
              )}
            </div>
            <div className="site-chat-compose">
              <textarea
                value={siteChatText}
                onChange={(event) => setSiteChatText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    requestSiteChange();
                  }
                }}
                placeholder="Ex.: mude o título e deixe o texto mais acolhedor"
              />
              <button
                onClick={requestSiteChange}
                disabled={!siteChatText.trim() || siteChatBusy}
                aria-label="Enviar alteração do site"
              >
                <Send />
              </button>
            </div>
          </aside>
          {editCode ? (
            <div className="code-editor">
              <div>
                <span>HTML da página inicial</span>
                <small>Scripts inseridos são bloqueados no preview.</small>
              </div>
              <textarea
                value={previewHtml}
                onChange={(e) =>
                  updateSite(current.id, {
                    html: previewPage ? current.html : e.target.value,
                    pages: (current.pages || []).map((item) =>
                      item.slug === previewPage
                        ? { ...item, html: e.target.value }
                        : item,
                    ),
                    codeEdited: true,
                    serverPublished: false,
                  })
                }
              />
            </div>
          ) : (
            <div className={`site-preview ${device}`}>
              <iframe
                title={`Preview de ${current.name}`}
                sandbox="allow-forms allow-popups"
                srcDoc={previewHtml}
              />
            </div>
          )}
        </div>
        {current.published && current.serverPublished && (
          <section className="site-leads section">
            <div className="section-head">
              <div>
                <span className="eyebrow">CONTATOS RECEBIDOS</span>
                <h2>Leads deste site</h2>
                <p>Mensagens enviadas pelo formulário da página pública.</p>
              </div>
              <span className="lead-count">{leads.length}</span>
            </div>
            {loadingLeads ? (
              <p className="muted">Carregando contatos...</p>
            ) : leads.length === 0 ? (
              <div className="lead-empty">
                <Mail />
                <span>Nenhum contato recebido ainda.</span>
              </div>
            ) : (
              <div className="lead-list">
                {leads.map((lead) => (
                  <article key={lead.id}>
                    <div>
                      <strong>{lead.name}</strong>
                      <small>
                        {new Date(lead.createdAt).toLocaleString("pt-BR")}
                      </small>
                    </div>
                    <p>{lead.message || "Sem mensagem."}</p>
                    <footer>
                      <a href={`mailto:${lead.email}`}>
                        <Mail /> {lead.email}
                      </a>
                      {lead.phone && <span>{lead.phone}</span>}
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </PageTitle>
    );
  }
  return (
    <PageTitle
      eyebrow="SITES E MATERIAIS"
      title="Crie uma presença digital de verdade"
      text="Gere um site com várias páginas, edite por conversa, visualize em diferentes telas e publique."
      action={
        <Button icon={Plus} onClick={() => setModal(true)}>
          Criar site
        </Button>
      }
    >
      <AreaToolkit
        area="sites"
        db={db}
        update={update}
        business={business}
        setToast={setToast}
        go={go}
      />
      <div id="site-projects" />
      {sites.length === 0 ? (
        <Empty
          icon={Globe2}
          title="Nenhum site criado"
          text="Descreva seu negócio e gere um site responsivo com páginas de Início, Sobre, Serviços e Contato."
          action="Criar meu primeiro site"
          onAction={() => setModal(true)}
        />
      ) : (
        <div className="sites-grid">
          {sites.map((s) => (
            <article key={s.id}>
              <div className="site-thumb">
                <iframe title="Miniatura" sandbox="" srcDoc={s.html} />
                <span
                  className={
                    s.published && s.serverPublished
                      ? "live"
                      : s.published
                        ? "pending"
                        : ""
                  }
                >
                  {s.published && s.serverPublished
                    ? "Publicado"
                    : s.published
                      ? "Atualização pendente"
                      : "Rascunho"}
                </span>
              </div>
              <div>
                <h3>{s.name}</h3>
                <p>{s.publicUrl || `/s/${s.slug}`}</p>
                <small>
                  Atualizado {new Date(s.updatedAt).toLocaleString("pt-BR")}
                </small>
                <footer>
                  <button onClick={() => setPreview(s.id)}>
                    <Edit3 />
                    Editar
                  </button>
                  <button onClick={() => download(s)}>
                    <Download />
                    Baixar
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(s.html);
                      setToast("Código copiado");
                    }}
                  >
                    <Copy />
                    Código
                  </button>
                  <button className="danger" onClick={() => deleteSite(s)}>
                    <Trash2 />
                  </button>
                </footer>
              </div>
            </article>
          ))}
        </div>
      )}
      {modal && (
        <Modal title="Criar um site" wide onClose={() => setModal(false)}>
          <form className="modal-body" onSubmit={generate}>
            <Field
              label="Instruções para criar o site"
              hint="Este briefing orienta a criação e nunca será exibido aos visitantes."
            >
              <textarea
                required
                autoFocus
                value={form.instructions}
                onChange={(e) =>
                  setForm({ ...form, instructions: e.target.value })
                }
                placeholder="Ex.: Uma landing page para apresentar operações de frete com frota 100% elétrica e redução de CO₂..."
              />
            </Field>
            <Field
              label="Texto de apresentação ao visitante (opcional)"
              hint="Se ficar vazio, o assistente criará um texto público a partir do briefing."
            >
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Ex.: Logística sustentável que reduz o CO₂ da sua cadeia."
              />
            </Field>
            <div className="form-grid">
              <Field label="Nome do negócio">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Segmento">
                <input
                  value={form.segment}
                  onChange={(e) =>
                    setForm({ ...form, segment: e.target.value })
                  }
                />
              </Field>
              <Field label="Título principal">
                <input
                  value={form.headline}
                  onChange={(e) =>
                    setForm({ ...form, headline: e.target.value })
                  }
                  placeholder="Se vazio, usa o nome do negócio"
                />
              </Field>
              <Field label="Chamada do botão">
                <input
                  value={form.cta}
                  onChange={(e) => setForm({ ...form, cta: e.target.value })}
                />
              </Field>
              <Field label="Contato ou link">
                <input
                  value={form.contact}
                  onChange={(e) =>
                    setForm({ ...form, contact: e.target.value })
                  }
                  placeholder="https://wa.me/..."
                />
              </Field>
              <Field label="Cor principal">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Serviços (um por linha)">
              <textarea
                value={form.services}
                onChange={(e) => setForm({ ...form, services: e.target.value })}
              />
            </Field>
            <SiteVisualEditor
              brief={form}
              onChange={(patch) => setForm({ ...form, ...patch })}
            />
            <div className="notice">
              <ShieldCheck />
              <span>
                O texto é gerado pelo assistente a partir do briefing; fotos e
                depoimentos são sempre os que você enviar aqui, nunca inventados.
              </span>
            </div>
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={WandSparkles} disabled={generating}>
                {generating ? "Criando páginas..." : "Gerar site completo"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </PageTitle>
  );
}

export default Sites;
