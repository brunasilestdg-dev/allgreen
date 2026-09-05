// Parâmetros PADRÃO do motor de HC e DRE por tipo de operação.
//
// Enviados pela titular (tipos_operacao.yaml/json): globais (impostos, margem,
// rateio, frota, ESG), estrutura de headcount (camadas, abordagem A/B/C,
// reserva), os quatro tipos de operação (dedicado por jornada, dedicado por
// viagem, spot por pacote, spot por entrega) e modificadores. Campos com
// { input: true } são preenchidos pela pessoa na simulação (escopo por rota,
// operação ou veículo); os demais são a régua base — editável só por admin,
// versionada por tenant. Este arquivo é a semente; o valor em vigor vem do
// banco quando existir.
export const PARAMS_OPERACAO_PADRAO = Object.freeze({
  "globais": {
    "impostos": {
      "icms_pct": 0.12,
      "pis_cofins_pct": 0.0925,
      "iss_pis_cofins_pct": 0.1425,
      "comissao_comercial_pct": 0.05,
      "gross_up_fator": 1.3252,
      "regime_tributario": "lucro_real"
    },
    "margem": {
      "margem_alvo_pct": 0.3
    },
    "rateio": {
      "dias_uteis_mes": 22
    },
    "frota_disponivel": [
      "moto",
      "passeio",
      "fiorino_van",
      "vuc",
      "toco",
      "truck",
      "carreta_sider",
      "carreta_aberta",
      "carreta_eletrica"
    ],
    "entregavel_esg": {
      "selo_esg": true,
      "relatorio_mensal_co2": true,
      "co2_evitado_g_por_km": 95
    }
  },
  "headcount": {
    "camadas": {
      "regional": {
        "cargos": [
          "gerente",
          "coordenador",
          "supervisor_regional"
        ],
        "rateio": true
      },
      "nucleo_base": {
        "lider_operacoes_mes": 6500,
        "auxiliar_mes": 3850,
        "qtd_auxiliares": 2,
        "fixo_por_base": true
      },
      "variavel": {
        "motorista_clt_mes": 9381,
        "entregador_pj_dia": 220,
        "diaria_moto_8h": 523,
        "torre_controle_mes": 6500
      }
    },
    "abordagem": {
      "ativa": "A",
      "A_fracao_nucleo_marginal": 0.2,
      "B_gatilho_migracao_vol_dia": 700,
      "C_inclui": [
        "supervisao_dedicada",
        "gerenciamento_risco"
      ]
    },
    "reserva_motorista_pct": 0.2
  },
  "dedicado_jornada": {
    "unidade_cobranca": "diaria_ou_mensal",
    "jornada_h": 8,
    "dias_uteis_mes": 22,
    "sla": "mesmo_dia",
    "volume_contratado_dia": {
      "min": 2,
      "ref": 6,
      "max": 10
    },
    "custo_veiculo_mes": {
      "locacao_veiculo": 1850,
      "seguro_veiculo": 0,
      "energia_recarga_r_por_km": 0.12,
      "manutencao_preventiva": 200,
      "ipva_licenciamento": 80,
      "rastreamento": 0,
      "seguro_carga_malote": 150
    },
    "custo_mao_obra": {
      "entregador_diaria": {
        "4h": 160,
        "8h": 220
      }
    },
    "formacao_preco": {
      "overhead_admin_pct": 0.1,
      "margem_pct": 0.26,
      "impostos_pct": 0.1425
    }
  },
  "dedicado_viagem": {
    "unidade_cobranca": "viagem",
    "etapa": "middle_mile",
    "dias_operacionais_mes": 22,
    "fluxo": "somente_ida",
    "fator_km_ciclo": 2.0,
    "custo_diario_item": {
      "custo_diario_veiculo": {
        "vuc": 495,
        "toco": 495,
        "carreta": 1742
      },
      "rastreador_dia": 21.82,
      "motorista_dia": 280,
      "ajudante_dia": 200,
      "pernoite_caminhao": 120,
      "overhead_dia": 346.05,
      "energia_dia": {
        "input": true,
        "escopo": "por_rota",
        "unidade": "R$/dia",
        "varia_com": "distancia"
      },
      "manutencao_dia": {
        "input": true,
        "escopo": "por_rota",
        "unidade": "R$/dia",
        "varia_com": "distancia"
      },
      "distancia_ida_volta_km": {
        "input": true,
        "escopo": "por_rota",
        "unidade": "km"
      },
      "pedagio": {
        "input": true,
        "escopo": "por_rota",
        "unidade": "R$",
        "regra": "repassado_a_custo_por_eixo"
      }
    },
    "custo_ativo_pesado": {
      "valor_cavalo": 1300000,
      "vida_util_cavalo_meses": 60,
      "residual_cavalo_pct": {
        "input": true,
        "escopo": "por_operacao",
        "default": 0.2,
        "nota": "residual de elétrico importado incerto"
      },
      "valor_carreta": 280000,
      "vida_util_carreta_meses": 120,
      "residual_carreta_pct": 0.2,
      "ipva_pct_aa": 0.02,
      "seguro_casco_pct_aa": 0.045,
      "rctr_rcf_dc_mes": 350,
      "rastreamento_gr_mes": 450,
      "licenciamento_antt_ano": 1200,
      "custo_capital_pct_aa": 0.1,
      "base_custo_capital_pct": 0.5,
      "motorista_mes": 3400,
      "encargos_pct": 0.7,
      "beneficios_mes": 900,
      "horas_extras_pct": 0.1,
      "cobertura_reserva_pct": 0.15,
      "preco_energia_kwh": {
        "input": true,
        "escopo": "por_operacao",
        "default": 1.05,
        "nota": "depende do posto tarifário"
      },
      "consumo_solo_kwh_km": {
        "input": true,
        "escopo": "por_veiculo",
        "default": 0.95,
        "nota": "confirmar com fabricante"
      },
      "consumo_conjunto_kwh_km": {
        "input": true,
        "escopo": "por_veiculo",
        "default": 1.35,
        "nota": "confirmar com fabricante"
      },
      "autonomia_util_km": {
        "input": true,
        "escopo": "por_veiculo",
        "default": 300,
        "nota": "autonomia real carregado"
      },
      "invest_infra_recarga": 450000,
      "amortizacao_infra_meses": 60,
      "veiculos_rateando_infra": 4,
      "manutencao_cavalo_km": 0.42,
      "manutencao_carreta_km": 0.12,
      "pneus_cavalo": {
        "qtd": 6,
        "preco": 2800,
        "vida_km": 90000
      },
      "pneus_carreta": {
        "qtd": 12,
        "preco": 2600,
        "vida_km": 100000
      }
    },
    "formacao_preco": {
      "overhead_admin_pct": 0.08,
      "margem_pct": 0.3,
      "gross_up_fator": 1.3252,
      "pedagio": "repassado_a_custo",
      "vigencia_minima_meses": 12
    }
  },
  "spot_pacote": {
    "unidade_cobranca": "pacote",
    "etapa": "last_mile",
    "modal": "moto",
    "perfil_entrega": "B2B",
    "dias_operacionais_mes": 26,
    "tentativas_entrega": 3,
    "razao_cubagem_kg_m3": 300,
    "prazo_baixa_pod_h": 48,
    "generalidades": {
      "gris_pct_nf": 0.002,
      "advalorem_pct_nf": 0.003,
      "tde_pct_frete": 0.15,
      "trt_pct_frete": 0.15,
      "reentrega_pct_frete": 0.5,
      "devolucao_pct_frete": 1.0,
      "servico_fim_semana_pct": 1.0,
      "estadia_valor_hora": 160,
      "pedagio_incluido": false
    },
    "custo": {
      "entregador_diaria": 523,
      "rateio_nucleo": "abordagem_A",
      "ponto_equilibrio_pac_dia": 50
    }
  },
  "spot_entrega": {
    "unidade_cobranca": "entrega",
    "etapa": "last_mile",
    "perfil_entrega": "PAP",
    "modal": "moto",
    "tentativas_entrega": 3,
    "tarifa_por_entrega": {
      "input": true,
      "escopo": "por_operacao",
      "unidade": "R$/entrega"
    }
  },
  "modificadores": {
    "etapa_logistica": {
      "enum": [
        "first_mile",
        "middle_mile",
        "hub_last_mile",
        "last_mile",
        "reversa"
      ],
      "sla": {
        "first_mile_pct": 0.99,
        "transferencia_antecedencia_min": 30,
        "transferencia_tolerancia_pct": 0.02,
        "last_mile_atraso_max_pct": 0.015,
        "reversa_prazo": "dobro_do_prazo_de_entrega"
      }
    },
    "cross_docking": {
      "ativo": false
    },
    "refrigerado": {
      "ativo": false
    }
  }
});

export default PARAMS_OPERACAO_PADRAO;
