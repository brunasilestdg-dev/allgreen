import { useState, useMemo } from "react";

/*
  Simulador de CO₂ evitado — To Do Green
  Fatores baseados nos documentos oficiais TDG:
  - CCN_Precificacao_Courier_Eletrico (aba 3.CO2_Calculadora)
  - Moto: 100 gCO₂/km combustão (CETESB-SP) menos 5 gCO₂/km elétrica
    (Fator MCTIC 2024 × 15 Wh/km) = 95 gCO₂/km evitados.
  Para os demais modais, mantém-se a mesma lógica: CO₂ evitado =
  emissão do combustão menos a emissão real da recarga elétrica
  (grid Brasil), nunca tratando o elétrico como zero.
*/

// emComb: emissão do veículo a combustão (gCO2/km)
// emEle: emissão real da versão elétrica na recarga, grid Brasil (gCO2/km)
const VEHICLES = {
  moto:    { label: "Moto elétrica", emComb: 100, emEle: 5,  icon: "🏍️", fuel: "flex" },
  carro:   { label: "Carro / VUC leve", emComb: 180, emEle: 12, icon: "🚗", fuel: "flex" },
  van:     { label: "Van / Furgão", emComb: 260, emEle: 20, icon: "🚐", fuel: "diesel" },
  vuc:     { label: "VUC", emComb: 320, emEle: 26, icon: "🚚", fuel: "diesel" },
  toco:    { label: "Toco", emComb: 620, emEle: 60, icon: "🚛", fuel: "diesel" },
  carreta: { label: "Carreta", emComb: 900, emEle: 95, icon: "🚛", fuel: "diesel" },
};

// Fatores de equivalência
const KG_CO2_POR_ARVORE_ANO = 22;   // 1 árvore absorve ~22 kg CO2/ano
// kg CO2 por litro queimado. "flex" = média 50% gasolina (2,27) + 50% etanol (1,50, escapamento).
const KG_CO2_LITRO = { flex: 1.885, gasolina: 2.27, diesel: 2.68 };
// WhatsApp comercial da To Do Green — o botão "Solicitar uma cotação" abre a
// conversa direto com a mensagem já preenchida a partir da simulação.
const WHATSAPP = "5511951006360";
const FUEL_LABEL = { flex: "combustível (mix gasolina/etanol)", gasolina: "gasolina", diesel: "diesel" };

