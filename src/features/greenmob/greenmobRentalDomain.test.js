import { describe, expect, it } from "vitest";
import {
  CONTRACT_STATUS,
  createRentalContract,
  createRentalVehicle,
  excessKmCharge,
  fleetStatusSummary,
  isContractActive,
  monthlyRecurringRevenue,
  registerReturn,
} from "./greenmobRentalDomain.js";

describe("Greenmob — contratos de locação", () => {
  it("cria contrato em rascunho por padrão e placa em maiúsculas no veículo", () => {
    const veiculo = createRentalVehicle({ plate: "abc1d23", brand: "BYD", model: "Dolphin" });
    expect(veiculo.plate).toBe("ABC1D23");
    const contrato = createRentalContract({ clientName: "Cliente" });
    expect(CONTRACT_STATUS).toContain(contrato.status);
    expect(contrato.status).toBe("rascunho");
  });

  it("MRR soma apenas contratos ativos (entregue, ativo, renovado)", () => {
    const contratos = [
      createRentalContract({ status: "ativo", monthlyBRL: 3000 }),
      createRentalContract({ status: "entregue", monthlyBRL: 2000 }),
      createRentalContract({ status: "reservado", monthlyBRL: 4000 }),
      createRentalContract({ status: "devolvido", monthlyBRL: 5000 }),
    ];
    expect(monthlyRecurringRevenue(contratos)).toBe(5000);
    expect(isContractActive(contratos[0])).toBe(true);
    expect(isContractActive(contratos[2])).toBe(false);
  });

  it("status da frota conta disponíveis, reservados, locados e ocupação", () => {
    const v1 = createRentalVehicle({ plate: "A1", status: "disponivel" });
    const v2 = createRentalVehicle({ plate: "A2", status: "disponivel" });
    const v3 = createRentalVehicle({ plate: "A3", status: "manutencao" });
    const v4 = createRentalVehicle({ plate: "A4", status: "disponivel" });
    const contratos = [
      createRentalContract({ vehicleId: v1.id, status: "ativo" }),
      createRentalContract({ vehicleId: v2.id, status: "reservado" }),
    ];
    const status = fleetStatusSummary([v1, v2, v3, v4], contratos);
    expect(status.total).toBe(4);
    expect(status.locados).toBe(1);
    expect(status.reservados).toBe(1);
    expect(status.manutencao).toBe(1);
    expect(status.disponiveis).toBe(1); // só v4
    expect(status.ocupacaoPercent).toBe(25);
  });

  it("excedente de km — sem leitura devolve null com motivo, não 0", () => {
    const contrato = createRentalContract({
      startDate: "2026-01-01",
      monthlyBRL: 3000,
      monthlyKmAllowance: 2000,
      excessKmPriceBRL: 1.5,
    });
    // Sem handover nem leitura atual
    const semLeitura = excessKmCharge(contrato, null);
    expect(semLeitura.excessKm).toBeNull();
    expect(semLeitura.chargeBRL).toBeNull();
    expect(semLeitura.reason).toBe("Sem leitura de odômetro");
  });

  it("excedente de km — sem preço configurado devolve 0 explicando a regra", () => {
    const contrato = createRentalContract({
      startDate: "2026-01-01",
      handoverOdometerKm: 1000,
      monthlyKmAllowance: 2000,
      excessKmPriceBRL: 0,
    });
    const semPreco = excessKmCharge(contrato, 10000);
    expect(semPreco.excessKm).toBe(0);
    expect(semPreco.chargeBRL).toBe(0);
    expect(semPreco.reason).toBe("Preço por km excedente não definido no contrato");
  });

  it("registerReturn muda status para devolvido, preserva a origem da leitura", () => {
    const contrato = createRentalContract({ status: "ativo", startDate: "2026-01-01", handoverOdometerKm: 100 });
    const devolvido = registerReturn(contrato, { returnOdometerKm: 15000, source: "telemetry" });
    expect(devolvido.status).toBe("devolvido");
    expect(devolvido.returnOdometerKm).toBe(15000);
    expect(devolvido.lastReadingSource).toBe("telemetry");
  });
});
