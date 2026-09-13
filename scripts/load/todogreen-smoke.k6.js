/* global __ENV, __VU, __ITER */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = String(__ENV.BASE_URL || "http://127.0.0.1:8788").replace(/\/$/, "");
const AUTH_TOKEN = String(__ENV.AUTH_TOKEN || "").trim();
const PUBLIC_ONLY = String(__ENV.PUBLIC_ONLY || "") === "1";
const TARGET_VUS = Math.max(1, Number(__ENV.TARGET_VUS || 25));
const RAMP = __ENV.RAMP || "30s";
const STEADY = __ENV.STEADY || "2m";

export const options = {
  scenarios: {
    read_mix: {
      executor: "ramping-vus",
      stages: [
        { duration: RAMP, target: Math.max(1, Math.ceil(TARGET_VUS / 4)) },
        { duration: RAMP, target: TARGET_VUS },
        { duration: STEADY, target: TARGET_VUS },
        { duration: RAMP, target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
    checks: ["rate>0.99"],
    "endpoint_duration{endpoint:status}": ["p(95)<500"],
    "endpoint_duration{endpoint:clients}": ["p(95)<1500"],
    "endpoint_duration{endpoint:service-orders}": ["p(95)<1500"],
    "endpoint_duration{endpoint:preflight}": ["p(95)<1500"],
  },
};

const failures = new Rate("functional_failures");
const endpointDuration = new Trend("endpoint_duration", true);

function headers() {
  return AUTH_TOKEN ? { authorization: `Bearer ${AUTH_TOKEN}` } : {};
}

function get(path, endpoint, expected = 200) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: headers(),
    tags: { endpoint },
    timeout: "10s",
  });
  endpointDuration.add(response.timings.duration, { endpoint });
  const ok = check(response, {
    [`${endpoint} responde ${expected}`]: (r) => r.status === expected,
    [`${endpoint} devolve corpo`]: (r) => Boolean(r.body),
  });
  failures.add(!ok);
  return response;
}

export function setup() {
  const status = http.get(`${BASE_URL}/api/status`, { timeout: "10s" });
  if (status.status !== 200) throw new Error(`BASE_URL indisponível: /api/status respondeu ${status.status}`);
  if (!PUBLIC_ONLY && !AUTH_TOKEN) {
    throw new Error("Defina AUTH_TOKEN de uma sessão owner/admin, ou PUBLIC_ONLY=1 para medir somente endpoints públicos.");
  }
}

export default function () {
  get("/api/status", "status");

  if (!PUBLIC_ONLY) {
    // Mix somente leitura: mede navegação/API sem criar, editar ou excluir dado.
    const selector = (__VU + __ITER) % 4;
    if (selector === 0) get("/api/todogreen/clients", "clients");
    else if (selector === 1) get("/api/todogreen/transactions/service-orders", "service-orders");
    else if (selector === 2) get("/api/todogreen/preflight?limit=20", "preflight");
    else get("/api/todogreen/system-health", "system-health");
  }

  sleep(0.2);
}
