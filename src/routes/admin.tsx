import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequireSuperAdmin } from "@/components/admin/RequireSuperAdmin";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Painel Master — Gestão Pro" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <RequireSuperAdmin>
      <Outlet />
    </RequireSuperAdmin>
  );
}
