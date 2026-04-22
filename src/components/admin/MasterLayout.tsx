import { Outlet } from "@tanstack/react-router";
import { MasterSidebar, useMasterSidebarState } from "./MasterSidebar";
import { MasterTopbar } from "./MasterTopbar";
import { RequireSuperAdmin } from "./RequireSuperAdmin";
import { cn } from "@/lib/utils";

export function MasterLayout() {
  const sidebar = useMasterSidebarState();
  return (
    <RequireSuperAdmin>
      <div className="min-h-screen w-full bg-muted/30">
        <MasterSidebar
          collapsed={sidebar.collapsed}
          onToggle={sidebar.toggle}
          mobileOpen={sidebar.mobileOpen}
          onMobileClose={sidebar.closeMobile}
        />
        <div
          className={cn(
            "flex min-h-screen flex-col transition-[padding] duration-200",
            sidebar.collapsed ? "lg:pl-[72px]" : "lg:pl-64"
          )}
        >
          <MasterTopbar onMobileMenuClick={sidebar.openMobile} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </RequireSuperAdmin>
  );
}
