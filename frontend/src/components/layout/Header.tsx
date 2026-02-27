import ThemeToggle from "@/components/ui/ThemeToggle";
import { TEAM_NAME } from "@/constants/app";

export default function Header() {
	return (
		<div className="z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
			<div className="mx-auto max-w-6xl px-6 py-8">
				<div className="flex justify-between items-start gap-6">
					<header>
						<div className="space-y-2">
							<h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent font-sans">
								{TEAM_NAME}
							</h1>
							<p className="text-sm uppercase tracking-[0.3em] text-muted-foreground font-semibold font-sans">
								AI-Powered Disaster Assessment
							</p>
							<div className="h-px bg-gradient-to-r from-border via-border/50 to-transparent" />
						</div>
					</header>

					<ThemeToggle />
				</div>
			</div>
		</div>
	);
}
