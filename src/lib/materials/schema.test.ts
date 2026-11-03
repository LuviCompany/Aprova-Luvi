import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  LIMITS,
  LOCKED_CONTENT_FIELDS,
  PAGE_SIZE,
  PRESENTED_FIELDS,
  charCount,
  isContentLocked,
  parseMaterialFilters,
  parseMaterialInput,
  publishBeforeApproval,
} from "./schema";

const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PROJECT = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";

const valid = {
  clientId: CLIENT,
  projectId: PROJECT,
  type: "carrossel",
  title: "Campanha de verão",
  description: "",
  caption: "",
  aspectRatio: "",
  channel: "",
  publishDate: "",
  dueDate: "",
};

const ok = (input: Record<string, unknown>, mode: "create" | "edit" = "create") => {
  const result = parseMaterialInput(input, { mode });
  if (!result.ok) throw new Error(JSON.stringify(result.fieldErrors));
  return result.data;
};
const errors = (input: Record<string, unknown>, mode: "create" | "edit" = "create") => {
  const result = parseMaterialInput(input, { mode });
  return result.ok ? {} : result.fieldErrors;
};

describe("parseMaterialInput", () => {
  it("aceita o mínimo (cliente, projeto, tipo e título) e normaliza os opcionais para vazio/nulo", () => {
    expect(ok(valid)).toEqual({
      clientId: CLIENT,
      projectId: PROJECT,
      type: "carrossel",
      title: "Campanha de verão",
      description: "",
      caption: "",
      aspectRatio: null,
      channel: "",
      publishDate: null,
      dueDate: null,
    });
  });

  it("título: junta espaços repetidos, exige 2 a 200 caracteres e alguma letra ou número", () => {
    expect(ok({ ...valid, title: "  Casa   Aurora  " }).title).toBe("Casa Aurora");
    expect(errors({ ...valid, title: "A" }).title).toMatch(/mínimo de 2/);
    expect(errors({ ...valid, title: "   " }).title).toBeTruthy();
    expect(errors({ ...valid, title: "!!!" }).title).toMatch(/letras ou números/);
    expect(errors({ ...valid, title: "a".repeat(LIMITS.title + 1) }).title).toMatch(/200/);
    expect(errors({ ...valid, title: "a".repeat(LIMITS.title) }).title).toBeUndefined();
  });

  it("legenda: preserva quebras de linha e espaços internos, apara só as pontas e troca CRLF por LF", () => {
    const caption = "  Linha 1\r\n\r\nLinha  3 #tag  ";
    expect(ok({ ...valid, caption }).caption).toBe("Linha 1\n\nLinha  3 #tag");
  });

  it("limites contam caracteres como o Postgres: emoji vale 1", () => {
    expect(charCount("😀".repeat(3))).toBe(3);
    expect(errors({ ...valid, caption: "😀".repeat(LIMITS.caption) }).caption).toBeUndefined();
    expect(errors({ ...valid, caption: "😀".repeat(LIMITS.caption + 1) }).caption).toMatch(/2200/);
    expect(errors({ ...valid, description: "a".repeat(LIMITS.description + 1) }).description).toMatch(/2000/);
    expect(errors({ ...valid, channel: "a".repeat(LIMITS.channel + 1) }).channel).toMatch(/120/);
  });

  it("tipo: só os quatro do banco", () => {
    for (const type of ["imagem", "carrossel", "video", "pdf"]) expect(ok({ ...valid, type }).type).toBe(type);
    expect(errors({ ...valid, type: "gif" }).type).toBeTruthy();
    expect(errors({ ...valid, type: "" }).type).toBeTruthy();
  });

  it("cliente e projeto precisam ser UUID no cadastro", () => {
    expect(errors({ ...valid, clientId: "c1" }).clientId).toBe("Escolha o cliente.");
    expect(errors({ ...valid, projectId: "" }).projectId).toBe("Escolha o projeto.");
  });

  it("na edição, cliente, projeto e tipo não são exigidos", () => {
    const data = ok({ title: "Só o título" }, "edit");
    expect(data.title).toBe("Só o título");
    expect(data.clientId).toBe("");
  });

  it("proporção: vazia vira nula; só 1:1, 4:5, 9:16 e outro", () => {
    for (const ratio of ASPECT_RATIOS) expect(ok({ ...valid, aspectRatio: ratio }).aspectRatio).toBe(ratio);
    expect(ok({ ...valid, aspectRatio: "" }).aspectRatio).toBeNull();
    expect(errors({ ...valid, aspectRatio: "16:9" }).aspectRatio).toMatch(/proporção válida/);
  });

  it("datas: só datas reais; vazia vira nula", () => {
    expect(ok({ ...valid, publishDate: "2026-12-01", dueDate: "2026-11-20" })).toMatchObject({
      publishDate: "2026-12-01",
      dueDate: "2026-11-20",
    });
    expect(errors({ ...valid, publishDate: "2026-02-31" }).publishDate).toMatch(/data válida/);
    expect(errors({ ...valid, dueDate: "01/12/2026" }).dueDate).toMatch(/data válida/);
  });

  it("publicação anterior ao prazo NÃO é erro de validação (é só um aviso na tela)", () => {
    const data = ok({ ...valid, publishDate: "2026-11-01", dueDate: "2026-11-20" });
    expect(data.publishDate).toBe("2026-11-01");
  });

  it("valores que não são texto não quebram a validação", () => {
    expect(errors({ ...valid, title: 123, caption: null, channel: undefined }).title).toBeTruthy();
  });
});

