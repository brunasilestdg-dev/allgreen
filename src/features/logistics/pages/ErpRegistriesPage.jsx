import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Building2,
  FileText,
  Landmark,
  Layers,
  MapPin,
  Route,
  TableProperties,
  Truck,
  UserRound,
  Users,
  WalletCards,
  Warehouse,
} from "lucide-react";
import { UNITS, formatDocument } from "../erpCoreDomain.js";
import "./TodoGreenPages.css";

const MASTER_API = "/api/todogreen/master-data";

const TABS = [
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

const SELECTS = {
  warehouseKind: [
    ["proprio","Próprio"],["terceiro","De terceiro"],["transito","Em trânsito"],["veiculo","Veículo"],
  ],
  partyRole: [
    ["fornecedor","Fornecedor"],["cliente","Cliente"],["transportador","Transportador"],["prestador","Prestador de serviço"],
  ],
  vehicleStatus: [["available","Disponível"],["in_operation","Em operação"],["maintenance","Manutenção"],["inactive","Inativo"]],
  employmentType: [["employee","CLT / empregado"],["pj","PJ"],["temporary","Temporário"],["intern","Estágio"],["apprentice","Aprendiz"],["third_party","Terceiro"],["other","Outro"]],
  driverEmployment: [["employee","Colaborador"],["aggregate","Agregado"],["pj","PJ"],["third_party","Terceiro"],["other","Outro"]],
  driverAvailability: [["available","Disponível"],["allocated","Alocado"],["off_shift","Fora de jornada"],["leave","Afastado"],["blocked","Bloqueado"],["unavailable","Indisponível"]],
  driverStatus: [["draft","Cadastro incompleto"],["active","Ativo"],["blocked","Bloqueado"],["inactive","Inativo"]],
  employeeStatus: [["draft","Cadastro incompleto"],["active","Ativo"],["leave","Afastado"],["inactive","Inativo"],["terminated","Desligado"]],
  unitKind: [["headquarters","Matriz"],["base","Base"],["hub","Hub"],["cross_dock","Cross-docking"],["warehouse","Depósito"],["support","Apoio"],["other","Outro"]],
  genericStatus: [["draft","Rascunho"],["active","Ativo"],["inactive","Inativo"]],
  priceStatus: [["draft","Rascunho"],["active","Ativa"],["expired","Vencida"],["inactive","Inativa"]],
  companyStatus: [["draft","Cadastro incompleto"],["active","Ativo"],["inactive","Inativo"]],
  rntrcStatus: [["","Não informado"],["ATIVO","Ativo"],["SUSPENSO","Suspenso"],["VENCIDO","Vencido"],["INATIVO","Inativo"]],
  accountOwner: [["company","Empresa"],["party","Fornecedor / parceiro"],["employee","Colaborador"],["driver","Motorista"]],
  bankAccountType: [["checking","Conta corrente"],["savings","Poupança"],["payment","Conta de pagamento"],["other","Outra"]],
  yesNo: [["false","Não"],["true","Sim"]],
};

const FORMS = {
  items: {
    initial:{ codigo:"",nome:"",unidade:"UN",categoria:"",estoqueMinimo:"",custoReferencia:"" },
    fields:[
      ["codigo","Código","text",true],["nome","Nome","text",true],
      ["unidade","Unidade","unit"],["categoria","Categoria"],
      ["estoqueMinimo","Estoque mínimo","number"],["custoReferencia","Custo de referência","number"],
    ],
  },
  warehouses: {
    initial:{ codigo:"",nome:"",tipo:"proprio",endereco:"" },
    fields:[["codigo","Código","text",true],["nome","Nome","text",true],["tipo","Tipo","select",false,"warehouseKind"],["endereco","Endereço"]],
  },
  parties: {
    initial:{ nome:"",documento:"",papeis:"fornecedor",email:"",telefone:"" },
    fields:[["nome","Razão social / nome","text",true],["documento","CNPJ ou CPF"],["papeis","Papel","select",false,"partyRole"],["email","E-mail","email"],["telefone","Telefone"]],
  },
  costCenters: { initial:{ codigo:"",nome:"" }, fields:[["codigo","Código","text",true],["nome","Nome","text",true]] },
  accounts: {
    initial:{ codigo:"",nome:"",tipo:"despesa" },
    fields:[["codigo","Código","text",true],["nome","Nome","text",true],["tipo","Natureza","select",false,"accountKind"]],
  },
  vehicles: {
    initial:{ prefix:"",plate:"",manufacturer:"",model:"",modelYear:"",category:"",operationalUnit:"",payloadKg:"",batteryCapacityKwh:"",realRangeKm:"",status:"available" },
    fields:[
      ["prefix","Prefixo","text",true],["plate","Placa"],["manufacturer","Fabricante"],["model","Modelo"],["modelYear","Ano","number"],
      ["category","Categoria"],["operationalUnit","Base / unidade"],["payloadKg","Capacidade kg","number"],
      ["batteryCapacityKwh","Bateria kWh","number"],["realRangeKm","Autonomia real km","number"],["status","Status","select",false,"vehicleStatus"],
    ],
  },
  drivers: {
    initial:{ driverCode:"",fullName:"",document:"",employmentType:"employee",phone:"",email:"",operationalUnitId:"",baseName:"",availabilityStatus:"unavailable",cnhNumber:"",cnhCategory:"",cnhExpiresAt:"",moppExpiresAt:"",rntrc:"",status:"draft" },
    fields:[
      ["driverCode","Código"],["fullName","Nome completo","text",true],["document","CPF / CNPJ"],["employmentType","Vínculo","select",false,"driverEmployment"],
      ["phone","Telefone"],["email","E-mail","email"],["operationalUnitId","ID da base / unidade"],["baseName","Base de referência"],
      ["availabilityStatus","Disponibilidade","select",false,"driverAvailability"],["cnhNumber","CNH"],["cnhCategory","Categoria CNH"],
      ["cnhExpiresAt","Validade CNH","date"],["moppExpiresAt","Validade MOPP","date"],["rntrc","RNTRC, quando aplicável"],["status","Status cadastral","select",false,"driverStatus"],
    ],
  },
  employees: {
    initial:{ employeeCode:"",fullName:"",document:"",employmentType:"employee",hireDate:"",jobTitle:"",department:"",workEmail:"",phone:"",operationalUnitId:"",costCenterId:"",status:"draft" },
    fields:[
      ["employeeCode","Matrícula / código"],["fullName","Nome completo","text",true],["document","CPF / CNPJ"],["employmentType","Vínculo","select",false,"employmentType"],
      ["hireDate","Data de admissão","date"],["jobTitle","Cargo"],["department","Área / departamento"],["workEmail","E-mail corporativo","email"],
      ["phone","Telefone"],["operationalUnitId","ID da base / unidade"],["costCenterId","ID do centro de custo"],["status","Status","select",false,"employeeStatus"],
    ],
  },
  operationalUnits: {
    initial:{ code:"",name:"",kind:"base",document:"",addressText:"",status:"draft" },
    fields:[["code","Código"],["name","Nome da base / unidade","text",true],["kind","Tipo","select",false,"unitKind"],["document","CNPJ, se houver"],["addressText","Endereço"],["status","Status","select",false,"genericStatus"]],
  },
  routes: {
    initial:{ code:"",name:"",productId:"",originUnitId:"",destinationUnitId:"",distanceKm:"",estimatedDurationMin:"",vehicleCategory:"",tollAmount:"",status:"draft" },
    fields:[
      ["code","Código"],["name","Nome da rota","text",true],["productId","Produto logístico"],["originUnitId","ID da origem"],["destinationUnitId","ID do destino"],
      ["distanceKm","Distância km","number"],["estimatedDurationMin","Duração estimada min","number"],["vehicleCategory","Categoria de veículo"],["tollAmount","Pedágio","number"],["status","Status","select",false,"genericStatus"],
    ],
  },
  priceTables: {
    initial:{ code:"",name:"",clientId:"",contractId:"",productId:"",currency:"BRL",validFrom:"",validUntil:"",adjustmentIndex:"",status:"draft" },
    fields:[
      ["code","Código"],["name","Nome da tabela","text",true],["clientId","ID do cliente, quando específica"],["contractId","ID do contrato, quando específico"],
      ["productId","Produto logístico"],["currency","Moeda"],["validFrom","Vigência inicial","date"],["validUntil","Vigência final","date"],["adjustmentIndex","Índice de reajuste"],["status","Status","select",false,"priceStatus"],
    ],
  },
  companyProfiles: {
    initial:{ legalName:"",tradeName:"",document:"",stateRegistration:"",cityRegistration:"",rntrc:"",rntrcCategory:"",rntrcStatus:"",rntrcCheckedAt:"",addressText:"",status:"draft" },
    fields:[
      ["legalName","Razão social","text",true],["tradeName","Nome fantasia"],["document","CNPJ"],["stateRegistration","Inscrição estadual"],["cityRegistration","Inscrição municipal"],
      ["rntrc","RNTRC"],["rntrcCategory","Categoria RNTRC"],["rntrcStatus","Status RNTRC","select",false,"rntrcStatus"],["rntrcCheckedAt","Data da consulta RNTRC","date"],
      ["addressText","Endereço completo"],["status","Status do cadastro","select",false,"companyStatus"],
    ],
  },
  bankAccounts: {
    initial:{ ownerType:"company",ownerId:"",bankCode:"",bankName:"",branch:"",account:"",accountDigit:"",accountType:"checking",pixKeyType:"",pixKey:"",isDefault:"false",status:"draft" },
    fields:[
      ["ownerType","Titular","select",false,"accountOwner"],["ownerId","ID do titular, quando não for a empresa"],["bankCode","Código do banco"],["bankName","Banco","text",true],
      ["branch","Agência"],["account","Conta"],["accountDigit","Dígito"],["accountType","Tipo de conta","select",false,"bankAccountType"],
      ["pixKeyType","Tipo de chave Pix"],["pixKey","Chave Pix"],["isDefault","Conta principal","select",false,"yesNo"],["status","Status","select",false,"genericStatus"],
    ],
  },
};

SELECTS.accountKind = [["ativo","Ativo"],["passivo","Passivo"],["receita","Receita"],["despesa","Despesa"],["resultado","Resultado"]];

const COLUMNS = {
  items:["Código","Material","Unidade","Categoria","Estoque mínimo"],
  warehouses:["Código","Depósito","Tipo","Endereço"],
  parties:["Pessoa ou parceiro","Documento","Papéis","Canal"],
  costCenters:["Código","Centro de custo"],
  accounts:["Código","Conta","Natureza"],
  vehicles:["Prefixo","Placa","Modelo","Base","Status"],
  drivers:["Código","Motorista","Documento","CNH","Disponibilidade","Status"],
  employees:["Matrícula","Colaborador","Cargo","Área","Vínculo","Status"],
  operationalUnits:["Código","Base / unidade","Tipo","Endereço","Status"],
  routes:["Código","Rota","Origem","Destino","Distância","Status"],
  priceTables:["Código","Tabela","Produto","Vigência","Status"],
  companyProfiles:["Razão social","CNPJ","RNTRC","Status RNTRC","Cadastro"],
  bankAccounts:["Titular","Banco","Agência","Conta","Tipo","Status"],
};

const numberPt = (value) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits:3 });
const fmtDate = (value) => value ? new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";

