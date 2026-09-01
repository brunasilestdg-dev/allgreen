import {
  Boxes, Building2, FileText, Landmark, Layers, MapPin, Route,
  TableProperties, Truck, UserRound, Users, WalletCards, Warehouse,
} from "lucide-react";
import { UNITS, formatDocument } from "../erpCoreDomain.js";

export const TABS = [
  { id:"items", title:"Materiais", icon:Boxes, singular:"material", source:"records" },
  { id:"warehouses", title:"Depósitos", icon:Warehouse, singular:"depósito", source:"records" },
  { id:"parties", title:"Fornecedores e parceiros", icon:Building2, singular:"fornecedor ou parceiro", source:"records" },
  { id:"costCenters", title:"Centros de custo", icon:Layers, singular:"centro de custo", source:"records" },
  { id:"accounts", title:"Plano de contas", icon:Landmark, singular:"conta", source:"records" },
  { id:"vehicles", title:"Veículos", icon:Truck, singular:"veículo", source:"fleet" },
  { id:"drivers", title:"Motoristas", icon:UserRound, singular:"motorista", source:"master", resource:"drivers" },
  { id:"employees", title:"Colaboradores", icon:Users, singular:"colaborador", source:"master", resource:"employees" },
  { id:"operationalUnits", title:"Bases e unidades", icon:MapPin, singular:"base ou unidade", source:"master", resource:"operational-units" },
  { id:"routes", title:"Rotas padrão", icon:Route, singular:"rota", source:"master", resource:"routes" },
  { id:"priceTables", title:"Tabelas de preço", icon:TableProperties, singular:"tabela de preço", source:"master", resource:"price-tables" },
  { id:"companyProfiles", title:"Dados da empresa", icon:FileText, singular:"cadastro da empresa", source:"master", resource:"company-profiles" },
  { id:"bankAccounts", title:"Contas bancárias", icon:WalletCards, singular:"conta bancária", source:"master", resource:"bank-accounts" },
];

// Regra da titular (30/08): "não tem que ter tela de cadastros unitárias a
// menos que se correlacionem — veículo e motorista pode ficar na mesma tela,
// mas não tá tabela de preço". Cada grupo abaixo é UMA tela; as seções dentro
// dele aparecem juntas porque uma alimenta a outra na operação. Cadastro sem
// correlação (tabela de preço, dados da empresa) fica sozinho de propósito.
export const GROUPS = [
  { id: "frota", title: "Frota", tabs: ["vehicles", "drivers"] },
  { id: "suprimentos", title: "Suprimentos", tabs: ["items", "warehouses", "parties"] },
  { id: "rede", title: "Rede logística", tabs: ["operationalUnits", "routes"] },
  { id: "financeiro", title: "Financeiro", tabs: ["costCenters", "accounts", "bankAccounts"] },
  { id: "pessoas", title: "Colaboradores", tabs: ["employees"] },
  { id: "precos", title: "Tabelas de preço", tabs: ["priceTables"] },
  { id: "empresa", title: "Dados da empresa", tabs: ["companyProfiles"] },
];

// O ?secao= do menu aponta para a SEÇÃO (materiais, veículos...); a tela abre
// o grupo que a contém.
export const groupOfTab = (tabId) =>
  GROUPS.find((group) => group.tabs.includes(tabId)) || GROUPS[0];

