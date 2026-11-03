import { describe, expect, it } from "vitest";
import { canManageClients } from "@/lib/auth/roles";
import { messageForDbError } from "./errors";
import {
  escapeLike,
  initialsFromName,
  normalizeInitials,
  parseClientFilters,
  parseClientInput,
  parseProjectFilters,
  parseProjectInput,
} from "./schema";

const CLIENT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("initialsFromName", () => {
  it("usa a primeira letra das duas primeiras palavras relevantes", () => {
    expect(initialsFromName("Casa Aurora Móveis")).toBe("CA");
    expect(initialsFromName("Clínica Vida Plena")).toBe("CV");
  });

  it("ignora partículas e acentos", () => {
    expect(initialsFromName("Casa de Pedra")).toBe("CP");
    expect(initialsFromName("Érica & Filhos")).toBe("EF");
    expect(initialsFromName("Ótica do Ângelo")).toBe("OA");
  });

  it("palavra única usa as duas primeiras letras; sem letras latinas cai em CL", () => {
    expect(initialsFromName("Luvi")).toBe("LU");
    expect(initialsFromName("日本")).toBe("CL");
  });

  it("o resultado sempre cabe na restrição do banco (1 a 3 de A-Z0-9)", () => {
    for (const name of ["Casa Aurora", "3M Brasil", "A", "Zé", "  espaços   demais  ", "ação & cia"]) {
      expect(initialsFromName(name), name).toMatch(/^[A-Z0-9]{1,3}$/);
    }
  });
});

describe("normalizeInitials", () => {
  it("maiúsculas, sem acento nem símbolos, no máximo 3", () => {
    expect(normalizeInitials("çã-1x9")).toBe("CA1");
    expect(normalizeInitials("  ")).toBe("");
  });
});

describe("parseClientInput", () => {
  it("normaliza espaços e deriva as iniciais quando faltam", () => {
    const r = parseClientInput({ name: "  Casa   Aurora  Móveis ", segment: " Varejo   de móveis ", initials: "" });
    expect(r).toEqual({ ok: true, data: { name: "Casa Aurora Móveis", segment: "Varejo de móveis", initials: "CA" } });
  });

  it("respeita iniciais informadas (normalizadas)", () => {
    const r = parseClientInput({ name: "Casa Aurora", segment: "", initials: "ç1" });
    expect(r.ok && r.data.initials).toBe("C1");
  });

  it("exige nome com 2+ caracteres e com letra ou número", () => {
    expect(parseClientInput({ name: "A", segment: "", initials: "" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.stringMatching(/mínimo de 2/) },
    });
    expect(parseClientInput({ name: "!!", segment: "", initials: "" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.stringMatching(/letras ou números/) },
    });
    expect(parseClientInput({ name: "   ", segment: "", initials: "" }).ok).toBe(false);
  });

  it("limita nome e segmento ao tamanho do banco (120)", () => {
    const longo = "x".repeat(121);
    const r = parseClientInput({ name: longo, segment: longo, initials: "" });
    expect(r).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), segment: expect.any(String) } });
    expect(parseClientInput({ name: "x".repeat(120), segment: "y".repeat(120), initials: "" }).ok).toBe(true);
  });

  it("tolera entrada ausente ou de tipo errado sem lançar", () => {
    expect(parseClientInput({}).ok).toBe(false);
    expect(parseClientInput({ name: 42 as unknown as string }).ok).toBe(false);
  });
});

