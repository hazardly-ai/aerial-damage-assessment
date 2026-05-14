import { useLocation, useNavigate } from "react-router-dom";
import Container from "@/components/layout/Container";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TEAM_NAME } from "@/constants/app";

export default function Header() {
	const location = useLocation();
	const navigate = useNavigate();

	const activeNav = location.pathname.startsWith("/map")
		? "map"
		: location.pathname.startsWith("/vlm")
			? "vlm"
			: location.pathname === "/"
				? "dashboard"
				: "";

	return (
		<div className="z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
			<Container className="py-6">
				<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
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
					<nav className="flex items-center justify-self-center">
						<ToggleGroup
							type="single"
							value={activeNav}
							variant="default"
							size="sm"
							className="relative gap-0 overflow-hidden rounded-full border border-input/70 bg-muted/30"
							onValueChange={(value) => {
								if (value === "dashboard") navigate("/");
								if (value === "map") navigate("/map");
								if (value === "vlm") navigate("/vlm");
							}}
							aria-label="Primary navigation"
						>
							<ToggleGroupItem
								value="dashboard"
								className="relative min-w-[120px] rounded-l-full rounded-r-none font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
								aria-label="Go to dashboard"
							>
								Dashboard
							</ToggleGroupItem>

							<ToggleGroupItem
								value="map"
								className="relative min-w-[120px] rounded-none font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
								aria-label="Go to map"
							>
								Map
							</ToggleGroupItem>

							<ToggleGroupItem
								value="vlm"
								className="relative min-w-[120px] rounded-r-full rounded-l-none font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
								aria-label="Go to VLM evaluation"
							>
								VLM Eval
							</ToggleGroupItem>
						</ToggleGroup>
					</nav>

					{/* RIGHT SIDE */}
					<div className="justify-self-end">
						<ThemeToggle />
					</div>
				</div>
			</Container>
		</div>
	);
}