export const SELECTS = {
  warehouseKind:[["proprio","Próprio"],["terceiro","De terceiro"],["transito","Em trânsito"],["veiculo","Veículo"]],
  partyRole:[["fornecedor","Fornecedor"],["cliente","Cliente"],["transportador","Transportador"],["prestador","Prestador de serviço"]],
  accountKind:[["ativo","Ativo"],["passivo","Passivo"],["receita","Receita"],["despesa","Despesa"],["resultado","Resultado"]],
  vehicleStatus:[["available","Disponível"],["in_operation","Em operação"],["maintenance","Manutenção"],["inactive","Inativo"]],
  employmentType:[["employee","CLT / empregado"],["pj","PJ"],["temporary","Temporário"],["intern","Estágio"],["apprentice","Aprendiz"],["third_party","Terceiro"],["other","Outro"]],
  driverEmployment:[["employee","Colaborador"],["aggregate","Agregado"],["pj","PJ"],["third_party","Terceiro"],["other","Outro"]],
  driverAvailability:[["available","Disponível"],["allocated","Alocado"],["off_shift","Fora de jornada"],["leave","Afastado"],["blocked","Bloqueado"],["unavailable","Indisponível"]],
  driverStatus:[["draft","Cadastro incompleto"],["active","Ativo"],["blocked","Bloqueado"],["inactive","Inativo"]],
  employeeStatus:[["draft","Cadastro incompleto"],["active","Ativo"],["leave","Afastado"],["inactive","Inativo"],["terminated","Desligado"]],
  unitKind:[["headquarters","Matriz"],["base","Base"],["hub","Hub"],["cross_dock","Cross-docking"],["warehouse","Depósito"],["support","Apoio"],["other","Outro"]],
  genericStatus:[["draft","Rascunho"],["active","Ativo"],["inactive","Inativo"]],
  priceStatus:[["draft","Rascunho"],["active","Ativa"],["expired","Vencida"],["inactive","Inativa"]],
  companyStatus:[["draft","Cadastro incompleto"],["active","Ativo"],["inactive","Inativo"]],
  rntrcStatus:[["","Não informado"],["ATIVO","Ativo"],["SUSPENSO","Suspenso"],["VENCIDO","Vencido"],["INATIVO","Inativo"]],
  accountOwner:[["company","Empresa"],["party","Fornecedor / parceiro"],["employee","Colaborador"],["driver","Motorista"]],
  bankAccountType:[["checking","Conta corrente"],["savings","Poupança"],["payment","Conta de pagamento"],["other","Outra"]],
  yesNo:[["false","Não"],["true","Sim"]],
};

