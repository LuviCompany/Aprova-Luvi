// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDS,
  createMaterial,
  createTestDb,
  errorOf,
  seedBase,
  type SentMaterial,
  type TestDb,
} from "./harness";

let db: TestDb;
let aSent: SentMaterial; // cliente A, enviado para aprovação
let aDraft: SentMaterial; // cliente A, rascunho (cliente não pode ver)
let bSent: SentMaterial; // cliente B, enviado
let outraOrg: SentMaterial; // cliente de OUTRA agência

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
  await db.exec(`insert into public.projects (id, client_id, name)
    values ('00000000-0000-4000-8000-0000000000c0', '${IDS.clienteOutraOrg}', 'Projeto Outra Org')`);
  aSent = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, title: "A enviado" });
  aDraft = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, title: "A rascunho" });
  bSent = await createMaterial(db, { clientId: IDS.clienteB, projectId: IDS.projetoB, sent: true, title: "B enviado" });
  outraOrg = await createMaterial(db, {
    clientId: IDS.clienteOutraOrg,
    projectId: "00000000-0000-4000-8000-0000000000c0",
    sent: true,
    title: "Outra agência",
  });
}, 60_000);

afterAll(async () => {
  await db.close();
});

const statusOfMaterial = async (id: string) =>
  (await db.query<{ status: string }>("select status from public.materials where id=$1", [id])).rows[0].status;

const titles = async (userId: string) =>
  db.asUser(userId, async () => {
    const { rows } = await db.query<{ title: string }>("select title from public.materials order by title");
    return rows.map((r) => r.title);
  });

describe("anônimo", () => {
  it("não lê nenhuma tabela de negócio", async () => {
    for (const table of ["materials", "clients", "decisions", "comments", "profiles", "approval_links"]) {
      const erro = await db.asAnon(() => errorOf(() => db.query(`select * from public.${table}`)));
      expect(erro, table).toMatch(/permission denied/);
    }
  });

  it("não executa funções de decisão nem de links", async () => {
    const erro = await db.asAnon(() =>
      errorOf(() => db.query("select public.decide_as_approver($1, 'aprovado', '')", [aSent.requestId])),
    );
    expect(erro).toMatch(/permission denied/);
  });

  it("não lê arquivos do bucket privado", async () => {
    const rows = await db.asAnon(async () => (await db.query("select name from storage.objects")).rows);
    expect(rows).toHaveLength(0);
  });
});

