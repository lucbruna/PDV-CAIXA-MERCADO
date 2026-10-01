# Arquitetura — PDV Sudam em rede (5 caixas)

Decidido com o cliente em 2026-09-28. Substitui o modelo local-only.

## Decisões

| Tema | Escolha | Motivo |
|---|---|---|
| Servidor | Mini PC na loja, rodando Node + SQLite | Custo R$ 0; não depende de internet |
| Clientes | 5 caixas abrem o endereço HTTPS do mini PC no Chrome | Nada a instalar nos caixas |
| Internet cai | Não afeta o sistema | Tudo trafega na rede local, não na internet |
| Fiscal | Não emite NFC-e/MFE | Controle interno |
| Dependências | Zero | `node:sqlite` já vem no Node 22+ |

## Por que o modelo local-only não dava conta

`localStorage` tem 5 MB por máquina, medidos no Chromium: `setItem` passa com
5000 KB e estoura com 5100 KB. A falha real apareceu por volta de **10.400
vendas** — uma venda aparecia na tela, o troco saía, e o registro sumia ao
reabrir, sem aviso. Além disso, 5 máquinas com arquivos separados nunca
enxergam a venda uma da outra.

Mover o dado para o servidor mata os dois problemas de uma vez: o limite deixa
de existir (SQLite em disco) e os 5 caixas passam a ler a mesma verdade.

## Forma do sistema

```
   LOJA (rede local, nao usa internet)
   ┌──────────────────────────────────────────────┐
   │  MINI PC                                     │
   │    node servidor.mjs  (porta 8787)           │
   │      ├─ node:sqlite  → dados/sudam.db        │
   │      ├─ backup automatico diario             │
   │      └─ serve o proprio app (html/css/js)    │
   └──────────────┬───────────────────────────────┘
                  │  https://192.168.0.10/
     ┌────────┬───┴───┬────────┬────────┐
   CAIXA 1 CAIXA 2  CAIXA 3  CAIXA 4  CAIXA 5
```

O app é servido pelo proprio servidor. Isso nao e detalhe: uma pagina aberta em
`file://` tem origem `null` e o navegador bloqueia qualquer chamada a um
servidor de rede. Servir o app e a API da mesma origem resolve o problema sem
nenhum proxy nos caixas.

## Divisao de responsabilidade

**Servidor — sempre manda.** Estoque e numeracao tem de ser decidedos em um
lugar so, senao 5 caixas venden a ultima unidade 5 vezes.

**Cliente — responde na hora.** Preco, total, troco, o nome do produto e o cupom
sao calculados na maquina. Se a maquina travar, o caixa nao para.

## Conflito de estoque (o ponto mais delicado)

Duas maquinas podem vender a ultima unidade quase no mesmo instante. Regra
adotada:

1. A venda **nunca** e recusada por falta de estoque no servidor. A mercadoria
   ja saiu da prateleira e o cliente esta na frente do caixa.
2. A venda e gravada, e o estoque pode ficar negativo.
3. O servidor marca a venda como `divergencia` e a tela de estoque mostra um
   aviso para o gerente reconciliar.

Recusar a venda no servidor seria o erro classico: o dinheiro e a mercadoria
ja foram entregues, e o sistema devolveria o cliente para o balcao.

## Divida e numeracao

Venda a prazo e fidelidade tocam o cadastro do cliente. Duas maquinas editando
o mesmo cliente ao mesmo tempo e caso comum (o mesmo cliente compra no caixa 1
e no caixa 2). O servidor aplica a escrita da venda sobre o valor atual, em
transacao, em vez de sobrescrever o cadastro inteiro. O saldo e sempre
`valor_no_servidor + valor_da_venda`, nunca o que a maquina tinha em memoria.

## Migration

Os dados atuais ficam em `localStorage` com a chave `sudam_gestao_v3` (18
colecoes, versao 3). A migracao roda uma vez, pelo `Ajustes → Migrar para o
servidor`: le o `db` local, sobe para o SQLite, e so marca como feito depois
que o servidor confirma.

## Servidor fora do ar

Se o mini PC estiver desligado, os 5 caixas param de vender. Mitigacoes:

- Ligar o mini PC no BIOS para voltar sozinho apos falta de energia.
- Backup diario automatico em pasta separada.
- O `db` antigo do `localStorage` continua valido como rede de seguranca.

Nao ha como vender sem o servidor nesse desenho. Foi escolha consciente: um
PC por caixa com copia local daria resiliencia, mas multiplicaria o codigo de
sincronizacao por 5 e o custo de manutencao para uma loja que formata rede e
perde cliente do balcao. A internet cair — o cenario que o clienteTema — nao
afeta o sistema.

## Estado atual da implementacao

Verificado em 2026-09-29 por `servidor/teste/e2e.mjs` (52 asserções, todas
passando) e por um teste no navegador contra o servidor de verdade.

- [x] Bloqueador 1: venda travada e revertida quando o armazenamento enche
- [x] Servidor Node + SQLite (schema, migração de coluna, backup)
- [x] API REST com venda em transação
- [x] Cliente lendo do servidor (`js/api.js`: login, base, envio, fila)
- [x] Login no servidor (scrypt + sessão por token)
- [x] Divergência de estoque (coluna `produtos.divergencia` + aviso no PDV)
- [x] Banco fechado contra download por HTTP + sessão em todas as rotas
- [ ] Teste com 5 caixas simultaneas (o código suporta; falta a prova)
- [ ] Instalador do servidor (o instalador atual é do app local)

## Pendencias conhecidas

- **`seq` das vendas é atribuído pelo cliente.** Duas caixas que vendem no
  mesmo instante podem receber o mesmo `proximoSeq` do `/api/base` e a
  segunda gravação bate no índice único `ux_venda_seq`. Para 5 caixas de
  verdade, o `seq` precisa ser gerado pelo servidor dentro da transação.
- **Preço vem do servidor, mas o desconto ainda vem do cliente.** O total é
  recalculado (subtotal do cadastro menos o desconto declarado, nunca acima
  do subtotal), o que fecha a adulteração de preço; falta um teto de
  desconto por perfil.
- **Estoque local não é reconciliado.** O PDV mostra o que o servidor
  devolveu na última venda, mas não busca reconciliation periódica.
- **Histórico antigo não é paginado no cliente.** `/api/vendas` aceita
  `limite`/`offset` e o cliente pede 500 por vez; falta carregar o resto ao
  rolar a lista.
- **Rate limit no login.** Não existe. Em rede local o risco é baixo, mas
  um brute force de `admin`/`1234` é plausível se o mini PC ficar com a
  porta 8787 exposta por um roteador.