describe("parseProjectInput", () => {
  const base = { clientId: CLIENT_ID, name: "Campanha de Verão", description: "  Peças de Instagram  ", status: "ativo", dueDate: "2026-12-15" };

  it("aceita um projeto completo e normaliza", () => {
    expect(parseProjectInput(base)).toEqual({
      ok: true,
      data: { clientId: CLIENT_ID, name: "Campanha de Verão", description: "Peças de Instagram", status: "ativo", dueDate: "2026-12-15" },
    });
  });

  it("data de entrega é opcional e vira null", () => {
    const r = parseProjectInput({ ...base, dueDate: "" });
    expect(r.ok && r.data.dueDate).toBeNull();
  });

  it("rejeita data inexistente ou em formato errado", () => {
    for (const dueDate of ["2026-02-31", "31/12/2026", "2026-13-01", "amanhã"]) {
      expect(parseProjectInput({ ...base, dueDate }), dueDate).toMatchObject({ ok: false, fieldErrors: { dueDate: expect.any(String) } });
    }
  });

  it("exige cliente válido na criação, mas não na edição", () => {
    expect(parseProjectInput({ ...base, clientId: "" })).toMatchObject({ ok: false, fieldErrors: { clientId: "Escolha o cliente." } });
    expect(parseProjectInput({ ...base, clientId: "nao-e-uuid" }).ok).toBe(false);
    const edit = parseProjectInput({ ...base, clientId: "" }, { requireClient: false });
    expect(edit.ok && edit.data.clientId).toBe("");
  });

  it("só aceita os status do banco", () => {
    expect(parseProjectInput({ ...base, status: "concluido" }).ok).toBe(true);
    expect(parseProjectInput({ ...base, status: "arquivado" })).toMatchObject({ ok: false, fieldErrors: { status: expect.any(String) } });
  });

  it("limita nome (160) e descrição (2000)", () => {
    expect(parseProjectInput({ ...base, name: "n".repeat(161) }).ok).toBe(false);
    expect(parseProjectInput({ ...base, description: "d".repeat(2001) }).ok).toBe(false);
    expect(parseProjectInput({ ...base, name: "n".repeat(160), description: "d".repeat(2000) }).ok).toBe(true);
  });
});

describe("filtros da URL", () => {
  it("clientes: padrão é só ativos; valor desconhecido volta ao padrão", () => {
    expect(parseClientFilters({})).toEqual({ q: "", status: "ativos" });
    expect(parseClientFilters({ status: "arquivados", q: "  casa  " })).toEqual({ q: "casa", status: "arquivados" });
    expect(parseClientFilters({ status: "todos" }).status).toBe("todos");
    expect(parseClientFilters({ status: "'; drop table clients;--" }).status).toBe("ativos");
  });

  it("projetos: status e cliente inválidos são ignorados", () => {
    expect(parseProjectFilters({})).toEqual({ q: "", status: "todos", clientId: null });
    expect(parseProjectFilters({ status: "pausado", cliente: CLIENT_ID })).toEqual({ q: "", status: "pausado", clientId: CLIENT_ID });
    expect(parseProjectFilters({ status: "x", cliente: "1 or 1=1" })).toEqual({ q: "", status: "todos", clientId: null });
    expect(parseProjectFilters({ cliente: "a'; drop table--" }).clientId).toBeNull();
  });

  it("projetos: ids simples passam pelo parser (a demonstração usa c1); a consulta real só aceita UUID", () => {
    expect(parseProjectFilters({ cliente: "c1" }).clientId).toBe("c1");
  });

  it("usa o primeiro valor quando o parâmetro se repete e limita a busca a 80 caracteres", () => {
    expect(parseClientFilters({ q: ["a", "b"] }).q).toBe("a");
    expect(parseClientFilters({ q: "z".repeat(200) }).q).toHaveLength(80);
  });
});

describe("escapeLike", () => {
  it("trata %, _ e \\ como texto literal", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(escapeLike("normal")).toBe("normal");
  });
});

describe("canManageClients (espelha app.can_manage_clients)", () => {
  it("admin e atendimento sim; designer e cliente não", () => {
    expect(canManageClients("admin")).toBe(true);
    expect(canManageClients("atendimento")).toBe(true);
    expect(canManageClients("designer")).toBe(false);
    expect(canManageClients("cliente")).toBe(false);
  });
});

describe("messageForDbError", () => {
  it("traduz duplicidade, permissão, formato e vínculo", () => {
    expect(messageForDbError({ code: "23505" }, "cliente")).toMatch(/já existe um cliente/i);
    expect(messageForDbError({ code: "42501" }, "projeto")).toMatch(/permissão/);
    expect(messageForDbError({ message: 'new row violates row-level security policy for table "clients"' }, "cliente")).toMatch(/permissão/);
    expect(messageForDbError({ code: "23514" }, "cliente")).toMatch(/regras de cadastro/);
    expect(messageForDbError({ code: "23503" }, "projeto")).toMatch(/relacionado/);
  });

  it("falha de rede vira a mensagem de serviço indisponível", () => {
    expect(messageForDbError({ message: "TypeError: fetch failed" }, "cliente")).toMatch(/serviço de autenticação/);
  });

  it("nunca vaza texto interno do banco", () => {
    const texto = messageForDbError({ code: "XX000", message: 'duplicate key value violates unique constraint "clients_organization_id_name_key"' }, "cliente");
    expect(texto).not.toMatch(/constraint|clients_|violates/);
  });
});
