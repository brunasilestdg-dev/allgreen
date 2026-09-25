import { useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Layers3,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  BUSINESS_PACKS,
  BUSINESS_INDUSTRY_CATALOG,
  businessEnabledPackIds,
  businessPackLabels,
  businessTypeById,
  industryCategoryById,
  profileTypeForIndustry,
  recommendedPackIds,
} from "./businessProfileDomain.js";
import "./businessProfile.css";

export default function BusinessProfileStudio({
  business,
  update,
  go,
  setToast,
}) {
  const [form, setForm] = useState(() => ({
    industryCategoryId: business?.industryCategoryId || "outros",
    industryActivity: business?.industryActivity || business?.segment || "",
    businessTypeId: business?.businessTypeId || "outro",
    segment: business?.segment || "",
    menuMode: business?.menuMode || "all",
    enabledPacks: businessEnabledPackIds(business),
  }));

  if (!business) {
    return (
      <section className="business-profile-page business-profile-empty">
        <Layers3 />
        <h1>Primeiro, crie o perfil do negócio</h1>
        <p>
          Depois você escolhe o tipo de atividade e as funções que quer deixar
          em destaque.
        </p>
        <button type="button" onClick={() => go("businesses")}>
          Criar negócio <ChevronRight />
        </button>
      </section>
    );
  }
  const selectedType = businessTypeById(form.businessTypeId);
  const selectedCategory = industryCategoryById(form.industryCategoryId);

  const changeCategory = (categoryId) => {
    const typeId = profileTypeForIndustry(categoryId);
    const category = industryCategoryById(categoryId);
    setForm((current) => ({
      ...current,
      industryCategoryId: categoryId,
      industryActivity: "",
      businessTypeId: typeId,
      segment: category?.label || current.segment,
      enabledPacks: recommendedPackIds(typeId),
      menuMode: "custom",
    }));
  };

  const changeActivity = (activity) => {
    const businessTypeId = profileTypeForIndustry(
      form.industryCategoryId,
      activity,
    );
    setForm((current) => ({
      ...current,
      industryActivity: activity,
      businessTypeId,
      enabledPacks: recommendedPackIds(businessTypeId),
      menuMode: "custom",
      segment: activity || selectedCategory?.label || current.segment,
    }));
  };

  const togglePack = (packId) =>
    setForm((current) => ({
      ...current,
      menuMode: "custom",
      enabledPacks: current.enabledPacks.includes(packId)
        ? current.enabledPacks.filter((id) => id !== packId)
        : [...current.enabledPacks, packId],
    }));

  const save = () => {
    update((db) => ({
      ...db,
      businesses: (db.businesses || []).map((item) =>
        item.id === business.id
          ? {
              ...item,
              industryCategoryId: form.industryCategoryId,
              industryCategoryLabel: selectedCategory?.label || "Outros",
              industryActivity: form.industryActivity.trim(),
              businessTypeId: form.businessTypeId,
              businessTypeLabel: selectedType?.label || "Outro tipo de negócio",
              segment: form.segment.trim() || selectedType?.label || "",
              menuMode: form.menuMode,
              enabledPacks: form.enabledPacks,
              focusAreas: businessPackLabels(form.enabledPacks).join(", "),
              profileConfiguredAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
    setToast("Perfil e funções do negócio atualizados");
  };

  return (
    <section className="business-profile-page">
      <header className="business-profile-hero">
        <div>
          <span className="eyebrow">CENTRAL DO NEGÓCIO</span>
          <h1>Um app que se adapta ao seu trabalho</h1>
          <p>
            Escolha o tipo de negócio e os pacotes que fazem sentido agora.
            Nada fica bloqueado: você pode ativar tudo ou mudar a combinação a
            qualquer momento.
          </p>
        </div>
        <div className="business-profile-summary">
          <Sparkles />
          <span>Perfil ativo</span>
          <strong>{selectedCategory?.label || selectedType?.label || "Personalizado"}</strong>
          {form.industryActivity && <small>{form.industryActivity}</small>}
          <small>{form.enabledPacks.length} pacotes selecionados</small>
        </div>
      </header>

      <div className="business-profile-layout">
        <article className="business-profile-card type-card">
          <div className="business-profile-card-title">
            <span><SlidersHorizontal /></span>
            <div>
              <h2>1. Tipo de negócio</h2>
              <p>Isso organiza a experiência inicial e o contexto da IA.</p>
            </div>
          </div>
          <label>
            Atividade principal
            <select
              value={form.industryCategoryId}
              onChange={(event) => changeCategory(event.target.value)}
            >
              {BUSINESS_INDUSTRY_CATALOG.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Atividade específica
            <select
              value={form.industryActivity}
              onChange={(event) => changeActivity(event.target.value)}
            >
              <option value="">Selecione a atividade</option>
              {(selectedCategory?.activities || []).map((activity) => (
                <option key={activity} value={activity}>
                  {activity}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descrição livre do segmento
            <input
              value={form.segment}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  segment: event.target.value,
                }))
              }
              placeholder="Ex.: transportadora de logística sustentável com frota 100% elétrica"
            />
          </label>
          {selectedType && (
            <p className="business-type-description">
              {selectedType.description}
            </p>
          )}
        </article>

        <article className="business-profile-card menu-card">
          <div className="business-profile-card-title">
            <span><Layers3 /></span>
            <div>
              <h2>2. Organização do menu</h2>
              <p>Escolha foco ou visão completa. O que fica fora dos pacotes continua em “Todas as ferramentas” e na busca.</p>
            </div>
          </div>
          <div className="business-menu-mode" role="radiogroup" aria-label="Organização do menu">
            <button
              type="button"
              role="radio"
              aria-checked={form.menuMode === "custom"}
              className={form.menuMode === "custom" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, menuMode: "custom" }))}
            >
              <CheckCircle2 />
              <span>
                <strong>Menu focado</strong>
                <small>Mostra os pacotes escolhidos e reduz distrações.</small>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.menuMode === "all"}
              className={form.menuMode === "all" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, menuMode: "all" }))}
            >
              <Layers3 />
              <span>
                <strong>Mostrar tudo</strong>
                <small>Deixa todas as funções visíveis no menu.</small>
              </span>
            </button>
          </div>
        </article>
      </div>

      <article className="business-profile-card packs-card">
        <div className="packs-heading">
          <div className="business-profile-card-title">
            <span><Check /></span>
            <div>
              <h2>3. Pacotes de funções</h2>
              <p>Ative qualquer combinação — inclusive todos os pacotes.</p>
            </div>
          </div>
          <div className="packs-actions">
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  menuMode: "custom",
                  enabledPacks: recommendedPackIds(current.businessTypeId),
                }))
              }
            >
              Usar recomendados
            </button>
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  menuMode: "all",
                  enabledPacks: BUSINESS_PACKS.map((pack) => pack.id),
                }))
              }
            >
              Ativar tudo
            </button>
          </div>
        </div>
        <div className="business-pack-grid">
          {BUSINESS_PACKS.map((pack) => {
            const checked = form.enabledPacks.includes(pack.id);
            return (
              <button
                type="button"
                key={pack.id}
                className={checked ? "selected" : ""}
                aria-pressed={checked}
                onClick={() => togglePack(pack.id)}
              >
                <span className="pack-check">{checked && <Check />}</span>
                <span>
                  <strong>{pack.label}</strong>
                  <small>{pack.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </article>

      <footer className="business-profile-savebar">
        <div>
          <strong>{business.name}</strong>
          <span>
            {form.menuMode === "all"
              ? "Todas as funções ficarão visíveis."
              : `${form.enabledPacks.length} pacotes ficarão em destaque no menu.`}
          </span>
        </div>
        <button type="button" onClick={save}>
          Salvar configuração
        </button>
      </footer>
    </section>
  );
}
