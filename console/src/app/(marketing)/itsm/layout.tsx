import type { ReactNode } from "react";
import { ItsmPublicHeader } from "@/itsm/components/itsm-public-header";
import { ItsmPublicFooter } from "@/itsm/components/itsm-public-footer";

export default function ItsmPublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-[#0E1726]">
      <ItsmPublicHeader />
      <main className="flex-1">{children}</main>
      <ItsmPublicFooter />
    </div>
  );
}
