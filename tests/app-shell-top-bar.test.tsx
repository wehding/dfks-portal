import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShellTopBar } from "../components/navigation/app-shell-top-bar";

test("appens topbar er sticky og har en stabil mobilbredde", () => {
  const html = renderToStaticMarkup(<AppShellTopBar>Indhold</AppShellTopBar>);

  assert.match(html, /data-app-shell-topbar="true"/);
  assert.match(html, /sticky/);
  assert.match(html, /top-0/);
  assert.match(html, /w-full/);
  assert.match(html, /min-w-0/);
  assert.match(html, /shrink-0/);
});
