import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Award, BatteryCharging, Camera, CheckCircle2, ClipboardCheck, Clock, CreditCard, Home, MapPin, Navigation, PackageCheck, Play, Route, Square, Truck, User } from "lucide-react";
import "./TodoGreenPages.css";
import Modal from "../../../components/Modal.jsx";
import { comRotulo } from "../rotulosDomain.js";
import { ROTULO_STATUS_ROTA, linkNavegacao, progressoDaRota, resumoDaRota } from "../routePlanDomain.js";
import { avaliarChecklist, GRUPOS_CHECKLIST, ITENS_CHECKLIST } from "../driverChecklistDomain.js";
import { formatarDuracao, resumoDaJornada } from "../driverJourneyDomain.js";
import { calcularScoreMotorista, ROTULO_FAIXA } from "../driverScoreDomain.js";
import { resumoDeProdutividade } from "../driverProductivityDomain.js";
import PadAssinatura from "../PadAssinatura.jsx";
import { dimensoesReduzidas, LADO_MAXIMO_PADRAO } from "../podCaptura.js";

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

// Devolve se REALMENTE gravou. Com foto+assinatura na fila, o limite do
// localStorage (~5 MB) fica perto — e engolir o QuotaExceededError em silêncio
// faria o app dizer "guardado" enquanto a entrega se perde. Quem enfileira
// precisa saber que não coube.
const gravarFila = (lista) => {
  try {
    localStorage.setItem(CHAVE_FILA, JSON.stringify(lista));
    return true;
  } catch {
    return false;
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

// Reduz a foto do canhoto ANTES de enviar: a câmera do celular gera arquivos de
// vários MB, que não caberiam na fila offline (localStorage) nem valeria a pena
// trafegar na estrada. Desenha num canvas no tamanho reduzido e devolve um JPEG
// data URL pequeno. Falha (imagem ilegível) rejeita — o motorista tenta de novo.
const reduzirImagem = (file, maxLado = LADO_MAXIMO_PADRAO, qualidade = 0.6) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { largura, altura } = dimensoesReduzidas(img.naturalWidth, img.naturalHeight, maxLado);
      if (!largura || !altura) return reject(new Error("Não consegui ler a imagem."));
      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, largura, altura);
      resolve(canvas.toDataURL("image/jpeg", qualidade));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui ler a imagem.")); };
    img.src = url;
  });

const ROTULO_SITUACAO = { active: "em andamento", em_andamento: "em andamento", concluida: "concluída" };

