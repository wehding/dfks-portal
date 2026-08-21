import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPortraitSource } from "../lib/person-portrait";

test("accepterer det aktuelle DFI DAM-domæne", () => {
  assert.equal(isAllowedPortraitSource("https://dfi-dam.qonqord.cloud/preview/example.jpg"), true);
});

test("afviser usikre eller efterlignede portrætkilder", () => {
  assert.equal(isAllowedPortraitSource("http://dfi-dam.qonqord.cloud/preview/example.jpg"), false);
  assert.equal(isAllowedPortraitSource("https://dfi-dam.qonqord.cloud.example.com/preview/example.jpg"), false);
  assert.equal(isAllowedPortraitSource("ikke-en-url"), false);
});
