// React hooks for state and lifecycle logic
import { useEffect, useState } from "react";

// Reusable styled Button component
import { Button } from "@/components/ui/Button.tsx";

export default function ThemeToggle() {
	// Track current theme (light by default)
	const [theme, setTheme] = useState<"light" | "dark">("light");

	// On initial mount:
	// - Check if a theme was previously saved in localStorage
	// - Apply it to the document root if it exists
	useEffect(() => {
		const saved = localStorage.getItem("theme") as "light" | "dark" | null;

		const root = document.documentElement;

		if (saved) {
			setTheme(saved);

			// Add/remove the "dark" class on <html>
			// Tailwind uses this class to apply dark mode styles
			if (saved === "dark") root.classList.add("dark");
			else root.classList.remove("dark");
		}
	}, []);

	// Toggle between light and dark themes
	const toggleTheme = () => {
		const root = document.documentElement;

		// Flip the theme value
		const newTheme = theme === "light" ? "dark" : "light";

		// Update React state
		setTheme(newTheme);

		// Persist choice so it stays after refresh
		localStorage.setItem("theme", newTheme);

		// Update the root class so Tailwind dark styles activate
		if (newTheme === "dark") root.classList.add("dark");
		else root.classList.remove("dark");
	};

	return (
		<Button
			variant="outline"
			onClick={toggleTheme}
			className="w-[115px] justify-center"
		>
			{theme === "light" ? "Dark Mode" : "Light Mode"}
		</Button>
	);
}