export default function DriverPortalPage() {
  const [sessao, setSessao] = useState(null);
  const [viagens, setViagens] = useState([]);
  const [rotas, setRotas] = useState([]);
  // Falha ao buscar as rotas (rede/servidor) é diferente de "não tem rota": sem
  // esta marca, um erro virava a mesma tela de "Nenhuma rota atribuída" e o
  // motorista não sabia se devia esperar ou tentar de novo.
  const [rotasErro, setRotasErro] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [formulario, setFormulario] = useState(null); // { viagem, tipo }
  const [dados, setDados] = useState({ recebedor: "", comprovanteUrl: "", descricao: "", fotoBase64: "", assinaturaBase64: "" });
  const [ocupado, setOcupado] = useState(false);
  const [capturandoFoto, setCapturandoFoto] = useState(false);
  const fotoInputRef = useRef(null);
  const [pendentesFila, setPendentesFila] = useState(() => lerFila().length);
  // Seção ativa do app: deixou de ser uma tela só (queixa da titular: "não tem
  // menu, não tem nada"). Hoje = viagens do dia; Entregas = histórico com POD;
  // Perfil = motorista, CNH e a fila offline.
  const [secao, setSecao] = useState("hoje");
  // CNH subida pelo próprio motorista (fica disponível à operação).
  const [enviandoCnh, setEnviandoCnh] = useState(false);
  const cnhInputRef = useRef(null);
  // Foto de perfil DO MOTORISTA: é dele, ele escolhe (pedido da titular — "as
  // pessoas escolhem, são delas"). Mora na conta (users.avatar_url) e é gravada
  // pelo mesmo endpoint do perfil do app, com a mesma sessão. Distinta da foto
  // do canhoto (POD) e da CNH — esta é a cara da pessoa.
  const [perfil, setPerfil] = useState(null); // { name, avatarUrl }
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [checklists, setChecklists] = useState([]);
  const [respostasVistoria, setRespostasVistoria] = useState({});
  const [obsVistoria, setObsVistoria] = useState("");
  const [enviandoVistoria, setEnviandoVistoria] = useState(false);
  const [turnos, setTurnos] = useState([]);
  const [turnoOcupado, setTurnoOcupado] = useState(false);
  const avatarInputRef = useRef(null);
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
        // A rota não pode derrubar o app se falhar (o /viagens acima é o que
        // decide se a sessão está de pé); mas a falha precisa ser visível, não
        // virar uma lista vazia silenciosa. Mantém a última rota conhecida.
        try {
          setRotas((await pedir("/rotas")).rotas || []);
          setRotasErro(false);
        } catch {
          setRotasErro(true);
        }
        // A vistoria não pode derrubar o app se falhar: mantém a lista conhecida.
        try {
          setChecklists((await pedir("/checklist")).checklists || []);
        } catch { /* segue com a lista anterior */ }
        try {
          setTurnos((await pedir("/jornada")).turnos || []);
        } catch { /* segue com os turnos anteriores */ }
      }
      setErro("");
    } catch (motivo) {
      setErro(motivo.message);
    }
  }, [escoarFila]);
  useEffect(() => { carregar(); }, [carregar]);

  // A conta (nome + foto escolhida) vem do mesmo endpoint de sessão do app —
  // com a MESMA sessão do motorista. Só leitura; se falhar, o perfil segue com
  // o placeholder e o resto do portal não quebra.
  const carregarPerfil = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/session", { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json().catch(() => ({}));
      if (d?.user) setPerfil({ name: d.user.name || "", avatarUrl: d.user.avatarUrl || "" });
    } catch { /* offline: mantém o placeholder */ }
  }, []);
  useEffect(() => { carregarPerfil(); }, [carregarPerfil]);

  const enviarFotoPerfil = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    setEnviandoFoto(true);
    try {
      const avatarUrl = await reduzirImagem(arquivo, 320, 0.72);
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ avatarUrl }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Não consegui salvar sua foto agora.");
      setPerfil((p) => ({ ...(p || {}), avatarUrl: d.user?.avatarUrl || avatarUrl }));
      setAviso("Foto de perfil atualizada.");
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui salvar sua foto agora.");
    } finally {
      setEnviandoFoto(false);
    }
  };

  const removerFotoPerfil = async () => {
    setEnviandoFoto(true);
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ avatarUrl: "" }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Não consegui remover a foto."); }
      setPerfil((p) => ({ ...(p || {}), avatarUrl: "" }));
      setAviso("Foto removida.");
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui remover a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  };

  // Voltou o sinal: escoa a fila sem esperar o motorista reabrir o app.
  useEffect(() => {
    const aoVoltar = () => { escoarFila().then((r) => { if (r.enviados > 0) carregar(); }).catch(() => {}); };
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, [escoarFila, carregar]);

  // Marca/desmarca uma parada da rota como concluída. O servidor recalcula o
  // status da rota (planejada → em rota → concluída) e devolve a rota nova.
  const marcarParada = async (rotaId, indice, concluida) => {
    try {
      const resposta = await pedir(`/rotas/${rotaId}/parada`, {
        method: "POST",
        body: JSON.stringify({ indice, concluida }),
      });
      setRotas((atuais) => atuais.map((rota) => (rota.id === rotaId ? resposta.rota : rota)));
    } catch (motivo) {
      // Uma falha de rede ao marcar UMA parada não pode derrubar o app inteiro
      // (o `erro` fatal troca a tela toda e joga o motorista pra fora no meio do
      // turno). É um aviso dispensável: a marcação não foi; ele tenta de novo.
      setAviso(motivo.message || "Não consegui atualizar a parada agora. Tente de novo.");
    }
  };

  const aoEscolherFoto = async (event) => {
    const file = event.target.files?.[0];
    // Limpa o input para o mesmo arquivo poder ser escolhido de novo depois.
    event.target.value = "";
    if (!file) return;
    setCapturandoFoto(true);
    try {
      const base64 = await reduzirImagem(file);
      setDados((v) => ({ ...v, fotoBase64: base64 }));
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui usar essa foto. Tente de novo.");
    } finally {
      setCapturandoFoto(false);
    }
  };

  // CNH: o motorista tira a foto (reduzida, um pouco maior que o canhoto para o
  // texto ficar legível) e/ou confirma a validade. Vai direto ao servidor —
  // documento não entra na fila offline de entregas.
  const enviarCnhFoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setEnviandoCnh(true);
    try {
      const base64 = await reduzirImagem(file, 1600, 0.72);
      await pedir("/cnh", { method: "POST", body: JSON.stringify({ imagemBase64: base64 }) });
      setAviso("CNH enviada. A operação já pode ver.");
      await carregar();
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui enviar a CNH agora.");
    } finally {
      setEnviandoCnh(false);
    }
  };
  const salvarValidadeCnh = async (valor) => {
    if (!valor) return;
    try {
      await pedir("/cnh", { method: "POST", body: JSON.stringify({ validade: valor }) });
      setAviso("Validade da CNH atualizada.");
      await carregar();
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui salvar a validade.");
    }
  };

  // Vistoria de pré-viagem: o motorista responde item a item e registra. Vai
  // direto ao servidor (é no depósito, com sinal), que RE-AVALIA o status.
  const enviarVistoria = async () => {
    setEnviandoVistoria(true);
    try {
      await pedir("/checklist", {
        method: "POST",
        body: JSON.stringify({ respostas: respostasVistoria, observacao: obsVistoria }),
      });
      setAviso("Vistoria registrada. Boa estrada!");
      setRespostasVistoria({});
      setObsVistoria("");
      await carregar();
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui registrar a vistoria agora.");
    } finally {
      setEnviandoVistoria(false);
    }
  };

  // Jornada: iniciar/encerrar turno. A posição vai junto, se o celular deixar.
  const acaoTurno = async (acao, mensagem) => {
    setTurnoOcupado(true);
    try {
      const gps = await posicaoAtual();
      const local = gps ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}` : "";
      const { turnos: novos } = await pedir(`/jornada/${acao}`, { method: "POST", body: JSON.stringify({ local }) });
      setTurnos(novos || []);
      setAviso(mensagem);
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui registrar o turno agora.");
    } finally {
      setTurnoOcupado(false);
    }
  };

  const zerarFormulario = () =>
    setDados({ recebedor: "", comprovanteUrl: "", descricao: "", fotoBase64: "", assinaturaBase64: "" });

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
      // Foto do canhoto e assinatura como imagem reduzida (data URL): o servidor
      // guarda no cofre e devolve a URL do comprovante. Vão só quando existem —
      // e viajam na fila offline como o resto do registro.
      ...(dados.fotoBase64 ? { comprovanteBase64: dados.fotoBase64 } : {}),
      ...(dados.assinaturaBase64 ? { assinaturaBase64: dados.assinaturaBase64 } : {}),
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
      zerarFormulario();
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
        if (gravarFila(fila)) {
          setPendentesFila(lerFila().length);
          setFormulario(null);
          zerarFormulario();
          setAviso("Sem sinal agora — registro guardado no celular (com foto e assinatura). Envia sozinho quando a internet voltar.");
        } else {
          // Não coube no celular (fila cheia de fotos): NÃO diz que guardou.
          // Mantém o formulário aberto para o motorista tentar de novo ou
          // remover a foto (que é o que mais ocupa espaço).
          setAviso("Sem sinal e a memória do celular está cheia — esta entrega não foi guardada. Tente em área com sinal, ou remova a foto para ocupar menos espaço.");
        }
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
  const hojeISO = new Date().toISOString().slice(0, 10);
  const entreguesHoje = feitas.filter((v) => String(v.entregueEm).slice(0, 10) === hojeISO).length;
  const ocorrenciasTotal = viagens.reduce((soma, v) => soma + (Number(v.ocorrencias) || 0), 0);
  const primeiroNome = String(sessao.motorista.nome || "").split(" ")[0];

  const rotasAtivas = rotas.filter((rota) => rota.status !== "concluida");
  const agoraISO = new Date().toISOString();
  const jornada = resumoDaJornada(turnos, agoraISO);
  const score = calcularScoreMotorista(viagens);
  const produtividade = resumoDeProdutividade(viagens, { minutosHoje: jornada.minutosHoje, agora: agoraISO });
  const vistoriaHoje = checklists.find((c) => String(c.dataServico).slice(0, 10) === hojeISO) || null;
  const vistoriaParcial = avaliarChecklist(respostasVistoria);
  const abas = [
    { id: "hoje", rotulo: "Hoje", icone: Home },
    { id: "rota", rotulo: "Rota", icone: Route },
    { id: "vistoria", rotulo: "Vistoria", icone: ClipboardCheck },
    { id: "entregas", rotulo: "Entregas", icone: PackageCheck },
    { id: "perfil", rotulo: "Perfil", icone: User },
  ];
  const SELO_VISTORIA = { aprovado: "Aprovada", ressalva: "Aprovada com ressalva", reprovado: "Reprovada" };

  return (
    <main className="tdg-driver-app">
      <header className="tdg-driver-topo">
        <div>
          <span>TO DO GREEN · MOTORISTA</span>
          <h1>Olá, {primeiroNome}</h1>
          <p>{pendentes.length ? `${pendentes.length} viagem(ns) com você` : "Nenhuma viagem pendente"}</p>
        </div>
        <Truck size={28} />
      </header>

      {/* Avisos importantes acompanham o motorista em qualquer aba. */}
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

      {/* ===== HOJE: resumo da jornada + viagens pendentes com ação ===== */}
      {secao === "hoje" && (
        <>
          {/* Turno: iniciar/encerrar. As horas do dia saem da diferença. */}
          <article className={`tdg-driver-cartao tdg-turno ${jornada.emTurno ? "aberto" : ""}`}>
            <div className="tdg-turno-info">
              <Clock size={18} />
              {jornada.emTurno
                ? <span><strong>Em turno</strong><small>há {formatarDuracao(jornada.turnoAtual.minutosDecorridos)} · hoje {formatarDuracao(jornada.minutosHoje)}</small></span>
                : <span><strong>Fora de turno</strong><small>{jornada.minutosHoje > 0 ? `hoje você já rodou ${formatarDuracao(jornada.minutosHoje)}` : "inicie o turno para começar o dia"}</small></span>}
            </div>
            {jornada.emTurno
              ? <button type="button" className="tdg-turno-btn encerrar" disabled={turnoOcupado} onClick={() => acaoTurno("fim", "Turno encerrado. Bom descanso!")}><Square size={16} /> Encerrar turno</button>
              : <button type="button" className="tdg-turno-btn iniciar" disabled={turnoOcupado} onClick={() => acaoTurno("inicio", "Turno iniciado. Boa jornada!")}><Play size={16} /> Iniciar turno</button>}
          </article>

          <div className="tdg-driver-jornada">
            <article><strong>{pendentes.length}</strong><span>a fazer</span></article>
            <article className="ok"><strong>{entreguesHoje}</strong><span>hoje</span></article>
            <article className={ocorrenciasTotal ? "alerta" : ""}><strong>{ocorrenciasTotal}</strong><span>ocorrências</span></article>
          </div>

          {/* Produtividade: cruza a jornada (horas) com as entregas. */}
          <article className="tdg-driver-cartao tdg-prod">
            <div className="tdg-driver-info-linha"><Award size={16} /><span>Meu dia</span></div>
            <div className="tdg-prod-grid">
              <div><strong>{produtividade.entregasHoje}</strong><small>entregas</small></div>
              <div><strong>{produtividade.kmHoje}</strong><small>km</small></div>
              <div><strong>{produtividade.horasHoje > 0 ? formatarDuracao(jornada.minutosHoje) : "—"}</strong><small>na estrada</small></div>
              <div><strong>{produtividade.entregasPorHora != null ? produtividade.entregasPorHora : "—"}</strong><small>por hora</small></div>
            </div>
            <small className="tdg-driver-rodape-nota">
              {produtividade.entregasPorHora != null
                ? `Na semana: ${produtividade.entregasSemana} entregas · ${produtividade.kmSemana} km.`
                : `Na semana: ${produtividade.entregasSemana} entregas · ${produtividade.kmSemana} km. Inicie o turno para ver entregas por hora.`}
            </small>
          </article>

          {pendentes.map((viagem) => (
            <article className="tdg-driver-cartao" key={viagem.id}>
              <div className="tdg-driver-rota">
                <strong>{viagem.referencia || "Viagem"}</strong>
                <span><MapPin size={14} /> {viagem.origem || "origem"} → {viagem.destino || "destino"}</span>
                <small>{viagem.dataServico || ""} · placa {viagem.placa || "—"} · {comRotulo(ROTULO_SITUACAO, viagem.situacao)}</small>
              </div>
              <div className="tdg-driver-acoes">
                <button type="button" onClick={() => { setFormulario({ viagem, tipo: "coleta" }); setAviso(""); }}>Coletei</button>
                <button type="button" onClick={() => { setFormulario({ viagem, tipo: "chegada" }); setAviso(""); }}>Cheguei</button>
                <button type="button" className="principal" onClick={() => { setFormulario({ viagem, tipo: "entrega" }); setAviso(""); }}><PackageCheck size={17} /> Entreguei</button>
                <button type="button" className="alerta" onClick={() => { setFormulario({ viagem, tipo: "ocorrencia" }); setAviso(""); }}>Ocorrência</button>
              </div>
            </article>
          ))}
          {!pendentes.length && <div className="tdg-driver-cartao tdg-driver-vazio"><PackageCheck size={30} /><p>Tudo entregue. 🎉</p><small>Nada pendente com você agora.</small></div>}
        </>
      )}

      {/* ===== ROTA: a rota do dia atribuída pela operação (#139) ===== */}
      {secao === "rota" && (
        <>
          <div className="tdg-driver-secao-titulo"><Route size={18} /><h2>Minha rota</h2></div>
          {rotasAtivas.length === 0 && rotasErro && (
            <div className="tdg-driver-cartao tdg-driver-vazio"><AlertTriangle size={30} /><p>Não consegui carregar suas rotas agora.</p><small>Pode ser o sinal. Puxe para atualizar ou tente de novo em instantes — nada foi perdido.</small></div>
          )}
          {rotasAtivas.length === 0 && !rotasErro && (
            <div className="tdg-driver-cartao tdg-driver-vazio"><Route size={30} /><p>Nenhuma rota atribuída.</p><small>Quando a operação montar e atribuir uma rota para você, ela aparece aqui em ordem.</small></div>
          )}
          {rotasAtivas.map((rota) => {
            const resumo = resumoDaRota(rota.paradas);
            const progresso = progressoDaRota(rota.paradas);
            return (
              <article className="tdg-driver-cartao tdg-driver-rota-card" key={rota.id}>
                <div className="tdg-driver-rota-cabecalho">
                  <strong>{rota.nome || "Rota do dia"}</strong>
                  <span className={`tdg-driver-rota-status status-${rota.status || "planejada"}`}>{ROTULO_STATUS_ROTA[rota.status] || "Planejada"}</span>
                </div>
                <small className="tdg-driver-rota-meta">
                  {rota.dataServico ? `${rota.dataServico} · ` : ""}
                  {resumo.concluidas}/{resumo.total} paradas · {progresso}%
                  {rota.distanciaKm ? ` · ${rota.distanciaKm} km` : ""}
                  {rota.placa ? ` · ${rota.placa}` : ""}
                </small>
                <div className="tdg-driver-rota-progresso" aria-hidden="true"><span style={{ width: `${progresso}%` }} /></div>
                <ol className="tdg-driver-rota-paradas">
                  {(rota.paradas || []).map((parada, indice) => {
                    const link = linkNavegacao(parada);
                    const vinculada = Boolean(parada.operationId && ["coleta", "entrega"].includes(parada.tipo));
                    const viagemVinculada = vinculada ? viagens.find((viagem) => viagem.id === parada.operationId) : null;
                    const aoMarcar = (event) => {
                      if (!vinculada) {
                        marcarParada(rota.id, indice, event.target.checked);
                        return;
                      }
                      if (parada.concluida) return;
                      if (!viagemVinculada) {
                        setAviso("A viagem vinculada não está disponível. Atualize o app antes de continuar.");
                        return;
                      }
                      setAviso("");
                      setFormulario({ viagem: viagemVinculada, tipo: parada.tipo });
                    };
                    return (
                      <li key={indice} className={parada.concluida ? "concluida" : ""}>
                        <label className="tdg-driver-rota-check">
                          <input
                            type="checkbox"
                            checked={Boolean(parada.concluida)}
                            disabled={Boolean(vinculada && parada.concluida)}
                            onChange={aoMarcar}
                          />
                          <span className="tdg-driver-rota-ordem">{parada.ordem || indice + 1}</span>
                        </label>
                        <div className="tdg-driver-rota-parada-info">
                          <span className="tdg-driver-rota-endereco">{parada.rotulo || parada.endereco || "Parada"}</span>
                          <small>
                            {vinculada && !parada.concluida && <span>{parada.tipo === "coleta" ? "confirme a coleta" : "confirme a entrega com POD"}</span>}
                            {parada.recarga && <em className="tdg-driver-rota-recarga"><BatteryCharging size={12} /> recarga</em>}
                            {(parada.janelaInicio || parada.janelaFim) && <span><Clock size={11} /> {parada.janelaInicio || "—"}{parada.janelaFim ? `–${parada.janelaFim}` : ""}</span>}
                          </small>
                        </div>
                        {link && (
                          <a className="tdg-driver-rota-nav" href={link} target="_blank" rel="noopener noreferrer" aria-label={`Navegar até ${parada.rotulo || "a parada"}`}>
                            <Navigation size={16} />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </article>
            );
          })}
        </>
      )}

      {/* ===== VISTORIA: checklist de pré-viagem (bloco 03) ===== */}
      {secao === "vistoria" && (
        <>
          <div className="tdg-driver-secao-titulo"><ClipboardCheck size={18} /><h2>Vistoria de pré-viagem</h2></div>

          {vistoriaHoje && (
            <article className={`tdg-driver-cartao tdg-vistoria-selo ${vistoriaHoje.status}`}>
              {vistoriaHoje.status === "reprovado" ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
              <div>
                <strong>Vistoria de hoje: {SELO_VISTORIA[vistoriaHoje.status]}</strong>
                <small>
                  {vistoriaHoje.status === "reprovado"
                    ? "Item crítico com problema. Não deve rodar assim — fale com a operação."
                    : "Registrada. Pode refazer abaixo se algo mudou."}
                </small>
              </div>
            </article>
          )}

          <p className="tdg-driver-rodape-nota">Antes de sair, confira o veículo. Um item crítico com problema reprova a vistoria — segurança em primeiro lugar.</p>

          {GRUPOS_CHECKLIST.map((grupo) => (
            <article className="tdg-driver-cartao tdg-vistoria-grupo" key={grupo}>
              <h3>{grupo}</h3>
              {ITENS_CHECKLIST.filter((item) => item.grupo === grupo).map((item) => {
                const resposta = respostasVistoria[item.id] || "";
                return (
                  <div className="tdg-vistoria-item" key={item.id}>
                    <span>{item.rotulo}{item.critico && <b className="tdg-vistoria-critico"> crítico</b>}</span>
                    <div className="tdg-vistoria-opcoes" role="group" aria-label={item.rotulo}>
                      {[["ok", "OK"], ["ressalva", "Ressalva"], ["problema", "Problema"]].map(([valor, rotulo]) => (
                        <button
                          key={valor}
                          type="button"
                          className={`${valor} ${resposta === valor ? "ativa" : ""}`}
                          aria-pressed={resposta === valor}
                          onClick={() => setRespostasVistoria((atual) => ({ ...atual, [item.id]: valor }))}
                        >
                          {rotulo}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </article>
          ))}

          <article className="tdg-driver-cartao">
            <label className="tdg-vistoria-obs">
              <span>Observação (opcional)</span>
              <textarea value={obsVistoria} onChange={(e) => setObsVistoria(e.target.value)} rows={2} placeholder="Ex.: retrovisor direito frouxo" />
            </label>
            <div className={`tdg-vistoria-veredito ${vistoriaParcial.status}`}>
              {vistoriaParcial.completo
                ? vistoriaParcial.resumo
                : `Faltam ${vistoriaParcial.pendentes} item(ns) para concluir.`}
            </div>
            <button
              type="button"
              className="tdg-driver-reenviar principal"
              disabled={!vistoriaParcial.completo || enviandoVistoria}
              onClick={enviarVistoria}
            >
              {enviandoVistoria ? "Registrando…" : "Registrar vistoria"}
            </button>
          </article>

          {checklists.length > 0 && (
            <article className="tdg-driver-cartao">
              <h3>Vistorias recentes</h3>
              {checklists.slice(0, 8).map((c) => (
                <div className="tdg-vistoria-historico" key={c.id}>
                  <span>{String(c.dataServico).slice(0, 10)}{c.placa ? ` · ${c.placa}` : ""}</span>
                  <b className={c.status}>{SELO_VISTORIA[c.status]}</b>
                </div>
              ))}
            </article>
          )}
        </>
      )}

      {/* ===== ENTREGAS: histórico com POD ===== */}
      {secao === "entregas" && (
        <>
          <div className="tdg-driver-secao-titulo"><PackageCheck size={18} /><h2>Entregas concluídas</h2></div>
          {feitas.length === 0 && <div className="tdg-driver-cartao tdg-driver-vazio"><PackageCheck size={30} /><p>Nenhuma entrega ainda.</p><small>As entregas que você concluir aparecem aqui, com o comprovante.</small></div>}
          {feitas.map((viagem) => (
            <article className="tdg-driver-cartao" key={viagem.id}>
              <div className="tdg-driver-rota">
                <strong>{viagem.referencia || "Viagem"}</strong>
                <span><MapPin size={14} /> {viagem.origem || "origem"} → {viagem.destino || "destino"}</span>
                <small>entregue em {String(viagem.entregueEm).slice(0, 16).replace("T", " ")} · placa {viagem.placa || "—"}</small>
              </div>
              <span className={`tdg-driver-pod ${viagem.comprovanteRegistrado ? "ok" : "falta"}`}>
                {viagem.comprovanteRegistrado ? <><CheckCircle2 size={14} /> comprovante ok</> : <><AlertTriangle size={14} /> sem comprovante</>}
              </span>
            </article>
          ))}
        </>
      )}

      {/* ===== PERFIL: motorista, CNH, disponibilidade e fila offline ===== */}
      {secao === "perfil" && (
        <>
          <article className="tdg-driver-cartao tdg-driver-perfil">
            <div className="tdg-driver-avatar">
              {perfil?.avatarUrl
                ? <img src={perfil.avatarUrl} alt="Sua foto de perfil" />
                : <User size={26} />}
            </div>
            <div className="tdg-driver-perfil-info">
              <strong>{sessao.motorista.nome || perfil?.name || "Motorista"}</strong>
              <small>{sessao.motorista.disponibilidade ? `Situação: ${sessao.motorista.disponibilidade}` : "Motorista To Do Green"}</small>
              <div className="tdg-driver-perfil-foto-acoes">
                <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={enviarFotoPerfil} />
                <button type="button" className="tdg-driver-foto-btn" onClick={() => avatarInputRef.current?.click()} disabled={enviandoFoto}>
                  <Camera size={15} /> {enviandoFoto ? "Salvando…" : perfil?.avatarUrl ? "Trocar foto" : "Adicionar minha foto"}
                </button>
                {perfil?.avatarUrl && (
                  <button type="button" className="tdg-driver-foto-remover" onClick={removerFotoPerfil} disabled={enviandoFoto}>
                    Remover
                  </button>
                )}
              </div>
            </div>
          </article>
          <article className="tdg-driver-cartao">
            <div className="tdg-driver-info-linha"><CreditCard size={16} /><span>CNH</span><b>{sessao.motorista.cnhCategoria || "—"}</b></div>
            <label className="tdg-driver-cnh-validade">
              <span><Clock size={14} aria-hidden="true" /> Validade da CNH</span>
              <input
                type="date"
                defaultValue={sessao.motorista.cnhValidade ? String(sessao.motorista.cnhValidade).slice(0, 10) : ""}
                onChange={(e) => salvarValidadeCnh(e.target.value)}
              />
            </label>
            {sessao.motorista.cnhAlerta
              ? <small className="tdg-driver-cnh-alerta">{sessao.motorista.cnhAlerta}</small>
              : <small>CNH em dia.</small>}
            <div className="tdg-driver-cnh-foto">
              {sessao.motorista.cnhImagemUrl
                ? <img src={sessao.motorista.cnhImagemUrl} alt="Foto da sua CNH" />
                : <div className="tdg-driver-cnh-vazia"><CreditCard size={26} /><small>Envie a foto da sua CNH — a operação precisa dela.</small></div>}
              <input ref={cnhInputRef} type="file" accept="image/*" capture="environment" hidden onChange={enviarCnhFoto} />
              <button type="button" className="tdg-captura-btn" onClick={() => cnhInputRef.current?.click()} disabled={enviandoCnh}>
                <Camera size={16} /> {enviandoCnh ? "Enviando…" : sessao.motorista.cnhImagemUrl ? "Refazer foto da CNH" : "Enviar foto da CNH"}
              </button>
            </div>
          </article>
          {/* Score do motorista: derivado das entregas (pontualidade, POD, ocorrências). */}
          <article className="tdg-driver-cartao tdg-score">
            <div className="tdg-driver-info-linha"><Award size={16} /><span>Meu score</span></div>
            {score.disponivel ? (
              <>
                <div className={`tdg-score-nota ${score.faixa}`}>
                  <strong>{score.nota}</strong>
                  <span>{ROTULO_FAIXA[score.faixa]} · {score.totalEntregues} entrega(s)</span>
                </div>
                <div className="tdg-score-componentes">
                  {score.componentes.map((c) => (
                    <div className="tdg-score-item" key={c.chave}>
                      <span>{c.rotulo}</span>
                      <div className="tdg-score-barra"><i style={{ width: `${c.valor}%` }} /></div>
                      <b>{c.valor}</b>
                    </div>
                  ))}
                </div>
                <small className="tdg-driver-rodape-nota">A nota vem do que você registra: entregar no prazo, com comprovante e sem ocorrência.</small>
              </>
            ) : (
              <small className="tdg-driver-rodape-nota">{score.aviso}</small>
            )}
          </article>

          <article className="tdg-driver-cartao">
            <div className="tdg-driver-info-linha"><Truck size={16} /><span>Viagens no total</span><b>{viagens.length}</b></div>
            <div className="tdg-driver-info-linha"><PackageCheck size={16} /><span>Entregues</span><b>{feitas.length}</b></div>
            <div className="tdg-driver-info-linha"><AlertTriangle size={16} /><span>Aguardando sinal</span><b>{pendentesFila}</b></div>
            {pendentesFila > 0 && <button type="button" className="tdg-driver-reenviar" onClick={() => escoarFila().then((r) => { if (r.enviados > 0) carregar(); })}>Reenviar registros guardados</button>}
          </article>
          <p className="tdg-driver-rodape-nota">Seus registros de rua (cheguei, entreguei, ocorrência) geram o comprovante que libera o faturamento. Sem sinal, ficam guardados no celular e enviam sozinhos.</p>
        </>
      )}

      {/* Confirmação em janela própria: o botão fica no card da viagem, mas o
          formulário nascia no fim da página — com várias viagens, fora da tela. */}
      {formulario && (
        <Modal
          title={formulario.tipo === "entrega" ? "Confirmar entrega" : formulario.tipo === "chegada" ? "Confirmar chegada" : formulario.tipo === "coleta" ? "Confirmar coleta" : "Registrar ocorrência"}
          onClose={() => setFormulario(null)}
        >
          <form className="tdg-driver-cartao tdg-driver-form tdg-form-em-modal" onSubmit={registrar}>
            <strong>{formulario.viagem.referencia || "Viagem"}</strong>
            {formulario.tipo === "entrega" && (
              <>
                <label><span>Quem recebeu</span><input required value={dados.recebedor} onChange={(e) => setDados((v) => ({ ...v, recebedor: e.target.value }))} placeholder="Nome de quem recebeu" /></label>
                <div className="tdg-driver-captura">
                  <span>Foto do canhoto</span>
                  <input ref={fotoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={aoEscolherFoto} />
                  <button type="button" className="tdg-captura-btn" onClick={() => fotoInputRef.current?.click()} disabled={capturandoFoto}>
                    <Camera size={16} /> {capturandoFoto ? "Processando…" : dados.fotoBase64 ? "Refazer foto" : "Tirar foto"}
                  </button>
                  {dados.fotoBase64 && (
                    <div className="tdg-captura-previa">
                      <img src={dados.fotoBase64} alt="Prévia do canhoto" />
                      <button type="button" onClick={() => setDados((v) => ({ ...v, fotoBase64: "" }))}>Remover</button>
                    </div>
                  )}
                </div>
                <div className="tdg-driver-captura">
                  <span>Assinatura de quem recebeu</span>
                  <PadAssinatura onChange={(d) => setDados((v) => ({ ...v, assinaturaBase64: d }))} />
                </div>
                <details className="tdg-driver-linkfallback">
                  <summary>ou colar um link da foto</summary>
                  <input value={dados.comprovanteUrl} onChange={(e) => setDados((v) => ({ ...v, comprovanteUrl: e.target.value }))} placeholder="https://…" />
                </details>
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

      {/* Navegação inferior fixa — o "menu" que faltava. Fica sempre à mão,
          padrão de app no celular. O badge mostra quantas viagens esperam. */}
      <nav className="tdg-driver-nav" aria-label="Seções do app do motorista">
        {abas.map((aba) => {
          const Icone = aba.icone;
          const ativa = secao === aba.id;
          const badge = aba.id === "hoje" ? pendentes.length : aba.id === "rota" ? rotasAtivas.length : aba.id === "entregas" ? feitas.length : 0;
          return (
            <button
              key={aba.id}
              type="button"
              className={ativa ? "is-active" : ""}
              aria-current={ativa ? "page" : undefined}
              onClick={() => setSecao(aba.id)}
            >
              <span className="tdg-driver-nav-icone">
                <Icone size={22} />
                {badge > 0 && <b>{badge > 9 ? "9+" : badge}</b>}
              </span>
              {aba.rotulo}
            </button>
          );
        })}
      </nav>
    </main>
  );
}
