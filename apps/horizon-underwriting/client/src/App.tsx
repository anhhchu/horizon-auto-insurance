import { useEffect, useState } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';
import { ThemeProvider } from 'next-themes';
import {
  Badge, Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger, TooltipProvider, useSidebar,
} from '@databricks/appkit-ui/react';
import { History, ListChecks, ShieldCheck, UserRound } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { DecisionsPage } from '@/pages/decisions/DecisionsPage';
import { PolicyReviewPage } from '@/pages/policy/PolicyReviewPage';
import { ReviewQueuePage } from '@/pages/queue/ReviewQueuePage';

const NAV = [
  { to: '/', label: 'Review queue', icon: ListChecks, match: (path: string) => path === '/' || path.startsWith('/policies') },
  { to: '/decisions', label: 'Decisions', icon: History, match: (path: string) => path.startsWith('/decisions') },
];

function useReviewer() {
  const [email, setEmail] = useState('');
  useEffect(() => {
    fetch('/api/whoami').then((response) => (response.ok ? response.json() : null)).then((body: { email?: string } | null) => setEmail(body?.email ?? '')).catch(() => setEmail(''));
  }, []);
  return email;
}

function AppSidebar() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <ShieldCheck className="size-6 shrink-0" aria-hidden="true" />
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <div className="font-bold">Horizon</div>
            <div className="text-sm text-sidebar-foreground/70">Underwriting</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ to, label, icon: Icon, match }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={match(pathname)}
                    tooltip={label}
                    className="h-10 text-base data-[active=true]:font-medium data-[active=true]:[&>svg]:text-sidebar-primary"
                  >
                    <NavLink to={to} end={to === '/'} onClick={() => setOpenMobile(false)}>
                      <Icon />
                      <span>{label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3 px-3 py-4 group-data-[collapsible=icon]:hidden">
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}

function Layout() {
  const reviewer = useReviewer();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background px-4 md:px-6">
          <SidebarTrigger className="size-10" aria-label="Toggle navigation" />
          <span className="hidden text-sm text-muted-foreground sm:inline">Unity Catalog governed · region-scoped · runs as you</span>
          {reviewer && (
            <Badge variant="outline" className="ml-auto max-w-[min(18rem,55vw)] gap-2 bg-card px-2.5 py-1 font-normal" title={`Signed in as ${reviewer}`}>
              <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{reviewer}</span>
            </Badge>
          )}
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

const router = createBrowserRouter([{
  element: <Layout />,
  children: [
    { path: '/', element: <ReviewQueuePage /> },
    { path: '/policies/:policyId', element: <PolicyReviewPage /> },
    { path: '/decisions', element: <DecisionsPage /> },
  ],
}]);

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