const rowFor = (tab, r) => {
  if (tab === "items") return [r.codigo,r.nome,r.unidade,r.categoria||"—",numberPt(r.estoqueMinimo)];
  if (tab === "warehouses") return [r.codigo,r.nome,r.tipo,r.endereco||"—"];
  if (tab === "parties") return [r.razaoSocial||r.nome,r.documento?formatDocument(r.documento):"—",(r.papeis||[]).join(", ")||"—",r.email||r.telefone||"—"];
  if (tab === "costCenters") return [r.codigo,r.nome];
  if (tab === "accounts") return [r.codigo,r.nome,r.tipo||r.natureza];
  if (tab === "vehicles") return [r.prefix,r.plate||"—",[r.manufacturer,r.model].filter(Boolean).join(" ")||"—",r.operationalUnit||"—",r.status||"—"];
  if (tab === "drivers") return [r.driverCode||"—",r.fullName,r.document?formatDocument(r.document):"—",[r.cnhNumber,r.cnhCategory].filter(Boolean).join(" / ")||"—",r.availabilityStatus,r.status];
  if (tab === "employees") return [r.employeeCode||"—",r.fullName,r.jobTitle||"—",r.department||"—",r.employmentType,r.status];
  if (tab === "operationalUnits") return [r.code||"—",r.name,r.kind,r.address?.full||r.address?.address||"—",r.status];
  if (tab === "routes") return [r.code||"—",r.name,r.originUnitId||r.origin?.city||"—",r.destinationUnitId||r.destination?.city||"—",`${numberPt(r.distanceKm)} km`,r.status];
  if (tab === "priceTables") return [r.code||"—",r.name,r.productId||"—",`${fmtDate(r.validFrom)} a ${fmtDate(r.validUntil)}`,r.status];
  if (tab === "companyProfiles") return [r.legalName||r.tradeName,r.document?formatDocument(r.document):"—",r.rntrc||"—",r.rntrcStatus||"—",r.status];
  if (tab === "bankAccounts") return [r.ownerType,r.bankName||r.bankCode||"—",r.branch||"—",`${r.account||"—"}${r.accountDigit?`-${r.accountDigit}`:""}`,r.accountType,r.status];
  return [];
};

