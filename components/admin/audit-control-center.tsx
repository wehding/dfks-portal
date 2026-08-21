"use client";

import { Activity, DatabaseZap, FileLock2, Gavel, Settings2 } from "lucide-react";
import { AuditGovernancePanel } from "@/components/admin/audit-governance-panel";
import { AuditLogClient } from "@/components/admin/audit-log-client";
import { AuditSarPanel } from "@/components/admin/audit-sar-panel";
import { AuditSettingsPanel } from "@/components/admin/audit-settings-panel";
import { AuditSiemPanel } from "@/components/admin/audit-siem-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AuditControlCenter({ callerRole }: { callerRole: string }) {
  const isJurist = callerRole === "jurist";
  const isSuperadmin = callerRole === "superadmin";

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Logning og indsigt</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Uforanderligt revisionsspor, medlemsindsigt og overvågning af den eksterne SIEM-levering.
        </p>
      </div>

      {isJurist ? (
        <Tabs defaultValue="sar">
          <TabsList variant="line"><TabsTrigger value="sar"><FileLock2 />Indsigtsanmodninger</TabsTrigger><TabsTrigger value="governance"><Gavel />Governance</TabsTrigger></TabsList>
          <TabsContent value="sar" className="mt-4"><AuditSarPanel callerRole={callerRole} /></TabsContent>
          <TabsContent value="governance" className="mt-4"><AuditGovernancePanel callerRole={callerRole} /></TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="events">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="w-max min-w-full justify-start">
              <TabsTrigger value="events"><Activity />Hændelser</TabsTrigger>
              <TabsTrigger value="sar"><FileLock2 />Indsigtsanmodninger</TabsTrigger>
              {isSuperadmin && <TabsTrigger value="governance"><Gavel />Governance</TabsTrigger>}
              {isSuperadmin && <TabsTrigger value="siem"><DatabaseZap />SIEM-status</TabsTrigger>}
              {isSuperadmin && <TabsTrigger value="settings"><Settings2 />Indstillinger</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="events" className="mt-4"><AuditLogClient embedded /></TabsContent>
          <TabsContent value="sar" className="mt-4"><AuditSarPanel callerRole={callerRole} /></TabsContent>
          {isSuperadmin && <TabsContent value="governance" className="mt-4"><AuditGovernancePanel callerRole={callerRole} /></TabsContent>}
          {isSuperadmin && <TabsContent value="siem" className="mt-4"><AuditSiemPanel /></TabsContent>}
          {isSuperadmin && <TabsContent value="settings" className="mt-4"><AuditSettingsPanel /></TabsContent>}
        </Tabs>
      )}
    </main>
  );
}
