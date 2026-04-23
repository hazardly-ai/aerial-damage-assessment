type AppSidebarProps = {
	activeSection: "overview" | "buildings";
	onOverview: () => void;
	onBuildings: () => void;
	disabled?: boolean;
};

export default function AppSidebar({
	activeSection,
	onOverview,
	onBuildings,
	disabled = false,
}: AppSidebarProps) {
	const buttonBase =
		"block w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";

	return (
		<div
			className="box-border shrink-0 sticky top-6"
			style={{ width: 220, minWidth: 220, maxWidth: 220 }}
		>
			<aside className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
				<div className="w-full">
					<button
						type="button"
						disabled={disabled}
						onClick={onOverview}
						className={`${buttonBase} ${
							activeSection === "overview"
								? "border-b border-primary/30 bg-primary/10"
								: "border-b border-border bg-background/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						}`}
					>
						Overview
					</button>

					<button
						type="button"
						disabled={disabled}
						onClick={onBuildings}
						className={`${buttonBase} ${
							activeSection === "buildings"
								? "bg-primary/10 border-b border-primary/30"
								: "bg-background/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						}`}
					>
						Buildings
					</button>
				</div>
			</aside>
		</div>
	);
}
