"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, Menu, PanelLeftClose, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/layout/icon-map";
import { Avatar, Badge, buttonVariants } from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/interactive";
import type { NavSection } from "@/components/layout/nav-config";
import { signOutAction } from "@/modules/auth/actions";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  isOwner?: boolean;
}

export interface ShellNotification {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  severity: string;
  createdAt: string;
}

/** True when this href is the most specific match among all nav items. */
function isNavActive(pathname: string, href: string, allHrefs: string[]) {
  const matches = (candidate: string) => {
    if (candidate === "/admin") return pathname === "/admin" || pathname === "/admin/";
    return pathname === candidate || pathname.startsWith(`${candidate}/`);
  };
  if (!matches(href)) return false;
  const longerMatch = allHrefs.some((other) => other !== href && other.length > href.length && matches(other));
  return !longerMatch;
}

function NavItemLink({
  item,
  active,
  currentStage,
  unreadCount,
  onNavigate,
  indented,
}: {
  item: NavSection["items"][number];
  active: boolean;
  currentStage: number;
  unreadCount: number;
  onNavigate: () => void;
  indented?: boolean;
}) {
  const available = item.stage <= currentStage;
  if (!available) {
    return (
      <li>
        <span
          className={cn(
            "flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-400",
            indented && "pl-8",
          )}
          title={`Arrives in Stage ${item.stage}`}
        >
          <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
          <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
            S{item.stage}
          </span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
          indented && "ml-3 border-l border-slate-200 pl-5",
          active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
        )}
      >
        <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
        {item.badge === "notifications" && unreadCount > 0 ? (
          <span className="ml-auto rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function NavSectionBlock({
  section,
  pathname,
  allHrefs,
  currentStage,
  unreadCount,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  allHrefs: string[];
  currentStage: number;
  unreadCount: number;
  onNavigate: () => void;
}) {
  const childActive = section.items.some((item) => isNavActive(pathname, item.href, allHrefs));
  const [open, setOpen] = useState(childActive);
  const [wasChildActive, setWasChildActive] = useState(childActive);
  if (childActive !== wasChildActive) {
    setWasChildActive(childActive);
    if (childActive) setOpen(true);
  }

  if (section.collapsible) {
    return (
      <div>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors",
            childActive ? "text-brand-700" : "text-slate-700 hover:bg-slate-50",
          )}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <NavIcon name="Package" className="h-4 w-4 shrink-0" />
          <span className="truncate">{section.title}</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform", open ? "rotate-0" : "-rotate-90")} aria-hidden="true" />
        </button>
        {open ? (
          <ul className="mt-0.5 space-y-0.5">
            {section.items.map((item) => (
              <NavItemLink
                key={item.href}
                item={item}
                active={isNavActive(pathname, item.href, allHrefs)}
                currentStage={currentStage}
                unreadCount={unreadCount}
                onNavigate={onNavigate}
                indented
              />
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.title}</p>
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <NavItemLink
            key={item.href}
            item={item}
            active={isNavActive(pathname, item.href, allHrefs)}
            currentStage={currentStage}
            unreadCount={unreadCount}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

export function AdminShell({
  sections,
  user,
  businessName,
  unreadCount,
  currentStage = 1,
  notifications,
  children,
}: {
  sections: NavSection[];
  user: ShellUser;
  businessName: string;
  unreadCount: number;
  /** Highest implemented stage; navigation entries above it are shown disabled. */
  currentStage?: number;
  notifications: ShellNotification[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const allHrefs = sections.flatMap((section) => section.items.map((item) => item.href));

  useEffect(() => {
    document.documentElement.style.setProperty("--admin-sidebar-width", sidebarOpen ? "16rem" : "0px");
    return () => {
      document.documentElement.style.removeProperty("--admin-sidebar-width");
    };
  }, [sidebarOpen]);

  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setSidebarOpen(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ ["--admin-sidebar-width" as string]: sidebarOpen ? "16rem" : "0px" }}
    >
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white shadow-sm transition-transform duration-200 ease-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              ES
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-slate-900">{businessName}</span>
              <span className="text-[11px] text-slate-500">Management platform</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="h-[calc(100vh-4rem)] space-y-6 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <NavSectionBlock
              key={section.title}
              section={section}
              pathname={pathname}
              allHrefs={allHrefs}
              currentStage={currentStage}
              unreadCount={unreadCount}
              onNavigate={closeOnMobile}
            />
          ))}
        </nav>
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      ) : null}

      <div
        className="flex min-h-screen flex-col transition-[padding] duration-200 ease-out lg:pl-[var(--admin-sidebar-width,16rem)]"
      >
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <form action="/admin/search" className="hidden flex-1 items-center gap-2 sm:flex">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                name="q"
                placeholder="Search orders, products, customers…"
                aria-label="Search"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </div>
          </form>

          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
                  aria-label={`Notifications (${unreadCount} unread)`}
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 ? (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-80">
                <DropdownMenuLabel>Recent notifications</DropdownMenuLabel>
                {notifications.length === 0 ? (
                  <p className="px-2.5 py-3 text-sm text-slate-500">No notifications yet.</p>
                ) : (
                  notifications.map((notification) => (
                    <DropdownMenuItem key={notification.id} asChild>
                      <Link href={notification.url ?? "/admin/notifications"} className="flex-col items-start gap-0.5">
                        <span className="flex w-full items-center gap-2">
                          <span className="font-medium text-slate-900">{notification.title}</span>
                          {notification.severity !== "INFO" ? (
                            <Badge variant={notification.severity === "CRITICAL" ? "danger" : "warning"}>
                              {notification.severity.toLowerCase()}
                            </Badge>
                          ) : null}
                        </span>
                        {notification.body ? (
                          <span className="line-clamp-2 text-xs text-slate-500">{notification.body}</span>
                        ) : null}
                      </Link>
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/notifications">View all notifications</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100" aria-label="Account menu">
                  <Avatar name={user.name} size={32} />
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm font-medium text-slate-900">{user.name}</span>
                    <span className="block text-[11px] text-slate-500">{user.roles.join(", ") || "No role"}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/profile">Profile &amp; password</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/notifications">Notifications</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin/audit">Audit log</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-start text-red-600 hover:bg-red-50")}
                  >
                    Sign out
                  </button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>

        <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400 sm:px-6">
          E-Store platform · All times shown in Asia/Dhaka (UTC+6) · Financial values are stored as integer paisa
        </footer>
      </div>
    </div>
  );
}
