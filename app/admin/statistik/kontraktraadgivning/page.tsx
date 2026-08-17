import { ContractAdviceStatistics } from "@/components/admin/contract-advice-statistics";
import { PageHeader } from "@/components/page-header";

export default function ContractAdviceStatisticsPage() {
  return <div className="space-y-6">
    <PageHeader title="Rådgivningsstatistik" subtitle="Anonymiserede mønstre fra kontraktgennemgangen" />
    <ContractAdviceStatistics />
  </div>;
}