const payloadFor = (tab, form) => {
  const body = { ...form };
  if (tab === "parties") {
    body.papeis = [form.papeis];
    body.razaoSocial = form.nome;
  }
  if (tab === "items") {
    body.estoqueMinimo = form.estoqueMinimo === "" ? 0 : Number(form.estoqueMinimo);
    body.custoReferencia = form.custoReferencia === "" ? 0 : Number(form.custoReferencia);
  }
  if (["operationalUnits","companyProfiles"].includes(tab)) {
    body.address = form.addressText ? { full:form.addressText } : {};
    delete body.addressText;
  }
  if (tab === "bankAccounts") body.isDefault = form.isDefault === true || form.isDefault === "true";
  for (const key of ["modelYear","payloadKg","batteryCapacityKwh","realRangeKm","distanceKm","estimatedDurationMin","tollAmount"]) {
    if (key in body) body[key] = body[key] === "" ? 0 : Number(body[key]);
  }
  return body;
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    method:options.method||"GET",
    headers:options.body?{"content-type":"application/json"}:undefined,
    body:options.body?JSON.stringify(options.body):undefined,
  });
  const payload = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(payload.error||"Não foi possível concluir o cadastro.");
  return payload;
}

export default function ErpRegistriesPage({ registros, criar, setToast }) {
  const [tab, setTab] = useState("items");
  const [external, setExternal] = useState({});
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentTab = TABS.find((item)=>item.id===tab)||TABS[0];
  const formConfig = FORMS[tab]||FORMS.items;
  const [form, setForm] = useState(formConfig.initial);

  useEffect(() => {
    setForm(FORMS[tab]?.initial||{});
    setShowForm(false);
  }, [tab]);

  useEffect(() => {
    if (currentTab.source === "records") return;
    let active = true;
    setLoading(true);
    const path = currentTab.source === "fleet" ? "/api/todogreen/fleet" : `${MASTER_API}/${currentTab.resource}?limit=500`;
    api(path)
      .then((payload) => {
        if (!active) return;
        setExternal((now)=>({ ...now, [tab]: currentTab.source === "fleet" ? payload.vehicles||[] : payload.records||[] }));
      })
      .catch((error)=>active&&setToast?.(error.message))
      .finally(()=>active&&setLoading(false));
    return ()=>{ active=false; };
  }, [tab, currentTab.resource, currentTab.source, setToast]);

  const list = currentTab.source === "records" ? registros?.[tab]||[] : external[tab]||[];
  const columns = useMemo(()=>COLUMNS[tab]||[],[tab]);
  const Icon = currentTab.icon;

  const change = (field, value) => setForm((now)=>({ ...now, [field]:value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const body = payloadFor(tab, form);
      let created;
      if (currentTab.source === "records") {
        created = await criar(tab, body);
      } else if (currentTab.source === "fleet") {
        const payload = await api("/api/todogreen/fleet", { method:"POST", body });
        created = payload.vehicle;
      } else {
        const payload = await api(`${MASTER_API}/${currentTab.resource}`, { method:"POST", body });
        created = payload.record;
      }
      if (currentTab.source !== "records" && created) {
        setExternal((now)=>({ ...now, [tab]:[created,...(now[tab]||[])] }));
      }
      setToast?.(`${currentTab.singular[0].toUpperCase()}${currentTab.singular.slice(1)} cadastrado.`);
      setForm(FORMS[tab]?.initial||{});
      setShowForm(false);
    } catch (error) {
      setToast?.(error.message||"Não foi possível cadastrar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CADASTROS MESTRES</span>
          <h2>A base operacional do ERP</h2>
          <p>As estruturas ficam disponíveis agora e permanecem vazias até o cadastro dos dados reais da To Do Green.</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={()=>setShowForm((value)=>!value)}>
            <Icon size={16}/>{showForm?"Fechar":`Novo ${currentTab.singular}`}
          </button>
        </div>
      </header>

      <nav className="tdg-registry-tabs" aria-label="Cadastros mestres do ERP">
        {TABS.map((item)=>(
          <button type="button" key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}>
            {item.title}{(item.source==="records"?registros?.[item.id]?.length:external[item.id]?.length)?` (${item.source==="records"?registros[item.id].length:external[item.id].length})`:""}
          </button>
        ))}
      </nav>

      {showForm && (
        <form className="tdg-panel tdg-form" onSubmit={submit}>
          {(formConfig.fields||[]).map(([field,label,type="text",required=false,selectKey])=>(
            <label key={field}>
              <span>{label}</span>
              {type === "select" ? (
                <select value={form[field]??""} onChange={(e)=>change(field,e.target.value)} required={required}>
                  {(SELECTS[selectKey]||[]).map(([value,labelText])=><option value={value} key={value||"empty"}>{labelText}</option>)}
                </select>
              ) : type === "unit" ? (
                <select value={form[field]||"UN"} onChange={(e)=>change(field,e.target.value)}>
                  {UNITS.map((unit)=><option value={unit.code} key={unit.code}>{unit.code} — {unit.name}</option>)}
                </select>
              ) : (
                <input
                  type={type}
                  value={form[field]??""}
                  onChange={(e)=>change(field,e.target.value)}
                  required={required}
                  min={type==="number"?"0":undefined}
                  step={type==="number"?"any":undefined}
                  maxLength={type==="number"?undefined:500}
                />
              )}
            </label>
          ))}
          <div className="tdg-form-actions full">
            <button className="tdg-action" type="submit" disabled={saving}>{saving?"Cadastrando...":"Cadastrar"}</button>
            <button type="button" onClick={()=>setShowForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">{currentTab.title.toUpperCase()}</span><h2>{currentTab.title}</h2></div>
          <Icon size={22}/>
        </div>
        {loading ? <p className="tdg-empty">Carregando cadastros...</p> : !list.length ? (
          <p className="tdg-empty">Nenhum {currentTab.singular} cadastrado ainda.</p>
        ) : (
          <div className="tdg-table-wrap">
            <table className="tdg-table">
              <thead><tr>{columns.map((column)=><th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {list.map((record)=><tr key={record.id}>{rowFor(tab,record).map((cell,index)=><td key={`${record.id}-${index}`}>{cell}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
