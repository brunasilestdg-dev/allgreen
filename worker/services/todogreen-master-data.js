import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const integer = (value) => Math.trunc(number(value));
const digits = (value, max = 30) => String(value ?? "").replace(/\D+/g, "").slice(0, max);
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const parse = (value, fallback = {}) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const has = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key);
const value = (body, current, inputKey, dbKey, fallback = "") =>
  has(body, inputKey) ? body[inputKey] : current?.[dbKey] ?? fallback;

const allowedAny = (access, permissions = []) =>
  permissions.some((permission) => podeNaVertical(access, permission) || podeNaVertical(access, "*"));

const common = (row) => ({
  id: row.id,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const CONFIG = {
  "company-profiles": {
    table: "todogreen_company_profiles",
    permissions: ["fiscal:manage", "finance:manage"],
    order: "updated_at DESC",
    required: (body) => !text(body.legalName || body.tradeName) ? "Informe a razão social ou nome empresarial." : "",
    map: (r) => ({ ...common(r), legalName:r.legal_name, tradeName:r.trade_name, document:r.document,
      stateRegistration:r.state_registration, cityRegistration:r.city_registration, rntrc:r.rntrc,
      rntrcCategory:r.rntrc_category, rntrcStatus:r.rntrc_status, rntrcCheckedAt:r.rntrc_checked_at || "",
      address:parse(r.address_json,{}), status:r.status, fields:parse(r.fields_json,{}) }),
    encode: (b,c={}) => ({
      legal_name:text(value(b,c,"legalName","legal_name"),240), trade_name:text(value(b,c,"tradeName","trade_name"),240),
      document:digits(value(b,c,"document","document"),14), state_registration:text(value(b,c,"stateRegistration","state_registration"),40),
      city_registration:text(value(b,c,"cityRegistration","city_registration"),40), rntrc:digits(value(b,c,"rntrc","rntrc"),20),
      rntrc_category:text(value(b,c,"rntrcCategory","rntrc_category"),20), rntrc_status:text(value(b,c,"rntrcStatus","rntrc_status"),40),
      rntrc_checked_at:text(value(b,c,"rntrcCheckedAt","rntrc_checked_at"),20)||null,
      address_json:JSON.stringify(object(has(b,"address")?b.address:parse(c.address_json,{}))),
      status:["draft","active","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"draft",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))),
    }),
  },
  "company-documents": {
    table: "todogreen_company_documents", permissions:["fiscal:manage","finance:manage"], order:"expires_at IS NULL, expires_at, updated_at DESC",
    filter:{ profileId:"profile_id" }, required:(b)=>!text(b.profileId)?"Informe o cadastro da empresa.":!text(b.kind)?"Informe o tipo do documento.":"",
    map:(r)=>({ ...common(r), profileId:r.profile_id, kind:r.kind, number:r.number, issuer:r.issuer, issuedAt:r.issued_at||"",
      expiresAt:r.expires_at||"", status:r.status, documentUrl:r.document_url, documentHash:r.document_hash,
      evidenceId:r.evidence_id, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ profile_id:text(value(b,c,"profileId","profile_id"),120), kind:text(value(b,c,"kind","kind","outro"),80)||"outro",
      number:text(value(b,c,"number","number"),120), issuer:text(value(b,c,"issuer","issuer"),120),
      issued_at:text(value(b,c,"issuedAt","issued_at"),20)||null, expires_at:text(value(b,c,"expiresAt","expires_at"),20)||null,
      status:["pending","valid","expired","revoked","not_applicable"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"pending",
      document_url:text(value(b,c,"documentUrl","document_url"),1000), document_hash:text(value(b,c,"documentHash","document_hash"),160),
      evidence_id:text(value(b,c,"evidenceId","evidence_id"),120), fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  employees: {
    table:"todogreen_employees", permissions:["hr:manage"], order:"full_name ASC",
    required:(b)=>!text(b.fullName)?"Informe o nome do colaborador.":"",
    map:(r)=>({ ...common(r), employeeCode:r.employee_code, fullName:r.full_name, document:r.document, employmentType:r.employment_type,
      hireDate:r.hire_date||"", terminationDate:r.termination_date||"", jobTitle:r.job_title, department:r.department,
      managerUserId:r.manager_user_id||"", workEmail:r.work_email, personalEmail:r.personal_email, phone:r.phone,
      operationalUnitId:r.operational_unit_id, costCenterId:r.cost_center_id, status:r.status, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ employee_code:text(value(b,c,"employeeCode","employee_code"),60).toUpperCase(), full_name:text(value(b,c,"fullName","full_name"),240),
      document:digits(value(b,c,"document","document"),14), employment_type:["employee","pj","temporary","intern","apprentice","third_party","other"].includes(text(value(b,c,"employmentType","employment_type")))?text(value(b,c,"employmentType","employment_type")):"employee",
      hire_date:text(value(b,c,"hireDate","hire_date"),20)||null, termination_date:text(value(b,c,"terminationDate","termination_date"),20)||null,
      job_title:text(value(b,c,"jobTitle","job_title"),160), department:text(value(b,c,"department","department"),120),
      manager_user_id:text(value(b,c,"managerUserId","manager_user_id"),120)||null, work_email:text(value(b,c,"workEmail","work_email"),200).toLowerCase(),
      personal_email:text(value(b,c,"personalEmail","personal_email"),200).toLowerCase(), phone:text(value(b,c,"phone","phone"),60),
      operational_unit_id:text(value(b,c,"operationalUnitId","operational_unit_id"),120), cost_center_id:text(value(b,c,"costCenterId","cost_center_id"),120),
      status:["draft","active","leave","inactive","terminated"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"active",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "employee-documents": {
    table:"todogreen_employee_documents", permissions:["hr:manage"], order:"expires_at IS NULL, expires_at, updated_at DESC", filter:{employeeId:"employee_id"},
    required:(b)=>!text(b.employeeId)?"Informe o colaborador.":!text(b.kind)?"Informe o tipo do documento.":"",
    map:(r)=>({ ...common(r), employeeId:r.employee_id, kind:r.kind, number:r.number, issuer:r.issuer, issuedAt:r.issued_at||"", expiresAt:r.expires_at||"",
      status:r.status, documentUrl:r.document_url, documentHash:r.document_hash, evidenceId:r.evidence_id, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ employee_id:text(value(b,c,"employeeId","employee_id"),120), kind:text(value(b,c,"kind","kind"),80), number:text(value(b,c,"number","number"),120),
      issuer:text(value(b,c,"issuer","issuer"),120), issued_at:text(value(b,c,"issuedAt","issued_at"),20)||null, expires_at:text(value(b,c,"expiresAt","expires_at"),20)||null,
      status:["pending","valid","expired","revoked","not_applicable"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"pending",
      document_url:text(value(b,c,"documentUrl","document_url"),1000), document_hash:text(value(b,c,"documentHash","document_hash"),160), evidence_id:text(value(b,c,"evidenceId","evidence_id"),120),
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  drivers: {
    table:"todogreen_drivers", permissions:["fleet:manage","operations:manage","operation:manage","hr:manage"], order:"full_name ASC",
    required:(b)=>!text(b.fullName)?"Informe o nome do motorista.":"",
    map:(r)=>({ ...common(r), employeeId:r.employee_id, partyId:r.party_id, driverCode:r.driver_code, fullName:r.full_name, document:r.document,
      employmentType:r.employment_type, phone:r.phone, email:r.email, operationalUnitId:r.operational_unit_id, baseName:r.base_name,
      availabilityStatus:r.availability_status, cnhNumber:r.cnh_number, cnhCategory:r.cnh_category, cnhExpiresAt:r.cnh_expires_at||"",
      moppExpiresAt:r.mopp_expires_at||"", rntrc:r.rntrc, status:r.status, userEmail:r.user_email||"", fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ employee_id:text(value(b,c,"employeeId","employee_id"),120), party_id:text(value(b,c,"partyId","party_id"),120),
      driver_code:text(value(b,c,"driverCode","driver_code"),60).toUpperCase(), full_name:text(value(b,c,"fullName","full_name"),240), document:digits(value(b,c,"document","document"),14),
      employment_type:["employee","aggregate","pj","third_party","other"].includes(text(value(b,c,"employmentType","employment_type")))?text(value(b,c,"employmentType","employment_type")):"employee",
      phone:text(value(b,c,"phone","phone"),60), email:text(value(b,c,"email","email"),200).toLowerCase(), operational_unit_id:text(value(b,c,"operationalUnitId","operational_unit_id"),120),
      base_name:text(value(b,c,"baseName","base_name"),160), availability_status:["available","allocated","off_shift","leave","blocked","unavailable"].includes(text(value(b,c,"availabilityStatus","availability_status")))?text(value(b,c,"availabilityStatus","availability_status")):"unavailable",
      cnh_number:text(value(b,c,"cnhNumber","cnh_number"),60), cnh_category:text(value(b,c,"cnhCategory","cnh_category"),20).toUpperCase(), cnh_expires_at:text(value(b,c,"cnhExpiresAt","cnh_expires_at"),20)||null,
      mopp_expires_at:text(value(b,c,"moppExpiresAt","mopp_expires_at"),20)||null, rntrc:digits(value(b,c,"rntrc","rntrc"),20),
      // E-mail de acesso ao portal do motorista (0070): é por ele que a sessão
      // da pessoa encontra o próprio cadastro e as próprias viagens.
      user_email:text(value(b,c,"userEmail","user_email"),200).toLowerCase(),
      status:["draft","active","blocked","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"draft",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "driver-documents": {
    table:"todogreen_driver_documents", permissions:["fleet:manage","operations:manage","operation:manage","hr:manage"], order:"expires_at IS NULL, expires_at, updated_at DESC", filter:{driverId:"driver_id"},
    required:(b)=>!text(b.driverId)?"Informe o motorista.":!text(b.kind)?"Informe o tipo do documento.":"",
    map:(r)=>({ ...common(r), driverId:r.driver_id, kind:r.kind, number:r.number, issuer:r.issuer, issuedAt:r.issued_at||"", expiresAt:r.expires_at||"",
      status:r.status, documentUrl:r.document_url, documentHash:r.document_hash, evidenceId:r.evidence_id, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ driver_id:text(value(b,c,"driverId","driver_id"),120), kind:text(value(b,c,"kind","kind"),80), number:text(value(b,c,"number","number"),120),
      issuer:text(value(b,c,"issuer","issuer"),120), issued_at:text(value(b,c,"issuedAt","issued_at"),20)||null, expires_at:text(value(b,c,"expiresAt","expires_at"),20)||null,
      status:["pending","valid","expired","revoked","not_applicable"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"pending",
      document_url:text(value(b,c,"documentUrl","document_url"),1000), document_hash:text(value(b,c,"documentHash","document_hash"),160), evidence_id:text(value(b,c,"evidenceId","evidence_id"),120),
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "operational-units": {
    table:"todogreen_operational_units", permissions:["operations:manage","operation:manage","planning:manage"], order:"name ASC",
    required:(b)=>!text(b.name)?"Informe o nome da base ou unidade.":"",
    map:(r)=>({ ...common(r), code:r.code, name:r.name, kind:r.kind, document:r.document, address:parse(r.address_json,{}), latitude:r.latitude, longitude:r.longitude,
      operatingHours:parse(r.operating_hours_json,{}), status:r.status, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ code:text(value(b,c,"code","code"),60).toUpperCase(), name:text(value(b,c,"name","name"),240),
      kind:["headquarters","base","hub","cross_dock","warehouse","support","other"].includes(text(value(b,c,"kind","kind")))?text(value(b,c,"kind","kind")):"base",
      document:digits(value(b,c,"document","document"),14), address_json:JSON.stringify(object(has(b,"address")?b.address:parse(c.address_json,{}))),
      latitude:has(b,"latitude")?(b.latitude===""?null:number(b.latitude)):c.latitude??null, longitude:has(b,"longitude")?(b.longitude===""?null:number(b.longitude)):c.longitude??null,
      operating_hours_json:JSON.stringify(object(has(b,"operatingHours")?b.operatingHours:parse(c.operating_hours_json,{}))),
      status:["draft","active","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"active",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  routes: {
    table:"todogreen_route_templates", permissions:["operations:manage","operation:manage","planning:manage","product:manage"], order:"name ASC",
    required:(b)=>!text(b.name)?"Informe o nome da rota.":"",
    map:(r)=>({ ...common(r), code:r.code, name:r.name, productId:r.product_id, originUnitId:r.origin_unit_id, destinationUnitId:r.destination_unit_id,
      origin:parse(r.origin_json,{}), destination:parse(r.destination_json,{}), distanceKm:r.distance_km, estimatedDurationMin:r.estimated_duration_min,
      vehicleCategory:r.vehicle_category, tollAmount:r.toll_amount, restrictions:parse(r.restrictions_json,{}), status:r.status, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ code:text(value(b,c,"code","code"),60).toUpperCase(), name:text(value(b,c,"name","name"),240), product_id:text(value(b,c,"productId","product_id"),120),
      origin_unit_id:text(value(b,c,"originUnitId","origin_unit_id"),120), destination_unit_id:text(value(b,c,"destinationUnitId","destination_unit_id"),120),
      origin_json:JSON.stringify(object(has(b,"origin")?b.origin:parse(c.origin_json,{}))), destination_json:JSON.stringify(object(has(b,"destination")?b.destination:parse(c.destination_json,{}))),
      distance_km:Math.max(0,number(value(b,c,"distanceKm","distance_km",0))), estimated_duration_min:Math.max(0,integer(value(b,c,"estimatedDurationMin","estimated_duration_min",0))),
      vehicle_category:text(value(b,c,"vehicleCategory","vehicle_category"),100), toll_amount:Math.max(0,number(value(b,c,"tollAmount","toll_amount",0))),
      restrictions_json:JSON.stringify(object(has(b,"restrictions")?b.restrictions:parse(c.restrictions_json,{}))), status:["draft","active","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"active",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "price-tables": {
    table:"todogreen_price_tables", permissions:["pricing:manage","proposal:manage","finance:manage"], order:"updated_at DESC",
    required:(b)=>!text(b.name)?"Informe o nome da tabela de preço.":"",
    map:(r)=>({ ...common(r), code:r.code, name:r.name, clientId:r.client_id, contractId:r.contract_id, productId:r.product_id, currency:r.currency,
      validFrom:r.valid_from||"", validUntil:r.valid_until||"", adjustmentIndex:r.adjustment_index, status:r.status, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ code:text(value(b,c,"code","code"),60).toUpperCase(), name:text(value(b,c,"name","name"),240), client_id:text(value(b,c,"clientId","client_id"),120),
      contract_id:text(value(b,c,"contractId","contract_id"),120), product_id:text(value(b,c,"productId","product_id"),120), currency:text(value(b,c,"currency","currency","BRL"),3).toUpperCase()||"BRL",
      valid_from:text(value(b,c,"validFrom","valid_from"),20)||null, valid_until:text(value(b,c,"validUntil","valid_until"),20)||null, adjustment_index:text(value(b,c,"adjustmentIndex","adjustment_index"),80),
      status:["draft","active","expired","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"draft",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "price-rows": {
    table:"todogreen_price_table_rows", permissions:["pricing:manage","proposal:manage","finance:manage"], order:"created_at, id", filter:{priceTableId:"price_table_id"},
    required:(b)=>!text(b.priceTableId)?"Informe a tabela de preço.":!text(b.chargeUnit)?"Informe a unidade de cobrança.":"",
    map:(r)=>({ ...common(r), priceTableId:r.price_table_id, routeId:r.route_id, vehicleCategory:r.vehicle_category, originKey:r.origin_key, destinationKey:r.destination_key,
      minQuantity:r.min_quantity, maxQuantity:r.max_quantity, chargeUnit:r.charge_unit, unitPrice:r.unit_price, minimumCharge:r.minimum_charge,
      additionalRules:parse(r.additional_rules_json,{}), status:r.status, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ price_table_id:text(value(b,c,"priceTableId","price_table_id"),120), route_id:text(value(b,c,"routeId","route_id"),120), vehicle_category:text(value(b,c,"vehicleCategory","vehicle_category"),100),
      origin_key:text(value(b,c,"originKey","origin_key"),160), destination_key:text(value(b,c,"destinationKey","destination_key"),160), min_quantity:Math.max(0,number(value(b,c,"minQuantity","min_quantity",0))),
      max_quantity:has(b,"maxQuantity")?(b.maxQuantity===""?null:Math.max(0,number(b.maxQuantity))):c.max_quantity??null, charge_unit:text(value(b,c,"chargeUnit","charge_unit"),80),
      unit_price:Math.max(0,number(value(b,c,"unitPrice","unit_price",0))), minimum_charge:Math.max(0,number(value(b,c,"minimumCharge","minimum_charge",0))),
      additional_rules_json:JSON.stringify(object(has(b,"additionalRules")?b.additionalRules:parse(c.additional_rules_json,{}))), status:["active","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"active",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "bank-accounts": {
    table:"todogreen_bank_accounts", permissions:["finance:manage","hr:manage"], order:"is_default DESC, updated_at DESC",
    filter:{ownerType:"owner_type",ownerId:"owner_id"}, required:(b)=>!text(b.bankName)&&!text(b.bankCode)?"Informe o banco.":"",
    map:(r)=>({ ...common(r), ownerType:r.owner_type, ownerId:r.owner_id, bankCode:r.bank_code, bankName:r.bank_name, branch:r.branch, account:r.account,
      accountDigit:r.account_digit, accountType:r.account_type, pixKeyType:r.pix_key_type, pixKey:r.pix_key, isDefault:r.is_default===1, status:r.status, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ owner_type:["company","party","employee","driver"].includes(text(value(b,c,"ownerType","owner_type")))?text(value(b,c,"ownerType","owner_type")):"company",
      owner_id:text(value(b,c,"ownerId","owner_id"),120), bank_code:digits(value(b,c,"bankCode","bank_code"),10), bank_name:text(value(b,c,"bankName","bank_name"),160),
      branch:text(value(b,c,"branch","branch"),40), account:text(value(b,c,"account","account"),60), account_digit:text(value(b,c,"accountDigit","account_digit"),10),
      account_type:["checking","savings","payment","other"].includes(text(value(b,c,"accountType","account_type")))?text(value(b,c,"accountType","account_type")):"checking",
      pix_key_type:text(value(b,c,"pixKeyType","pix_key_type"),40), pix_key:text(value(b,c,"pixKey","pix_key"),240), is_default:(has(b,"isDefault")?b.isDefault:c.is_default===1)?1:0,
      status:["draft","active","inactive"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"active",
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "implementation-projects": {
    table:"todogreen_implementation_projects", permissions:["operations:manage","operation:manage","planning:manage","product:manage"], order:"target_go_live_at IS NULL, target_go_live_at, updated_at DESC",
    filter:{clientId:"client_id"}, required:(b)=>!text(b.clientId)?"Informe o cliente.":!text(b.title)?"Informe o nome da implantação.":"",
    map:(r)=>({ ...common(r), clientId:r.client_id, contractId:r.contract_id, operationId:r.operation_id, title:r.title, status:r.status, ownerUserId:r.owner_user_id||"",
      targetGoLiveAt:r.target_go_live_at||"", actualGoLiveAt:r.actual_go_live_at||"", scope:parse(r.scope_json,{}), operatingModel:parse(r.operating_model_json,{}),
      capacity:parse(r.capacity_json,{}), integrations:parse(r.integrations_json,{}), billing:parse(r.billing_json,{}), support:parse(r.support_json,{}), rasci:parse(r.rasci_json,{}), risks:parse(r.risks_json,[]), fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ client_id:text(value(b,c,"clientId","client_id"),120), contract_id:text(value(b,c,"contractId","contract_id"),120), operation_id:text(value(b,c,"operationId","operation_id"),120),
      title:text(value(b,c,"title","title"),240), status:["planning","in_progress","ready","go_live","completed","on_hold","cancelled"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"planning",
      owner_user_id:text(value(b,c,"ownerUserId","owner_user_id"),120)||null, target_go_live_at:text(value(b,c,"targetGoLiveAt","target_go_live_at"),40)||null, actual_go_live_at:text(value(b,c,"actualGoLiveAt","actual_go_live_at"),40)||null,
      scope_json:JSON.stringify(object(has(b,"scope")?b.scope:parse(c.scope_json,{}))), operating_model_json:JSON.stringify(object(has(b,"operatingModel")?b.operatingModel:parse(c.operating_model_json,{}))),
      capacity_json:JSON.stringify(object(has(b,"capacity")?b.capacity:parse(c.capacity_json,{}))), integrations_json:JSON.stringify(object(has(b,"integrations")?b.integrations:parse(c.integrations_json,{}))),
      billing_json:JSON.stringify(object(has(b,"billing")?b.billing:parse(c.billing_json,{}))), support_json:JSON.stringify(object(has(b,"support")?b.support:parse(c.support_json,{}))),
      rasci_json:JSON.stringify(object(has(b,"rasci")?b.rasci:parse(c.rasci_json,{}))), risks_json:JSON.stringify(Array.isArray(has(b,"risks")?b.risks:parse(c.risks_json,[]))?(has(b,"risks")?b.risks:parse(c.risks_json,[])):[]),
      fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
  "implementation-gates": {
    table:"todogreen_implementation_gates", permissions:["operations:manage","operation:manage","planning:manage","product:manage"], order:"due_at IS NULL, due_at, created_at", filter:{projectId:"project_id"},
    required:(b)=>!text(b.projectId)?"Informe a implantação.":!text(b.title)?"Informe o gate ou entrega.":"",
    map:(r)=>({ ...common(r), projectId:r.project_id, phase:r.phase, code:r.code, title:r.title, description:r.description, ownerUserId:r.owner_user_id||"", status:r.status,
      dueAt:r.due_at||"", blocking:r.blocking===1, evidenceRequired:r.evidence_required===1, evidenceId:r.evidence_id, completedBy:r.completed_by||"", completedAt:r.completed_at||"", notes:r.notes, fields:parse(r.fields_json,{}) }),
    encode:(b,c={})=>({ project_id:text(value(b,c,"projectId","project_id"),120), phase:text(value(b,c,"phase","phase"),100), code:text(value(b,c,"code","code"),60).toUpperCase(), title:text(value(b,c,"title","title"),240),
      description:text(value(b,c,"description","description"),4000), owner_user_id:text(value(b,c,"ownerUserId","owner_user_id"),120)||null,
      status:["pending","in_progress","blocked","done","waived"].includes(text(value(b,c,"status","status")))?text(value(b,c,"status","status")):"pending",
      due_at:text(value(b,c,"dueAt","due_at"),40)||null, blocking:(has(b,"blocking")?b.blocking:c.blocking!==0)?1:0, evidence_required:(has(b,"evidenceRequired")?b.evidenceRequired:c.evidence_required===1)?1:0,
      evidence_id:text(value(b,c,"evidenceId","evidence_id"),120), completed_by:text(value(b,c,"completedBy","completed_by"),120)||null, completed_at:text(value(b,c,"completedAt","completed_at"),40)||null,
      notes:text(value(b,c,"notes","notes"),4000), fields_json:JSON.stringify(object(has(b,"fields")?b.fields:parse(c.fields_json,{}))) }),
  },
};

const scopedRow = async (env, config, ownerId, id) => env.DB.prepare(
  `SELECT * FROM ${config.table} WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
).bind(id, TENANT_ID, ownerId).first();

async function listResource(env, access, url, config) {
  const { limit, offset } = paginacao(url);
  const clauses = ["tenant_id=?", "workspace_owner_id=?", "archived_at IS NULL"];
  const binds = [TENANT_ID, access.ownerId];
  for (const [queryKey, dbKey] of Object.entries(config.filter || {})) {
    const filterValue = text(url.searchParams.get(queryKey), 120);
    if (filterValue) { clauses.push(`${dbKey}=?`); binds.push(filterValue); }
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE ${clauses.join(" AND ")} ORDER BY ${config.order || "updated_at DESC"} LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ${config.table} WHERE ${clauses.join(" AND ")}`,
  ).bind(...binds).first();
  return json({ records:(results||[]).map(config.map), total:total?.total||0, limit, offset });
}

async function createResource(env, access, user, config, body) {
  if (!allowedAny(access, config.permissions)) return json({ error:"Seu papel não pode alterar este cadastro." },403);
  const error = config.required?.(body) || "";
  if (error) return json({ error },400);
  const values = config.encode(body, {});
  const columns = Object.keys(values);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sqlColumns = ["id","tenant_id","workspace_owner_id",...columns,"revision","created_by","updated_by","created_at","updated_at","archived_at"];
  const sqlValues = [id,TENANT_ID,access.ownerId,...columns.map((key)=>values[key]),1,user.id,user.id,now,now,null];
  try {
    await env.DB.prepare(`INSERT INTO ${config.table} (${sqlColumns.join(",")}) VALUES (${sqlColumns.map(()=>"?").join(",")})`).bind(...sqlValues).run();
  } catch (cause) {
    if (/UNIQUE/i.test(String(cause?.message||cause))) return json({ error:"Já existe um cadastro com este identificador neste espaço." },409);
    throw cause;
  }
  const row = await scopedRow(env, config, access.ownerId, id);
  return json({ record:config.map(row) },201);
}

async function updateResource(env, access, user, config, id, body) {
  if (!allowedAny(access, config.permissions)) return json({ error:"Seu papel não pode alterar este cadastro." },403);
  const current = await scopedRow(env, config, access.ownerId, id);
  if (!current) return json({ error:"Cadastro não encontrado." },404);
  const revision = Number(body.revision);
  if (!Number.isFinite(revision) || revision !== Number(current.revision))
    return json({ error:"Este cadastro mudou. Recarregue antes de salvar." },409);
  const candidate = { ...config.map(current), ...body };
  const error = config.required?.(candidate) || "";
  if (error) return json({ error },400);
  const values = config.encode(body, current);
  const columns = Object.keys(values);
  const now = new Date().toISOString();
  const setSql = [...columns.map((key)=>`${key}=?`),"revision=revision+1","updated_by=?","updated_at=?"].join(",");
  const binds = [...columns.map((key)=>values[key]),user.id,now,id,TENANT_ID,access.ownerId,revision];
  try {
    const result = await env.DB.prepare(`UPDATE ${config.table} SET ${setSql} WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=? AND archived_at IS NULL`).bind(...binds).run();
    if (!result?.meta?.changes) return json({ error:"Este cadastro mudou. Recarregue antes de salvar." },409);
  } catch (cause) {
    if (/UNIQUE/i.test(String(cause?.message||cause))) return json({ error:"Já existe um cadastro com este identificador neste espaço." },409);
    throw cause;
  }
  const row = await scopedRow(env, config, access.ownerId, id);
  return json({ record:config.map(row) });
}

async function archiveResource(env, access, user, config, id) {
  if (!allowedAny(access, config.permissions)) return json({ error:"Seu papel não pode alterar este cadastro." },403);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE ${config.table} SET archived_at=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(now,user.id,now,id,TENANT_ID,access.ownerId).run();
  if (!result?.meta?.changes) return json({ error:"Cadastro não encontrado." },404);
  return json({ ok:true });
}

export async function handleTodoGreenMasterData(request, env, access, user) {
  if (!env.DB) return json({ error:"Banco indisponível." },503);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/todogreen\/master-data\/?/,"").split("/").filter(Boolean);
  const [resource,id] = parts;
  const config = CONFIG[resource];
  if (!config) return json({ error:"Cadastro mestre não encontrado." },404);

  if (request.method === "GET") {
    if (!id) return listResource(env, access, url, config);
    const row = await scopedRow(env, config, access.ownerId, id);
    return row ? json({ record:config.map(row) }) : json({ error:"Cadastro não encontrado." },404);
  }

  const body = await request.json().catch(()=>({}));
  if (request.method === "POST" && !id) return createResource(env, access, user, config, body);
  if (request.method === "PATCH" && id) return updateResource(env, access, user, config, id, body);
  if (request.method === "DELETE" && id) return archiveResource(env, access, user, config, id);
  return json({ error:"Método não permitido." },405);
}
