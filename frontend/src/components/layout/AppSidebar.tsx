import { useEffect, useState } from "react";

type FilterOption = {
	key: string;
	label: string;
};

type AppSidebarProps = {
	activeSection: "overview" | "buildings";
	activeDamageFilter: string;
	filters: FilterOption[];
	onOverview: () => void;
	onSelectFilter: (filter: string) => void;
};

export default function AppSidebar({
	activeSection,
	activeDamageFilter,
	filters,
	onOverview,
	onSelectFilter,
}: AppSidebarProps) {
	const [buildingsOpen, setBuildingsOpen] = useState(true);

	useEffect(() => {
		if (activeSection === "buildings") setBuildingsOpen(true);
	}, [activeSection]);

	return (
		<aside
			className="box-border shrink-0 sticky top-6 rounded-xl border border-border bg-card text-card-foreground overflow-hidden"
			style={{ width: 220, minWidth: 220, maxWidth: 220 }}
		>
			<div className="w-full">
				<button
					type="button"
					onClick={onOverview}
					className={
						activeSection === "overview"
							? "block w-full border-b border-primary/30 bg-primary/10 text-left px-3 py-2 text-sm"
							: "block w-full border-b border-border bg-background/50 text-left px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					}
				>
					Overview
				</button>

				<div className="w-full bg-background/40">
					<button
						type="button"
						onClick={() => setBuildingsOpen((prev) => !prev)}
						className={
							activeSection === "buildings"
								? "block w-full border-b border-primary/30 bg-primary/10 text-left px-3 py-2 text-sm font-medium"
								: "block w-full border-b border-border text-left px-3 py-2 text-sm font-medium"
						}
					>
						Buildings
					</button>

					{buildingsOpen && (
						<div className="w-full">
							{filters.map((filter) => (
								<button
									type="button"
									key={filter.key}
									onClick={() => onSelectFilter(filter.key)}
									className={
										activeSection === "buildings" && activeDamageFilter === filter.key
											? "block w-full border-b border-border border-l-2 border-l-primary bg-accent text-accent-foreground text-left px-3 py-2 text-sm font-medium"
											: "block w-full border-b border-border bg-background text-left px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
									}
								>
									{filter.label}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</aside>
	);
}