/**
 * "Agora" FIXO da demonstração (Fase 1): as datas fictícias de src/lib/mock são relativas a ele.
 * Fica fora de src/lib/mock de propósito: componentes de cliente que só precisam desta constante não
 * podem puxar os dados fictícios (clientes, materiais, decisões) para o pacote enviado ao navegador.
 * Nunca usar para regra de negócio real: o domínio recebe a data por parâmetro.
 */
export const NOW = "2026-10-28T12:00:00-03:00";
