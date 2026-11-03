import { describe, expect, it } from "vitest";
import {
  FILE_LIMITS,
  MAX_SLIDES,
  acceptFor,
  allowedKinds,
  cleanFileName,
  contentMatchesDeclared,
  formatBytes,
  isOwnPath,
  sniffMime,
  storagePathFor,
  validateUploadPlan,
} from "./files";

const MB = 1024 * 1024;
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new Uint8Array([...value].map((c) => c.charCodeAt(0)));
const pad = (data: Uint8Array, size = 32) => {
  const out = new Uint8Array(size);
  out.set(data);
  return out;
};

const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const MATERIAL = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const FILE = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const img = (size = 1000, type = "image/jpeg") => ({ name: "a.jpg", type, size });

describe("validateUploadPlan", () => {
  it("imagem, vídeo e PDF: um arquivo do próprio tipo; vários não", () => {
    expect(validateUploadPlan("imagem", 0, [img()])).toEqual({ ok: true });
    expect(validateUploadPlan("video", 0, [{ name: "v.mp4", type: "video/mp4", size: 5 * MB }])).toEqual({ ok: true });
    expect(validateUploadPlan("pdf", 0, [{ name: "p.pdf", type: "application/pdf", size: 5 * MB }])).toEqual({ ok: true });
    const many = validateUploadPlan("imagem", 0, [img(), img()]);
    expect(many.ok).toBe(false);
    expect(!many.ok && many.error).toMatch(/único arquivo/);
  });

  it("um arquivo de tipo errado é recusado com a mensagem do arquivo", () => {
    const result = validateUploadPlan("imagem", 0, [{ name: "v.mp4", type: "video/mp4", size: 10 }]);
    expect(result).toMatchObject({ ok: false, perFile: { 0: expect.stringMatching(/não serve/) } });
    const pdfInCarousel = validateUploadPlan("carrossel", 0, [{ name: "p.pdf", type: "application/pdf", size: 10 }]);
    expect(pdfInCarousel).toMatchObject({ ok: false, perFile: { 0: expect.stringMatching(/carrossel/) } });
  });

  it("carrossel aceita imagens e vídeos misturados até 10 slides, contando os que já existem", () => {
    const mixed = [img(), { name: "v.mov", type: "video/quicktime", size: 3 * MB }];
    expect(validateUploadPlan("carrossel", 0, mixed)).toEqual({ ok: true });
    expect(validateUploadPlan("carrossel", 8, mixed)).toEqual({ ok: true });
    const over = validateUploadPlan("carrossel", 9, mixed);
    expect(over).toMatchObject({ ok: false, error: expect.stringContaining(`no máximo ${MAX_SLIDES}`) });
    expect(validateUploadPlan("carrossel", 0, Array.from({ length: 11 }, () => img())).ok).toBe(false);
  });

  it("formato desconhecido, arquivo vazio e arquivo acima do limite", () => {
    expect(validateUploadPlan("imagem", 0, [{ name: "a.gif", type: "image/gif", size: 10 }])).toMatchObject({ perFile: { 0: expect.stringMatching(/Formato não aceito/) } });
    expect(validateUploadPlan("imagem", 0, [img(0)])).toMatchObject({ perFile: { 0: expect.stringMatching(/vazio/) } });
    expect(validateUploadPlan("imagem", 0, [img(FILE_LIMITS.imagem)]).ok).toBe(true);
    expect(validateUploadPlan("imagem", 0, [img(FILE_LIMITS.imagem + 1)])).toMatchObject({ perFile: { 0: expect.stringMatching(/20,0 MB/) } });
    expect(validateUploadPlan("video", 0, [{ name: "v.mp4", type: "video/mp4", size: 50 * MB + 1 }]).ok).toBe(false);
    expect(validateUploadPlan("pdf", 0, [{ name: "p.pdf", type: "application/pdf", size: 50 * MB }]).ok).toBe(true);
  });

  it("sem arquivo algum, pede para escolher", () => {
    expect(validateUploadPlan("imagem", 0, [])).toMatchObject({ ok: false, error: "Escolha ao menos um arquivo." });
  });
});

