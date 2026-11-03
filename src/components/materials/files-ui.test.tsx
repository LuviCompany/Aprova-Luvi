import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const prepareUploadsAction = vi.fn();
const finalizeUploadsAction = vi.fn();
const removeFileAction = vi.fn();
const reorderFilesAction = vi.fn();
const startRevisionAction = vi.fn();
vi.mock("@/app/admin/materiais/files-actions", () => ({
  prepareUploadsAction: (...args: unknown[]) => prepareUploadsAction(...args),
  finalizeUploadsAction: (...args: unknown[]) => finalizeUploadsAction(...args),
  removeFileAction: (...args: unknown[]) => removeFileAction(...args),
  reorderFilesAction: (...args: unknown[]) => reorderFilesAction(...args),
  startRevisionAction: (...args: unknown[]) => startRevisionAction(...args),
}));
const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/materials/upload-client", () => ({
  uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrl(...args),
  sha256Hex: async () => "f".repeat(64),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { FilePreview } from "@/components/materials/file-preview";
import { FileUploader } from "@/components/materials/file-uploader";
import { SlidesPanel } from "@/components/materials/slides-panel";
import { StartRevisionDialog } from "@/components/materials/start-revision-dialog";
import { VersionsHistory } from "@/components/materials/versions-history";
import type { MaterialVersionItem, VersionFile } from "@/lib/materials/versions";

const MATERIAL = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const VERSION = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const ids = ["5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60", "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"];

const file = (n: number, over: Partial<VersionFile> = {}): VersionFile => ({
  id: ids[n - 1],
  position: n,
  kind: "imagem",
  mimeType: "image/jpeg",
  originalName: `slide-${n}.jpg`,
  sizeBytes: 2048 * n,
  checksum: null,
  ...over,
});
const jpg = (name = "arte.jpg", size = 1000) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });
const fileInput = (container: HTMLElement) => container.querySelector("input[type=file]") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  prepareUploadsAction.mockImplementation(async (_id: string, metas: unknown[]) => ({
    ok: true,
    uploads: metas.map((_, index) => ({ index, path: `c/m/${index}.jpg`, url: `https://s/up/${index}` })),
  }));
  finalizeUploadsAction.mockResolvedValue({ ok: true, versionId: VERSION });
  uploadToSignedUrl.mockResolvedValue(undefined);
  removeFileAction.mockResolvedValue({ ok: true });
  reorderFilesAction.mockResolvedValue({ ok: true });
  startRevisionAction.mockResolvedValue({ ok: true });
});

