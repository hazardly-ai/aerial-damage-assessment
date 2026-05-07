import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ImagePreviewDialog from "@/components/ui/ImagePreviewDialog";
import Item from "@/components/ui/Item";
import Pagination from "@/components/ui/Pagination";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import { resolveImageUrl } from "@/utils/hazardlyApi";
import type {
	ImagePairRow,
	ImagePairSortKey,
	SortDirection,
} from "./dashboardTypes";

type DashboardImagePairsSectionProps = {
	loadingImagePairs: boolean;
	imagePairTotalItems: number;
	imagePairRows: ImagePairRow[];
	imagePairPageRows: ImagePairRow[];
	imagePairPage: number;
	imagePairTotalPages: number;
	imagePairSortKey: ImagePairSortKey | null;
	imagePairSortDirection: SortDirection | null;
	selectedDisasterName: string | null;
	onPageChange: (page: number) => void;
	onSortChange: (key: ImagePairSortKey) => void;
};

type PreviewImage = {
	src: string;
	alt: string;
	title: string;
	subtitle?: string;
};

const resolveStorageUrl = (path?: string | null): string | null =>
	path ? resolveImageUrl(path) : null;

export default function DashboardImagePairsSection({
	loadingImagePairs,
	imagePairTotalItems,
	imagePairRows,
	imagePairPageRows,
	imagePairPage,
	imagePairTotalPages,
	imagePairSortKey,
	imagePairSortDirection,
	selectedDisasterName,
	onPageChange,
	onSortChange,
}: DashboardImagePairsSectionProps) {
	const navigate = useNavigate();
	const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);

	const renderSortIcon = (key: ImagePairSortKey) => {
		if (imagePairSortKey !== key) {
			return <ArrowUpDown className="h-3.5 w-3.5" />;
		}

		return imagePairSortDirection === "asc" ? (
			<ArrowUp className="h-3.5 w-3.5" />
		) : (
			<ArrowDown className="h-3.5 w-3.5" />
		);
	};

	const renderSortableHeader = (label: string, key: ImagePairSortKey) => (
		<th className="py-2 pr-3 font-medium" scope="col">
			<button
				type="button"
				onClick={() => onSortChange(key)}
				className="inline-flex items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground"
			>
				<span>{label}</span>
				{renderSortIcon(key)}
			</button>
		</th>
	);

	return (
		<>
			<div className="dashboard-theme-surface relative overflow-hidden rounded-xl border border-border bg-card p-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h3 className="text-lg font-semibold">Image Pairs</h3>
					<div className="flex items-center gap-3">
						<p className="text-xs text-muted-foreground">
							{imagePairTotalItems} total rows
						</p>
					</div>
				</div>

				{loadingImagePairs ? (
					<div className="rounded-md border border-border bg-background p-4">
						<div className="absolute inset-0 z-10 flex items-center justify-center bg-card/40 backdrop-blur-[2px]">
							<SpinnerEmpty
								title="Loading image pairs"
								description="Calculating image-level metrics..."
								className="min-h-[280px] border-0 p-0"
							/>
						</div>
					</div>
				) : (
					<div className="relative z-0 overflow-x-auto">
						<table className="dashboard-theme-table w-full text-sm">
							<thead>
								<tr className="border-b border-border/60 bg-muted/30 text-left text-muted-foreground">
									{renderSortableHeader("Post Image", "xbd_id")}
									{renderSortableHeader("Total Buildings", "totalBuildings")}
									{renderSortableHeader("Correct", "correctCount")}
									{renderSortableHeader("Incorrect", "incorrectCount")}
									{renderSortableHeader("Accuracy", "accuracyPct")}
								</tr>
							</thead>
							<tbody>
								{imagePairPageRows.map((pair) => {
									const postThumbnail = resolveStorageUrl(pair.post_image_path);

									return (
										<tr
											key={pair.id}
											className="cursor-pointer align-top border-b border-border/70 hover:bg-muted/40"
											onClick={() => {
												if (!selectedDisasterName) return;
												navigate(`/map/${selectedDisasterName}/${pair.xbd_id}`);
											}}
										>
											<td className="py-3 pr-3">
												<button
													type="button"
													className="group block w-full text-left"
													onClick={(event) => {
														event.stopPropagation();
														if (!postThumbnail) return;
														setPreviewImage({
															src: postThumbnail,
															alt: `Post scene ${pair.xbd_id}`,
															title: `Scene #${pair.xbd_id}`,
															subtitle: `Pair ${pair.id}`,
														});
													}}
												>
													<Item
														imageSrc={postThumbnail}
														imageAlt={`Post scene ${pair.xbd_id}`}
														title={`Scene #${pair.xbd_id}`}
														subtitle={`Pair ${pair.id}`}
														meta={`Compared: ${pair.comparedCount}`}
														imageOverlayLabel="Preview"
													/>
												</button>
											</td>
											<td className="py-3 pr-3 font-medium">
												{pair.totalBuildings}
											</td>
											<td className="py-3 pr-3 font-medium text-emerald-600">
												{pair.correctCount}
											</td>
											<td className="py-3 pr-3 font-medium text-rose-600">
												{pair.incorrectCount}
											</td>
											<td className="py-3 pr-3 text-muted-foreground">
												{pair.accuracyPct == null
													? "N/A"
													: `${pair.accuracyPct}%`}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						{imagePairRows.length === 0 && (
							<div className="rounded-md border border-border bg-background px-4 py-6 text-sm text-muted-foreground">
								No image pair data available for this disaster yet.
							</div>
						)}
					</div>
				)}

				<div className="relative z-20 border-t border-border bg-card px-4 pb-4 pt-2">
					<Pagination
						page={imagePairPage}
						totalPages={imagePairTotalPages}
						onPageChange={onPageChange}
					/>
				</div>
			</div>

			{previewImage && (
				<ImagePreviewDialog
					imageSrc={previewImage.src}
					imageAlt={previewImage.alt}
					title={previewImage.title}
					subtitle={previewImage.subtitle}
					onClose={() => setPreviewImage(null)}
				/>
			)}
		</>
	);
}