describe("assinatura do arquivo", () => {
  const JPEG = pad(bytes(0xff, 0xd8, 0xff, 0xe0));
  const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
  const WEBP = pad(text("RIFF\0\0\0\0WEBPVP8 "));
  const PDF = pad(text("%PDF-1.7\n"));
  const MP4 = pad(new Uint8Array([0, 0, 0, 0x20, ...text("ftypisom")]));
  const MOV = pad(new Uint8Array([0, 0, 0, 0x14, ...text("ftypqt  ")]));

  it("reconhece os seis formatos aceitos", () => {
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(MP4)).toBe("video/mp4");
    expect(sniffMime(MOV)).toBe("video/quicktime");
    expect(sniffMime(pad(new Uint8Array([0, 0, 0, 8, ...text("moov")])))).toBe("video/quicktime");
  });

  it("não confunde: executável, HTML, texto e vazio não são reconhecidos", () => {
    expect(sniffMime(pad(text("MZ\x90\0")))).toBeNull();
    expect(sniffMime(pad(text("<html><script>")))).toBeNull();
    expect(sniffMime(pad(text("%PD")))).toBeNull();
    expect(sniffMime(new Uint8Array())).toBeNull();
    expect(sniffMime(pad(text("RIFF\0\0\0\0WAVEfmt ")))).toBeNull(); // RIFF que não é WebP
  });

  it("o conteúdo precisa bater com o tipo declarado (um .exe renomeado para .jpg falha)", () => {
    expect(contentMatchesDeclared("image/jpeg", JPEG)).toBe(true);
    expect(contentMatchesDeclared("image/png", JPEG)).toBe(false);
    expect(contentMatchesDeclared("application/pdf", pad(text("MZ\x90\0")))).toBe(false);
    expect(contentMatchesDeclared("image/jpeg", PDF)).toBe(false);
    expect(contentMatchesDeclared("video/mp4", MOV)).toBe(true); // mesma família de contêiner
    expect(contentMatchesDeclared("video/mp4", JPEG)).toBe(false);
  });
});

describe("caminhos, nomes e formatos", () => {
  it("o caminho gerado fica na pasta do material e só esse formato é aceito de volta", () => {
    const path = storagePathFor(CLIENT, MATERIAL, FILE, "image/png");
    expect(path).toBe(`${CLIENT}/${MATERIAL}/${FILE}.png`);
    expect(isOwnPath(path, CLIENT, MATERIAL)).toBe(true);
    for (const bad of [
      `${CLIENT}/${MATERIAL}/../${FILE}.png`,
      `${CLIENT}/${FILE}/${FILE}.png`,
      `${FILE}/${MATERIAL}/${FILE}.png`,
      `${CLIENT}/${MATERIAL}/x/${FILE}.png`,
      `${CLIENT}/${MATERIAL}/${FILE}.exe`,
      `${CLIENT}/${MATERIAL}/arquivo.png`,
      `${CLIENT}/${MATERIAL}/`,
    ]) {
      expect(isOwnPath(bad, CLIENT, MATERIAL), bad).toBe(false);
    }
    expect(isOwnPath(path, CLIENT, FILE)).toBe(false);
  });

  it("nome para exibição: sem pastas nem caracteres de controle, até 255", () => {
    expect(cleanFileName("C:\\Users\\x\\arte final.png")).toBe("arte final.png");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\u0000b\nc.png")).toBe("abc.png");
    expect(cleanFileName("   ")).toBe("arquivo");
    expect(cleanFileName("a".repeat(400))).toHaveLength(255);
  });

  it("atributo accept e tipos permitidos por material", () => {
    expect(acceptFor("pdf")).toBe("application/pdf");
    expect(acceptFor("carrossel")).toContain("video/mp4");
    expect(acceptFor("carrossel")).not.toContain("application/pdf");
    expect(allowedKinds("carrossel")).toEqual(["imagem", "video"]);
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(5 * MB)).toBe("5,0 MB");
  });
});