describe("publishBeforeApproval", () => {
  it("avisa só quando a publicação vem antes do prazo; datas iguais ou faltando não avisam", () => {
    expect(publishBeforeApproval("2026-11-01", "2026-11-20")).toBe(true);
    expect(publishBeforeApproval("2026-11-20", "2026-11-20")).toBe(false);
    expect(publishBeforeApproval("2026-12-01", "2026-11-20")).toBe(false);
    expect(publishBeforeApproval(null, "2026-11-20")).toBe(false);
    expect(publishBeforeApproval("2026-11-01", "")).toBe(false);
    expect(publishBeforeApproval("2026-02-31", "2026-11-20")).toBe(false);
  });
});

describe("trava de conteúdo e campos apresentados ao cliente", () => {
  it("só rascunho edita conteúdo", () => {
    expect(isContentLocked("rascunho")).toBe(false);
    for (const status of ["aguardando", "alteracao", "aprovado"] as const) expect(isContentLocked(status)).toBe(true);
  });

  it("os campos travados são parte dos apresentados ao cliente; as datas ficam fora da trava", () => {
    for (const field of LOCKED_CONTENT_FIELDS) expect(PRESENTED_FIELDS).toContain(field);
    expect(LOCKED_CONTENT_FIELDS).not.toContain("publish_date");
    expect(LOCKED_CONTENT_FIELDS).not.toContain("due_date");
    expect(PRESENTED_FIELDS).toContain("publish_date");
  });
});

describe("parseMaterialFilters", () => {
  it("padrão quando não há parâmetros", () => {
    expect(parseMaterialFilters({})).toEqual({ q: "", status: "todos", type: "todos", clientId: null, projectId: null, page: 1 });
  });

  it("lê os filtros válidos e ignora os desconhecidos", () => {
    expect(
      parseMaterialFilters({ q: "  verão   2026 ", status: "aprovado", tipo: "pdf", cliente: CLIENT, projeto: PROJECT, pagina: "3" }),
    ).toEqual({ q: "verão 2026", status: "aprovado", type: "pdf", clientId: CLIENT, projectId: PROJECT, page: 3 });
    const bad = parseMaterialFilters({ status: "x", tipo: "y", cliente: "a b;c", projeto: "'; drop", pagina: "-2" });
    expect(bad).toMatchObject({ status: "todos", type: "todos", clientId: null, projectId: null, page: 1 });
  });

  it("página inválida, enorme ou com texto volta à 1; busca é limitada a 80 caracteres", () => {
    for (const pagina of ["0", "abc", "", "99999999"]) expect(parseMaterialFilters({ pagina }).page).toBe(1);
    expect(parseMaterialFilters({ q: "a".repeat(200) }).q).toHaveLength(80);
    expect(parseMaterialFilters({ q: ["um", "dois"] }).q).toBe("um");
  });

  it("o tamanho da página é fixo", () => {
    expect(PAGE_SIZE).toBe(20);
  });
});
