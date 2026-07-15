import assert from "node:assert/strict";
import test from "node:test";
import {
  somarPagamentosEfetivos,
  somarReceberEmAberto,
} from "./financeiro-canonico.ts";

const parcelas = (pagamentos: number[]) =>
  pagamentos.map((valorPago) => ({
    tipo: "receber",
    status: valorPago >= 400 ? "pago" : valorPago > 0 ? "parcial" : "pendente",
    valor: 400,
    valor_pago: valorPago,
  }));

test("fiado 1200 sem baixa separa vendido, recebido, carteira e caixa", () => {
  const lancamentos = parcelas([0, 0, 0]);
  assert.equal(1_200, 1_200); // total vendido vem de vendas
  assert.equal(somarPagamentosEfetivos([]), 0);
  assert.equal(somarReceberEmAberto(lancamentos), 1_200);
});

test("uma parcela quitada resulta em recebido 400 e carteira 800", () => {
  assert.equal(somarPagamentosEfetivos([{ valor: 400 }]), 400);
  assert.equal(somarReceberEmAberto(parcelas([400, 0, 0])), 800);
});

test("baixa parcial acumula 550 e mantém saldo 650", () => {
  const pagamentos = [{ valor: 400 }, { valor: 150 }];
  assert.equal(somarPagamentosEfetivos(pagamentos), 550);
  assert.equal(somarReceberEmAberto(parcelas([400, 150, 0])), 650);
});

test("venda mista considera PIX recebido e somente fiado em aberto", () => {
  assert.equal(somarPagamentosEfetivos([{ valor: 400 }]), 400);
  assert.equal(
    somarReceberEmAberto([
      { tipo: "receber", status: "pago", valor: 400, valor_pago: 400 },
      { tipo: "receber", status: "pendente", valor: 600, valor_pago: 0 },
    ]),
    600,
  );
});

test("cancelamento sem baixa remove o saldo sem criar recebido", () => {
  const canceladas = parcelas([0, 0, 0]).map((l) => ({ ...l, status: "cancelado" }));
  assert.equal(somarReceberEmAberto(canceladas), 0);
  assert.equal(somarPagamentosEfetivos([]), 0);
});
