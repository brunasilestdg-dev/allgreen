import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, PackageCheck, Truck } from "lucide-react";
import "./TodoGreenPages.css";
import Modal from "../../../components/Modal.jsx";
import { comRotulo } from "../rotulosDomain.js";

// ===== Portal do Motorista =====
//
// A tela que o motorista abre NO CELULAR, na rua. Três gestos: cheguei,
// entreguei (com recebedor, foto e GPS — vira o POD que o faturamento exige)
// e ocorrência. Nada de gestão: quem gere frota usa /todogreen/motorista-frota.

const authHeaders = () => {
  try {
    const token = localStorage.getItem("seu-funcionario-auth-token") || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const pedir = async (caminho, options = {}) => {
  const resposta = await fetch(`/api/todogreen/driver-portal${caminho}`, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.error || "Não foi possível concluir.");
    // Só o 4xx é rejeição DEFINITIVA (viagem não é sua, dado faltando): repetir
    // não resolveria, então NÃO entra na fila offline. O 5xx é falha TRANSITÓRIA
    // do servidor (503 sem banco, 500 momentâneo) — tratado como falha de rede:
    // fica na fila e é retentado. Antes, qualquer não-2xx descartava a entrega.
    if (resposta.status >= 400 && resposta.status < 500) erro.rejeitadoPeloServidor = true;
    throw erro;
  }
  return dados;
};

// Chave única por registro, estável entre reenvios: é o id da linha na fila e
// vai no payload como idempotencyKey, para o servidor deduplicar um reenvio
// (resposta perdida depois do commit) em vez de duplicar evento/notificação.
const novaChave = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* segue para o fallback */
  }
  return `k-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
};

// Fila offline: na estrada o sinal cai. Quando o envio falha por REDE (fetch
// estoura antes de o servidor responder), o registro fica guardado no próprio
// celular e é reenviado sozinho — ao voltar o sinal, ao reabrir o app ou ao
// tocar em "Reenviar". Erro do servidor (400/404) não entra na fila: repetir
// não resolveria.
const CHAVE_FILA = "tdg-motorista-fila-eventos";

const lerFila = () => {
  try {
    const bruto = localStorage.getItem(CHAVE_FILA);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
};

const gravarFila = (lista) => {
  try {
    localStorage.setItem(CHAVE_FILA, JSON.stringify(lista));
  } catch {
    // Sem espaço/sem storage: melhor perder a persistência do que travar o app.
  }
};

// GPS é melhor esforço: sem permissão ou sem sinal, o evento sai sem
// coordenada — atrasar a entrega por causa do GPS seria inverter a prioridade.
const posicaoAtual = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60000 },
    );
  });

const ROTULO_SITUACAO = { active: "em andamento", em_andamento: "em andamento", concluida: "concluída" };

export default function DriverPortalPage() {
  const [sessao, setSessao] = useState(null);
  const [viagens, setViagens] = useState([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [formulario, setFormulario] = useState(null); // { viagem, tipo }
  const [dados, setDados] = useState({ recebedor: "", comprovanteUrl: "", descricao: "" });
  const [ocupado, setOcupado] = useState(false);
  const [pendentesFila, setPendentesFila] = useState(() => lerFila().length);
  // Trava de reentrância: mount + evento "online" + botão "Reenviar" poderiam
  // drenar a fila ao mesmo tempo e enviar cada evento mais de uma vez. Só um
  // dreno por vez.
  const escoandoRef = useRef(false);

  // Envia (ou reenvia) o que está na fila offline. Cada item que o servidor
  // aceita (ou rejeita em definitivo) sai da fila; o que falha por rede/5xx fica
  // para a próxima. Ao final, RELÊ a fila e remove só os ids processados — assim
  // um evento enfileirado DURANTE o dreno não é apagado por um snapshot velho.
  const escoarFila = useCallback(async () => {
    if (escoandoRef.current) return { enviados: 0 };
    let fila = lerFila();
    if (!fila.length) return { enviados: 0 };
    // Itens gravados pela versão anterior não têm id. Atribui um e persiste AGORA
    // (síncrono, antes de qualquer await, então nenhum enfileiramento se mistura),
    // para o dreno conseguir removê-los individualmente ao final pela mesma chave.
    if (fila.some((item) => !item.id)) {
      fila = fila.map((item) => (item.id ? item : { ...item, id: novaChave() }));
      gravarFila(fila);
    }
    escoandoRef.current = true;
    try {
      let enviados = 0;
      const processados = new Set();
      for (const item of fila) {
        try {
          await pedir(`/viagens/${item.viagemId}/evento`, { method: "POST", body: JSON.stringify(item.payload) });
          processados.add(item.id);
          enviados += 1;
        } catch (motivo) {
          // Rejeição definitiva do servidor (4xx): sai da fila (não vai passar
          // nunca). Falha de rede ou 5xx transitório: fica para tentar de novo.
          if (motivo.rejeitadoPeloServidor) processados.add(item.id);
        }
      }
      // Relê a fila atual (pode ter crescido durante os awaits) e tira só o que
      // foi processado — em vez de sobrescrever com o snapshot inicial.
      const atual = lerFila().filter((item) => !processados.has(item.id));
      gravarFila(atual);
      setPendentesFila(atual.length);
      return { enviados };
    } finally {
      escoandoRef.current = false;
    }
  }, []);

  const carregar = useCallback(async () => {
    try {
      const s = await pedir("/sessao");
      setSessao(s);
      if (s.vinculado) {
        const resultado = await escoarFila().catch(() => ({ enviados: 0 }));
        if (resultado.enviados > 0) setAviso(`${resultado.enviados} registro(s) guardado(s) foram enviados agora.`);
        setViagens((await pedir("/viagens")).viagens || []);
      }
      setErro("");
    } catch (motivo) {
      setErro(motivo.message);
    }
  }, [escoarFila]);
  useEffect(() => { carregar(); }, [carregar]);

  // Voltou o sinal: escoa a fila sem esperar o motorista reabrir o app.
  useEffect(() => {
    const aoVoltar = () => { escoarFila().then((r) => { if (r.enviados > 0) carregar(); }).catch(() => {}); };
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, [escoarFila, carregar]);

  const registrar = async (event) => {
    event.preventDefault();
    if (!formulario) return;
    setOcupado(true);
    const gps = await posicaoAtual();
    const chave = novaChave();
    const payload = {
      tipo: formulario.tipo,
      descricao: dados.descricao,
      recebedor: dados.recebedor,
      comprovanteUrl: dados.comprovanteUrl,
      local: gps ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}` : "",
      // Momento REAL do gesto: sem isto, um evento que espera horas na fila é
      // carimbado com a hora do sync (o servidor usa corpo.ocorridoEm quando vem).
      ocorridoEm: new Date().toISOString(),
      // Chave de idempotência estável entre reenvios (o servidor deduplica).
      idempotencyKey: chave,
      ...(gps || {}),
    };
    try {
      await pedir(`/viagens/${formulario.viagem.id}/evento`, { method: "POST", body: JSON.stringify(payload) });
      setAviso(formulario.tipo === "entrega" ? "Entrega registrada com comprovante. Boa estrada!" : "Registrado.");
      setFormulario(null);
      setDados({ recebedor: "", comprovanteUrl: "", descricao: "" });
      await carregar();
    } catch (motivo) {
      if (motivo.rejeitadoPeloServidor) {
        // O servidor recusou em definitivo (4xx): mostra o motivo, não enfileira.
        setAviso(motivo.message);
      } else {
        // Falha de rede ou 5xx transitório: guarda no celular e segue. O id da
        // linha é a própria chave de idempotência — mesmo reenvio, mesma chave.
        const fila = lerFila();
        fila.push({ id: chave, viagemId: formulario.viagem.id, referencia: formulario.viagem.referencia, tipo: formulario.tipo, payload, criadoEm: payload.ocorridoEm });
        gravarFila(fila);
        setPendentesFila(fila.length);
        setFormulario(null);
        setDados({ recebedor: "", comprovanteUrl: "", descricao: "" });
        setAviso("Sem sinal agora — registro guardado no celular. Envia sozinho quando a internet voltar.");
      }
    } finally {
      setOcupado(false);
    }
  };

  if (erro) {
    return <main className="tdg-driver-app"><div className="tdg-driver-cartao aviso"><AlertTriangle size={20} /><p>{erro}</p></div></main>;
  }
  if (!sessao) return <main className="tdg-driver-app"><div className="tdg-driver-cartao"><p>Carregando…</p></div></main>;
  if (!sessao.vinculado) {
    return <main className="tdg-driver-app"><div className="tdg-driver-cartao aviso"><AlertTriangle size={20} /><p>{sessao.aviso}</p></div></main>;
  }

  const pendentes = viagens.filter((viagem) => !viagem.entregueEm);
  const feitas = viagens.filter((viagem) => viagem.entregueEm);

  return (
    <main className="tdg-driver-app">
      <header className="tdg-driver-topo">
        <div>
          <span>TO DO GREEN · MOTORISTA</span>
          <h1>Olá, {String(sessao.motorista.nome || "").split(" ")[0]}</h1>
          <p>{pendentes.length ? `${pendentes.length} viagem(ns) com você` : "Nenhuma viagem pendente"}</p>
        </div>
        <Truck size={28} />
      </header>

      {sessao.motorista.cnhAlerta && (
        <div className="tdg-driver-cartao aviso"><AlertTriangle size={18} /><p>{sessao.motorista.cnhAlerta}</p></div>
      )}
      {aviso && (
        <div className="tdg-driver-cartao ok" role="status"><CheckCircle2 size={18} /><p>{aviso}</p><button type="button" onClick={() => setAviso("")} aria-label="Fechar aviso">×</button></div>
      )}
      {pendentesFila > 0 && (
        <div className="tdg-driver-cartao aviso" role="status">
          <AlertTriangle size={18} />
          <p>{pendentesFila} registro(s) aguardando sinal. Enviam sozinhos quando a internet voltar.</p>
          <button type="button" onClick={() => escoarFila().then((r) => { if (r.enviados > 0) carregar(); })} aria-label="Reenviar agora">Reenviar</button>
        </div>
      )}

      {pendentes.map((viagem) => (
        <article className="tdg-driver-cartao" key={viagem.id}>
          <div className="tdg-driver-rota">
            <strong>{viagem.referencia || "Viagem"}</strong>
            <span><MapPin size={14} /> {viagem.origem || "origem"} → {viagem.destino || "destino"}</span>
            <small>{viagem.dataServico || ""} · placa {viagem.placa || "—"} · {comRotulo(ROTULO_SITUACAO, viagem.situacao)}</small>
          </div>
          <div className="tdg-driver-acoes">
            <button type="button" onClick={() => { setFormulario({ viagem, tipo: "chegada" }); setAviso(""); }}>Cheguei</button>
            <button type="button" className="principal" onClick={() => { setFormulario({ viagem, tipo: "entrega" }); setAviso(""); }}><PackageCheck size={17} /> Entreguei</button>
            <button type="button" className="alerta" onClick={() => { setFormulario({ viagem, tipo: "ocorrencia" }); setAviso(""); }}>Ocorrência</button>
          </div>
        </article>
      ))}
      {!pendentes.length && <div className="tdg-driver-cartao"><p>Tudo entregue. 🎉</p></div>}

      {/* Confirmação em janela própria: o botão fica no card da viagem, mas o
          formulário nascia no fim da página — com várias viagens, fora da tela. */}
      {formulario && (
        <Modal
          title={formulario.tipo === "entrega" ? "Confirmar entrega" : formulario.tipo === "chegada" ? "Confirmar chegada" : "Registrar ocorrência"}
          onClose={() => setFormulario(null)}
        >
          <form className="tdg-driver-cartao tdg-driver-form tdg-form-em-modal" onSubmit={registrar}>
            <strong>{formulario.viagem.referencia || "Viagem"}</strong>
            {formulario.tipo === "entrega" && (
              <>
                <label><span>Quem recebeu</span><input required value={dados.recebedor} onChange={(e) => setDados((v) => ({ ...v, recebedor: e.target.value }))} placeholder="Nome de quem recebeu" /></label>
                <label><span>Foto do canhoto (link)</span><input value={dados.comprovanteUrl} onChange={(e) => setDados((v) => ({ ...v, comprovanteUrl: e.target.value }))} placeholder="Cole o link da foto (opcional)" /></label>
              </>
            )}
            {formulario.tipo === "ocorrencia" && (
              <label><span>O que aconteceu</span><input required value={dados.descricao} onChange={(e) => setDados((v) => ({ ...v, descricao: e.target.value }))} placeholder="Ex.: destinatário ausente" /></label>
            )}
            <small>Sua localização vai junto, se o celular permitir.</small>
            {/* Enquanto o modal está aberto, o aviso do topo fica escondido
                atrás do fundo — o erro precisa aparecer aqui dentro. */}
            {aviso && <div className="tdg-driver-cartao aviso" role="alert"><AlertTriangle size={18} /><p>{aviso}</p></div>}
            <div className="tdg-driver-acoes tdg-form-actions">
              <button type="button" onClick={() => setFormulario(null)}>Cancelar</button>
              <button type="submit" className="principal" disabled={ocupado}>{ocupado ? "Enviando…" : "Confirmar"}</button>
            </div>
          </form>
        </Modal>
      )}

      {feitas.length > 0 && (
        <details className="tdg-driver-historico">
          <summary>Entregues ({feitas.length})</summary>
          {feitas.map((viagem) => (
            <article className="tdg-driver-cartao" key={viagem.id}>
              <div className="tdg-driver-rota">
                <strong>{viagem.referencia}</strong>
                <small>entregue em {String(viagem.entregueEm).slice(0, 16).replace("T", " ")} {viagem.comprovanteRegistrado ? "· comprovante ok" : ""}</small>
              </div>
            </article>
          ))}
        </details>
      )}
    </main>
  );
}
