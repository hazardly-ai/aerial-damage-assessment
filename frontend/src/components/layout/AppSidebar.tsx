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
	disabled?: boolean; // New Prop
};

export default function AppSidebar({
	activeSection,
	activeDamageFilter,
	filters,
	onOverview,
	onSelectFilter,
	disabled = false, // Default to false
}: AppSidebarProps) {
	const [buildingsOpen, setBuildingsOpen] = useState(true);

	useEffect(() => {
		if (activeSection === "buildings") setBuildingsOpen(true);
	}, [activeSection]);

	// Common classes for all buttons to handle the disabled state visually
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
						onClick={() => setBuildingsOpen((prev) => !prev)}
						aria-expanded={buildingsOpen}
						className={`flex w-full items-center justify-between px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
							activeSection === "buildings"
								? "bg-primary/10"
								: "hover:bg-accent/50"
						}`}
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
				<div
					className={`mt-3 overflow-hidden rounded-xl border border-border bg-card ${disabled ? "opacity-50 pointer-events-none" : ""}`}
				>
					{filters.map((filter) => (
						<button
							type="button"
							key={filter.key}
							disabled={disabled}
							onClick={() => onSelectFilter(filter.key)}
							className={`${buttonBase} ${
								activeSection === "buildings" &&
								activeDamageFilter === filter.key
									? "border-b border-border border-l-2 border-l-primary bg-accent text-accent-foreground font-medium last:border-b-0"
									: "border-b border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground last:border-b-0"
							}`}
						>
							{filter.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
