// ===== Chaves VAPID das notificações do navegador (Web Push) =====
//
// Sem VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no cofre, `pushEnabled(env)` fica
// falso e nenhum push sai: resumo semanal, avisos de automação e pendências
// ficam só dentro do app. Este script gera um par novo no formato exato que a
// lib @block65/webcrypto-web-push espera — pública = ponto P-256 "raw" (65
// bytes) em base64url; privada = campo `d` do JWK.
//
// Uso, na máquina de quem administra o Worker:
//   node scripts/gerar-chaves-vapid.mjs
//   npx wrangler secret put VAPID_PUBLIC_KEY    (cola a pública)
//   npx wrangler secret put VAPID_PRIVATE_KEY   (cola a privada)
// Opcional: VAPID_SUBJECT (um mailto: de contato). Nunca cole a chave privada
// em código, commit, chat ou log. Trocar o par depois invalida as inscrições
// existentes: cada pessoa precisa ligar as notificações de novo.

/* global Buffer, process, console */
import { webcrypto } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function gerarChavesVapid(subtle = webcrypto.subtle) {
  const par = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publica = Buffer.from(await subtle.exportKey("raw", par.publicKey)).toString("base64url");
  const { d: privada } = await subtle.exportKey("jwk", par.privateKey);
  return { publicKey: publica, privateKey: privada };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { publicKey, privateKey } = await gerarChavesVapid();
  console.log("VAPID_PUBLIC_KEY  =", publicKey);
  console.log("VAPID_PRIVATE_KEY =", privateKey);
  console.log("\nCadastre os dois no cofre do Worker (não commite):");
  console.log("  npx wrangler secret put VAPID_PUBLIC_KEY");
  console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
}
