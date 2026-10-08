import { redirect } from "next/navigation";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

export async function AdminLayout({ children }: { children: React.ReactNode }) {
  const adminId = await verifySuperAdmin();

  if (!adminId) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

