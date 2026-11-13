import assert from "node:assert/strict";
import test from "node:test";
import { canLockPaymentMethod, findDuplicatePaid, relatedOrderIds } from "./paymentRules.js";

test("não converte Pix em cartão na mesma tentativa", () => {
  const result = canLockPaymentMethod("pix", "card");
  assert.equal(result.ok, false);
  assert.match(result.error, /novo pedido/i);
});

test("não converte cartão em Pix na mesma tentativa", () => {
  const result = canLockPaymentMethod("card", "pix");
  assert.equal(result.ok, false);
  assert.match(result.error, /novo pedido/i);
});

test("permite travar o método na primeira tentativa", () => {
  assert.deepEqual(canLockPaymentMethod("", "pix"), { ok: true, method: "pix" });
  assert.deepEqual(canLockPaymentMethod("", "card"), { ok: true, method: "card" });
});

test("permite repetir o mesmo método", () => {
  assert.deepEqual(canLockPaymentMethod("pix", "pix"), { ok: true, method: "pix" });
});

test("relaciona pedidos pelo parent_order_id", () => {
  const parent = { id: "a", parent_order_id: null, status: "pending" };
  const child = { id: "b", parent_order_id: "a", status: "paid" };
  const sibling = { id: "c", parent_order_id: "a", status: "pending" };
  const ids = relatedOrderIds(child, [parent, child, sibling]);
  assert.deepEqual(ids.sort(), ["a", "b", "c"]);
});

test("detecta pagamento duplicado entre pedidos relacionados", () => {
  const parent = { id: "a", parent_order_id: null, status: "paid" };
  const child = { id: "b", parent_order_id: "a", status: "paid" };
  assert.equal(findDuplicatePaid(child, [parent, child])?.id, "a");
  assert.equal(findDuplicatePaid({ ...child, status: "pending" }, [parent, child]), null);
});
