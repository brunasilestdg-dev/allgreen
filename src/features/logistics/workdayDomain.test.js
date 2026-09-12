import { describe, expect, it } from "vitest";
import { workdayTasks } from "./workdayDomain.js";

describe("Meu dia", () => {
  const tasks = [
    { id: "a", due: "2026-09-03" },
    { id: "b", due: "2026-09-04" },
    { id: "c", due: "2026-09-05" },
    { id: "d" },
    { id: "e", due: "invalida" },
  ];

  it("separa hoje, atrasadas e sem prazo sem alterar os registros", () => {
    expect(workdayTasks(tasks, "today", "2026-09-04").map((task) => task.id)).toEqual(["b"]);
    expect(workdayTasks(tasks, "overdue", "2026-09-04").map((task) => task.id)).toEqual(["a"]);
    expect(workdayTasks(tasks, "undated", "2026-09-04").map((task) => task.id)).toEqual(["d", "e"]);
    expect(workdayTasks(tasks)).toHaveLength(5);
  });
});
