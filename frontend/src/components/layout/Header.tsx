import { Link, useLocation } from "react-router-dom";
import Container from "@/components/layout/Container";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { TEAM_NAME } from "@/constants/app";

export default function Header() {
	const location = useLocation();

	const navItems = [
		{ name: "Dashboard", path: "/dashboard" },
		{ name: "Map", path: "/map" },
	];

	return (
		<div className="z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
			<Container className="py-6">
				<div className="flex justify-between items-center gap-6">
					{/* LEFT SIDE */}
					<div className="space-y-2">
						<h1 className="pb-[0.1525em] text-3xl sm:text-4xl font-bold tracking-tight leading-[1.08] bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent font-sans">
							{TEAM_NAME}
						</h1>

						<p className="text-xs uppercase tracking-[0.3em] text-muted-foreground font-semibold font-sans">
							AI-Powered Disaster Assessment
						</p>

						<div className="header-divider" />
					</div>

					{/* CENTER NAV */}
					<nav className="flex items-center gap-6">
						{navItems.map((item) => {
							const isActive = location.pathname === item.path;

							return (
								<Link
									key={item.path}
									to={item.path}
									className={`text-sm font-medium transition-colors ${
										isActive
											? "text-foreground"
											: "text-muted-foreground hover:text-foreground"
									}`}
								>
									{item.name}
								</Link>
							);
						})}
					</nav>

					{/* RIGHT SIDE */}
					<ThemeToggle />
				</div>
			</Container>
		</div>
	);
}
