import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";

export default function ThemeToggle() {
	const [theme, setTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		const saved = localStorage.getItem("theme") as "light" | "dark" | null;

		const root = document.documentElement;

		if (saved) {
			setTheme(saved);
			if (saved === "dark") root.classList.add("dark");
			else root.classList.remove("dark");
		}
	}, []);

	const toggleTheme = () => {
		const root = document.documentElement;
		const newTheme = theme === "light" ? "dark" : "light";

		setTheme(newTheme);
		localStorage.setItem("theme", newTheme);

		if (newTheme === "dark") root.classList.add("dark");
		else root.classList.remove("dark");
	};

	return (
		<Button variant="outline" onClick={toggleTheme}>
			{theme === "light" ? "Dark Mode" : "Light Mode"}
		</Button>
	);
}
