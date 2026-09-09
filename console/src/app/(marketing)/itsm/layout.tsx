import type { ReactNode } from "react";
import { ItsmPublicHeader } from "@/itsm/components/itsm-public-header";
import { ItsmPublicFooter } from "@/itsm/components/itsm-public-footer";

export default function ItsmPublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAFBFD] text-[#0E1726]">
      <ItsmPublicHeader />
      <main className="flex-1">{children}</main>
      <ItsmPublicFooter />
    </div>
  );
}