export const FORMS = {
  items:{ initial:{codigo:"",nome:"",unidade:"UN",categoria:"",estoqueMinimo:"",custoReferencia:""}, fields:[["codigo","Código","text",true],["nome","Nome","text",true],["unidade","Unidade","unit"],["categoria","Categoria"],["estoqueMinimo","Estoque mínimo","number"],["custoReferencia","Custo de referência","number"]] },
  warehouses:{ initial:{codigo:"",nome:"",tipo:"proprio",endereco:""}, fields:[["codigo","Código","text",true],["nome","Nome","text",true],["tipo","Tipo","select",false,"warehouseKind"],["endereco","Endereço"]] },
  parties:{ initial:{nome:"",documento:"",papeis:"fornecedor",email:"",telefone:""}, fields:[["nome","Razão social / nome","text",true],["documento","CNPJ ou CPF"],["papeis","Papel","select",false,"partyRole"],["email","E-mail","email"],["telefone","Telefone"]] },
  costCenters:{ initial:{codigo:"",nome:""}, fields:[["codigo","Código","text",true],["nome","Nome","text",true]] },
  accounts:{ initial:{codigo:"",nome:"",tipo:"despesa"}, fields:[["codigo","Código","text",true],["nome","Nome","text",true],["tipo","Natureza","select",false,"accountKind"]] },
  vehicles:{ initial:{prefix:"",plate:"",manufacturer:"",model:"",modelYear:"",category:"",operationalUnit:"",payloadKg:"",batteryCapacityKwh:"",realRangeKm:"",status:"available"}, fields:[["prefix","Prefixo","text",true],["plate","Placa"],["manufacturer","Fabricante"],["model","Modelo"],["modelYear","Ano","number"],["category","Categoria"],["operationalUnit","Base / unidade"],["payloadKg","Capacidade kg","number"],["batteryCapacityKwh","Bateria kWh","number"],["realRangeKm","Autonomia real km","number"],["status","Status","select",false,"vehicleStatus"]] },
  drivers:{ initial:{driverCode:"",fullName:"",document:"",employmentType:"employee",phone:"",email:"",userEmail:"",operationalUnitId:"",baseName:"",availabilityStatus:"unavailable",cnhNumber:"",cnhCategory:"",cnhExpiresAt:"",moppExpiresAt:"",rntrc:"",status:"draft"}, fields:[["driverCode","Código"],["fullName","Nome completo","text",true],["document","CPF / CNPJ"],["employmentType","Vínculo","select",false,"driverEmployment"],["phone","Telefone"],["email","E-mail","email"],["userEmail","E-mail de acesso (portal do motorista)","email"],["operationalUnitId","ID da base / unidade"],["baseName","Base de referência"],["availabilityStatus","Disponibilidade","select",false,"driverAvailability"],["cnhNumber","CNH"],["cnhCategory","Categoria CNH"],["cnhExpiresAt","Validade CNH","date"],["moppExpiresAt","Validade MOPP","date"],["rntrc","RNTRC, quando aplicável"],["status","Status cadastral","select",false,"driverStatus"]] },
  employees:{ initial:{employeeCode:"",fullName:"",document:"",employmentType:"employee",hireDate:"",jobTitle:"",department:"",workEmail:"",phone:"",operationalUnitId:"",costCenterId:"",status:"draft"}, fields:[["employeeCode","Matrícula / código"],["fullName","Nome completo","text",true],["document","CPF / CNPJ"],["employmentType","Vínculo","select",false,"employmentType"],["hireDate","Data de admissão","date"],["jobTitle","Cargo"],["department","Área / departamento"],["workEmail","E-mail corporativo","email"],["phone","Telefone"],["operationalUnitId","ID da base / unidade"],["costCenterId","ID do centro de custo"],["status","Status","select",false,"employeeStatus"]] },
  operationalUnits:{ initial:{code:"",name:"",kind:"base",document:"",addressText:"",status:"draft"}, fields:[["code","Código"],["name","Nome da base / unidade","text",true],["kind","Tipo","select",false,"unitKind"],["document","CNPJ, se houver"],["addressText","Endereço"],["status","Status","select",false,"genericStatus"]] },
  routes:{ initial:{code:"",name:"",productId:"",originUnitId:"",destinationUnitId:"",distanceKm:"",estimatedDurationMin:"",vehicleCategory:"",tollAmount:"",status:"draft"}, fields:[["code","Código"],["name","Nome da rota","text",true],["productId","Produto logístico"],["originUnitId","ID da origem"],["destinationUnitId","ID do destino"],["distanceKm","Distância km","number"],["estimatedDurationMin","Duração estimada min","number"],["vehicleCategory","Categoria de veículo"],["tollAmount","Pedágio","number"],["status","Status","select",false,"genericStatus"]] },
  priceTables:{ initial:{code:"",name:"",clientId:"",contractId:"",productId:"",currency:"BRL",validFrom:"",validUntil:"",adjustmentIndex:"",documentUrl:"",status:"draft"}, fields:[["code","Código"],["name","Nome da tabela","text",true],["clientId","ID do cliente, quando específica"],["contractId","ID do contrato, quando específico"],["productId","Produto logístico"],["currency","Moeda"],["validFrom","Vigência inicial","date"],["validUntil","Vigência final","date"],["adjustmentIndex","Índice de reajuste"],["documentUrl","Arquivo da tabela (.xlsx, .pdf, .csv...) — envie do computador ou cole um link","file"],["status","Status","select",false,"priceStatus"]] },
  companyProfiles:{ initial:{legalName:"",tradeName:"",document:"",stateRegistration:"",cityRegistration:"",rntrc:"",rntrcCategory:"",rntrcStatus:"",rntrcCheckedAt:"",addressText:"",status:"draft"}, fields:[["legalName","Razão social","text",true],["tradeName","Nome fantasia"],["document","CNPJ"],["stateRegistration","Inscrição estadual"],["cityRegistration","Inscrição municipal"],["rntrc","RNTRC"],["rntrcCategory","Categoria RNTRC"],["rntrcStatus","Status RNTRC","select",false,"rntrcStatus"],["rntrcCheckedAt","Data da consulta RNTRC","date"],["addressText","Endereço completo"],["status","Status do cadastro","select",false,"companyStatus"]] },
  bankAccounts:{ initial:{ownerType:"company",ownerId:"",bankCode:"",bankName:"",branch:"",account:"",accountDigit:"",accountType:"checking",pixKeyType:"",pixKey:"",isDefault:"false",status:"draft"}, fields:[["ownerType","Titular","select",false,"accountOwner"],["ownerId","ID do titular, quando não for a empresa"],["bankCode","Código do banco"],["bankName","Banco","text",true],["branch","Agência"],["account","Conta"],["accountDigit","Dígito"],["accountType","Tipo de conta","select",false,"bankAccountType"],["pixKeyType","Tipo de chave Pix"],["pixKey","Chave Pix"],["isDefault","Conta principal","select",false,"yesNo"],["status","Status","select",false,"genericStatus"]] },
};

