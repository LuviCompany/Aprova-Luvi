/**
 * Envio direto do navegador para a URL assinada do bucket privado (sem passar pelo servidor do app).
 * Usa XMLHttpRequest porque `fetch` não informa o progresso do envio.
 */

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export function uploadToSignedUrl(url: string, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else if (xhr.status === 413) {
        reject(new UploadError("O arquivo é maior do que o armazenamento aceita.", xhr.status));
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(new UploadError("O envio expirou. Tente de novo.", xhr.status));
      } else {
        reject(new UploadError(`Falha no envio (código ${xhr.status}).`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError("Sem conexão com o armazenamento. Verifique a internet e tente de novo."));
    xhr.ontimeout = () => reject(new UploadError("O envio demorou demais. Tente de novo."));
    xhr.onabort = () => reject(new UploadError("Envio cancelado."));
    // Mesmo formato que o cliente oficial do Supabase usa no envio por URL assinada.
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

/** SHA-256 em hexadecimal (informativo). Devolve `undefined` se o navegador não souber calcular. */
export async function sha256Hex(file: Blob): Promise<string | undefined> {
  try {
    if (!globalThis.crypto?.subtle) return undefined;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}
