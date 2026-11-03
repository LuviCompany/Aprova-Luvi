// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Step {
  method: string;
  args: unknown[];
}
let steps: Step[] = [];
let result: { data: unknown; error: { message: string } | null } = { data: [], error: null };

function builderFor(table: string) {
  steps = [{ method: "from", args: [table] }];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    builder[method] = (...args: unknown[]) => {
      steps.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { VERSIONS_SELECT, listMaterialVersions } from "./versions";

const MATERIAL = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const V1 = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const F1 = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60";
const F2 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const content = { title: "T", description: "", caption: "Legenda", type: "imagem", aspect_ratio: null, channel: "", publish_date: null, due_date: null, files: [] };

const row = (over: Record<string, unknown> = {}) => ({
  id: V1,
  number: 2,
  note: "nota",
  created_at: "2026-11-03T12:00:00Z",
  profiles: { full_name: "Designer Teste" },
  material_files: [
    { id: F2, slide_position: 2, kind: "video", mime_type: "video/mp4", original_name: "b.mp4", size_bytes: 20, checksum_sha256: null },
    { id: F1, slide_position: 1, kind: "imagem", mime_type: "image/jpeg", original_name: "a.jpg", size_bytes: 10, checksum_sha256: "a".repeat(64) },
  ],
  material_version_contents: null,
  approval_requests: [{ count: 0 }],
  ...over,
});

beforeEach(() => {
  result = { data: [], error: null };
});

describe("listMaterialVersions", () => {
  it("consulta pelo material, da versão mais recente para a mais antiga", async () => {
    await listMaterialVersions(MATERIAL);
    expect(steps.some((s) => s.method === "select" && s.args[0] === VERSIONS_SELECT)).toBe(true);
    expect(steps.some((s) => s.method === "eq" && s.args[0] === "material_id" && s.args[1] === MATERIAL)).toBe(true);
    expect(steps.some((s) => s.method === "order" && s.args[0] === "number" && (s.args[1] as { ascending: boolean }).ascending === false)).toBe(true);
  });

  it("id que não é UUID não consulta o banco", async () => {
    steps = [];
    expect(await listMaterialVersions("nao-uuid")).toEqual([]);
    expect(steps).toHaveLength(0);
  });

  it("ordena os arquivos por posição e converte para o formato da tela", async () => {
    result = { data: [row()], error: null };
    const [version] = await listMaterialVersions(MATERIAL);
    expect(version).toMatchObject({ id: V1, number: 2, note: "nota", author: "Designer Teste", frozen: null, sent: false });
    expect(version.files.map((f) => f.originalName)).toEqual(["a.jpg", "b.mp4"]);
    expect(version.files[0]).toEqual({ id: F1, position: 1, kind: "imagem", mimeType: "image/jpeg", originalName: "a.jpg", sizeBytes: 10, checksum: "a".repeat(64) });
  });

  it("conteúdo congelado como objeto ou lista; 'enviada' quando há solicitação", async () => {
    result = {
      data: [
        row({ material_version_contents: { content, frozen_at: "2026-11-02T12:00:00Z" }, approval_requests: [{ count: 1 }] }),
        row({ id: F1, number: 1, material_version_contents: [{ content, frozen_at: "2026-11-01T12:00:00Z" }], profiles: null }),
      ],
      error: null,
    };
    const [a, b] = await listMaterialVersions(MATERIAL);
    expect(a.sent).toBe(true);
    expect(a.frozen).toMatchObject({ frozenAt: "2026-11-02T12:00:00Z", content: { caption: "Legenda" } });
    expect(b.frozen?.content.title).toBe("T");
    expect(b.author).toBeNull();
  });

  it("erro do banco e resposta fora do formato viram DataLoadError", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(listMaterialVersions(MATERIAL)).rejects.toThrow(/Não foi possível carregar as versões/);
    result = { data: [row({ material_files: [{ id: F1 }] })], error: null };
    await expect(listMaterialVersions(MATERIAL)).rejects.toThrow(/resposta inesperada/);
  });
});
