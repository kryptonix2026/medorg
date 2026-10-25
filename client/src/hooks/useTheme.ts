import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("medorg_theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("medorg_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => prev === "light" ? "dark" : "light");
  }, []);

  return { theme, toggleTheme };
}