import assert from "node:assert/strict";
import test from "node:test";
import { memberSalaryBenchmark } from "../lib/member-statistics";

const row = (holderId: string, weekly: number, contributes = true) => ({ holderId, weekly, contributes });

test("medlemsbenchmark kræver mindst ti kvalificerede kontrakter", () => {
  const nine = Array.from({ length: 9 }, (_, index) => row(`member-${index % 5}`, 8_000 + index * 100));
  assert.equal(memberSalaryBenchmark(nine, 5), null);
});

test("medlemsbenchmark kræver organisationens minimum af personer", () => {
  const ten = Array.from({ length: 10 }, (_, index) => row(`member-${index % 4}`, 8_000 + index * 100));
  assert.equal(memberSalaryBenchmark(ten, 5), null);
});

test("medlemmer med mange kontrakter vægter én gang før medianen", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => row("a", 20_000)),
    row("b", 8_000), row("c", 9_000), row("d", 10_000), row("e", 11_000),
  ];
  assert.equal(memberSalaryBenchmark(rows, 5), 10_000);
});

test("fravalgte og ugyldige rækker indgår ikke", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => row(`member-${index}`, 8_000 + index * 100)),
    row("excluded", 100_000, false), row("invalid", Number.NaN),
  ];
  assert.equal(memberSalaryBenchmark(rows, 5), 8_450);
});
