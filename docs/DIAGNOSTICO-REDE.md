# Diagnóstico: timeouts de conexão com o Supabase

Investigação feita em **2026-11-02**, sem alterar credenciais nem configurações remotas (só conexões TCP e consultas DNS públicas).

## Sintoma

- `UND_ERR_CONNECT_TIMEOUT` (`Connect Timeout Error … timeout: 10000ms`) em `next dev` e em scripts Node, de forma **intermitente**: a primeira conexão estourava ~10 s e as seguintes respondiam em ~100 ms.
- `fetch failed` no `bootstrap-admin` (uma vez), um `GET /admin` de 26,7 s no `next dev`, e o aviso enganoso "link expirou" ao salvar a senha (corrigido no app: ver `docs/VALIDACAO-FASE-2.md`).

## Evidências

TCP na porta 443, 12 conexões por destino, em milissegundos (`X` = falhou/estourou 6 s):

| Destino | Resultado |
|---|---|
| Supabase `104.18.38.10` | `47 1033 X X 27 1029 1039 3027 18 1028 21 X` |
| Supabase `172.64.149.246` | `X 3061 X 1026 X 11 3040 33 19 3037 X 3026` |
| Cloudflare DNS `1.1.1.1` | `X X X 1049 30 1024 43 26 X 9 X X` |
| Google DNS `8.8.8.8` | `1118 1054 110 X X 50 63 101 54 3114 1065 X` |
| GitHub `140.82.112.3` | `X 1119 111 113 112 1114 110 111 113 116 3140 1139` |
| Vercel `76.76.21.21` | `20 3039 3046 19 22 19 20 26 1034 X 1031 X` |

- **Tempos de ~1 s e ~3 s** são o padrão de **retransmissão do SYN** (o primeiro pacote da conexão se perde e é reenviado após 1 s, depois 2 s...). Isso aparece em **todos** os destinos, não só no Supabase.
- Os dois endereços do Supabase (ambos IPv4; não há registro AAAA) se comportam igual, então não é um IP ruim nem questão de IPv6.
- O DNS responde (A: 2 endereços) e, quando a conexão abre, o Supabase responde rápido (HTTP 200 em ~100 ms; TLS em 50–100 ms).
- `ping` ao roteador: 0% de perda; `ping 1.1.1.1`: 6% de perda (1 em 15), mínimo 6 ms, média 10 ms.
- A máquina está em **Wi-Fi 802.11g, 54 Mbps, canal 3 (2,4 GHz)**, sinal 95%, com uma placa Wi-Fi 6 (MediaTek MT7920): o enlace está muito abaixo do que a placa suporta.
- Consultas DNS por UDP (`nslookup 8.8.8.8`) também deram "timed out" várias vezes na mesma janela.

## Conclusão

**A causa é a rede local ou o provedor, não o Supabase, o app, as chaves nem a configuração do projeto.** Um ponto de acesso em modo legado (802.11g) num canal 2,4 GHz disputado, ou o roteador/NAT do provedor, perdendo os primeiros pacotes de conexões novas, explica o padrão. Não foi possível separar "Wi-Fi" de "roteador/provedor" sem trocar de rede; essa é a etapa seguinte.

Não foi a causa: IPv6/happy eyeballs, DNS, certificado/TLS, chave ou URL do projeto, limite de requisições do Supabase (as falhas ocorrem em destinos que nada têm a ver com ele).

## Como reproduzir

```bash
npm run net:check
```

Abre 12 conexões TCP:443 por endereço do projeto e por dois destinos de controle (`1.1.1.1`, `8.8.8.8`) e conclui sozinho: "rede local ou provedor" (controles também perdem pacotes), "caminho até o Supabase" (só o projeto perde) ou "inconclusivo". Não usa chaves nem altera nada. A lógica de decisão tem teste (`src/test/check-network.test.ts`).

## O que fazer (por conta do usuário; nada disso foi alterado pelo assistente)

1. Rode `npm run net:check` **em outra rede** (celular como roteador, ou cabo Ethernet) e compare. Se lá ficar sem `X`/1000/3000, está confirmado que é a rede de origem.
2. No roteador: tirar o modo "somente 802.11g/legado" (usar b/g/n/ax misto ou ax), preferir a banda de 5 GHz, trocar o canal 2,4 GHz para 1, 6 ou 11, e atualizar o firmware. Se o roteador é do provedor, abrir chamado citando a perda de SYN intermitente.
3. Não mexer em ajustes globais do Windows (por exemplo, o RTO inicial do TCP) só para mascarar o problema.

## O que o app já faz e o que não faz

- **Já:** falha de rede ao consultar a sessão não vira mais "sem sessão"/"link expirou"; login e troca de senha mostram "Não foi possível falar com o serviço de autenticação. Tente novamente" e **não encerram a sessão**; páginas protegidas falham fechado (erro claro) em vez de fingir logout.
- **Não (decisão pendente):** um `fetch` com timeout de conexão curto (ex.: 3 s) e 1–2 tentativas para o cliente Supabase **só em desenvolvimento**, que esconderia o problema na rede de casa. Não foi implementado para não adicionar código de contorno antes de confirmar a causa em outra rede.
- A produção (Vercel → Supabase) roda em rede de datacenter e não depende da rede doméstica de desenvolvimento; o risco para o lançamento é baixo, mas os logs da produção devem ser acompanhados (ver `docs/CHECKLIST-LANCAMENTO.md`).
