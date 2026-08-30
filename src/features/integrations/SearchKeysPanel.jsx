import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Globe, KeyRound, Loader2, Search, Trash2 } from "lucide-react";
import { Button, Empty, Field } from "../../components/ui.jsx";

// ===== "Quero que a pesquisa de empresa pare de esbarrar em cota" =====
//
// A cascata de busca já resolve a cota quando existe um SearXNG próprio — mas
// ligá-lo exigia `wrangler secret put SEARXNG_BASE_URL` num terminal, que quem
// administra o ERP não tem. Este painel é o par do AiKeysPanel para busca: a
// pessoa cola a URL do SearXNG (ou as chaves gratuitas de Serper/Brave/Tavily
// como reserva) e o ERP passa a pesquisar por elas. Sem terminal.
//
// Duas decisões, as mesmas do painel de IA: (1) o segredo é testado ANTES de
// ser guardado, e o resultado aparece na hora; (2) o segredo nunca volta para
// a tela — volta o prefixo. A URL não é segredo, então essa volta.

const pedir = async (caminho, opcoes = {}, authHeaders) => {
  const resposta = await fetch(`/api/search-keys${caminho}`, {
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

function CartaoBusca({ provedor, onSalvar, onTestar, onRemover, ocupado }) {
  const [aberto, setAberto] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [chave, setChave] = useState("");
  const [erro, setErro] = useState("");
  const [ofereceForcar, setOfereceForcar] = useState(false);

  const minha = provedor.minha;
  const ehUrl = provedor.tipo === "url";
  const podeSalvar = ehUrl ? url.trim().length > 8 : chave.trim().length >= 8;

  const salvar = async (forcar = false) => {
    setErro("");
    try {
      const corpo = ehUrl
        ? { url: url.trim(), token: token.trim(), salvarMesmoAssim: forcar }
        : { chave: chave.trim(), salvarMesmoAssim: forcar };
      await onSalvar(provedor.id, corpo);
      setUrl(""); setToken(""); setChave("");
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
          <span className="int-ia-selo neutro">Configurado no servidor</span>
        ) : null}
      </div>

      {minha && (
        <dl className="int-ia-dados">
          {ehUrl
            ? (
              <>
                <div><dt>Endereço</dt><dd>{minha.url}</dd></div>
                <div><dt>Token</dt><dd>{minha.temToken ? minha.prefixo || "definido" : "sem token"}</dd></div>
              </>
            )
            : <div><dt>Chave</dt><dd>{minha.prefixo}</dd></div>}
          <div>
            <dt>Último teste</dt>
            <dd>{minha.testadaEm ? new Date(minha.testadaEm).toLocaleString("pt-BR") : "nunca testada"}</dd>
          </div>
        </dl>
      )}
      {minha && !minha.testeOk && minha.testeErro && (
        <p className="int-ia-erro">{minha.testeErro}</p>
      )}

      {aberto ? (
        <div className="int-ia-form">
          {ehUrl ? (
            <>
              <Field label="Endereço da instância (URL)">
                <input
                  type="url"
                  autoComplete="off"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://sua-instancia.exemplo.app"
                />
              </Field>
              <Field label="Token (opcional)">
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="deixe vazio se a instância não exige token"
                />
              </Field>
            </>
          ) : (
            <Field label={`Chave do ${provedor.nome}`}>
              <input
                type="password"
                autoComplete="off"
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                placeholder="Cole a chave aqui"
              />
            </Field>
          )}
          <p className="muted int-ia-onde">Onde pegar: {provedor.onde}</p>
          {erro && <p className="int-ia-erro">{erro}</p>}
          <div className="int-ia-acoes">
            <Button icon={ocupado ? Loader2 : Check} onClick={() => salvar(false)} disabled={ocupado || !podeSalvar}>
              {ocupado ? "Testando…" : "Testar e salvar"}
            </Button>
            {ofereceForcar && (
              <Button variant="secondary" onClick={() => salvar(true)} disabled={ocupado}>
                Salvar assim mesmo
              </Button>
            )}
            <Button variant="secondary" onClick={() => { setAberto(false); setErro(""); setUrl(""); setToken(""); setChave(""); }}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="int-ia-acoes">
          <Button variant="secondary" icon={ehUrl ? Globe : KeyRound} onClick={() => setAberto(true)}>
            {minha ? (ehUrl ? "Trocar endereço" : "Trocar chave") : (ehUrl ? "Apontar minha instância" : "Conectar minha conta")}
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

export default function SearchKeysPanel({ setToast, authHeaders }) {
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
        ? "Busca conectada e testada."
        : "Guardado, mas o teste não trouxe resultado. Veja o aviso no cartão.");
      await carregar();
    } finally {
      setOcupado(false);
    }
  };

  const testar = async (provedorId) => {
    setOcupado(true);
    try {
      const resposta = await pedir(`/${provedorId}`, { method: "POST", body: JSON.stringify({ acao: "testar" }) }, authHeaders);
      setToast?.(resposta.ok ? "A busca respondeu com resultado." : `Não respondeu: ${resposta.erro}`);
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado(false);
    }
  };

  const remover = async (provedorId, nome) => {
    if (!window.confirm(`Remover a sua configuração do ${nome}? A pesquisa volta a usar o que estiver no servidor, se houver.`)) return;
    setOcupado(true);
    try {
      await pedir(`/${provedorId}`, { method: "DELETE" }, authHeaders);
      setToast?.("Configuração removida.");
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="int-bloco">
      <h3><Search size={16} /> Ligar a busca da pesquisa de empresa</h3>
      <p className="muted">
        As pesquisas de LinkedIn, decisores, notícias e RFQ saem daqui. Aponte a
        sua própria instância de SearXNG para busca sem cota, ou cole as chaves
        gratuitas de um ou mais provedores — o sistema usa uma de cada vez e,
        quando a cota do mês acaba, passa sozinho para a próxima.
      </p>

      {erro && <p className="int-ia-erro">{erro}</p>}

      {dados && !dados.cofreDisponivel && (
        <p className="int-ia-erro">
          O cofre ainda não foi configurado neste servidor
          (<code>WORKSPACE_AI_VAULT_KEY</code>). Sem ele um token ou chave não
          pode ser guardado com segurança.
        </p>
      )}

      {!dados && !erro && <Empty icon={Search} title="Carregando" text="Buscando as suas fontes de pesquisa." />}

      {dados?.provedores && (
        <ul className="int-ia-lista">
          {dados.provedores.map((provedor) => (
            <CartaoBusca
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
