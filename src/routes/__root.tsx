import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
      { title: "ERP BOM COMPARISON" },
      {
        name: "description",
        content:
          "Engineering Drawing vs ERP BOM Verification — automated row-by-row Checking-1 comparison.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "ERP BOM COMPARISON" },
      {
        property: "og:description",
        content: "Engineering Drawing vs ERP BOM Verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "ERP BOM COMPARISON" },
      { name: "description", content: "Compares engineering drawing PDFs against ERP BOM Excel files to identify discrepancies." },
      { property: "og:description", content: "Compares engineering drawing PDFs against ERP BOM Excel files to identify discrepancies." },
      { name: "twitter:description", content: "Compares engineering drawing PDFs against ERP BOM Excel files to identify discrepancies." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/de38d6ac-3e57-4dbc-a16e-2505f564ce3c/id-preview-a7c78613--d84a8713-89af-4246-b7f0-1e31b3715757.lovable.app-1777351737441.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/de38d6ac-3e57-4dbc-a16e-2505f564ce3c/id-preview-a7c78613--d84a8713-89af-4246-b7f0-1e31b3715757.lovable.app-1777351737441.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
  return <Outlet />;
}
