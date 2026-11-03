// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de arquivos com Supabase e storage FALSOS. Prova as decisões do servidor: quem pode, o que é
 * validado (tipo, tamanho, ASSINATURA), o que é gravado, o que é apagado quando algo falha e que nunca se mexe
 * em arquivo fora da pasta do material. A RLS e as travas de verdade estão em src/test/db/files-versions.test.ts.
 */

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown]>;
}
type Result = { data: unknown; error: { code?: string; message?: string } | null };

const calls: Call[] = [];
const removed: string[][] = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const signedUploads: string[] = [];
let respond: (call: Call) => Result;
let rpcResult: Result;
let uploadUrlError = false;
let objects: Record<string, { bytes: Uint8Array; total?: number }> = {};

function fakeSupabase() {
  return {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const run = () => {
        calls.push(call);
        return Promise.resolve(respond(call));
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => {
          call.op = "insert";
          call.payload = payload;
          return builder;
        },
        delete: () => {
          call.op = "delete";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: run,
        then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
      };
      return builder;
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          signedUploads.push(path);
          return uploadUrlError ? { data: null, error: { message: "x" } } : { data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: "t", path }, error: null };
        },
        createSignedUrl: async (path: string) => (objects[path] ? { data: { signedUrl: `https://storage.test/sign/${path}` }, error: null } : { data: null, error: { message: "not found" } }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: [], error: null };
        },
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("as ações do painel não podem usar o cliente de chave secreta");
});
const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { finalizeUploadsAction, prepareUploadsAction, removeFileAction, reorderFilesAction, startRevisionAction } from "@/app/admin/materiais/files-actions";

const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const USER = "11111111-1111-4111-8111-111111111111";
const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_CLIENT = "6f708192-3c4d-4e5f-9fa1-2c3d4e5f6071";
const MATERIAL = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const VERSION = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const FILE_A = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60";
const FILE_B = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID1 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID2 = "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f";

const SAVED = { ...process.env };
const sessionOf = (role: string) => ({ kind: "ok", user: { id: USER, role, organizationId: ORG } });
const pad = (...values: number[]) => {
  const out = new Uint8Array(64);
  out.set(values);
  return out;
};
const JPEG = pad(0xff, 0xd8, 0xff, 0xe0);
const PNG = pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const EXE = pad(0x4d, 0x5a, 0x90, 0x00);
const writes = () => calls.filter((c) => c.op !== "select");

interface State {
  material: Record<string, unknown> | null;
  version: Record<string, unknown> | null; // última versão
  oldFile: Record<string, unknown> | null;
}
let state: State;
const pathOf = (uuid: string, ext = "jpg", client = CLIENT) => `${client}/${MATERIAL}/${uuid}.${ext}`;
const putObject = (path: string, bytes: Uint8Array, total = 1000) => {
  objects[path] = { bytes, total };
};

beforeEach(() => {
  calls.length = 0;
  removed.length = 0;
  rpcCalls.length = 0;
  signedUploads.length = 0;
  vi.clearAllMocks();
  uploadUrlError = false;
  objects = {};
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(sessionOf("designer"));
  state = {
    material: { id: MATERIAL, client_id: CLIENT, type: "imagem", status: "rascunho" },
    version: null,
    oldFile: null,
  };
  rpcResult = { data: null, error: null };
  respond = (call) => {
    if (call.op === "select") {
      if (call.table === "materials") return { data: state.material, error: null };
      if (call.table === "material_versions") return { data: state.version ? [state.version] : [], error: null };
      if (call.table === "material_files") return { data: call.filters.some(([c]) => c === "slide_position") ? state.oldFile : state.oldFile, error: null };
    }
    if (call.op === "insert" && call.table === "material_versions") return { data: [{ id: VERSION }], error: null };
    if (call.op === "delete") return { data: [{ id: FILE_A }], error: null };
    return { data: null, error: null };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = decodeURIComponent(String(url).replace("https://storage.test/sign/", ""));
      const object = objects[path];
      if (!object) return new Response("nope", { status: 404 });
      return new Response(object.bytes as unknown as BodyInit, { status: 206, headers: { "content-range": `bytes 0-63/${object.total ?? object.bytes.length}` } });
    }),
  );
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
});

