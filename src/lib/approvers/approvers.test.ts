import { describe, expect, it } from "vitest";
import { messageForDbError } from "@/lib/clients/errors";
import { pickPortalContext, sortLinks, type PortalLink } from "@/lib/auth/portal-selection";
import { alsoApprovesFor, buildLinkCandidates, type OtherApproverRow } from "./people";
import { accessStatus, normalizeEmail, parseApproverInput } from "./schema";

describe("parseApproverInput", () => {
  it("normaliza nome, cargo e e-mail (minúsculas, sem espaços nas pontas)", () => {
    expect(parseApproverInput({ name: "  Marina   Prado ", email: "  Marina.Prado@CasaAurora.COM  ", jobTitle: " Diretora  de  Marketing " })).toEqual({
      ok: true,
      data: { name: "Marina Prado", email: "marina.prado@casaaurora.com", jobTitle: "Diretora de Marketing" },
    });
  });

  it("cargo é opcional", () => {
    const r = parseApproverInput({ name: "Paulo", email: "paulo@x.com", jobTitle: "" });
    expect(r.ok && r.data.jobTitle).toBe("");
  });

  it("rejeita e-mail inválido com as mesmas regras do banco", () => {
    for (const email of ["", "sem-arroba", "a@b", "a b@c.com", "a@b c.com", "@x.com", "a@.com"]) {
      expect(parseApproverInput({ name: "Paulo", email, jobTitle: "" }), email).toMatchObject({
        ok: false,
        fieldErrors: { email: "Informe um e-mail válido." },
      });
    }
    expect(parseApproverInput({ name: "Paulo", email: `${"a".repeat(250)}@x.com`, jobTitle: "" }).ok).toBe(false);
  });

  it("exige nome com 2+ caracteres e com letra ou número; limita nome e cargo a 120", () => {
    expect(parseApproverInput({ name: "A", email: "a@b.com" })).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/mínimo de 2/) } });
    expect(parseApproverInput({ name: "!!", email: "a@b.com" })).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/letras ou números/) } });
    expect(parseApproverInput({ name: "n".repeat(121), email: "a@b.com", jobTitle: "c".repeat(121) })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), jobTitle: expect.any(String) },
    });
  });

  it("na edição o e-mail não é exigido nem devolvido (o e-mail não muda)", () => {
    const r = parseApproverInput({ name: "Paulo Aurora", email: "ignorado@x.com", jobTitle: "Diretor" }, { requireEmail: false });
    expect(r).toEqual({ ok: true, data: { name: "Paulo Aurora", email: "", jobTitle: "Diretor" } });
    expect(parseApproverInput({ name: "Paulo Aurora" }, { requireEmail: false }).ok).toBe(true);
  });

  it("tolera entrada ausente ou de tipo errado sem lançar", () => {
    expect(parseApproverInput({}).ok).toBe(false);
    expect(parseApproverInput({ name: 1 as unknown as string, email: {} as unknown as string }).ok).toBe(false);
  });

  it("normalizeEmail", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
  });
});

describe("accessStatus", () => {
  it("login vence; senão o convite em aberto; senão só por link", () => {
    expect(accessStatus(true, "preparado")).toBe("login");
    expect(accessStatus(false, "preparado")).toBe("convite_preparado");
    expect(accessStatus(false, "enviado")).toBe("convite_enviado");
    expect(accessStatus(false, null)).toBe("so_link");
    expect(accessStatus(false, "revogado")).toBe("so_link");
  });
});

const row = (over: Partial<OtherApproverRow> & Pick<OtherApproverRow, "id" | "email">): OtherApproverRow => ({
  clientId: "c-" + over.id,
  clientName: "Cliente " + over.id,
  name: "Pessoa " + over.email,
  jobTitle: "",
  active: true,
  hasLogin: false,
  ...over,
});

describe("agrupamento por pessoa", () => {
  const rows = [
    row({ id: "1", email: "ana@x.com", clientName: "Vita Nutri", hasLogin: false }),
    row({ id: "2", email: "ANA@x.com", clientName: "Brisa Modas", hasLogin: true }),
    row({ id: "3", email: "bia@x.com", clientName: "Vita Nutri", active: false }),
    row({ id: "4", email: "caio@x.com", clientName: "Rota 66" }),
  ];

  it("candidatos: uma entrada por pessoa (e-mail sem diferenciar caixa), preferindo a linha com login", () => {
    const candidates = buildLinkCandidates(rows, ["caio@x.com"]);
    expect(candidates.map((c) => c.email.toLowerCase())).toEqual(["ana@x.com"]);
    expect(candidates[0]).toMatchObject({ sourceApproverId: "2", hasLogin: true, clientNames: ["Brisa Modas", "Vita Nutri"] });
  });

  it("não oferece quem já está neste cliente, nem vínculos inativos", () => {
    expect(buildLinkCandidates(rows, ["ana@x.com", "caio@x.com"])).toEqual([]);
    expect(buildLinkCandidates(rows, []).map((c) => c.email.toLowerCase())).not.toContain("bia@x.com");
  });

  it("ordena por nome", () => {
    const list = buildLinkCandidates(
      [row({ id: "1", email: "z@x.com", name: "Zélia" }), row({ id: "2", email: "a@x.com", name: "Ágata" }), row({ id: "3", email: "m@x.com", name: "Marcos" })],
      [],
    );
    expect(list.map((c) => c.name)).toEqual(["Ágata", "Marcos", "Zélia"]);
  });

  it("'também aprova para' lista só outros clientes com vínculo ativo", () => {
    const map = alsoApprovesFor(rows, ["ana@x.com", "bia@x.com"]);
    expect(map.get("ana@x.com")).toEqual(["Brisa Modas", "Vita Nutri"]);
    expect(map.has("bia@x.com")).toBe(false);
  });
});

