# Arquitetura — PDV Sudam em rede (5 caixas)

Decidido com o cliente em 2026-09-28. Substitui o modelo local-only.

## Decisões

| Tema | Escolha | Motivo |
|---|---|---|
| Servidor | Mini PC na loja, rodando Node + SQLite | Custo R$ 0; não depende de internet |
| Clientes | 5 caixas abrem `http://IP:8787` no Chrome | Nada a instalar nos caixas |
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
                  │  http://192.168.0.10:8787
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

- [x] Bloqueador 1: venda travada e revertida quando o armazenamento enche
- [ ] Servidor Node + SQLite (schema, migration, backup)
- [ ] API REST com venda em transacao
- [ ] Cliente lendo do servidor
- [ ] Login no servidor
- [ ] Divergencia de estoque
- [ ] Teste com 5 caixas simultaneas
- [ ] Instalador do servidor
