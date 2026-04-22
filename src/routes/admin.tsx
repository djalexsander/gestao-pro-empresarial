import { createFileRoute } from "@tanstack/react-router";
import { MasterLayout } from "@/components/admin/MasterLayout";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Painel Master — Gestão Pro" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MasterLayout,
});
