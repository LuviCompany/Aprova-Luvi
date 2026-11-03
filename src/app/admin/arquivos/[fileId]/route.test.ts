// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

let guard: { ok: true; supabase: unknown } | { ok: false; error: string };
vi.mock("@/lib/auth/action-guard", () => ({ authorizeStaff: async () => guard }));

const FILE = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60";
let fileRow: { data: unknown; error: unknown };
let signed: { data: { signedUrl: string } | null; error: unknown };
const signedFor: string[] = [];

const supabase = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => fileRow }) }) }),
  storage: {
    from: () => ({
      createSignedUrl: async (path: string, seconds: number) => {
        signedFor.push(`${path}|${seconds}`);
        return signed;
      },
    }),
  },
};

import { GET } from "./route";

const call = (id: string) => GET(new Request("http://localhost/admin/arquivos/x"), { params: Promise.resolve({ fileId: id }) } as never);

beforeEach(() => {
  signedFor.length = 0;
  guard = { ok: true, supabase };
  fileRow = { data: { storage_path: "cliente/material/arquivo.jpg" }, error: null };
  signed = { data: { signedUrl: "https://storage.test/sign/cliente/material/arquivo.jpg?token=abc" }, error: null };
});

describe("GET /admin/arquivos/[fileId]", () => {
  it("equipe com acesso: redireciona para uma URL assinada de 60 s, sem cache e sem Referer", async () => {
    const response = await call(FILE);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(signed.data!.signedUrl);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(signedFor).toEqual(["cliente/material/arquivo.jpg|60"]);
  });

  it("sem sessão da equipe: 401, sem consultar o banco nem gerar URL", async () => {
    guard = { ok: false, error: "Sua sessão expirou. Entre novamente." };
    const response = await call(FILE);
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(signedFor).toHaveLength(0);
  });

  it("arquivo inexistente ou de outro cliente (a RLS não o mostra) responde igual: 404 sem URL", async () => {
    fileRow = { data: null, error: null };
    expect((await call(FILE)).status).toBe(404);
    fileRow = { data: null, error: { message: "x" } };
    expect((await call(FILE)).status).toBe(404);
    expect(signedFor).toHaveLength(0);
  });

  it("id que não é UUID: 404 sem nem checar a sessão; falha ao assinar: 404", async () => {
    expect((await call("../../etc/passwd")).status).toBe(404);
    signed = { data: null, error: { message: "x" } };
    const response = await call(FILE);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