describe("escolha da empresa no portal (nunca 'o primeiro vínculo')", () => {
  const link = (id: string, name: string): PortalLink => ({ approverId: "a" + id, clientId: id, clientName: name });
  const vita = link("11111111-1111-4111-8111-111111111111", "Vita Nutri");
  const aurora = link("22222222-2222-4222-8222-222222222222", "Casa Aurora");

  it("nenhum vínculo: sem acesso", () => {
    expect(pickPortalContext([], undefined)).toEqual({ kind: "none" });
    expect(pickPortalContext([], vita.clientId)).toEqual({ kind: "none" });
  });

  it("um vínculo: é ele, com ou sem preferência (não há o que escolher)", () => {
    expect(pickPortalContext([vita], undefined)).toMatchObject({ kind: "ok", context: vita });
    expect(pickPortalContext([vita], aurora.clientId)).toMatchObject({ kind: "ok", context: vita });
  });

  it("vários vínculos e nenhuma escolha: PEDE a escolha, em vez de pegar o primeiro", () => {
    const result = pickPortalContext([vita, aurora], undefined);
    expect(result.kind).toBe("choose");
    expect(result.kind === "choose" && result.links.map((l) => l.clientName)).toEqual(["Casa Aurora", "Vita Nutri"]);
  });

  it("a preferência só vale se for um dos vínculos devolvidos agora; qualquer outro valor é ignorado", () => {
    expect(pickPortalContext([vita, aurora], aurora.clientId)).toMatchObject({ kind: "ok", context: aurora });
    for (const lixo of ["33333333-3333-4333-8333-333333333333", "' or 1=1 --", "", "casa aurora"]) {
      expect(pickPortalContext([vita, aurora], lixo).kind, lixo).toBe("choose");
    }
  });

  it("a ordem não depende da ordem em que o banco devolve", () => {
    expect(sortLinks([vita, aurora]).map((l) => l.clientName)).toEqual(sortLinks([aurora, vita]).map((l) => l.clientName));
  });
});

describe("mensagens de erro das funções do banco (A.2)", () => {
  it("traduz as exceções escritas de propósito, sem vazar o texto interno", () => {
    const casos: Array<[Parameters<typeof messageForDbError>[0], Parameters<typeof messageForDbError>[1], RegExp]> = [
      [{ code: "23514", message: "cliente arquivado: reative o cliente antes de cadastrar em projects" }, "projeto", /arquivado/],
      [{ code: "P0001", message: "sem permissão" }, "vinculo", /permissão/],
      [{ code: "P0001", message: "o e-mail do aprovador deve ser o mesmo do login vinculado" }, "aprovador", /mesmo do login/],
      [{ code: "P0001", message: "aprovador de origem inativo" }, "vinculo", /origem está inativa/],
      [{ code: "P0001", message: "a origem e o destino são o mesmo cliente" }, "vinculo", /já pertence/],
      [{ code: "P0001", message: "o aprovador já tem acesso ao portal" }, "convite", /já tem acesso/],
      [{ code: "P0001", message: "aprovador inativo" }, "convite", /inativo/],
      [{ code: "P0001", message: "o convite não está em aberto" }, "convite", /não está mais em aberto/],
      [{ code: "23505", message: "duplicate key value violates unique constraint approvers_client_id_email_key" }, "aprovador", /e-mail já está cadastrado/],
      [{ code: "23505", message: "duplicate key" }, "vinculo", /já está vinculada/],
      [{ code: "23505", message: "duplicate key" }, "convite", /convite em aberto/],
    ];
    for (const [error, entity, esperado] of casos) {
      const texto = messageForDbError(error, entity);
      expect(texto, JSON.stringify(error)).toMatch(esperado);
      expect(texto).not.toMatch(/duplicate key|constraint|approvers_|projects|violates/);
    }
  });
});
