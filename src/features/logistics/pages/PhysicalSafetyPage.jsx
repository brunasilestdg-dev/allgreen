import { useMemo, useState } from "react";
import { KeyRound, ShieldCheck, Siren } from "lucide-react";
import {
  CONTEXTOS_PROIBIDOS,
  MOTIVOS_BLOQUEIO,
  LIMITE_PARADO_KMH,
  podeBloquearRemoto,
  registrarTentativaBloqueio,
  detectarCoacao,
  escalonamentoInexecucaoContato,
} from "../physicalSafetyDomain.js";
import "./TodoGreenPages.css";

// Segurança operacional — a página que existe pra IMPEDIR o clique errado.
// Toda decisão passa por podeBloquearRemoto (contexto + velocidade + dupla
// autorização); a coação tem senha própria; a inexecução de contato escala
// automaticamente. Nada aqui é atalho — o objetivo é não matar gente.

const PAPEIS = ["operacao-lider", "seguranca-24x7", "gerente-frota"];

export default function PhysicalSafetyPage() {
  const [ctx, setCtx] = useState({
    contexto: "estacionamento",
    velocidadeKmh: 0,
    velocidadeConfiavel: true,
    motivo: "roubo-confirmado",
  });
  const [autorizacoes, setAutorizacoes] = useState([{ autorId: "", papel: "operacao-lider" }, { autorId: "", papel: "seguranca-24x7" }]);
  const [log, setLog] = useState([]);

  const [senhas, setSenhas] = useState({ normal: "1234", coacao: "9999", digitada: "" });
  // useState com inicializador função — Date.now() só roda uma vez, o
  // compilador React exige purity durante o render.
  const [contato] = useState(() => {
    const now = Date.now();
    return { ultimaRespostaMs: now - 8 * 60000, agoraMs: now };
  });

  const decisao = useMemo(
    () => podeBloquearRemoto({ ...ctx, autorizacoes }),
    [ctx, autorizacoes],
  );
  const coacao = useMemo(
    () => detectarCoacao({ digitada: senhas.digitada, senhaNormalHash: senhas.normal, senhaCoacaoHash: senhas.coacao }),
    [senhas],
  );
  const escala = useMemo(
    () => escalonamentoInexecucaoContato({ ultimaRespostaMs: contato.ultimaRespostaMs, agoraMs: contato.agoraMs }),
    [contato],
  );

  const bloquear = () => {
    setLog((cur) => registrarTentativaBloqueio(cur, decisao, { veiculoId: "VE-047", autorizacoes }));
  };

  const atualizarAutorizador = (idx, campo, valor) => {
    setAutorizacoes((cur) => cur.map((a, i) => (i === idx ? { ...a, [campo]: valor } : a)));
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>TORRE · SEGURANÇA FÍSICA</span>
          <h2>Bloqueio remoto, senha de coação, escalonamento</h2>
          <p>Bloqueio remoto é PERMITIDO apenas com o veículo praticamente parado ({LIMITE_PARADO_KMH} km/h), fora de contexto proibido, com dupla autorização humana, e por motivo listado. O objetivo é que nenhum clique errado mate alguém.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><ShieldCheck size={20} /></span><div><strong>Decisão de bloqueio</strong><small>{decisao.permitido ? "PERMITIDO" : `RECUSADO · ${decisao.motivo}`}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Contexto</span>
            <select value={ctx.contexto} onChange={(e) => setCtx({ ...ctx, contexto: e.target.value })}>
              <option value="estacionamento">estacionamento</option>
              <option value="posto">posto/parada segura</option>
              <option value="base-operacional">base operacional</option>
              {CONTEXTOS_PROIBIDOS.map((c) => <option key={c} value={c}>{c} (proibido)</option>)}
            </select>
          </label>
          <label><span>Velocidade (km/h)</span><input type="number" min="0" step="0.1" value={ctx.velocidadeKmh} onChange={(e) => setCtx({ ...ctx, velocidadeKmh: Number(e.target.value) || 0 })} /></label>
          <label><span>Leitura confiável?</span>
            <select value={ctx.velocidadeConfiavel ? "sim" : "nao"} onChange={(e) => setCtx({ ...ctx, velocidadeConfiavel: e.target.value === "sim" })}>
              <option value="sim">sim</option>
              <option value="nao">não (fix GPS fraco)</option>
            </select>
          </label>
          <label><span>Motivo</span>
            <select value={ctx.motivo} onChange={(e) => setCtx({ ...ctx, motivo: e.target.value })}>
              {MOTIVOS_BLOQUEIO.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <div className="tdg-recarga-form">
          {autorizacoes.map((a, i) => (
            <div key={i} style={{ display: "contents" }}>
              <label><span>Autorizador {i + 1} — id</span><input value={a.autorId} onChange={(e) => atualizarAutorizador(i, "autorId", e.target.value)} placeholder="usuário" /></label>
              <label><span>Autorizador {i + 1} — papel</span>
                <select value={a.papel} onChange={(e) => atualizarAutorizador(i, "papel", e.target.value)}>
                  {PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>
        <div className="tdg-recarga-form-actions">
          <button className="tdg-action" type="button" onClick={bloquear} disabled={!decisao.permitido}>Registrar bloqueio</button>
        </div>
        <p className="tdg-driver-nota">
          Barreiras: contexto <strong>{ctx.contexto}</strong> {CONTEXTOS_PROIBIDOS.includes(ctx.contexto) ? "(PROIBIDO)" : "(ok)"} · velocidade <strong>{ctx.velocidadeKmh} km/h</strong> {ctx.velocidadeKmh > LIMITE_PARADO_KMH ? "(veículo em movimento — recusa)" : ""} · autorizadores <strong>{autorizacoes.filter((a) => a.autorId && PAPEIS.includes(a.papel)).length}</strong> de 2 exigidos.
        </p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><KeyRound size={20} /></span><div><strong>Senha de coação</strong><small>{coacao.autenticou ? (coacao.coacao ? "AUTENTICOU (silêncio) + alerta discreto" : "autenticou normal") : "senha errada"}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Senha normal (demo)</span><input value={senhas.normal} onChange={(e) => setSenhas({ ...senhas, normal: e.target.value })} /></label>
          <label><span>Senha de coação (demo)</span><input value={senhas.coacao} onChange={(e) => setSenhas({ ...senhas, coacao: e.target.value })} /></label>
          <label><span>Motorista digitou</span><input value={senhas.digitada} onChange={(e) => setSenhas({ ...senhas, digitada: e.target.value })} placeholder="qualquer valor" /></label>
        </div>
        <p className="tdg-driver-nota">Se o motorista digitar a senha de coação, o app FINGE autenticar normalmente (para o assaltante não notar) e dispara um alerta silencioso para a torre. Aqui a demo compara texto puro — em produção, ambas viram HASH no cadastro.</p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Siren size={20} /></span><div><strong>Motorista não responde</strong><small>nível de escalonamento: {escala.nivel}</small></div></div>
        <p className="tdg-driver-nota">Sem resposta há {Math.round(escala.decorridoMin)} minutos. Padrão: 5 min = supervisor; 15 min = central de segurança. Ajuste no domínio (não na tela) se o cliente pedir tempos diferentes.</p>
      </article>

      {log.length > 0 && (
        <article className="tdg-panel">
          <div className="tdg-work-area-heading"><span><ShieldCheck size={20} /></span><div><strong>Auditoria de bloqueio</strong><small>{log.length} tentativa(s)</small></div></div>
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Quando</th><th>Permitido?</th><th>Motivo</th><th>Autorizadores</th></tr></thead>
              <tbody>
                {log.slice().reverse().map((linha) => (
                  <tr key={linha.id}>
                    <td>{new Date(linha.quando).toLocaleString("pt-BR")}</td>
                    <td>{linha.permitido ? "sim" : "não"}</td>
                    <td>{linha.motivoNegacao || "—"}</td>
                    <td>{linha.autorizacoes.map((a) => `${a.autorId || "?"} (${a.papel})`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </div>
  );
}