function formatNum(n, dec = 0) {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

export default function EsgEmissionSimulator() {
  const [tipo, setTipo] = useState("moto");
  const [entregas, setEntregas] = useState(1000);
  const [kmPorEntrega, setKmPorEntrega] = useState(3.5);

  const r = useMemo(() => {
    const v = VEHICLES[tipo];
    const evitadoGkm = v.emComb - v.emEle; // CO2 líquido evitado por km
    const kmTotal = entregas * kmPorEntrega;
    const kgCO2 = (kmTotal * evitadoGkm) / 1000; // g -> kg
    const tonCO2 = kgCO2 / 1000;

    const kgEmitidoEle = (kmTotal * v.emEle) / 1000; // o que a recarga ainda emite
    const arvores = kgCO2 / KG_CO2_POR_ARVORE_ANO;
    const litrosComb = kgCO2 / KG_CO2_LITRO[v.fuel];
    const kmCarro = kgCO2 / (VEHICLES.carro.emComb / 1000);

    return { evitadoGkm, kmTotal, kgCO2, tonCO2, kgEmitidoEle, arvores, litrosComb, fuel: v.fuel, kmCarro };
  }, [tipo, entregas, kmPorEntrega]);

  const equivalencias = [
    {
      icon: "🌳",
      valor: formatNum(r.arvores),
      unidade: r.arvores === 1 ? "árvore" : "árvores",
      desc: "absorvendo CO₂ durante um ano inteiro",
    },
    {
      icon: "⛽",
      valor: formatNum(r.litrosComb),
      unidade: `litros de ${FUEL_LABEL[r.fuel]}`,
      desc: "que deixaram de ser queimados",
    },
    {
      icon: "🚗",
      valor: formatNum(r.kmCarro),
      unidade: "km",
      desc: "de um carro a combustão comum",
    },
    {
      icon: "🔋",
      valor: formatNum(r.kgEmitidoEle, 1),
      unidade: "kg CO₂",
      desc: "emissão real da recarga, já descontada do total",
    },
  ];

  return (
    <div style={styles.wrap}>
      <style>{globalCss}</style>

      <header style={styles.header}>
        <div style={styles.brandRow}>
          <span style={styles.brandDot} />
          <span style={styles.brandName}>To Do Green</span>
        </div>
        <p style={styles.tagline}>Mudando o mundo a cada entrega</p>
        <h1 style={styles.title}>Simulador de impacto ESG</h1>
        <p style={styles.subtitle}>
          Quanto CO₂ sua operação deixa de emitir ao rodar 100% elétrico, já
          descontada a emissão da recarga na matriz brasileira.
        </p>
      </header>

      <div className="tdg-esg-sim-grid" style={styles.grid}>
        {/* Painel de entrada */}
        <section style={styles.inputCard}>
          <span style={styles.fieldLabel}>Tipo de veículo</span>
          <div className="tdg-esg-sim-vehicles" style={styles.vehicleGrid}>
            {Object.entries(VEHICLES).map(([key, v]) => (
              <button
                key={key}
                onClick={() => setTipo(key)}
                style={{
                  ...styles.vehicleBtn,
                  ...(tipo === key ? styles.vehicleBtnActive : {}),
                }}
              >
                <span style={styles.vehicleIcon}>{v.icon}</span>
                <span style={styles.vehicleLabel}>{v.label}</span>
                <span style={styles.vehicleEm}>{v.emComb - v.emEle} g/km</span>
              </button>
            ))}
          </div>

          <div style={styles.field}>
            <div style={styles.fieldTop}>
              <span style={styles.fieldLabel}>Quantidade de entregas</span>
              <input
                type="number"
                min={0}
                value={entregas}
                onChange={(e) => setEntregas(Math.max(0, Number(e.target.value)))}
                style={styles.numInput}
              />
            </div>
            <input
              type="range"
              min={0}
              max={50000}
              step={100}
              value={Math.min(entregas, 50000)}
              onChange={(e) => setEntregas(Number(e.target.value))}
              style={styles.range}
            />
          </div>

          <div style={styles.field}>
            <div style={styles.fieldTop}>
              <span style={styles.fieldLabel}>KM médio por entrega</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={kmPorEntrega}
                onChange={(e) => setKmPorEntrega(Math.max(0, Number(e.target.value)))}
                style={styles.numInput}
              />
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={0.5}
              value={Math.min(kmPorEntrega, 200)}
              onChange={(e) => setKmPorEntrega(Number(e.target.value))}
              style={styles.range}
            />
          </div>

          <div style={styles.kmTotal}>
            <span>Distância total percorrida</span>
            <strong>{formatNum(r.kmTotal)} km</strong>
          </div>
        </section>

        {/* Painel de resultado */}
        <section style={styles.resultCol}>
          <div style={styles.heroCard}>
            <span style={styles.heroLabel}>CO₂ evitado</span>
            <div style={styles.heroNumber}>
              {r.tonCO2 >= 1 ? formatNum(r.tonCO2, 2) : formatNum(r.kgCO2, 1)}
              <span style={styles.heroUnit}>
                {r.tonCO2 >= 1 ? " toneladas" : " kg"}
              </span>
            </div>
            <p style={styles.heroSub}>
              {formatNum(r.kgCO2)} kg de CO₂ que não foram lançados na atmosfera
              nesta operação, já descontada a emissão da recarga.
            </p>
          </div>

          <p style={styles.equivIntro}>Esse CO₂ evitado corresponde a:</p>
          <div className="tdg-esg-sim-equiv" style={styles.equivGrid}>
            {equivalencias.map((eq, i) => (
              <div key={i} style={styles.equivCard}>
                <span style={styles.equivIcon}>{eq.icon}</span>
                <div>
                  <div style={styles.equivValor}>
                    {eq.valor} <span style={styles.equivUnidade}>{eq.unidade}</span>
                  </div>
                  <div style={styles.equivDesc}>{eq.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Seção educativa */}
      <section style={styles.eduSection}>
        <h2 style={styles.eduTitle}>Por que evitar CO₂ importa</h2>
        <div className="tdg-esg-sim-edu" style={styles.eduGrid}>
          <div style={styles.eduCard}>
            <div style={styles.eduBig}>~75%</div>
            <p style={styles.eduText}>
              O dióxido de carbono responde por cerca de três quartos das
              emissões de gases de efeito estufa, sendo o principal vetor do
              aquecimento global.
            </p>
          </div>
          <div style={styles.eduCard}>
            <div style={styles.eduIcon}>🌡️</div>
            <p style={styles.eduText}>
              Ele permanece na atmosfera por séculos, acumulando calor e
              elevando a temperatura do planeta ano após ano.
            </p>
          </div>
          <div style={styles.eduCard}>
            <div style={styles.eduIcon}>🚚</div>
            <p style={styles.eduText}>
              O transporte é uma das maiores fontes de emissão. Cada entrega
              elétrica no lugar de um veículo a combustão corta essa emissão na
              origem.
            </p>
          </div>
          <div style={styles.eduCard}>
            <div style={styles.eduIcon}>🌍</div>
            <p style={styles.eduText}>
              Reduzir emissões hoje limita eventos climáticos extremos, protege
              a saúde nas cidades e mantém metas ESG e regulatórias em dia.
            </p>
          </div>
        </div>
      </section>

      {/* Benefícios para o relatório ESG do cliente */}
      <section style={styles.benSection}>
        <h2 style={styles.benTitle}>Benefícios para o seu relatório ESG</h2>
        <p style={styles.benIntro}>
          Contratar frota 100% elétrica não é só entrega mais limpa. É um
          resultado ambiental pronto, auditável e comunicável para dentro e
          para fora da sua empresa.
        </p>

        <div className="tdg-esg-sim-ben" style={styles.benBlocks}>
          <div style={styles.benBlock}>
            <span style={styles.benTag}>No seu inventário de carbono</span>
            <ul style={styles.benList}>
              <li><strong>Redução de Escopo 3.</strong> A emissão da sua logística terceirizada cai direto no seu inventário, sem trocar nada internamente. Costuma ser a maior e mais difícil fatia de reduzir.</li>
              <li><strong>Dado auditável.</strong> CO₂ evitado de forma rastreável, com relatório mensal incluso no padrão To Do Green, entra no seu inventário GEE (GHG Protocol / CDP) como linha de relatório, não como marketing.</li>
              <li><strong>Progresso em metas.</strong> Uma das poucas alavancas de Escopo 3 que você controla via contratação, ajudando a bater metas de neutralidade sem CAPEX próprio.</li>
            </ul>
          </div>

          <div style={styles.benBlock}>
            <span style={styles.benTag}>No mercado e na marca</span>
            <ul style={styles.benList}>
              <li><strong>Pontos em licitação.</strong> Cada vez mais RFPs pontuam critério ambiental. Última milha 100% elétrica é vantagem em concorrência.</li>
              <li><strong>Comunicação com lastro.</strong> Selo de entrega verde ao consumidor final com um número real por trás, não só discurso.</li>
              <li><strong>Acesso a capital e grandes contratos.</strong> Mantém você elegível para fundos e contratantes que filtram fornecedores por ESG.</li>
            </ul>
          </div>

          <div style={styles.benBlock}>
            <span style={styles.benTag}>Em risco evitado</span>
            <ul style={styles.benList}>
              <li><strong>Antecipação regulatória.</strong> Restrições a combustão em zonas urbanas de baixa emissão já são realidade e tendem a crescer. Você não é pego de surpresa.</li>
              <li><strong>Proteção contra greenwashing.</strong> A conta desconta a emissão real da recarga em vez de tratar o elétrico como zero, então o número resiste à auditoria de um time técnico.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Chamada de fechamento */}
      <section style={styles.ctaSection}>
        <h2 style={styles.ctaText}>O que vamos fazer pelo mundo hoje?</h2>
        <a
          href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
            `Olá! Simulei o impacto ESG no site da To Do Green: ${VEHICLES[tipo].label}, ${formatNum(entregas)} entregas de ${formatNum(kmPorEntrega, 1)} km evitam ${formatNum(r.kgCO2)} kg de CO₂. Gostaria de solicitar uma cotação.`,
          )}`}
          target="_blank"
          rel="noreferrer noopener"
          style={styles.ctaBtn}
        >
          💬 Solicitar uma cotação
        </a>
        <p style={styles.ctaBrand}>To Do Green · Mudando o mundo a cada entrega</p>
      </section>

      <footer style={styles.footer}>
        Fatores baseados nos documentos oficiais To Do Green. Moto: 100 gCO₂/km
        combustão (CETESB-SP) menos 5 gCO₂/km da recarga elétrica (Fator MCTIC
        2024 × 15 Wh/km) = 95 gCO₂/km evitados. Demais modais seguem a mesma
        lógica de descontar a emissão real da recarga (grid Brasil). Árvore:
        absorção de ~22 kg CO₂/ano. Combustível evitado por tipo de veículo:
        moto e carro consideram mix 50% gasolina (2,27 kg CO₂/litro) e 50% etanol
        (1,50 kg CO₂/litro, escapamento), média de 1,885 kg CO₂/litro; os pesados
        usam diesel (2,68 kg CO₂/litro). Valores de
        referência para comunicação comercial; os fatores dos veículos pesados
        (van, VUC, toco, carreta) são estimativas até validação da operação.
      </footer>
    </div>
  );
}

const GREEN = "#0F7A3D";
const GREEN_DARK = "#0A5C2E";
const GREEN_LIGHT = "#E8F4EC";
const INK = "#14201A";

const globalCss = `
  * { box-sizing: border-box; }
  input[type="range"] {
    -webkit-appearance: none; appearance: none;
    height: 6px; border-radius: 999px; background: ${GREEN_LIGHT}; outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 20px; height: 20px; border-radius: 50%;
    background: ${GREEN}; cursor: pointer; border: 3px solid #fff;
    box-shadow: 0 1px 4px rgba(15,122,61,.4);
  }
  input[type="range"]::-moz-range-thumb {
    width: 20px; height: 20px; border-radius: 50%;
    background: ${GREEN}; cursor: pointer; border: 3px solid #fff;
  }
  /* Responsivo: em telas estreitas os pares de colunas empilham em vez de
     espremer. Sem isso o simulador ficava apertado no celular. */
  @media (max-width: 760px) {
    .tdg-esg-sim-grid { grid-template-columns: 1fr !important; }
    .tdg-esg-sim-edu, .tdg-esg-sim-ben { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 460px) {
    .tdg-esg-sim-vehicles { grid-template-columns: repeat(2, 1fr) !important; }
    .tdg-esg-sim-equiv { grid-template-columns: 1fr !important; }
  }
`;

const styles = {
  wrap: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    maxWidth: 980,
    margin: "0 auto",
    padding: "32px 20px 48px",
    color: INK,
  },
  header: { marginBottom: 28 },
  brandRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
  brandDot: {
    width: 12, height: 12, borderRadius: "50%",
    background: `linear-gradient(135deg, #3BC66E, ${GREEN})`,
  },
  brandName: { fontWeight: 700, letterSpacing: ".01em", color: GREEN_DARK },
  tagline: {
    fontSize: 14, fontWeight: 600, color: GREEN,
    margin: "0 0 10px", fontStyle: "italic",
  },
  title: { fontSize: 34, fontWeight: 800, margin: "0 0 6px", lineHeight: 1.1 },
  subtitle: { fontSize: 16, color: "#5A6B62", margin: 0, maxWidth: 560 },

  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)",
    gap: 20,
    alignItems: "start",
  },

  inputCard: {
    background: "#fff",
    border: "1px solid #E4EAE6",
    borderRadius: 18,
    padding: 22,
  },
  vehicleGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 8,
    marginBottom: 22,
  },
  vehicleBtn: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
    padding: "12px 6px", borderRadius: 12, border: "1.5px solid #E4EAE6",
    background: "#fff", cursor: "pointer", transition: "all .15s",
  },
  vehicleBtnActive: {
    borderColor: GREEN, background: GREEN_LIGHT,
    boxShadow: `0 0 0 1px ${GREEN}`,
  },
  vehicleIcon: { fontSize: 22 },
  vehicleLabel: { fontSize: 11, fontWeight: 600, textAlign: "center", lineHeight: 1.15 },
  vehicleEm: { fontSize: 10, color: "#8A978F" },

  field: { marginBottom: 20 },
  fieldTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  fieldLabel: { fontSize: 13, fontWeight: 600, color: "#3E4E45" },
  numInput: {
    width: 100, padding: "6px 10px", borderRadius: 8,
    border: "1.5px solid #E4EAE6", fontSize: 15, fontWeight: 700,
    textAlign: "right", color: GREEN_DARK,
  },
  range: { width: "100%" },

  kmTotal: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 16px", background: GREEN_LIGHT, borderRadius: 12,
    fontSize: 14, color: GREEN_DARK,
  },

  resultCol: { display: "flex", flexDirection: "column", gap: 16 },
  heroCard: {
    background: `linear-gradient(150deg, ${GREEN} 0%, ${GREEN_DARK} 100%)`,
    borderRadius: 18, padding: "26px 24px", color: "#fff",
  },
  heroLabel: { fontSize: 13, fontWeight: 600, opacity: .85, letterSpacing: ".02em" },
  heroNumber: { fontSize: 52, fontWeight: 800, lineHeight: 1, margin: "8px 0 10px" },
  heroUnit: { fontSize: 22, fontWeight: 600, opacity: .9 },
  heroSub: { fontSize: 14, margin: 0, opacity: .9, lineHeight: 1.5 },

  equivIntro: { fontSize: 14, fontWeight: 600, color: "#3E4E45", margin: "2px 0 0" },
  equivGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  equivCard: {
    display: "flex", gap: 12, alignItems: "flex-start",
    background: "#fff", border: "1px solid #E4EAE6", borderRadius: 14, padding: 16,
  },
  equivIcon: { fontSize: 26, lineHeight: 1 },
  equivValor: { fontSize: 20, fontWeight: 800, color: GREEN_DARK, lineHeight: 1.1 },
  equivUnidade: { fontSize: 13, fontWeight: 600, color: "#5A6B62" },
  equivDesc: { fontSize: 12, color: "#7A887F", marginTop: 3, lineHeight: 1.35 },

  eduSection: {
    marginTop: 32,
    background: GREEN_DARK,
    borderRadius: 18,
    padding: "28px 26px",
    color: "#fff",
  },
  eduTitle: { fontSize: 22, fontWeight: 800, margin: "0 0 18px" },
  eduGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 14,
  },
  eduCard: {
    background: "rgba(255,255,255,.08)",
    borderRadius: 14,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  eduBig: {
    fontSize: 40, fontWeight: 800, lineHeight: 1,
    color: "#5BE08C",
  },
  eduIcon: { fontSize: 30, lineHeight: 1 },
  eduText: { fontSize: 14, margin: 0, opacity: .92, lineHeight: 1.5 },

  benSection: {
    marginTop: 32,
    background: "#fff",
    border: "1px solid #E4EAE6",
    borderRadius: 18,
    padding: "28px 26px",
  },
  benTitle: { fontSize: 22, fontWeight: 800, margin: "0 0 8px", color: INK },
  benIntro: { fontSize: 15, color: "#5A6B62", margin: "0 0 22px", maxWidth: 640, lineHeight: 1.5 },
  benBlocks: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
  benBlock: {
    background: GREEN_LIGHT, borderRadius: 14, padding: "18px 16px",
  },
  benTag: {
    display: "inline-block", fontSize: 12, fontWeight: 700, color: GREEN_DARK,
    marginBottom: 10,
  },
  benList: {
    margin: 0, paddingLeft: 18, fontSize: 13, color: "#3E4E45", lineHeight: 1.55,
    display: "flex", flexDirection: "column", gap: 10,
  },

  ctaSection: {
    marginTop: 20,
    background: `linear-gradient(150deg, ${GREEN} 0%, ${GREEN_DARK} 100%)`,
    borderRadius: 18, padding: "40px 26px", textAlign: "center", color: "#fff",
  },
  ctaText: { fontSize: 30, fontWeight: 800, margin: 0, lineHeight: 1.15 },
  ctaBtn: {
    display: "inline-flex", alignItems: "center", gap: 8,
    marginTop: 20, padding: "14px 26px", borderRadius: 999,
    background: "#fff", color: GREEN_DARK, fontWeight: 800, fontSize: 16,
    textDecoration: "none", boxShadow: "0 6px 18px rgba(0,0,0,.18)",
  },
  ctaBrand: { fontSize: 14, opacity: .9, margin: "16px 0 0", fontWeight: 500 },

  footer: {
    marginTop: 26, fontSize: 11.5, color: "#9AA69E", lineHeight: 1.5,
    borderTop: "1px solid #EEF2EF", paddingTop: 16,
  },
};
