// Páginas que servem a mais de um grupo de telas. Cada uma é declarada UMA
// vez: dois `lazy()` do mesmo módulo seriam dois componentes diferentes, e a
// tela do segundo grupo mostraria o "Carregando..." mesmo com o código já
// baixado pela primeira.
import { lazy } from "react";

export const TransactionalSpinePage = lazy(() => import("../pages/TransactionalSpinePage.jsx"));
export const EnterpriseAreaPage = lazy(() => import("../pages/EnterpriseAreaPage.jsx"));
