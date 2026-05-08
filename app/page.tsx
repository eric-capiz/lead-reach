import { getCurrentUser } from "@/server/auth/session";
import { MarketingDashboard } from "@/components/dashboard";
import { PublicHome } from "@/components/auth/PublicHome";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ registered?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) return <PublicHome />;
  const sp = searchParams ? await searchParams : {};
  const reg = sp.registered;
  const fromRegistration = reg === "1" || (Array.isArray(reg) && reg.includes("1"));
  const showSetupPopup = fromRegistration && !user.setupCompleted;
  return <MarketingDashboard showSetupPopup={showSetupPopup} />;
}