describe("FileUploader", () => {
  it("o campo aceita só os formatos do tipo (carrossel: imagens e vídeos; PDF: só PDF) e aceita vários só no carrossel", () => {
    const { container, rerender } = render(<FileUploader materialId={MATERIAL} type="carrossel" existingCount={0} />);
    expect(fileInput(container)).toHaveAttribute("multiple");
    expect(fileInput(container).accept).toContain("video/mp4");
    expect(fileInput(container).accept).not.toContain("application/pdf");
    rerender(<FileUploader materialId={MATERIAL} type="pdf" existingCount={0} />);
    expect(fileInput(container)).not.toHaveAttribute("multiple");
    expect(fileInput(container).accept).toBe("application/pdf");
    expect(screen.getByRole("button", { name: "Enviar arquivo" })).toBeInTheDocument();
    rerender(<FileUploader materialId={MATERIAL} type="imagem" existingCount={1} />);
    expect(screen.getByRole("button", { name: "Substituir arquivo" })).toBeInTheDocument();
  });

  it("envia: prepara, sobe direto pela URL assinada, finaliza com o checksum e atualiza a página", async () => {
    const { container } = render(<FileUploader materialId={MATERIAL} type="imagem" existingCount={0} />);
    const f = jpg();
    await userEvent.upload(fileInput(container), f);

    await waitFor(() => expect(finalizeUploadsAction).toHaveBeenCalledTimes(1));
    expect(prepareUploadsAction).toHaveBeenCalledWith(MATERIAL, [{ name: "arte.jpg", type: "image/jpeg", size: 1000 }]);
    expect(uploadToSignedUrl).toHaveBeenCalledWith("https://s/up/0", f, expect.any(Function));
    expect(finalizeUploadsAction).toHaveBeenCalledWith(MATERIAL, [{ path: "c/m/0.jpg", name: "arte.jpg", type: "image/jpeg", size: 1000, checksum: "f".repeat(64) }]);
    expect(await screen.findByText("Arquivo enviado com sucesso.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Enviado")).toBeInTheDocument();
  });

  it("arquivo inválido é recusado na tela, antes de qualquer envio, com a mensagem do arquivo", async () => {
    const { container } = render(<FileUploader materialId={MATERIAL} type="imagem" existingCount={0} />);
    await userEvent.upload(fileInput(container), new File(["x"], "doc.gif", { type: "image/gif" }), { applyAccept: false });
    expect(await screen.findByText(/Formato não aceito/)).toBeInTheDocument();
    expect(prepareUploadsAction).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("carrossel acima de 10 slides é recusado na tela", async () => {
    const { container } = render(<FileUploader materialId={MATERIAL} type="carrossel" existingCount={9} />);
    await userEvent.upload(fileInput(container), [jpg("a.jpg"), jpg("b.jpg")]);
    expect(await screen.findByText(/no máximo 10 slides/)).toBeInTheDocument();
    expect(prepareUploadsAction).not.toHaveBeenCalled();
  });

  it("falha parcial: registra só os que subiram, marca o que falhou e permite tentar de novo", async () => {
    uploadToSignedUrl.mockImplementation(async (url: string) => {
      if (url.endsWith("/1")) throw new Error("Sem conexão com o armazenamento. Verifique a internet e tente de novo.");
    });
    const { container } = render(<FileUploader materialId={MATERIAL} type="carrossel" existingCount={0} />);
    await userEvent.upload(fileInput(container), [jpg("a.jpg"), jpg("b.jpg")]);

    await waitFor(() => expect(finalizeUploadsAction).toHaveBeenCalledTimes(1));
    expect((finalizeUploadsAction.mock.calls[0][1] as Array<{ name: string }>).map((i) => i.name)).toEqual(["a.jpg"]);
    expect(await screen.findByText(/1 de 2 arquivos enviados/)).toBeInTheDocument();
    expect(screen.getByText(/Sem conexão com o armazenamento/)).toBeInTheDocument();

    uploadToSignedUrl.mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole("button", { name: /Tentar de novo \(1\)/ }));
    await waitFor(() => expect(finalizeUploadsAction).toHaveBeenCalledTimes(2));
    expect((finalizeUploadsAction.mock.calls[1][1] as Array<{ name: string }>).map((i) => i.name)).toEqual(["b.jpg"]);
  });

  it("erro do servidor ao preparar ou conferir aparece no arquivo e na mensagem geral", async () => {
    prepareUploadsAction.mockResolvedValue({ ok: false, error: "Corrija os arquivos indicados.", perFile: { 0: "Arquivo grande demais (30,0 MB)." } });
    const { container } = render(<FileUploader materialId={MATERIAL} type="imagem" existingCount={0} />);
    await userEvent.upload(fileInput(container), jpg());
    expect(await screen.findByText("Arquivo grande demais (30,0 MB).")).toBeInTheDocument();
    expect(screen.getByText("Corrija os arquivos indicados.")).toBeInTheDocument();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("conferência do servidor reprovou o conteúdo: o arquivo fica como falhou com o motivo", async () => {
    finalizeUploadsAction.mockResolvedValue({ ok: false, error: "Alguns arquivos não passaram na conferência.", perFile: { 0: "O conteúdo não corresponde ao formato do arquivo." } });
    const { container } = render(<FileUploader materialId={MATERIAL} type="imagem" existingCount={0} />);
    await userEvent.upload(fileInput(container), jpg());
    expect(await screen.findByText("O conteúdo não corresponde ao formato do arquivo.")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falha de todos os envios não chama o servidor para finalizar", async () => {
    uploadToSignedUrl.mockRejectedValue(new Error("Falha no envio (código 500)."));
    const { container } = render(<FileUploader materialId={MATERIAL} type="imagem" existingCount={0} />);
    await userEvent.upload(fileInput(container), jpg());
    expect(await screen.findByText("Nenhum arquivo foi enviado.")).toBeInTheDocument();
    expect(finalizeUploadsAction).not.toHaveBeenCalled();
  });
});

describe("SlidesPanel", () => {
  const files = [file(1), file(2), file(3)];

  it("mostra os slides em ordem, com pré-visualização pela rota protegida", () => {
    render(<SlidesPanel versionId={VERSION} type="carrossel" files={files} editable />);
    expect(screen.getByRole("list", { name: "Slides do carrossel" })).toBeInTheDocument();
    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    expect(screen.getByText("slide-3.jpg")).toBeInTheDocument();
    expect(screen.getByAltText("slide-1.jpg")).toHaveAttribute("src", `/admin/arquivos/${ids[0]}`);
  });

  it("mover para baixo envia a lista completa na nova ordem; o primeiro não sobe e o último não desce", async () => {
    render(<SlidesPanel versionId={VERSION} type="carrossel" files={files} editable />);
    expect(screen.getByRole("button", { name: "Mover o slide 1 para cima" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mover o slide 3 para baixo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Mover o slide 1 para baixo" }));
    await waitFor(() => expect(reorderFilesAction).toHaveBeenCalledWith(VERSION, [ids[1], ids[0], ids[2]]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("se o servidor recusar a ordem, volta à anterior e mostra o erro", async () => {
    reorderFilesAction.mockResolvedValue({ error: "A ordem dos slides está desatualizada. Recarregue a página." });
    render(<SlidesPanel versionId={VERSION} type="carrossel" files={files} editable />);
    await userEvent.click(screen.getByRole("button", { name: "Mover o slide 2 para cima" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/desatualizada/);
    const names = screen.getAllByText(/^slide-\d\.jpg$/).map((el) => el.textContent);
    expect(names).toEqual(["slide-1.jpg", "slide-2.jpg", "slide-3.jpg"]);
  });

  it("remover pede confirmação e só então chama o servidor", async () => {
    render(<SlidesPanel versionId={VERSION} type="carrossel" files={files} editable />);
    await userEvent.click(screen.getByRole("button", { name: "Remover o slide 2" }));
    const dialog = await screen.findByRole("dialog");
    expect(removeFileAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/apagado do armazenamento/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(removeFileAction).toHaveBeenCalledWith(ids[1]));
  });

  it("versão travada: sem botões de mover nem remover; arquivo único não tem reordenação", () => {
    const { rerender } = render(<SlidesPanel versionId={VERSION} type="carrossel" files={files} editable={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<SlidesPanel versionId={VERSION} type="imagem" files={[file(1)]} editable />);
    expect(screen.queryByRole("button", { name: /Mover/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover o arquivo" })).toBeInTheDocument();
  });

  it("sem arquivos mostra o estado vazio", () => {
    render(<SlidesPanel versionId={VERSION} type="carrossel" files={[]} editable />);
    expect(screen.getByText("Nenhum arquivo nesta versão.")).toBeInTheDocument();
  });
});

describe("StartRevisionDialog", () => {
  it("exige motivo de 10 a 500 caracteres, explica que o histórico é preservado e envia o motivo", async () => {
    render(<StartRevisionDialog materialId={MATERIAL} status="aprovado" />);
    await userEvent.click(screen.getByRole("button", { name: "Iniciar revisão" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/preservados no histórico/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Iniciar revisão" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Motivo da revisão"), "curto");
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Motivo da revisão"), " mas agora está bom");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(startRevisionAction).toHaveBeenCalledWith(MATERIAL, "curto mas agora está bom"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("mostra o erro do servidor sem fechar", async () => {
    startRevisionAction.mockResolvedValue({ error: "Só material aprovado ou com alteração pedida entra em revisão." });
    render(<StartRevisionDialog materialId={MATERIAL} status="alteracao" />);
    await userEvent.click(screen.getByRole("button", { name: "Iniciar revisão" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Motivo da revisão"), "Trocar a foto principal");
    await userEvent.click(within(dialog).getByRole("button", { name: "Iniciar revisão" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Só material aprovado/);
  });
});

describe("VersionsHistory e FilePreview", () => {
  const version = (n: number, over: Partial<MaterialVersionItem> = {}): MaterialVersionItem => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    number: n,
    note: `nota ${n}`,
    createdAt: "2026-11-03T12:00:00Z",
    author: "Designer Teste",
    files: [file(1)],
    frozen: null,
    sent: false,
    ...over,
  });

  it("estado vazio", () => {
    render(<VersionsHistory versions={[]} />);
    expect(screen.getByText(/Nenhuma versão ainda/)).toBeInTheDocument();
  });

  it("lista da mais recente à mais antiga com selos, nota, autor, arquivos e o conteúdo congelado", () => {
    render(
      <VersionsHistory
        versions={[
          version(2, { note: "Ajustar o logo" }),
          version(1, {
            sent: true,
            frozen: {
              frozenAt: "2026-11-02T12:00:00Z",
              content: { title: "Campanha", description: "", caption: "Legenda\ncongelada", type: "carrossel", aspect_ratio: "4:5", channel: "Instagram Feed", publish_date: "2026-12-01", due_date: null },
            },
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("summary"));
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Versão 2")).toBeInTheDocument();
    expect(within(items[0]).getByText("Mais recente")).toBeInTheDocument();
    expect(within(items[0]).getByText("Em edição")).toBeInTheDocument();
    expect(within(items[0]).getByText(/ainda não foi congelado/)).toBeInTheDocument();
    expect(within(items[1]).getByText("Enviada")).toBeInTheDocument();
    expect(within(items[1]).getByText("Instagram Feed")).toBeInTheDocument();
    expect(within(items[1]).getByText("4:5 (retrato)")).toBeInTheDocument();
    expect(within(items[1]).getByText(/Legenda\s*congelada/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/Cópia imutável registrada/)).toBeInTheDocument();
    expect(screen.getAllByText(/Designer Teste/)).toHaveLength(2); // autor de cada versão
  });

  it("pré-visualização usa sempre a rota protegida; PDF abre em nova aba com rel seguro; vídeo tem controles", () => {
    const { container } = render(
      <div>
        <FilePreview file={file(1)} />
        <FilePreview file={file(2, { kind: "video", originalName: "clipe.mp4" })} />
        <FilePreview file={file(3, { kind: "pdf", originalName: "proposta.pdf" })} />
      </div>,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", `/admin/arquivos/${ids[0]}`);
    expect(container.querySelector("video")).toHaveAttribute("controls");
    const link = screen.getByRole("link", { name: /Abrir PDF/ });
    expect(link).toHaveAttribute("href", `/admin/arquivos/${ids[2]}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.innerHTML).not.toMatch(/supabase|storage\/v1|token=/);
  });
});