export const COLUMNS = {
  items:["Código","Material","Unidade","Categoria","Estoque mínimo"], warehouses:["Código","Depósito","Tipo","Endereço"], parties:["Pessoa ou parceiro","Documento","Papéis","Canal"], costCenters:["Código","Centro de custo"], accounts:["Código","Conta","Natureza"], vehicles:["Prefixo","Placa","Modelo","Base","Status"], drivers:["Código","Motorista","Documento","CNH","Disponibilidade","Status"], employees:["Matrícula","Colaborador","Cargo","Área","Vínculo","Status"], operationalUnits:["Código","Base / unidade","Tipo","Endereço","Status"], routes:["Código","Rota","Origem","Destino","Distância","Status"], priceTables:["Código","Tabela","Produto","Vigência","Arquivo","Status"], companyProfiles:["Razão social","CNPJ","RNTRC","Status RNTRC","Cadastro"], bankAccounts:["Titular","Banco","Agência","Conta","Tipo","Status"],
};

const num = (v) => Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const date = (v) => v ? new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";

export const rowFor = (tab,r) => {
  if(tab==="items") return [r.codigo,r.nome,r.unidade,r.categoria||"—",num(r.estoqueMinimo)];
  if(tab==="warehouses") return [r.codigo,r.nome,r.tipo,r.endereco||"—"];
  if(tab==="parties") return [r.razaoSocial||r.nome,r.documento?formatDocument(r.documento):"—",(r.papeis||[]).join(", ")||"—",r.email||r.telefone||"—"];
  if(tab==="costCenters") return [r.codigo,r.nome];
  if(tab==="accounts") return [r.codigo,r.nome,r.tipo||r.natureza];
  if(tab==="vehicles") return [r.prefix,r.plate||"—",[r.manufacturer,r.model].filter(Boolean).join(" ")||"—",r.operationalUnit||"—",r.status||"—"];
  if(tab==="drivers") return [r.driverCode||"—",r.fullName,r.document?formatDocument(r.document):"—",[r.cnhNumber,r.cnhCategory].filter(Boolean).join(" / ")||"—",r.availabilityStatus,r.status];
  if(tab==="employees") return [r.employeeCode||"—",r.fullName,r.jobTitle||"—",r.department||"—",r.employmentType,r.status];
  if(tab==="operationalUnits") return [r.code||"—",r.name,r.kind,r.address?.full||r.address?.address||"—",r.status];
  if(tab==="routes") return [r.code||"—",r.name,r.originUnitId||r.origin?.city||"—",r.destinationUnitId||r.destination?.city||"—",`${num(r.distanceKm)} km`,r.status];
  if(tab==="priceTables") return [r.code||"—",r.name,r.productId||"—",`${date(r.validFrom)} a ${date(r.validUntil)}`,r.documentUrl?"com arquivo":"—",r.status];
  if(tab==="companyProfiles") return [r.legalName||r.tradeName,r.document?formatDocument(r.document):"—",r.rntrc||"—",r.rntrcStatus||"—",r.status];
  if(tab==="bankAccounts") return [r.ownerType,r.bankName||r.bankCode||"—",r.branch||"—",`${r.account||"—"}${r.accountDigit?`-${r.accountDigit}`:""}`,r.accountType,r.status];
  return [];
};

export const payloadFor = (tab,form) => {
  const body={...form};
  delete body.__arquivoNome; // rótulo só de tela (nome do arquivo enviado), nunca vai ao servidor
  if(tab==="parties"){body.papeis=[form.papeis];body.razaoSocial=form.nome;}
  if(tab==="items"){body.estoqueMinimo=form.estoqueMinimo===""?0:Number(form.estoqueMinimo);body.custoReferencia=form.custoReferencia===""?0:Number(form.custoReferencia);}
  if(["operationalUnits","companyProfiles"].includes(tab)){body.address=form.addressText?{full:form.addressText}:{};delete body.addressText;}
  if(tab==="bankAccounts") body.isDefault=form.isDefault===true||form.isDefault==="true";
  for(const key of ["modelYear","payloadKg","batteryCapacityKwh","realRangeKm","distanceKm","estimatedDurationMin","tollAmount"]){if(key in body) body[key]=body[key]===""?0:Number(body[key]);}
  return body;
};

export { UNITS };
