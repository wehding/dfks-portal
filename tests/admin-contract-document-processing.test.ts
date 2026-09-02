import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as ts from "typescript";
import * as reviewModule from "../lib/contract-document-review";

const routePath = new URL("../app/api/admin/contracts/[id]/document-processing/route.ts", import.meta.url);
const clientPath = new URL("../app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", import.meta.url);
const coveragePath = new URL("../config/audit-coverage.json", import.meta.url);

type RouteExports = {
  GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
};

type RouteHarnessOptions = {
  auth?:
    | { ok: true; userId: string; orgId: string; role: string }
    | { ok: false; response: Response };
  contractOrgId?: string;
  auditFailure?: Error;
  sameOrigin?: boolean;
  rpcData?: unknown;
  rpcError?: { code?: string; message?: string } | null;
};

const CONTRACT_ID = "10000000-0000-4000-8000-000000000001";
const ORG_ID = "20000000-0000-4000-8000-000000000002";
const MEMBER_ID = "30000000-0000-4000-8000-000000000003";
const ACTOR_ID = "40000000-0000-4000-8000-000000000004";

function parseClient(source: string) {
  return ts.createSourceFile(
    clientPath.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function jsxAttributeText(
  element: ts.JsxOpeningLikeElement,
  name: string,
  sourceFile: ts.SourceFile,
) {
  const attribute = element.attributes.properties.find(candidate => (
    ts.isJsxAttribute(candidate) && candidate.name.getText(sourceFile) === name
  ));
  return attribute?.getText(sourceFile) ?? "";
}

function createQuery<Row extends Record<string, unknown>>(
  table: string,
  row: Row | null,
  calls: Array<{ table: string; filters: Record<string, unknown> }>,
) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle: async () => {
      calls.push({ table, filters: { ...filters } });
      const matches = row && Object.entries(filters).every(([column, value]) => row[column] === value);
      return { data: matches ? row : null, error: null };
    },
  };
  return query;
}

async function createRouteHarness(options: RouteHarnessOptions = {}) {
  const routeSource = await readFile(routePath, "utf8");
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: routePath.pathname,
  }).outputText;

  const auth = options.auth ?? {
    ok: true as const,
    userId: ACTOR_ID,
    orgId: ORG_ID,
    role: "admin",
  };
  const contract = {
    id: CONTRACT_ID,
    org_id: options.contractOrgId ?? ORG_ID,
    rights_holder_id: MEMBER_ID,
    status: "kladde",
    document_processing_status: "needs_review",
    document_processing_error_code: "ocr_spatial_quality",
  };
  const job = {
    id: "50000000-0000-4000-8000-000000000005",
    org_id: options.contractOrgId ?? ORG_ID,
    contract_id: CONTRACT_ID,
    status: "needs_review",
    error_code: "ocr_spatial_quality",
    page_count: 3,
    attempts: 1,
    review_disposition: null,
    review_details: {
      schemaVersion: 1,
      reasons: [{ code: "ocr_spatial_quality", pageNumbers: [2] }],
    },
  };
  const queryCalls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const authCalls: Array<{ module: string; operation: string }> = [];
  const serviceClientOptions: unknown[] = [];
  const db = {
    from: (table: string) => {
      if (table === "contracts") return createQuery(table, contract, queryCalls);
      if (table === "contract_document_jobs") return createQuery(table, job, queryCalls);
      throw new Error(`Uventet tabel i route-test: ${table}`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return {
        data: options.rpcData ?? [{
          outcome: "retry_queued",
          job_id: "60000000-0000-4000-8000-000000000006",
          review_disposition: "retry_after_pipeline_fix",
        }],
        error: options.rpcError ?? null,
      };
    },
  };

  const mocks: Record<string, unknown> = {
    "next/server": {
      NextResponse: {
        json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
      },
    },
    "@/lib/api-auth": {
      requireStaffModuleApi: async (module: string, operation: string) => {
        authCalls.push({ module, operation });
        return auth;
      },
    },
    "@/lib/audit-access-server": {
      auditRequestContext: () => ({
        actorUserId: ACTOR_ID,
        actorOrgId: ORG_ID,
        actorRole: "admin",
        source: "admin",
      }),
    },
    "@/lib/audit-log-server": {
      recordAuditEvent: async (input: Record<string, unknown>) => {
        auditCalls.push(input);
        if (options.auditFailure) throw options.auditFailure;
        return "70000000-0000-4000-8000-000000000007";
      },
    },
    "@/lib/contract-document-review": reviewModule,
    "@/lib/request-security": {
      isSameOriginMutation: () => options.sameOrigin ?? true,
    },
    "@/lib/supabase/service": {
      createServiceClient: (clientOptions?: unknown) => {
        serviceClientOptions.push(clientOptions);
        return db;
      },
    },
  };
  const moduleRecord: { exports: Partial<RouteExports> } = { exports: {} };
  const factory = new vm.Script(
    `(function(require, module, exports) { ${compiled}\n})`,
    { filename: routePath.pathname },
  ).runInThisContext() as (
    requireFunction: (specifier: string) => unknown,
    module: typeof moduleRecord,
    exports: typeof moduleRecord.exports,
  ) => void;
  factory(
    specifier => {
      if (!(specifier in mocks)) throw new Error(`Uventet import i route-test: ${specifier}`);
      return mocks[specifier];
    },
    moduleRecord,
    moduleRecord.exports,
  );
  const route = moduleRecord.exports as RouteExports;
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "function");
  return { route, queryCalls, rpcCalls, auditCalls, authCalls, serviceClientOptions };
}

