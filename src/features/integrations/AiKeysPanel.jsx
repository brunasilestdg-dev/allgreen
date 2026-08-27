import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button, Empty, Field } from "../../components/ui.jsx";

// ===== "Quero conectar com Claude, GPT, Google" =====
//
// A tela de integrações trazia planilha, agenda, WhatsApp, JSON e webhooks — e
// nada de IA. Os onze provedores viviam no cofre do Worker, o que significa que
// quem usa o produto não tinha onde plugar a própria conta e todo o consumo
// saía da conta de quem hospeda.
//
// Três decisões desta tela, todas para não criar um formulário que assusta:
//
// 1) A chave é testada ANTES de ser guardada, e o resultado aparece na hora.
//    "Cadastrei e não sei se funciona" é o estado que faz a pessoa desistir.
// 2) A chave nunca volta para a tela. Volta o prefixo (`sk-ant-…`). Para
//    trocar, cadastra de novo. Campo que reexibe segredo é segredo que vaza
//    por captura de tela e por quem está olhando junto.
// 3) Cada cartão diz onde pegar a chave. Sem isso a tela pede uma coisa que a
//    pessoa não sabe onde procurar.

const pedir = async (caminho, opcoes = {}, authHeaders) => {
  const resposta = await fetch(`/api/ai-keys${caminho}`, {
    ...opcoes,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(opcoes.headers || {}),
    },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados?.error || "Não foi possível concluir.");
    erro.detalhe = dados?.detalhe || "";
    erro.podeSalvarMesmoAssim = dados?.podeSalvarMesmoAssim === true;
    throw erro;
  }
  return dados;
};