const version = (fileCount: number, sent = false) => ({ id: VERSION, number: 1, material_files: [{ count: fileCount }], approval_requests: [{ count: sent ? 1 : 0 }] });
const item = (uuid: string, over: Record<string, unknown> = {}) => ({ path: pathOf(uuid), name: "arte.jpg", type: "image/jpeg", size: 1000, ...over });

describe("prepareUploadsAction", () => {
  const meta = [{ name: "arte.jpg", type: "image/jpeg", size: 1000 }];

  it("equipe prepara; aprovador e sessões inválidas não chegam ao banco nem ao storage", async () => {
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await prepareUploadsAction(MATERIAL, meta)).ok).toBe(false);
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect(await prepareUploadsAction(MATERIAL, meta)).toMatchObject({ ok: false, error: expect.stringMatching(/sessão expirou/) });
    expect(calls).toHaveLength(0);
    expect(signedUploads).toHaveLength(0);
  });

  it("devolve uma URL assinada por arquivo, com o caminho na pasta {cliente}/{material}/ e a extensão do tipo", async () => {
    const result = await prepareUploadsAction(MATERIAL, meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0].path).toMatch(new RegExp(`^${CLIENT}/${MATERIAL}/[0-9a-f-]{36}\\.jpg$`));
    expect(result.uploads[0].url).toContain("token=");
    expect(signedUploads).toEqual([result.uploads[0].path]);
    expect(writes()).toHaveLength(0); // nada é gravado no banco nesta etapa
  });

  it("recusa tipo, tamanho e quantidade inválidos por arquivo, sem pedir nenhuma URL", async () => {
    const result = await prepareUploadsAction(MATERIAL, [{ name: "x.gif", type: "image/gif", size: 10 }]);
    expect(result).toMatchObject({ ok: false, perFile: { 0: expect.stringMatching(/Formato não aceito/) } });
    expect(await prepareUploadsAction(MATERIAL, [{ name: "x.jpg", type: "image/jpeg", size: 21 * 1024 * 1024 }])).toMatchObject({ ok: false });
    expect(await prepareUploadsAction(MATERIAL, [meta[0], meta[0]])).toMatchObject({ ok: false, error: expect.stringMatching(/único arquivo/) });
    expect(signedUploads).toHaveLength(0);
  });

  it("carrossel: considera os slides que a versão de trabalho já tem; versão já enviada não conta", async () => {
    state.material = { id: MATERIAL, client_id: CLIENT, type: "carrossel", status: "rascunho" };
    state.version = version(9);
    expect(await prepareUploadsAction(MATERIAL, [meta[0], meta[0]])).toMatchObject({ ok: false, error: expect.stringMatching(/no máximo 10/) });
    state.version = version(9, true);
    expect((await prepareUploadsAction(MATERIAL, [meta[0], meta[0]])).ok).toBe(true);
  });

  it("material fora de rascunho, inexistente ou falha do storage", async () => {
    state.material = { id: MATERIAL, client_id: CLIENT, type: "imagem", status: "aprovado" };
    expect(await prepareUploadsAction(MATERIAL, meta)).toMatchObject({ ok: false, error: expect.stringMatching(/Inicie uma revisão/) });
    state.material = null;
    expect(await prepareUploadsAction(MATERIAL, meta)).toMatchObject({ ok: false, error: "Material não encontrado." });
    state.material = { id: MATERIAL, client_id: CLIENT, type: "imagem", status: "rascunho" };
    uploadUrlError = true;
    expect(await prepareUploadsAction(MATERIAL, meta)).toMatchObject({ ok: false, error: expect.stringMatching(/preparar o envio/) });
    expect((await prepareUploadsAction("nao-uuid", meta)).ok).toBe(false);
  });
});