test("admin-endpointet afgrænser PDF-kontrol efter modul og organisation", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /requireStaffModuleApi\("contracts", "read"\)/);
  assert.match(source, /requireStaffModuleApi\("contracts", "write"\)/);
  assert.match(source, /isSameOriginMutation\(request\)/);
  assert.ok((source.match(/\.eq\("org_id", orgId\)/g) ?? []).length >= 2);
  assert.match(source, /\.eq\("id", id\)/);
  assert.match(source, /targetMemberUuid: loaded\.contract\.rights_holder_id/);
  assert.match(source, /Cache-Control", "no-store"/);
});

test("admin-endpointet bruger den atomiske service-RPC uden klientleverede jobbeviser", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /rpc\("admin_contract_document_review_action", \{/);
  assert.match(source, /p_contract_id: id/);
  assert.match(source, /p_org_id: auth\.orgId/);
  assert.match(source, /p_action: body\.action/);
  assert.match(source, /p_actor_user_id: auth\.userId/);
  assert.doesNotMatch(source, /body\.(?:orgId|rightsHolderId|jobId|hash|spatial|errorCode)/);
  assert.doesNotMatch(source, /select\([^)]*(?:storage_path|sha256|safe_error_message)/);
});

test("API-svaret sanitiserer review_details til kode og sidetal", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /sanitizeContractDocumentReviewErrorCode\(/);
  assert.match(source, /sanitizeContractDocumentReviewDetails\(job\?\.review_details, pageCount\)/);
  assert.match(source, /\n\s+affectedPages,\n/);
  assert.doesNotMatch(source, /original_storage_path|output_storage_path|processed_sha256|original_sha256/);
});

test("mobilkortet har fuldbredde handlinger, loading og aria-live", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.match(source, /DocumentProcessingReviewCard/);
  assert.match(source, /Prøv igen/);
  assert.match(source, /Markér: ny scanning nødvendig/);
  assert.ok((source.match(/min-h-11 w-full/g) ?? []).length >= 2);
  assert.match(source, /grid-cols-1 gap-2 sm:grid-cols-2/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Henter den seneste PDF-status/);
});

test("arbejdsfladen afviser et sent PDF-statussvar efter navigation", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(!controller\.signal\.aborted\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
});

test("OCR-handling kan ikke startes dobbelt og låser sine handlinger", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.match(source, /if \(documentReviewAction\) return/);
  assert.match(source, /setDocumentReviewAction\(action\)/);
  assert.ok((source.match(/disabled=\{Boolean\(activeAction\)\}/g) ?? []).length >= 2);
  assert.match(source, /setDocumentReviewAction\(null\)/);
});

test("OCR-kortet ligger i mobilens scrollområde og ikke i den faste topbjælke", async () => {
  const source = await readFile(clientPath, "utf8");
  const sourceFile = parseClient(source);
  const usages: ts.JsxSelfClosingElement[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxSelfClosingElement(node)
      && node.tagName.getText(sourceFile) === "DocumentProcessingReviewCard"
    ) usages.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(usages.length, 1, "reviewkortet skal kun monteres ét sted i redigeringsdialogen");

  let ancestor: ts.Node | undefined = usages[0].parent;
  let insideScrollableContent = false;
  let insideFixedHeader = false;
  while (ancestor) {
    if (ts.isJsxElement(ancestor)) {
      const className = jsxAttributeText(ancestor.openingElement, "className", sourceFile);
      if (className.includes("overflow-y-auto")) insideScrollableContent = true;
      if (className.includes("shrink-0") && className.includes("border-b")) insideFixedHeader = true;
    }
    ancestor = ancestor.parent;
  }
  assert.equal(insideScrollableContent, true, "reviewkortet skal kunne scrolles på en lille mobilskærm");
  assert.equal(insideFixedHeader, false, "reviewkortet må ikke udvide dialogens faste topområde");
});

