// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeOutDir,
  buildSupabasePlan,
  runStorageBackup,
  runStorageRestore,
  safeObjectPath,
  sealFile,
  unsealFile,
  verifyStorageDir,
} from "../../scripts/backup-tools.mjs";
import { PRODUCTION_SUPABASE_HOST } from "@/lib/env";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const CLIENT = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const P1 = `${CLIENT}/${MATERIAL}/${VERSION}/slide-1.png`;
const P2 = `${CLIENT}/${MATERIAL}/${VERSION}/slide-2.pdf`;

interface Row { storage_path: string; size_bytes: number; checksum_sha256: string | null; mime_type: string }

/** Supabase FALSO: bucket em memória (listagem por pasta como a real), tabela material_files e registro de chamadas. */
function fakeAdmin(objects: Record<string, string>, rows: Row[]) {
  const store = new Map(Object.entries(objects));
  const uploads: Array<{ path: string; upsert: unknown; contentType: unknown }> = [];
  const storage = {
    from: () => ({
      list: async (prefix: string, opts: { limit: number; offset: number }) => {
        const base = prefix ? `${prefix}/` : "";
        const seen = new Map<string, { name: string; id: string | null; metadata?: { size: number } }>();
        for (const [name, body] of store) {
          if (!name.startsWith(base)) continue;
          const [head, ...tail] = name.slice(base.length).split("/");
          if (tail.length) seen.set(head, { name: head, id: null });
          else seen.set(head, { name: head, id: `obj-${name}`, metadata: { size: Buffer.byteLength(body) } });
        }
        return { data: [...seen.values()].slice(opts.offset, opts.offset + opts.limit), error: null };
      },
      download: async (path: string) =>
        store.has(path) ? { data: new Blob([store.get(path)!]), error: null } : { data: null, error: { message: "not found" } },
      upload: async (path: string, body: Buffer, opts: { upsert: boolean; contentType: string }) => {
        uploads.push({ path, upsert: opts.upsert, contentType: opts.contentType });
        if (store.has(path)) return { error: { message: "The resource already exists" } };
        store.set(path, body.toString());
        return { error: null };
      },
    }),
  };
  const from = () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) });
  return { admin: { storage, from } as never, store, uploads };
}

