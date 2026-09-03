import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as ts from "typescript";

const modulePath = new URL("../lib/server/contract-import-access.ts", import.meta.url);
const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"] as const;

type Caller = { userId: string; orgId: string; role: string };
type Access = {
  orgId: string;
  modules: {
    contracts: { write: boolean };
    contract_ownership: { write: boolean };
  };
};

async function loadAccessHelper(input: { caller: Caller | null; access: Access | null }) {
  const source = await readFile(modulePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: modulePath.pathname,
  }).outputText;
  const rolesSeen: Array<readonly string[]> = [];
  const mocks: Record<string, unknown> = {
    "server-only": {},
    "@/lib/admin-roles": { ADMIN_ROLES },
    "@/lib/server/request-app-access-context": {
      getRequestAppAccessContext: async () => input.access,
    },
    "@/lib/supabase/assert-admin": {
      assertAdminRole: async (_session: unknown, roles: readonly string[]) => {
        rolesSeen.push(roles);
        return input.caller;
      },
    },
    "@/lib/supabase/server": { createClient: async () => ({}) },
  };
  const moduleRecord: { exports: { requireContractImportWriteAccess?: () => Promise<unknown> } } = { exports: {} };
  const factory = new vm.Script(
    `(function(require, module, exports) { ${compiled}\n})`,
    { filename: modulePath.pathname },
  ).runInThisContext() as (
    requireFunction: (specifier: string) => unknown,
    module: typeof moduleRecord,
    exports: typeof moduleRecord.exports,
  ) => void;
  factory(
    specifier => {
      if (!(specifier in mocks)) throw new Error(`Uventet import i access-test: ${specifier}`);
      return mocks[specifier];
    },
    moduleRecord,
    moduleRecord.exports,
  );
  assert.equal(typeof moduleRecord.exports.requireContractImportWriteAccess, "function");
  return {
    requireAccess: moduleRecord.exports.requireContractImportWriteAccess!,
    rolesSeen,
  };
}

test("jurist har kontraktupload, men får aldrig ejerskabsrettighed", async () => {
  const caller = { userId: "jurist-user", orgId: "org-a", role: "jurist" };
  const harness = await loadAccessHelper({
    caller,
    access: {
      orgId: "org-a",
      modules: {
        contracts: { write: true },
        contract_ownership: { write: false },
      },
    },
  });

  assert.deepEqual(await harness.requireAccess(), {
    caller,
    canManageOwnership: false,
  });
  assert.deepEqual(harness.rolesSeen, [ADMIN_ROLES]);
});

test("manager kan vælge ejer, mens manglende kontraktskriveret eller forkert organisation afvises", async () => {
  const caller = { userId: "admin-user", orgId: "org-a", role: "admin" };
  const manager = await loadAccessHelper({
    caller,
    access: {
      orgId: "org-a",
      modules: {
        contracts: { write: true },
        contract_ownership: { write: true },
      },
    },
  });
  assert.deepEqual(await manager.requireAccess(), { caller, canManageOwnership: true });

  const readOnly = await loadAccessHelper({
    caller,
    access: {
      orgId: "org-a",
      modules: {
        contracts: { write: false },
        contract_ownership: { write: true },
      },
    },
  });
  assert.equal(await readOnly.requireAccess(), null);

  const wrongOrg = await loadAccessHelper({
    caller,
    access: {
      orgId: "org-b",
      modules: {
        contracts: { write: true },
        contract_ownership: { write: true },
      },
    },
  });
  assert.equal(await wrongOrg.requireAccess(), null);
});
