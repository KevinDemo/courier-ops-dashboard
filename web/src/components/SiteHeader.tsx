import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/** The same switch as the homepage, on the same localStorage key. The inline script in index.html stops a flash on load. */
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(savedTheme);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const chrome = { light: "#f6f6f4", dark: "#0a0b0c" };
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      const scheme = meta.media.includes("dark") ? "dark" : "light";
      meta.content = theme === "system" ? chrome[scheme] : chrome[theme];
    });
  }, [theme]);

  const choose = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing: the choice still applies to this page view.
    }
  };

  return (
    <fieldset className="theme">
      <legend className="sr">Theme</legend>
      {THEMES.map((t) => (
        <label key={t.value}>
          <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => choose(t.value)} />
          <span>{t.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function SiteHeader() {
  return (
    <header className="topbar">
      <div className="wrap topbar-row">
        <a className="mark" href="https://oct28th.com/" target="_blank" rel="noopener">
          <span className="mark-box" aria-hidden="true">KC</span>Kevin Chen
        </a>
        <span className="product">Courier operations dashboard</span>
        <nav aria-label="Links">
          <a href="https://github.com/KevinDemo/courier-ops-dashboard" target="_blank" rel="noopener">Source on GitHub</a>
        </nav>
        <ThemeSwitch />
      </div>
    </header>
  );
}
