import { useLocation, useNavigate } from "react-router-dom";
import { FolderGit2, Files, Route, Search } from "lucide-react";
import type { ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  icon: ReactNode;
  path: string | null; // null = disabled
}

const TABS: Tab[] = [
  { id: "repos", label: "REPOS", icon: <FolderGit2 size={18} />, path: "/" },
  {
    id: "files",
    label: "FILES",
    icon: <Files size={18} />,
    path: "/project",
  },
  { id: "tours", label: "TOURS", icon: <Route size={18} />, path: null },
  { id: "search", label: "SEARCH", icon: <Search size={18} />, path: null },
];

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = location.pathname.startsWith("/project")
    ? "files"
    : "repos";

  return (
    <nav style={styles.section}>
      <div style={styles.pill}>
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const isDisabled = tab.path === null;

          return (
            <button
              key={tab.id}
              onClick={() => {
                if (!isDisabled && tab.path) navigate(tab.path);
              }}
              disabled={isDisabled}
              style={{
                ...styles.tab,
                ...(isActive ? styles.tabActive : {}),
                ...(isDisabled ? styles.tabDisabled : {}),
              }}
            >
              <span
                style={{
                  color: isActive
                    ? "var(--text-inverted)"
                    : isDisabled
                      ? "var(--text-muted)"
                      : "var(--text-tertiary)",
                }}
              >
                {tab.icon}
              </span>
              <span
                style={{
                  ...styles.label,
                  color: isActive
                    ? "var(--text-inverted)"
                    : isDisabled
                      ? "var(--text-muted)"
                      : "var(--text-tertiary)",
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    background: "var(--bg-activitybar)",
    padding: "12px 21px 21px 21px",
    zIndex: 100,
  },
  pill: {
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    background: "var(--bg-card)",
    borderRadius: "var(--radius-pill)",
    height: 62,
    padding: "4px 4px",
  },
  tab: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    flex: 1,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "8px 0",
    borderRadius: 26,
    WebkitTapHighlightColor: "transparent",
  },
  tabActive: {
    background: "var(--accent)",
  },
  tabDisabled: {
    cursor: "default",
    opacity: 0.5,
  },
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.5px",
  },
};
