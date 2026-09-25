// Telas do Estúdio (área "Estúdio" do menu).
import { Suspense, lazy } from "react";

// Ferramentas do app geral trazidas para dentro da vertical (Estúdio). Elas já
// recebem db/update/setToast; passamos um contexto de negócio To Do Green para
// os exemplos e prompts saírem no tom da transportadora.
const CreativeToolkit = lazy(() => import("../../creative/CreativeToolkit.jsx"));
const MediaStudio = lazy(() => import("../../media/MediaStudio.jsx"));
const CodeStudio = lazy(() => import("../../code/CodeStudio.jsx"));
// Análise de textos e Mapa de ideias moram no App.jsx como funções de módulo
// (usam só props + helpers de módulo). Importamos por named export com lazy — o
// App.jsx não importa a vertical estaticamente, então não há ciclo.
const TextAnalyzer = lazy(() => import("../../../App.jsx").then((m) => ({ default: m.Analyzer })));
const MindMapStudio = lazy(() => import("../../../App.jsx").then((m) => ({ default: m.MindMap })));
// Contexto de negócio que o Estúdio usa para os exemplos e prompts saírem no
// tom da To Do Green (transportadora elétrica), em vez do exemplo genérico.
const negocioTDG = {
  id: "todogreen",
  name: "To Do Green",
  segment: "Transportadora rodoviária 100% elétrica (B2B)",
  goal: "Transporte de carga com frota elétrica, foco em ESG e redução de CO2",
  focusAreas: "logística, frota elétrica, ESG, transporte de cargas",
};

export default function TelasEstudio({ contexto }) {
  const { db, update, setToast, page } = contexto;
  return (<>
      {page === "estudio-criativo" && <Suspense fallback={<section className="tdg-panel">Carregando o estúdio...</section>}><div className="tdg-page tdg-estudio"><CreativeToolkit business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "midia" && <Suspense fallback={<section className="tdg-panel">Carregando a mídia...</section>}><div className="tdg-page tdg-estudio"><MediaStudio db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "editor-codigo" && <Suspense fallback={<section className="tdg-panel">Carregando o editor...</section>}><div className="tdg-page tdg-estudio"><CodeStudio db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "analise-texto" && <Suspense fallback={<section className="tdg-panel">Carregando a análise...</section>}><div className="tdg-page tdg-estudio"><TextAnalyzer db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
      {page === "mapa-ideias" && <Suspense fallback={<section className="tdg-panel">Carregando o mapa...</section>}><div className="tdg-page tdg-estudio"><MindMapStudio db={db} update={update} business={negocioTDG} setToast={setToast} /></div></Suspense>}
  </>);
}
