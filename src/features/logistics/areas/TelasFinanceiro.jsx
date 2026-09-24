// Telas de Financeiro e Fiscal: faturamento, títulos, rateios, receita, custos,
// comissões, tesouraria, GreenPay e documentos fiscais.
import { Suspense, lazy } from "react";
import { TransactionalSpinePage } from "./paginasCompartilhadas.js";

const FiscalPage = lazy(() => import("../pages/FiscalPage.jsx"));
const TreasuryPage = lazy(() => import("../pages/TreasuryPage.jsx"));
const FinancePage = lazy(() => import("../pages/FinancePage.jsx"));
const GreenPayAdminPage = lazy(() => import("../pages/GreenPayAdminPage.jsx"));

export default function TelasFinanceiro({ contexto }) {
  const {
    setToast, authHeaders, page, registros, criar, registrarPagamento, estornarPagamento,
    listarSubrecurso, clientes,
  } = contexto;
  return (<>
      {page === "fiscal" && <Suspense fallback={<section className="tdg-panel">Carregando fiscal...</section>}><FiscalPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "tesouraria" && <Suspense fallback={<section className="tdg-panel">Carregando a tesouraria...</section>}><TreasuryPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "greenpay" && <Suspense fallback={<section className="tdg-panel">Carregando o GreenPay...</section>}><GreenPayAdminPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "receita" && <Suspense fallback={<section className="tdg-panel">Carregando contas a receber...</section>}><FinancePage type="revenue" entries={registros.financial.filter((item) => item.tipo === "revenue")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "faturamento" && <Suspense fallback={<section className="tdg-panel">Carregando faturamento...</section>}><TransactionalSpinePage mode="billing" authHeaders={authHeaders} clients={clientes} setToast={setToast} /></Suspense>}
      {page === "titulos" && <Suspense fallback={<section className="tdg-panel">Carregando títulos...</section>}><TransactionalSpinePage mode="titles" authHeaders={authHeaders} clients={clientes} setToast={setToast} /></Suspense>}
      {page === "rateios" && <Suspense fallback={<section className="tdg-panel">Carregando rateios...</section>}><TransactionalSpinePage mode="costs" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "custos" && <Suspense fallback={<section className="tdg-panel">Carregando custos e margem...</section>}><FinancePage type="cost" entries={registros.financial.filter((item) => item.tipo === "cost")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "comissoes" && <Suspense fallback={<section className="tdg-panel">Carregando comissões...</section>}><FinancePage type="commission" entries={registros.financial.filter((item) => item.tipo === "commission")} clients={clientes} contracts={registros.contracts} criar={criar} registrarPagamento={registrarPagamento} estornarPagamento={estornarPagamento} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
  </>);
}
