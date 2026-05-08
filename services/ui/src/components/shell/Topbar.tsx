"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useNamespace } from "@/lib/namespace-context";
import { useHealth } from "@/lib/use-health";
import { ExecutionIndicator } from "@/components/system/ExecutionIndicator";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { Menu } from "lucide-react";
import { Icon } from "@/components/ui/Icon";

interface Props {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: Props) {
  const pathname = usePathname();
  const { clearApiKey } = useAuth();
  const { namespace, setNamespace, namespaces, isLoading } = useNamespace();
  const health = useHealth(30000);
  //test commit
  const isPresentation =
    pathname?.startsWith("/microsite") || pathname?.startsWith("/presentation");

  if (pathname === "/") return null;

  if (
    pathname?.startsWith("/chat") ||
    pathname?.startsWith("/proposal") ||
    pathname?.startsWith("/microsite") ||
    pathname?.startsWith("/presentation")
  ) {
    return (
      <div className="exec-indicator-float">
        <ExecutionIndicator />
      </div>
    );
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* Mobile-only hamburger — CSS hides it on desktop */}
        <button
          className="topbar-hamburger"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Icon icon={Menu} size="md" />
        </button>
        <span className="topbar-title">Console</span>
      </div>

      {!isPresentation && (
        <div className="topbar-center">
          <label className="topbar-ns-label" htmlFor="global-namespace">
            Project
          </label>
          <select
            id="global-namespace"
            className="select topbar-ns-select"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            disabled={isLoading}
          >
            {isLoading ? (
              <option>Loading...</option>
            ) : (
              <>
                <option value="">(none)</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
      )}

      <div className="topbar-right">
        <ExecutionIndicator />
        <ThemeToggle />
        <span
          className={`health-dot health-dot--${health.status}`}
          title={`API: ${health.status}${health.timestamp ? ` (${health.timestamp})` : ""}`}
        />
        <button className="btn btn-sm" onClick={clearApiKey}>
          Disconnect
        </button>
      </div>
    </header>
  );
}
