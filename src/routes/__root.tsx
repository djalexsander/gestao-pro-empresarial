import { Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider, themeInitScript } from "@/components/theme/ThemeProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { OperadorProvider } from "@/components/auth/OperadorProvider";
import { TerminalProvider } from "@/components/auth/TerminalProvider";
import { ModeProvider } from "@/components/modes/ModeProvider";
import { MasterContextProvider } from "@/components/admin/MasterContextProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { UpdateBanner } from "@/components/shared/UpdateBanner";
import { OfflineBanner } from "@/components/shared/OfflineBanner";

import { CartProvider } from "@/components/saas/CartContext";
import { DesktopRoleProvider } from "@/components/desktop/DesktopRoleProvider";
import { LocalRealtimeProvider } from "@/components/realtime/LocalRealtimeProvider";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você está procurando não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Gestão Pro — Sistema de Gestão Empresarial" },
      { name: "description", content: "Sistema completo de gestão: estoque, vendas, compras, financeiro e relatórios." },
      { name: "author", content: "Gestão Pro" },
      { property: "og:title", content: "Gestão Pro — Sistema de Gestão Empresarial" },
      { property: "og:description", content: "Sistema completo de gestão: estoque, vendas, compras, financeiro e relatórios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#6d28d9" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Gestão Pro" },
      { name: "application-name", content: "Gestão Pro" },
      { name: "twitter:title", content: "Gestão Pro — Sistema de Gestão Empresarial" },
      { name: "twitter:description", content: "Sistema completo de gestão: estoque, vendas, compras, financeiro e relatórios." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/fa640c1d-96bd-4d08-8463-14aa4cbe1ff2/id-preview-f233302a--d496f5c9-6c16-45ff-b55b-2b12904c1c94.lovable.app-1776900095095.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/fa640c1d-96bd-4d08-8463-14aa4cbe1ff2/id-preview-f233302a--d496f5c9-6c16-45ff-b55b-2b12904c1c94.lovable.app-1776900095095.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <MasterContextProvider>
            <ModeProvider>
              <OperadorProvider>
                <TerminalProvider>
                  <DesktopRoleProvider>
                    <CartProvider>
                      <LocalRealtimeProvider>
                        <AppLayout />
                        <UpdateBanner />
                        <OfflineBanner />
                        <Toaster richColors position="top-right" />
                      </LocalRealtimeProvider>
                    </CartProvider>
                  </DesktopRoleProvider>
                </TerminalProvider>
              </OperadorProvider>
            </ModeProvider>
          </MasterContextProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