function CartaoProvedor({ provedor, onSalvar, onTestar, onRemover, ocupado }) {
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("");
  const [modelo, setModelo] = useState("");
  const [erro, setErro] = useState("");
  const [ofereceForcar, setOfereceForcar] = useState(false);

  const minha = provedor.minha;

  const salvar = async (forcar = false) => {
    setErro("");
    try {
      await onSalvar(provedor.id, { chave, modelo, salvarMesmoAssim: forcar });
      setChave("");
      setAberto(false);
      setOfereceForcar(false);
    } catch (motivo) {
      setErro(motivo.detalhe ? `${motivo.message} ${motivo.detalhe}` : motivo.message);
      setOfereceForcar(Boolean(motivo.podeSalvarMesmoAssim));
    }
  };

  return (
    <li className={`int-ia-cartao${minha?.ativa ? " ativa" : ""}`}>
      <div className="int-ia-topo">
        <div>
          <strong>{provedor.nome}</strong>
          <p className="muted">{provedor.descricao}</p>
        </div>
        {minha ? (
          <span className={`int-ia-selo${minha.testeOk ? " ok" : " atencao"}`}>
            {minha.testeOk ? <Check size={13} /> : <AlertTriangle size={13} />}
            {minha.testeOk ? "Funcionando" : "Não respondeu"}
          </span>
        ) : provedor.reservaDaPlataforma ? (
          // Sem esta linha a pergunta inevitável é "se eu não cadastrar, para
          // de funcionar?".
          <span className="int-ia-selo neutro">Usando a chave do app</span>
        ) : null}
      </div>

      {minha && (
        <dl className="int-ia-dados">
          <div><dt>Chave</dt><dd>{minha.prefixo}</dd></div>
          {minha.modelo && <div><dt>Modelo</dt><dd>{minha.modelo}</dd></div>}
          <div>
            <dt>Último teste</dt>
            <dd>
              {minha.testadaEm
                ? new Date(minha.testadaEm).toLocaleString("pt-BR")
                : "nunca testada"}
            </dd>
          </div>
        </dl>
      )}
      {minha && !minha.testeOk && minha.testeErro && (
        <p className="int-ia-erro">{minha.testeErro}</p>
      )}

      {aberto ? (
        <div className="int-ia-form">
          <Field label={`Chave do ${provedor.nome}`}>
            <input
              type="password"
              autoComplete="off"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder="Cole a chave aqui"
            />
          </Field>
          <Field label="Modelo (opcional)">
            <input
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder={provedor.modeloPadrao || "deixe vazio para usar o padrão"}
            />
          </Field>
          <p className="muted int-ia-onde">Onde pegar: {provedor.onde}</p>
          {erro && <p className="int-ia-erro">{erro}</p>}
          <div className="int-ia-acoes">
            <Button icon={ocupado ? Loader2 : Check} onClick={() => salvar(false)} disabled={ocupado || chave.length < 12}>
              {ocupado ? "Testando…" : "Testar e salvar"}
            </Button>
            {ofereceForcar && (
              <Button variant="secondary" onClick={() => salvar(true)} disabled={ocupado}>
                Salvar assim mesmo
              </Button>
            )}
            <Button variant="secondary" onClick={() => { setAberto(false); setErro(""); setChave(""); }}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="int-ia-acoes">
          <Button variant="secondary" icon={KeyRound} onClick={() => setAberto(true)}>
            {minha ? "Trocar chave" : "Conectar minha conta"}
          </Button>
          {minha && (
            <>
              <Button variant="secondary" onClick={() => onTestar(provedor.id)} disabled={ocupado}>
                Testar agora
              </Button>
              <Button variant="secondary" icon={Trash2} onClick={() => onRemover(provedor.id, provedor.nome)} disabled={ocupado}>
                Remover
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function AiKeysPanel({ setToast, authHeaders }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await pedir("", {}, authHeaders));
      setErro("");
    } catch (motivo) {
      setErro(motivo.message);
    }
  }, [authHeaders]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (provedorId, corpo) => {
    setOcupado(true);
    try {
      const resposta = await pedir(`/${provedorId}`, { method: "POST", body: JSON.stringify(corpo) }, authHeaders);
      setToast?.(resposta.testeOk
        ? "Chave conectada e testada."
        : "Chave guardada, mas o provedor não respondeu ao teste.");
      await carregar();
    } finally {
      setOcupado(false);
    }
  };

  const testar = async (provedorId) => {
    setOcupado(true);
    try {
      const resposta = await pedir(`/${provedorId}`, { method: "POST", body: JSON.stringify({ acao: "testar" }) }, authHeaders);
      setToast?.(resposta.ok ? "Conexão respondeu." : `Não respondeu: ${resposta.erro}`);
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado(false);
    }
  };

  const remover = async (provedorId, nome) => {
    // Remover uma credencial é ação de mão única. Confirmar aqui é barato; a
    // pessoa refazer o cadastro depois não é.
    if (!window.confirm(`Remover a sua chave do ${nome}? O app volta a usar a chave da plataforma, se houver.`)) return;
    setOcupado(true);
    try {
      await pedir(`/${provedorId}`, { method: "DELETE" }, authHeaders);
      setToast?.("Chave removida.");
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="int-bloco">
      <h3><Sparkles size={16} /> Conectar sua própria inteligência artificial</h3>
      <p className="muted">
        Traga a sua conta do Claude, do ChatGPT ou do Google e o app passa a usar
        ela primeiro — com os seus modelos e a sua cota. Sem cadastrar nada, tudo
        continua funcionando com a inteligência que já vem no app.
      </p>

      {erro && <p className="int-ia-erro">{erro}</p>}

      {dados && !dados.cofreDisponivel && (
        <p className="int-ia-erro">
          O cofre de chaves ainda não foi configurado neste servidor
          (<code>WORKSPACE_AI_VAULT_KEY</code>). Enquanto isso, nenhuma chave pode
          ser guardada com segurança — e guardar sem segurança não é opção.
        </p>
      )}

      {!dados && !erro && <Empty icon={Sparkles} title="Carregando" text="Buscando as suas conexões de inteligência artificial." />}

      {dados?.cofreDisponivel && (
        <ul className="int-ia-lista">
          {dados.provedores.map((provedor) => (
            <CartaoProvedor
              key={provedor.id}
              provedor={provedor}
              onSalvar={salvar}
              onTestar={testar}
              onRemover={remover}
              ocupado={ocupado}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