describe("isolamento entre clientes (portal)", () => {
  it("o aprovador do cliente A vê só materiais do cliente A já enviados", async () => {
    expect(await titles(IDS.userClienteA)).toEqual(["A enviado"]);
  });

  it("o aprovador do cliente B vê só os materiais do cliente B", async () => {
    expect(await titles(IDS.userClienteB)).toEqual(["B enviado"]);
  });

  it("rascunhos nunca aparecem para o cliente", async () => {
    const rows = await db.asUser(IDS.userClienteA, async () =>
      (await db.query("select id from public.materials where id = $1", [aDraft.materialId])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("cliente A não enxerga versões, arquivos, solicitações, decisões nem projetos do cliente B", async () => {
    await db.asUser(IDS.userClienteA, async () => {
      const q = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.length;
      expect(await q("select 1 from public.material_versions where material_id = $1", [bSent.materialId])).toBe(0);
      expect(await q("select 1 from public.material_files where material_id = $1", [bSent.materialId])).toBe(0);
      expect(await q("select 1 from public.approval_requests where id = $1", [bSent.requestId])).toBe(0);
      expect(await q("select 1 from public.projects where id = $1", [IDS.projetoB])).toBe(0);
      expect(await q("select 1 from public.clients where id = $1", [IDS.clienteB])).toBe(0);
      expect(await q("select 1 from public.approvers where client_id = $1", [IDS.clienteB])).toBe(0);
    });
  });

  it("cliente A enxerga só o próprio cliente e o próprio projeto", async () => {
    await db.asUser(IDS.userClienteA, async () => {
      const clients = (await db.query<{ id: string }>("select id from public.clients")).rows;
      expect(clients.map((c) => c.id)).toEqual([IDS.clienteA]);
      const projects = (await db.query<{ id: string }>("select id from public.projects")).rows;
      expect(projects.map((p) => p.id)).toEqual([IDS.projetoA]);
    });
  });

  it("aprovador com perfil inativo não vê nada", async () => {
    expect(await titles(IDS.userInativo)).toEqual([]);
  });

  it("cliente não lê perfis da equipe nem auditoria", async () => {
    await db.asUser(IDS.userClienteA, async () => {
      const profiles = (await db.query<{ id: string }>("select id from public.profiles")).rows;
      expect(profiles.map((p) => p.id)).toEqual([IDS.userClienteA]);
      expect((await db.query("select 1 from public.audit_events")).rows).toHaveLength(0);
      expect((await db.query("select 1 from public.organizations")).rows).toHaveLength(0);
    });
  });

  it("cliente não escreve em materiais, versões, arquivos nem solicitações", async () => {
    // Cliente e equipe compartilham o papel de banco "authenticated": o bloqueio vem da RLS
    // (0 linhas afetadas em update/delete e violação de política em insert).
    await db.asUser(IDS.userClienteA, async () => {
      const upd = await db.query("update public.materials set title='hack' where id=$1 returning id", [aSent.materialId]);
      expect(upd.rows).toHaveLength(0);
      const del = await db.query("delete from public.materials where id=$1 returning id", [aSent.materialId]);
      expect(del.rows).toHaveLength(0);
      const ins = (sql: string, params: unknown[]) => errorOf(() => db.query(sql, params));
      expect(
        await ins("insert into public.materials (project_id, client_id, title, type, created_by) values ($1,$2,'novo','imagem',$3)", [IDS.projetoA, IDS.clienteA, IDS.userClienteA]),
      ).toMatch(/row-level security/);
      expect(
        await ins("insert into public.approval_requests (material_id, version_id, client_id, requested_by) values ($1,$2,$3,$4)", [aSent.materialId, aSent.versionId, IDS.clienteA, IDS.userClienteA]),
      ).toMatch(/row-level security/);
      expect(
        await ins("insert into public.material_versions (material_id, client_id, created_by) values ($1,$2,$3)", [aSent.materialId, IDS.clienteA, IDS.userClienteA]),
      ).toMatch(/row-level security/);
      expect(await ins("update public.materials set status='aprovado' where id=$1", [aSent.materialId])).toMatch(/permission denied/);
    });
    expect(await statusOfMaterial(aSent.materialId)).toBe("aguardando");
  });
});

describe("equipe da agência", () => {
  it("vê todos os materiais dos clientes da própria organização, inclusive rascunhos", async () => {
    const t = await titles(IDS.designer);
    expect(t).toEqual(["A enviado", "A rascunho", "B enviado"]);
  });

  it("não enxerga nada de outra organização, e vice-versa", async () => {
    expect(await titles(IDS.staffOutraOrg)).toEqual(["Outra agência"]);
    const rows = await db.asUser(IDS.designer, async () =>
      (await db.query("select 1 from public.clients where id = $1", [IDS.clienteOutraOrg])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("não cria material em cliente de outra organização", async () => {
    const erro = await db.asUser(IDS.designer, () =>
      errorOf(() =>
        db.query(
          "insert into public.materials (project_id, client_id, title, type, created_by) values ($1,$2,'invasor','imagem',$3)",
          ["00000000-0000-4000-8000-0000000000c0", IDS.clienteOutraOrg, IDS.designer],
        ),
      ),
    );
    expect(erro).toMatch(/row-level security|violates|foreign key/i);
  });

  it("não serve de oráculo sobre materiais de outra agência (mensagem idêntica à da RLS)", async () => {
    const probe = (m: SentMaterial) =>
      db.asUser(IDS.staffOutraOrg, () =>
        errorOf(() =>
          db.query("insert into public.material_versions (material_id, client_id, created_by) values ($1,$2,$3)", [m.materialId, IDS.clienteA, IDS.staffOutraOrg]),
        ),
      );
    const comSolicitacaoAberta = await probe(aSent);
    const semSolicitacao = await probe(aDraft);
    expect(comSolicitacaoAberta).toMatch(/row-level security/);
    expect(comSolicitacaoAberta).toBe(semSolicitacao);
  });

  it("não falsifica created_by", async () => {
    const erro = await db.asUser(IDS.designer, () =>
      errorOf(() =>
        db.query(
          "insert into public.materials (project_id, client_id, title, type, created_by) values ($1,$2,'falso','imagem',$3)",
          [IDS.projetoA, IDS.clienteA, IDS.admin],
        ),
      ),
    );
    expect(erro).toMatch(/row-level security/);
  });

  it("edita título mas não altera o status do material diretamente", async () => {
    await db.asUser(IDS.designer, async () => {
      expect(await errorOf(() => db.query("update public.materials set title='Novo título' where id=$1", [aDraft.materialId]))).toBeNull();
      expect(await errorOf(() => db.query("update public.materials set status='aprovado' where id=$1", [aDraft.materialId]))).toMatch(/permission denied/);
    });
    const { rows } = await db.query<{ status: string }>("select status from public.materials where id=$1", [aDraft.materialId]);
    expect(rows[0].status).toBe("rascunho");
  });

  it("não adiciona nem remove arquivos de versão já enviada", async () => {
    await db.asUser(IDS.designer, async () => {
      const insertErr = await errorOf(() =>
        db.query(
          `insert into public.material_files (version_id, material_id, client_id, slide_position, kind,
             storage_path, original_name, mime_type, size_bytes, created_by)
           values ($1,$2,$3,2,'imagem',$4,'x.png','image/png',10,$5)`,
          [aSent.versionId, aSent.materialId, IDS.clienteA, `${IDS.clienteA}/novo.png`, IDS.designer],
        ),
      );
      expect(insertErr).toMatch(/row-level security/);
      const del = await db.query("delete from public.material_files where version_id=$1 returning id", [aSent.versionId]);
      expect(del.rows).toHaveLength(0);
    });
  });

  it("não apaga material enviado", async () => {
    const rows = await db.asUser(IDS.designer, async () =>
      (await db.query("delete from public.materials where id=$1 returning id", [aSent.materialId])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("só atendimento e admin gerenciam clientes; designer não", async () => {
    await db.asUser(IDS.designer, async () => {
      expect(await errorOf(() => db.query("update public.clients set segment='x' where id=$1", [IDS.clienteA]))).toBeNull();
      const { rows } = await db.query("update public.clients set segment='x' where id=$1 returning id", [IDS.clienteA]);
      expect(rows).toHaveLength(0);
    });
    const ok = await db.asUser(IDS.atendimento, async () =>
      (await db.query("update public.clients set segment='Varejo' where id=$1 returning id", [IDS.clienteA])).rows,
    );
    expect(ok).toHaveLength(1);
  });

  it("só administradores leem a auditoria", async () => {
    const admin = await db.asUser(IDS.admin, async () => (await db.query("select 1 from public.audit_events")).rows.length);
    const designer = await db.asUser(IDS.designer, async () => (await db.query("select 1 from public.audit_events")).rows.length);
    expect(admin).toBeGreaterThan(0);
    expect(designer).toBe(0);
  });
});

describe("segredos do fluxo por link", () => {
  it("ninguém no app lê o token_hash, nem a equipe", async () => {
    await db.asUser(IDS.designer, async () => {
      expect(await errorOf(() => db.query("select token_hash from public.approval_links"))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query("select * from public.approval_links"))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query("select id, expires_at, revoked_at from public.approval_links"))).toBeNull();
    });
  });

  it("verificações e sessões de link são inacessíveis a authenticated e anon", async () => {
    for (const table of ["approval_verifications", "approval_link_sessions"]) {
      expect(await db.asUser(IDS.admin, () => errorOf(() => db.query(`select * from public.${table}`))), table).toMatch(/permission denied/);
      expect(await db.asAnon(() => errorOf(() => db.query(`select * from public.${table}`))), table).toMatch(/permission denied/);
    }
  });

  it("clientes não enxergam links de aprovação (0 linhas), nem o hash", async () => {
    await db.asUser(IDS.userClienteA, async () => {
      expect((await db.query("select id from public.approval_links")).rows).toHaveLength(0);
      expect(await errorOf(() => db.query("select token_hash from public.approval_links"))).toMatch(/permission denied/);
    });
  });
});

describe("perfis", () => {
  it("o usuário altera o próprio nome, mas não o próprio papel nem o de outro", async () => {
    await db.asUser(IDS.designer, async () => {
      const own = await db.query("update public.profiles set full_name='Designer Novo' where id=$1 returning id", [IDS.designer]);
      expect(own.rows).toHaveLength(1);
      expect(await errorOf(() => db.query("update public.profiles set role='admin' where id=$1", [IDS.designer]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query("update public.profiles set active=true where id=$1", [IDS.designer]))).toMatch(/permission denied/);
      const other = await db.query("update public.profiles set full_name='Hack' where id=$1 returning id", [IDS.admin]);
      expect(other.rows).toHaveLength(0);
    });
  });

  it("não há cadastro livre: perfis não podem ser criados pelo app", async () => {
    const erro = await db.asUser(IDS.admin, () =>
      errorOf(() =>
        db.query("insert into public.profiles (id, organization_id, full_name, email, role) values ($1,$2,'Intruso','i@x.test','admin')", [
          "00000000-0000-4000-8000-0000000000aa",
          IDS.orgLuvi,
        ]),
      ),
    );
    expect(erro).toMatch(/permission denied/);
  });
});

describe("comentários", () => {
  it("o aprovador comenta como ele mesmo e o nome vem do cadastro", async () => {
    await db.asUser(IDS.userClienteA, async () => {
      await db.query(
        `insert into public.comments (material_id, version_id, client_id, slide, author_role, author_approver_id, body)
         values ($1,$2,$3,2,'cliente',$4,'  Trocar a foto  ')`,
        [aSent.materialId, aSent.versionId, IDS.clienteA, IDS.aprovadorA],
      );
    });
    const { rows } = await db.query<{ author_name: string; body: string }>(
      "select author_name, body from public.comments where material_id=$1",
      [aSent.materialId],
    );
    expect(rows[0]).toEqual({ author_name: "Aprovador A", body: "Trocar a foto" });
  });

  it("não é possível passar author_name (coluna fora do grant)", async () => {
    const erro = await db.asUser(IDS.userClienteA, () =>
      errorOf(() =>
        db.query(
          `insert into public.comments (material_id, version_id, client_id, author_role, author_approver_id, author_name, body)
           values ($1,$2,$3,'cliente',$4,'Fulano Falso','oi')`,
          [aSent.materialId, aSent.versionId, IDS.clienteA, IDS.aprovadorA],
        ),
      ),
    );
    expect(erro).toMatch(/permission denied/);
  });

  it("não comenta em nome de outro aprovador, de outro cliente nem em versão não enviada", async () => {
    const insert = (user: string, m: SentMaterial, client: string, approver: string) =>
      db.asUser(user, () =>
        errorOf(() =>
          db.query(
            `insert into public.comments (material_id, version_id, client_id, author_role, author_approver_id, body)
             values ($1,$2,$3,'cliente',$4,'texto')`,
            [m.materialId, m.versionId, client, approver],
          ),
        ),
      );
    expect(await insert(IDS.userClienteA, aSent, IDS.clienteA, IDS.aprovadorALink)).toMatch(/row-level security/);
    expect(await insert(IDS.userClienteB, aSent, IDS.clienteA, IDS.aprovadorB)).toMatch(/row-level security|foreign key/);
    expect(await insert(IDS.userClienteA, aDraft, IDS.clienteA, IDS.aprovadorA)).toMatch(/row-level security/);
  });

  it("a equipe comenta como Luvi, só em nome próprio", async () => {
    const insert = (profile: string) =>
      db.asUser(IDS.designer, () =>
        errorOf(() =>
          db.query(
            `insert into public.comments (material_id, version_id, client_id, author_role, author_profile_id, body)
             values ($1,$2,$3,'luvi',$4,'Versão ajustada')`,
            [aSent.materialId, aSent.versionId, IDS.clienteA, profile],
          ),
        ),
      );
    expect(await insert(IDS.designer)).toBeNull();
    expect(await insert(IDS.admin)).toMatch(/row-level security/);
  });

  it("o cliente B não lê comentários do cliente A", async () => {
    const rows = await db.asUser(IDS.userClienteB, async () => (await db.query("select 1 from public.comments")).rows);
    expect(rows).toHaveLength(0);
  });

  it("comentários não podem ser editados nem apagados", async () => {
    expect(await errorOf(() => db.query("update public.comments set body='x'"))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.comments"))).toMatch(/imutável/);
  });
});

describe("armazenamento privado (storage.objects)", () => {
  const names = (userId: string | null) => {
    const run = async () => (await db.query<{ name: string }>("select name from storage.objects where bucket_id='materials'")).rows.map((r) => r.name);
    return userId ? db.asUser(userId, run) : db.asAnon(run);
  };

  it("a equipe lê os arquivos dos clientes da própria agência, e só deles", async () => {
    const list = await names(IDS.designer);
    expect(list).toContain(aSent.filePath);
    expect(list).toContain(aDraft.filePath);
    expect(list).toContain(bSent.filePath);
    expect(list).not.toContain(outraOrg.filePath);
  });

  it("o aprovador lê só arquivos de versões enviadas ao próprio cliente", async () => {
    expect(await names(IDS.userClienteA)).toEqual([aSent.filePath]);
    expect(await names(IDS.userClienteB)).toEqual([bSent.filePath]);
  });

  it("o aprovador não lê rascunhos do próprio cliente", async () => {
    expect(await names(IDS.userClienteA)).not.toContain(aDraft.filePath);
  });

  it("anônimo não lê nada", async () => {
    expect(await names(null)).toEqual([]);
  });

  it("a equipe envia arquivos só para a pasta de clientes da própria agência", async () => {
    const put = (path: string) =>
      db.asUser(IDS.designer, () =>
        errorOf(() => db.query("insert into storage.objects (bucket_id, name) values ('materials', $1)", [path])),
      );
    expect(await put(`${IDS.clienteA}/novo/arquivo.png`)).toBeNull();
    expect(await put(`${IDS.clienteOutraOrg}/novo/arquivo.png`)).toMatch(/row-level security/);
    expect(await put("pasta-sem-uuid/arquivo.png")).toMatch(/row-level security/);
  });

  it("o aprovador não envia arquivos", async () => {
    const erro = await db.asUser(IDS.userClienteA, () =>
      errorOf(() => db.query("insert into storage.objects (bucket_id, name) values ('materials', $1)", [`${IDS.clienteA}/x.png`])),
    );
    expect(erro).toMatch(/row-level security/);
  });

  it("arquivos de versão enviada não podem ser apagados; os de rascunho podem", async () => {
    await db.asUser(IDS.designer, async () => {
      const sent = await db.query("delete from storage.objects where name=$1 returning id", [aSent.filePath]);
      expect(sent.rows).toHaveLength(0);
      const draft = await db.query("delete from storage.objects where name=$1 returning id", [aDraft.filePath]);
      expect(draft.rows).toHaveLength(1);
    });
  });
});
