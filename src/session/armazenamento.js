// ===== Sessão e armazenamento local =====
//
// Onde o espaço de trabalho fica guardado no navegador, qual revisão foi lida
// por último, o que fazer quando o servidor recusa a gravação por conflito, e
// como entrar e sair.
//
// Está separado porque é a camada mais perigosa de mexer sem olhar: um erro de
// chave aqui não quebra a tela — faz a pessoa abrir o produto e encontrar o
// espaço de outra conta, ou o próprio espaço vazio. Enterrado no meio de vinte
// e cinco mil linhas, ninguém revisava.

import {
  ACTIVE_USER_KEY,
  AUTH_TOKEN_KEY,
  LEGACY_STORAGE_KEY,
  STORAGE_PREFIX,
  emptyDb,
} from "./espacoVazio.js";

export const userStorageKey = (id) => `${STORAGE_PREFIX}${id}`;
export const WORKSPACE_REVISION_PREFIX = "sf-workspace-revision:";
export const WORKSPACE_CONFLICT_PREFIX = "sf-workspace-conflict:";

export function readWorkspaceRevision(spaceKey) {
  try {
    const value = Number(
      localStorage.getItem(`${WORKSPACE_REVISION_PREFIX}${spaceKey}`),
    );
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function storeWorkspaceRevision(spaceKey, revision) {
  try {
    localStorage.setItem(
      `${WORKSPACE_REVISION_PREFIX}${spaceKey}`,
      String(revision),
    );
  } catch {}
}

export function preserveWorkspaceConflict(
  spaceKey,
  data,
  baseRevision,
  conflict,
) {
  try {
    localStorage.setItem(
      `${WORKSPACE_CONFLICT_PREFIX}${spaceKey}`,
      JSON.stringify({
        data,
        baseRevision,
        serverRevision: conflict.serverRevision,
        serverUpdatedAt: conflict.serverUpdatedAt,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {}
}
export const cleanDb = (user) => ({
  ...emptyDb,
  user: user || null,
  preferences: { ...emptyDb.preferences },
});

export function readUserDb(user) {
  if (!user?.id) return cleanDb(null);
  try {
    const saved = JSON.parse(
      localStorage.getItem(userStorageKey(user.id)) || "{}",
    );
    return {
      ...cleanDb(user),
      ...saved,
      user,
      preferences: { ...emptyDb.preferences, ...(saved.preferences || {}) },
    };
  } catch {
    return cleanDb(user);
  }
}

export function loadInitialDb() {
  try {
    const activeId = localStorage.getItem(ACTIVE_USER_KEY);
    if (activeId) {
      const saved = JSON.parse(
        localStorage.getItem(userStorageKey(activeId)) || "{}",
      );
      if (saved.user?.id === activeId)
        return {
          ...cleanDb(saved.user),
          ...saved,
          preferences: { ...emptyDb.preferences, ...(saved.preferences || {}) },
        };
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "{}");
    if (legacy.user?.id) {
      localStorage.setItem(ACTIVE_USER_KEY, legacy.user.id);
      localStorage.setItem(
        userStorageKey(legacy.user.id),
        JSON.stringify(legacy),
      );
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return {
        ...cleanDb(legacy.user),
        ...legacy,
        preferences: { ...emptyDb.preferences, ...(legacy.preferences || {}) },
      };
    }
  } catch {}
  return cleanDb(null);
}

export function startUserSession(user) {
  // Compatibilidade temporária: o App principal ainda usa AUTH_TOKEN_KEY para
  // decidir se deve validar a sessão. O cookie HttpOnly continua sendo emitido
  // e aceito pelo servidor, mas o token legado só poderá ser removido depois
  // que esse gate do App também for migrado para cookie.
  localStorage.setItem(ACTIVE_USER_KEY, user.id);
  localStorage.removeItem("sf-space");
  localStorage.removeItem("sf-space-name");
  return readUserDb(user);
}

export function authHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function endSession() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(ACTIVE_USER_KEY);
  localStorage.removeItem("sf-space");
  localStorage.removeItem("sf-space-name");
  // Mesmo sem Bearer no navegador, o fetch same-origin envia o cookie HttpOnly
  // automaticamente. Isso garante que sair realmente revogue a sessão atual.
  fetch("/api/auth/session", {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }).catch(() => {});
}

export function mergeMedia(localItems = [], remoteItems = []) {
  return (remoteItems || []).map((item) => {
    if (item.localOnly && !item.url) {
      const local = (localItems || []).find((x) => x.id === item.id);
      if (local?.url) return { ...local };
    }
    return item;
  });
}

export const activeSpaceId = () => {
  try {
    return localStorage.getItem("sf-space") || "";
  } catch {
    return "";
  }
};
