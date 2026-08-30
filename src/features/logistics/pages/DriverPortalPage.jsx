import { useCallback, useEffect, useState } from "react";
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
  if (!resposta.ok) throw new Error(dados.error || "Não foi possível concluir.");
  return dados;
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

  const carregar = useCallback(async () => {
    try {
      const s = await pedir("/sessao");
      setSessao(s);
      if (s.vinculado) setViagens((await pedir("/viagens")).viagens || []);
      setErro("");
    } catch (motivo) {
      setErro(motivo.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const registrar = async (event) => {
    event.preventDefault();
    if (!formulario) return;
    setOcupado(true);
    try {
      const gps = await posicaoAtual();
      await pedir(`/viagens/${formulario.viagem.id}/evento`, {
        method: "POST",
        body: JSON.stringify({
          tipo: formulario.tipo,
          descricao: dados.descricao,
          recebedor: dados.recebedor,
          comprovanteUrl: dados.comprovanteUrl,
          local: gps ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}` : "",
          ...(gps || {}),
        }),
      });
      setAviso(formulario.tipo === "entrega" ? "Entrega registrada com comprovante. Boa estrada!" : "Registrado.");
      setFormulario(null);
      setDados({ recebedor: "", comprovanteUrl: "", descricao: "" });
      await carregar();
    } catch (motivo) {
      setAviso(motivo.message);
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
