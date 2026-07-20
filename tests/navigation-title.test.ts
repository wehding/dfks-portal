import test from "node:test";
import assert from "node:assert/strict";
import { resolveNavigationTitle } from "../lib/navigation-title";

const items = [
  { href: "/portal/mine-vaerker", label: "Mine værker" },
  { href: "/portal/mine-kontrakter", label: "Mine kontrakter" },
  { href: "/portal/kontraktgennemgang", label: "Kontraktgennemgang" },
];

test("mobile topbar follows the current portal route", () => {
  assert.equal(resolveNavigationTitle("/portal/mine-vaerker", items, "Portal"), "Mine værker");
  assert.equal(resolveNavigationTitle("/portal/mine-kontrakter", items, "Portal"), "Mine kontrakter");
});

test("nested portal routes keep their section title", () => {
  assert.equal(resolveNavigationTitle("/portal/kontraktgennemgang/123", items, "Portal"), "Kontraktgennemgang");
  assert.equal(resolveNavigationTitle("/portal/ukendt", items, "Portal"), "Portal");
});
