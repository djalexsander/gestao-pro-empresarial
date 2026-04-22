import { Outlet } from "@tanstack/react-router";
import { AppSidebar, useSidebarState } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const sidebar = useSidebarState();

  return (
    <div className="min-h-screen w-full bg-background">
      <AppSidebar
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
        <AppTopbar onMobileMenuClick={sidebar.openMobile} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
