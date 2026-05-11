import { useEffect } from "react";
import AppSidebar from "@/components/layout/AppSidebar";
import Container from "@/components/layout/Container";
import Footer from "@/components/layout/Footer.tsx";
import Header from "@/components/layout/Header";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import DashboardBuildingsSection from "./dashboard/DashboardBuildingsSection";
import DashboardImagePairsSection from "./dashboard/DashboardImagePairsSection";
import DashboardOverviewSection from "./dashboard/DashboardOverviewSection";
import { useDashboardData } from "./dashboard/useDashboardData";

export default function Dashboard() {
	const dashboard = useDashboardData();

	useEffect(() => {
		document.title = "Dashboard";
	}, []);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<Header />
			<Container className="w-full py-8">
				<div className="flex flex-row items-start gap-6">
					<AppSidebar
						activeSection={dashboard.activeSection}
						onOverview={dashboard.setOverviewSection}
						onBuildings={dashboard.setBuildingsSection}
						onImagePairs={dashboard.setImagePairsSection}
						disabled={dashboard.loadingStats}
					/>

					<div className="relative min-w-0 flex-1 space-y-6">
						{dashboard.loadingStats && (
							<div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm">
								<SpinnerEmpty
									title="Loading Dashboard"
									description="Syncing disaster data..."
									className="border-0"
								/>
							</div>
						)}

						{dashboard.error && (
							<div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
								{dashboard.error}
							</div>
						)}

						{dashboard.activeSection === "overview" && (
							<DashboardOverviewSection
								loadingStats={dashboard.loadingStats}
								loadingBuildings={dashboard.loadingBuildings}
								totalBuildings={dashboard.stats.total}
								predictionMetrics={dashboard.predictionMetrics}
								overviewDamageRows={dashboard.overviewDamageRows}
								onViewBuildings={dashboard.setDamageFilter}
							/>
						)}

						{dashboard.activeSection === "buildings" && (
							<DashboardBuildingsSection
								totalItems={dashboard.totalItems}
								activeDamageFilter={dashboard.activeDamageFilter}
								buildingSearchQuery={dashboard.buildingSearchQuery}
								disasterSearchQuery={dashboard.disasterSearchQuery}
								xbdSearchQuery={dashboard.xbdSearchQuery}
								predictedDamageFilter={dashboard.predictedDamageFilter}
								buildingCorrectnessFilter={dashboard.buildingCorrectnessFilter}
								onDamageFilterChange={dashboard.setBuildingsFilter}
								onBuildingSearchChange={dashboard.setBuildingSearchFilter}
								onDisasterSearchChange={dashboard.setDisasterSearchFilter}
								onXbdSearchChange={dashboard.setXbdSearchFilter}
								onPredictedDamageFilterChange={
									dashboard.setPredictedDamageTableFilter
								}
								onBuildingCorrectnessFilterChange={
									dashboard.setBuildingCorrectnessTableFilter
								}
								onClearFilters={dashboard.clearBuildingFilters}
								loadingBuildings={dashboard.loadingBuildings}
								page={dashboard.page}
								rows={dashboard.rows}
								selectedDisasterName={dashboard.selectedDisasterName}
								totalPages={dashboard.totalPages}
								buildingSortKey={dashboard.buildingSortKey}
								buildingSortDirection={dashboard.buildingSortDirection}
								onPageChange={dashboard.setPage}
								onSortChange={dashboard.setBuildingsSort}
							/>
						)}

						{dashboard.activeSection === "image-pairs" && (
							<DashboardImagePairsSection
								loadingImagePairs={dashboard.loadingImagePairs}
								imagePairTotalItems={dashboard.imagePairTotalItems}
								imagePairRows={dashboard.imagePairRows}
								imagePairPageRows={dashboard.imagePairPageRows}
								imagePairPage={dashboard.imagePairPage}
								imagePairTotalPages={dashboard.imagePairTotalPages}
								imagePairSortKey={dashboard.imagePairSortKey}
								imagePairSortDirection={dashboard.imagePairSortDirection}
								selectedDisasterName={dashboard.selectedDisasterName}
								onPageChange={dashboard.setImagePairsPage}
								onSortChange={dashboard.setImagePairsSort}
							/>
						)}
					</div>
				</div>
			</Container>
			<Footer />
		</div>
	);
}