const goodRows = (): Row[] => [
  { storage_path: P1, size_bytes: 5, checksum_sha256: sha("PNG-1"), mime_type: "image/png" },
  { storage_path: P2, size_bytes: 5, checksum_sha256: sha("PDF-2"), mime_type: "application/pdf" },
];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aprova-backup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("backup-tools: caminhos e destino", () => {
  it("aceita o padrão do app e recusa nomes que escapariam da pasta", () => {
    expect(safeObjectPath(P1)).toBe(P1);
    for (const bad of ["", "../x", "a/../b", "/abs/x", "a//b", "a\\b", "C:/x", "a/b.", "a/b ", "a/b?.png", "a/\u0001"]) {
      expect(() => safeObjectPath(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("recusa gravar dentro do repositório e em pasta sincronizada com a nuvem", () => {
    expect(() => assertSafeOutDir(join(process.cwd(), "backups"))).toThrow(/repositório/);
    expect(() => assertSafeOutDir(process.cwd())).toThrow(/repositório/);
    expect(() => assertSafeOutDir(join(dir, "OneDrive", "bk"))).toThrow(/nuvem/);
    expect(assertSafeOutDir(join(dir, "OneDrive", "bk"), { allowCloud: true })).toContain("bk");
    expect(assertSafeOutDir(join(dir, "bk"))).toContain("bk");
    expect(() => assertSafeOutDir("")).toThrow();
  });

  it("o backup do storage só aceita o projeto de produção e a chave secreta", () => {
    const secret = "sb_secret_" + "s".repeat(30);
    const ok = buildSupabasePlan({ SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`, SUPABASE_SECRET_KEY: secret }, { requireProduction: true });
    expect(ok.errors).toEqual([]);
    const outro = buildSupabasePlan({ SUPABASE_URL: "https://outro-projeto.supabase.co", SUPABASE_SECRET_KEY: secret }, { requireProduction: true });
    expect(outro.errors.join(" ")).toMatch(/produção/);
    const publica = buildSupabasePlan(
      { SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`, SUPABASE_SECRET_KEY: "sb_publishable_" + "p".repeat(30) },
      { requireProduction: true },
    );
    expect(publica.errors.join(" ")).toMatch(/SECRETA/);
    expect(buildSupabasePlan({}, { requireProduction: true }).errors.length).toBeGreaterThan(1);
  });
});

describe("backup-tools: espelho do storage", () => {
  it("copia, grava o manifesto com SHA-256 e confere com o banco", async () => {
    const { admin } = fakeAdmin({ [P1]: "PNG-1", [P2]: "PDF-2" }, goodRows());
    const r = await runStorageBackup({ admin, outDir: dir, now: Date.UTC(2026, 10, 18, 12, 0, 0), projectHost: "x.supabase.co" });
    expect(r.problems).toEqual([]);
    expect(r.downloaded).toBe(2);
    expect(r.manifestPath).toMatch(/manifest-20261118T120000Z\.json$/);
    expect(await readFile(join(dir, "materials", ...P1.split("/")), "utf8")).toBe("PNG-1");
    expect(r.manifest.files.find((f: { path: string }) => f.path === P1)).toMatchObject({ sha256: sha("PNG-1"), size: 5, mime: "image/png", inDb: true });
    expect(JSON.stringify(r.manifest)).not.toMatch(/sb_secret|eyJ/);
  });

  it("a segunda execução reaproveita o que já existe e nunca apaga o que sumiu do Supabase", async () => {
    const first = fakeAdmin({ [P1]: "PNG-1", [P2]: "PDF-2" }, goodRows());
    await runStorageBackup({ admin: first.admin, outDir: dir, now: 1_000_000_000_000 });
    const second = fakeAdmin({ [P1]: "PNG-1" }, goodRows().slice(0, 1)); // P2 foi removido do projeto
    const r = await runStorageBackup({ admin: second.admin, outDir: dir, now: 1_000_000_100_000 });
    expect(r.downloaded).toBe(0);
    expect(r.reused).toBe(1);
    expect(await readFile(join(dir, "materials", ...P2.split("/")), "utf8")).toBe("PDF-2"); // continua no espelho
  });

  it("aponta SHA-256/tamanho diferentes do banco, registro sem objeto e objeto sem registro", async () => {
    const { admin } = fakeAdmin({ [P1]: "PNG-X", [`${CLIENT}/solto.png`]: "zz" }, goodRows());
    const r = await runStorageBackup({ admin, outDir: dir });
    const text = r.problems.join("\n");
    expect(text).toMatch(/SHA-256 diferente/);
    expect(text).toMatch(/Registro no banco sem objeto/);
    expect(r.manifest.objectsWithoutRecord).toEqual([`${CLIENT}/solto.png`]);
  });

  it("storage vazio com registros no banco é problema (projeto errado)", async () => {
    const { admin } = fakeAdmin({}, goodRows());
    const r = await runStorageBackup({ admin, outDir: dir });
    expect(r.problems.join(" ")).toMatch(/storage está vazio/);
  });

  it("ignora (e relata) objeto com nome inseguro em vez de gravar fora da pasta", async () => {
    const { admin } = fakeAdmin({ [`${CLIENT}/a:b.png`]: "x" }, []);
    const r = await runStorageBackup({ admin, outDir: dir });
    expect(r.problems.join(" ")).toMatch(/inseguro/);
    expect(r.manifest.objectCount).toBe(0);
  });
});

describe("backup-tools: verificação do espelho", () => {
  async function backedUp() {
    const f = fakeAdmin({ [P1]: "PNG-1", [P2]: "PDF-2" }, goodRows());
    await runStorageBackup({ admin: f.admin, outDir: dir });
    return f;
  }

  it("confirma um espelho íntegro", async () => {
    await backedUp();
    const v = await verifyStorageDir({ dir });
    expect(v).toMatchObject({ ok: true, checked: 2, missing: [], mismatched: [], extra: 0 });
  });

  it("detecta arquivo alterado e arquivo apagado", async () => {
    await backedUp();
    await writeFile(join(dir, "materials", ...P1.split("/")), "ADULTERADO");
    await rm(join(dir, "materials", ...P2.split("/")));
    const v = await verifyStorageDir({ dir });
    expect(v.ok).toBe(false);
    expect(v.mismatched).toEqual([P1]);
    expect(v.missing).toEqual([P2]);
  });

  it("conta arquivos extras no espelho sem reprovar", async () => {
    await backedUp();
    await mkdir(join(dir, "materials", CLIENT), { recursive: true });
    await writeFile(join(dir, "materials", CLIENT, "antigo.png"), "velho");
    expect((await verifyStorageDir({ dir })).extra).toBe(1);
    expect((await verifyStorageDir({ dir })).ok).toBe(true);
  });

  it("um manifesto com problemas nunca é dado como válido", async () => {
    const f = fakeAdmin({ [P1]: "PNG-X" }, goodRows().slice(0, 1));
    await runStorageBackup({ admin: f.admin, outDir: dir });
    expect((await verifyStorageDir({ dir })).ok).toBe(false);
  });

  it("recusa manifesto adulterado com caminho que escapa da pasta", async () => {
    await backedUp();
    const name = (await readdir(dir)).find((n) => n.startsWith("manifest-"))!;
    const manifest = JSON.parse(await readFile(join(dir, name), "utf8"));
    manifest.files[0].path = "../fora.txt";
    await writeFile(join(dir, name), JSON.stringify(manifest));
    await expect(verifyStorageDir({ dir })).rejects.toThrow(/inseguro/);
  });
});

describe("backup-tools: envio ao projeto de destino", () => {
  it("simulação não grava; execução envia só o que falta, sem sobrescrever", async () => {
    const src = fakeAdmin({ [P1]: "PNG-1", [P2]: "PDF-2" }, goodRows());
    await runStorageBackup({ admin: src.admin, outDir: dir });

    const target = fakeAdmin({ [P1]: "PNG-1" }, []); // projeto novo que já tem um dos arquivos
    const dry = await runStorageRestore({ admin: target.admin, dir, execute: false });
    expect(dry).toEqual({ pending: 1, uploaded: 0, skipped: 0 });
    expect(target.uploads).toEqual([]);

    const done = await runStorageRestore({ admin: target.admin, dir, execute: true });
    expect(done.uploaded).toBe(1);
    expect(target.uploads).toEqual([{ path: P2, upsert: false, contentType: "application/pdf" }]);
    expect(target.store.get(P1)).toBe("PNG-1");
  });

  it("não envia nada se o espelho não confere com o manifesto", async () => {
    const src = fakeAdmin({ [P1]: "PNG-1" }, goodRows().slice(0, 1));
    await runStorageBackup({ admin: src.admin, outDir: dir });
    await writeFile(join(dir, "materials", ...P1.split("/")), "ADULTERADO");
    const target = fakeAdmin({}, []);
    await expect(runStorageRestore({ admin: target.admin, dir, execute: true })).rejects.toThrow(/não confere/);
    expect(target.uploads).toEqual([]);
  });
});

describe("backup-tools: cifragem de arquivos", () => {
  const PASS = "senha-de-teste-bem-longa-123";

  it("cifra e decifra de volta o mesmo conteúdo, e o arquivo cifrado não contém o texto", async () => {
    const plain = join(dir, "dados.dump");
    const sealed = join(dir, "dados.dump.sealed");
    const back = join(dir, "volta.dump");
    const content = Buffer.concat([Buffer.from("CLIENTE CONFIDENCIAL "), Buffer.alloc(300_000, 7)]);
    await writeFile(plain, content);
    await sealFile(plain, sealed, PASS);
    expect((await readFile(sealed)).includes("CONFIDENCIAL")).toBe(false);
    await unsealFile(sealed, back, PASS);
    expect(sha(await readFile(back))).toBe(sha(content));
  });

  it("funciona com arquivo vazio e permite só conferir (--check) sem gravar o conteúdo", async () => {
    const plain = join(dir, "vazio");
    await writeFile(plain, "");
    await sealFile(plain, join(dir, "vazio.sealed"), PASS);
    await expect(unsealFile(join(dir, "vazio.sealed"), null, PASS)).resolves.toBeUndefined();
  });

  it("senha errada e arquivo adulterado falham e não deixam saída em disco", async () => {
    const plain = join(dir, "a.dump");
    await writeFile(plain, "conteúdo importante ".repeat(2000));
    const sealed = join(dir, "a.sealed");
    await sealFile(plain, sealed, PASS);

    const out1 = join(dir, "errada.out");
    await expect(unsealFile(sealed, out1, PASS + "x")).rejects.toThrow(/Senha incorreta ou arquivo corrompido/);
    expect(await readdir(dir)).not.toContain("errada.out");

    const bytes = await readFile(sealed);
    bytes[bytes.length - 100] ^= 0xff;
    await writeFile(sealed, bytes);
    const out2 = join(dir, "adulterado.out");
    await expect(unsealFile(sealed, out2, PASS)).rejects.toThrow(/corrompido/);
    expect(await readdir(dir)).not.toContain("adulterado.out");
  });

  it("exige senha forte, não sobrescreve saída existente e recusa arquivo que não é do Aprova Luvi", async () => {
    const plain = join(dir, "b");
    await writeFile(plain, "x");
    await expect(sealFile(plain, join(dir, "b.sealed"), "curta")).rejects.toThrow(/BACKUP_PASSPHRASE/);
    await sealFile(plain, join(dir, "b.sealed"), PASS);
    await expect(sealFile(plain, join(dir, "b.sealed"), PASS)).rejects.toThrow();
    await writeFile(join(dir, "lixo"), Buffer.alloc(200, 1));
    await expect(unsealFile(join(dir, "lixo"), null, PASS)).rejects.toThrow(/não é um backup/);
  });
});
