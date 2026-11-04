import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build e E2E isolados do `next dev` em execução: NEXT_DIST_DIR=.next-e2e (ver CLAUDE.md).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // O `next dev` registra cada Server Function com os ARGUMENTOS (o token do link e o código de 6 dígitos apareceriam no
  // terminal) e cada requisição com o caminho (o token está em /aprovar/<token>). Nada disso pode ir para log.
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/^\/aprovar\//] },
  },
  partialPrefetching: true,
  // A raiz só leva ao login. Como redirecionamento de configuração (e não como página com
  // redirect()), o Next não tenta pré-renderizar uma página que sempre lança NEXT_REDIRECT.
  async redirects() {
    return [{ source: "/", destination: "/login", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // Link de aprovação: o token vai na URL, então nada dele pode vazar por Referer, cache ou buscador.
        source: "/aprovar/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