test("GET-route håndhæver org-scope, returnerer minimerede data og auditerer medlemmet", async () => {
  const harness = await createRouteHarness();
  const response = await harness.route.GET(
    new Request(`https://portal.example/api/admin/contracts/${CONTRACT_ID}/document-processing`),
    { params: Promise.resolve({ id: CONTRACT_ID }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    data: {
      status: "needs_review",
      errorCode: "ocr_spatial_quality",
      title: "Tekstlagets placering skal kontrolleres",
      reason: "Det søgbare tekstlag ligger ikke sikkert nok oven på ordene i dokumentet.",
      pageCount: 3,
      affectedPages: [2],
      affectedPagesText: "Side 2",
      attempts: 1,
      reviewDisposition: null,
      recommendedAction: "retry",
      canRetry: true,
      canRequestRescan: false,
    },
  });
  assert.deepEqual(harness.authCalls, [{ module: "contracts", operation: "read" }]);
  assert.ok(harness.queryCalls.every(call => call.filters.org_id === ORG_ID));
  assert.equal(harness.auditCalls.length, 1);
  assert.equal(harness.auditCalls[0].targetMemberUuid, MEMBER_ID);
  assert.deepEqual(harness.auditCalls[0].dataCategories, ["contract_data"]);
  assert.deepEqual(harness.auditCalls[0].orgIds, [ORG_ID]);
});

test("GET-route fejler lukket ved auditfejl og returnerer 404 på fremmed organisation", async () => {
  const auditFailure = await createRouteHarness({ auditFailure: new Error("audit unavailable") });
  await assert.rejects(
    () => auditFailure.route.GET(
      new Request(`https://portal.example/api/admin/contracts/${CONTRACT_ID}/document-processing`),
      { params: Promise.resolve({ id: CONTRACT_ID }) },
    ),
    /audit unavailable/,
  );

  const crossOrg = await createRouteHarness({
    contractOrgId: "90000000-0000-4000-8000-000000000009",
  });
  const response = await crossOrg.route.GET(
    new Request(`https://portal.example/api/admin/contracts/${CONTRACT_ID}/document-processing`),
    { params: Promise.resolve({ id: CONTRACT_ID }) },
  );
  assert.equal(response.status, 404);
  assert.equal(crossOrg.auditCalls.length, 0);
  assert.equal(crossOrg.rpcCalls.length, 0);
});

test("route-logikken stopper før serviceadgang, når sessionen mangler modulrettighed", async () => {
  const forbiddenResponse = Response.json({ error: "Ikke autoriseret" }, { status: 403 });
  const harness = await createRouteHarness({
    auth: { ok: false, response: forbiddenResponse },
  });
  const response = await harness.route.GET(
    new Request(`https://portal.example/api/admin/contracts/${CONTRACT_ID}/document-processing`),
    { params: Promise.resolve({ id: CONTRACT_ID }) },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(harness.authCalls, [{ module: "contracts", operation: "read" }]);
  assert.equal(harness.queryCalls.length, 0);
  assert.equal(harness.rpcCalls.length, 0);
  assert.equal(harness.auditCalls.length, 0);
});

test("POST-route bruger sessionens actor/org og afviser cross-site mutationer", async () => {
  const harness = await createRouteHarness();
  const response = await harness.route.POST(
    new Request(`https://portal.example/api/admin/contracts/${CONTRACT_ID}/document-processing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://portal.example" },
      body: JSON.stringify({ action: "retry" }),
    }),
    { params: Promise.resolve({ id: CONTRACT_ID }) },
  );
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(harness.rpcCalls.length, 1);
  assert.deepEqual(harness.rpcCalls[0], {
    name: "admin_contract_document_review_action",
    args: {
      p_contract_id: CONTRACT_ID,
      p_org_id: ORG_ID,
      p_action: "retry",
      p_actor_user_id: ACTOR_ID,
    },
  });
  assert.equal(harness.serviceClientOptions.length, 2);
  assert.deepEqual(harness.authCalls, [{ module: "contracts", operation: "write" }]);

  const crossSite = await createRouteHarness({ sameOrigin: false });
  const rejected = await crossSite.route.POST(
    new Request(`https://portal.example/api/admin/contracts/${CONTRACT_ID}/document-processing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ action: "retry" }),
    }),
    { params: Promise.resolve({ id: CONTRACT_ID }) },
  );
  assert.equal(rejected.status, 403);
  assert.equal(crossSite.queryCalls.length, 0);
  assert.equal(crossSite.rpcCalls.length, 0);
});

test("den følsomme adminhandling er registreret i audit coverage", async () => {
  const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as {
    entries: Array<Record<string, unknown>>;
  };
  const entry = coverage.entries.find(candidate => (
    candidate.path === "app/api/admin/contracts/[id]/document-processing/route.ts"
  ));
  assert.ok(entry);
  assert.equal(entry.failClosed, true);
  assert.equal(entry.action, "read / job / update");
  assert.equal(
    entry.component,
    "admin.contracts.document-processing / admin_contract_document_review",
  );
  assert.deepEqual(entry.categories, ["contract_data"]);
  assert.equal(entry.test, "tests/admin-contract-document-processing.test.ts");
});
