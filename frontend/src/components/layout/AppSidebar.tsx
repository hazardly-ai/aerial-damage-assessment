import { ChevronDown } from "lucide-react";
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
		<div
			className="box-border shrink-0 sticky top-6"
			style={{ width: 220, minWidth: 220, maxWidth: 220 }}
		>
			<aside className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
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

					<button
						type="button"
						onClick={() => setBuildingsOpen((prev) => !prev)}
						aria-expanded={buildingsOpen}
						className={
							activeSection === "buildings"
								? "flex w-full items-center justify-between bg-primary/10 text-left px-3 py-2 text-sm font-medium"
								: "flex w-full items-center justify-between text-left px-3 py-2 text-sm font-medium"
						}
					>
						<span>Buildings</span>
						<ChevronDown
							size={14}
							className={`text-muted-foreground transition-transform ${
								buildingsOpen ? "rotate-180" : "rotate-0"
							}`}
						/>
					</button>
				</div>
			</aside>

			{buildingsOpen && (
				<div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
					{filters.map((filter) => (
						<button
							type="button"
							key={filter.key}
							onClick={() => onSelectFilter(filter.key)}
							className={
								activeSection === "buildings" &&
								activeDamageFilter === filter.key
									? "block w-full border-b border-border border-l-2 border-l-primary bg-accent text-accent-foreground text-left px-3 py-2 text-sm font-medium last:border-b-0"
									: "block w-full border-b border-border bg-background text-left px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground last:border-b-0"
							}
						>
							{filter.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
