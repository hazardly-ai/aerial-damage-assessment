// Theme toggle button (light/dark mode switch)
import ThemeToggle from "@/components/ui/ThemeToggle";

// Team name constant so we can easily change branding in one place
import { TEAM_NAME } from "@/constants/app";

export default function Header() {
	return (
		// Main header container
		// Slight background blur + border to separate it from the page content
		<div className="z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
			<div className="mx-auto max-w-6xl px-6 py-8">
				{/* Flex layout to keep title on the left and theme toggle on the right */}
				<div className="flex justify-between items-start gap-6">
					<header>
						{/* Title + subtitle section */}
						<div className="space-y-2">
							{/* Main app title with subtle gradient text effect */}
							<h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent font-sans">
								{TEAM_NAME}
							</h1>

							{/* Small uppercase subtitle describing the app */}
							<p className="text-sm uppercase tracking-[0.3em] text-muted-foreground font-semibold font-sans">
								AI-Powered Disaster Assessment
							</p>

							{/* Decorative gradient divider line under the subtitle */}
							<div className="h-px bg-gradient-to-r from-border via-border/50 to-transparent" />
						</div>
					</header>

					{/* Light/Dark mode toggle */}
					<ThemeToggle />
				</div>
			</div>
		</div>
	);
}