describe("finalizeUploadsAction", () => {
  it("primeiro envio: cria a versão 1, grava o arquivo na posição 1 com o usuário da sessão e confere o objeto", async () => {
    const it1 = item(UUID1, { checksum: "a".repeat(64) });
    putObject(it1.path, JPEG);
    const result = await finalizeUploadsAction(MATERIAL, [it1]);
    expect(result).toEqual({ ok: true, versionId: VERSION });
    const versionInsert = calls.find((c) => c.table === "material_versions" && c.op === "insert")!;
    expect(versionInsert.payload).toEqual({ material_id: MATERIAL, client_id: CLIENT, note: "Versão inicial", created_by: USER });
    const filesInsert = calls.find((c) => c.table === "material_files" && c.op === "insert")!;
    expect(filesInsert.payload).toEqual([
      {
        version_id: VERSION,
        material_id: MATERIAL,
        client_id: CLIENT,
        slide_position: 1,
        kind: "imagem",
        storage_path: it1.path,
        original_name: "arte.jpg",
        mime_type: "image/jpeg",
        size_bytes: 1000,
        checksum_sha256: "a".repeat(64),
        created_by: USER,
      },
    ]);
    expect(removed).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/materiais/[id]", "page");
  });

  it("carrossel com versão de trabalho: acrescenta depois dos slides existentes e NÃO cria versão nova; checksum inválido vira nulo", async () => {
    state.material = { id: MATERIAL, client_id: CLIENT, type: "carrossel", status: "rascunho" };
    state.version = version(2);
    const a = item(UUID1, { checksum: "xyz" });
    const b = item(UUID2, { name: "b.png", type: "image/png", path: pathOf(UUID2, "png") });
    putObject(a.path, JPEG);
    putObject(b.path, PNG);
    expect((await finalizeUploadsAction(MATERIAL, [a, b])).ok).toBe(true);
    expect(calls.some((c) => c.table === "material_versions" && c.op === "insert")).toBe(false);
    const rows = (calls.find((c) => c.table === "material_files" && c.op === "insert")!.payload as Array<Record<string, unknown>>);
    expect(rows.map((r) => r.slide_position)).toEqual([3, 4]);
    expect(rows.map((r) => r.checksum_sha256)).toEqual([null, null]);
  });

  it("versão anterior já enviada: o envio cria uma NOVA versão", async () => {
    state.version = version(1, true);
    const a = item(UUID1);
    putObject(a.path, JPEG);
    expect((await finalizeUploadsAction(MATERIAL, [a])).ok).toBe(true);
    expect(calls.find((c) => c.table === "material_versions" && c.op === "insert")!.payload).toMatchObject({ note: "Nova versão" });
  });

  it("conteúdo que não bate com o tipo (um executável renomeado para .jpg): recusa, apaga o objeto e não grava nada", async () => {
    const a = item(UUID1);
    putObject(a.path, EXE);
    const result = await finalizeUploadsAction(MATERIAL, [a]);
    expect(result).toMatchObject({ ok: false, perFile: { 0: expect.stringMatching(/não corresponde ao formato/) } });
    expect(removed).toEqual([[a.path]]);
    expect(writes()).toHaveLength(0);
  });

  it("tamanho diferente do declarado ou objeto que não chegou: recusa e limpa", async () => {
    const a = item(UUID1);
    putObject(a.path, JPEG, 999);
    expect(await finalizeUploadsAction(MATERIAL, [a])).toMatchObject({ ok: false, perFile: { 0: expect.stringMatching(/tamanho/) } });
    const b = item(UUID2, { path: pathOf(UUID2) });
    expect(await finalizeUploadsAction(MATERIAL, [b])).toMatchObject({ ok: false, perFile: { 0: expect.stringMatching(/não chegou/) } });
    expect(writes()).toHaveLength(0);
    expect(removed.flat()).toEqual([a.path, b.path]);
  });

  it("caminho fora da pasta do material (outro cliente, outro material, formato estranho): recusa e NUNCA apaga o que não é do material", async () => {
    const foreign = pathOf(UUID1, "jpg", OTHER_CLIENT);
    const own = item(UUID2);
    putObject(own.path, JPEG);
    const result = await finalizeUploadsAction(MATERIAL, [{ ...item(UUID1), path: foreign }, own]);
    expect(result).toMatchObject({ ok: false, error: "Caminho de arquivo inválido." });
    expect(removed.flat()).toEqual([own.path]); // só o que está na pasta do próprio material
    expect(writes()).toHaveLength(0);
    removed.length = 0;
    expect(await finalizeUploadsAction(MATERIAL, [{ ...own, path: `${CLIENT}/${MATERIAL}/../x.jpg` }])).toMatchObject({ ok: false });
    expect(await finalizeUploadsAction(MATERIAL, [own, own])).toMatchObject({ ok: false }); // repetido
  });

  it("tipo declarado que não combina com a extensão gerada, ou formato não aceito", async () => {
    const a = item(UUID1, { type: "image/png" }); // caminho .jpg
    putObject(a.path, PNG);
    expect(await finalizeUploadsAction(MATERIAL, [a])).toMatchObject({ ok: false, error: "Tipo de arquivo inválido." });
    expect(removed.flat()).toEqual([a.path]);
  });

  it("material fora de rascunho: apaga o que foi enviado e recusa", async () => {
    state.material = { id: MATERIAL, client_id: CLIENT, type: "imagem", status: "aguardando" };
    const a = item(UUID1);
    putObject(a.path, JPEG);
    expect(await finalizeUploadsAction(MATERIAL, [a])).toMatchObject({ ok: false, error: expect.stringMatching(/Inicie uma revisão/) });
    expect(removed.flat()).toEqual([a.path]);
    expect(writes()).toHaveLength(0);
  });

  it("falha ao gravar as linhas: apaga os objetos enviados", async () => {
    const a = item(UUID1);
    putObject(a.path, JPEG);
    const base = respond;
    respond = (call) => (call.table === "material_files" && call.op === "insert" ? { data: null, error: { code: "23514", message: "arquivo incompatível com o tipo do material" } } : base(call));
    expect(await finalizeUploadsAction(MATERIAL, [a])).toMatchObject({ ok: false, error: "O arquivo não combina com o tipo do material." });
    expect(removed.flat()).toEqual([a.path]);
  });

  it("arquivo único: o novo SUBSTITUI o anterior (linha antiga sai antes, objeto antigo é apagado depois)", async () => {
    state.version = version(1);
    const oldPath = pathOf(UUID2);
    state.oldFile = { id: FILE_A, storage_path: oldPath, version_id: VERSION, created_at: "x", slide_position: 1 };
    const a = item(UUID1);
    putObject(a.path, JPEG);
    expect((await finalizeUploadsAction(MATERIAL, [a])).ok).toBe(true);
    const order = calls.filter((c) => c.table === "material_files" && c.op !== "select").map((c) => c.op);
    expect(order).toEqual(["delete", "insert"]);
    expect((calls.find((c) => c.table === "material_files" && c.op === "insert")!.payload as Array<Record<string, unknown>>)[0].slide_position).toBe(1);
    expect(removed.flat()).toEqual([oldPath]);
  });

  it("arquivo único: se a gravação do novo falhar, a linha antiga é restaurada e o novo objeto é apagado", async () => {
    state.version = version(1);
    const oldPath = pathOf(UUID2);
    state.oldFile = { id: FILE_A, storage_path: oldPath, version_id: VERSION, created_at: "x", slide_position: 1 };
    const a = item(UUID1);
    putObject(a.path, JPEG);
    const base = respond;
    let inserts = 0;
    respond = (call) => {
      if (call.table === "material_files" && call.op === "insert") return ++inserts === 1 ? { data: null, error: { message: "boom" } } : { data: null, error: null };
      return base(call);
    };
    expect((await finalizeUploadsAction(MATERIAL, [a])).ok).toBe(false);
    const restore = calls.filter((c) => c.table === "material_files" && c.op === "insert")[1].payload as Record<string, unknown>;
    expect(restore.storage_path).toBe(oldPath);
    expect(restore).not.toHaveProperty("id");
    expect(removed.flat()).toEqual([a.path]);
  });

  it("aprovador de cliente não finaliza nada", async () => {
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await finalizeUploadsAction(MATERIAL, [item(UUID1)])).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("remoção, ordem e revisão", () => {
  it("remover: apaga a linha, depois o objeto, e recompacta as posições pelo banco", async () => {
    const base = respond;
    respond = (call) => {
      if (call.table === "material_files" && call.op === "select" && call.filters.some(([c]) => c === "id")) return { data: { id: FILE_A, version_id: VERSION, storage_path: pathOf(UUID1) }, error: null };
      if (call.table === "material_files" && call.op === "select") return { data: [{ id: FILE_B }], error: null };
      return base(call);
    };
    expect(await removeFileAction(FILE_A)).toEqual({ ok: true });
    expect(removed.flat()).toEqual([pathOf(UUID1)]);
    expect(rpcCalls).toEqual([{ fn: "reorder_version_files", args: { p_version_id: VERSION, p_order: [FILE_B] } }]);
  });

  it("arquivo de versão enviada (a RLS não apaga) não finge sucesso e não mexe no storage", async () => {
    const base = respond;
    respond = (call) => {
      if (call.op === "select") return { data: { id: FILE_A, version_id: VERSION, storage_path: pathOf(UUID1) }, error: null };
      if (call.op === "delete") return { data: [], error: null };
      return base(call);
    };
    expect(await removeFileAction(FILE_A)).toMatchObject({ error: expect.stringMatching(/já foi enviado/) });
    expect(removed).toHaveLength(0);
    expect((await removeFileAction("abc")).error).toBe("Arquivo inválido.");
  });

  it("reordenar: chama a função do banco com a lista completa; erros viram mensagem amigável", async () => {
    expect(await reorderFilesAction(VERSION, [FILE_B, FILE_A])).toEqual({ ok: true });
    expect(rpcCalls[0]).toEqual({ fn: "reorder_version_files", args: { p_version_id: VERSION, p_order: [FILE_B, FILE_A] } });
    expect((await reorderFilesAction(VERSION, ["x"])).error).toBe("Ordem inválida.");
    rpcResult = { data: null, error: { code: "22023", message: "a ordem precisa listar todos os arquivos da versão, sem repetir" } };
    expect((await reorderFilesAction(VERSION, [FILE_A])).error).toMatch(/desatualizada/);
    rpcResult = { data: null, error: { code: "23514", message: "versão já enviada para aprovação: a ordem não muda" } };
    expect((await reorderFilesAction(VERSION, [FILE_A])).error).toMatch(/já foi enviada/);
  });

  it("iniciar revisão: valida o motivo (10 a 500) antes de chamar o banco e devolve a nova versão", async () => {
    for (const reason of ["", "curto", " ".repeat(30), "x".repeat(501)]) {
      expect((await startRevisionAction(MATERIAL, reason)).error, reason.slice(0, 4)).toMatch(/motivo da revisão/);
    }
    expect(rpcCalls).toHaveLength(0);
    rpcResult = { data: VERSION, error: null };
    expect(await startRevisionAction(MATERIAL, "  Ajustar o logo e o preço  ")).toEqual({ ok: true, versionId: VERSION });
    expect(rpcCalls[0]).toEqual({ fn: "start_material_revision", args: { p_material_id: MATERIAL, p_reason: "Ajustar o logo e o preço" } });
    rpcResult = { data: null, error: { code: "23514", message: "só material aprovado ou com alteração pedida pode entrar em revisão" } };
    expect((await startRevisionAction(MATERIAL, "um motivo bem válido")).error).toMatch(/aprovado ou com alteração/);
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await startRevisionAction(MATERIAL, "um motivo bem válido")).error).toMatch(/permissão/);
  });
});
