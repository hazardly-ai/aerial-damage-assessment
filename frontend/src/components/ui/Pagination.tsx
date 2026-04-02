import { Button } from "@/components/ui/Button";

type PaginationProps = {
	page: number;
	totalPages: number;
	onPageChange: (nextPage: number) => void;
};

export default function Pagination({
	page,
	totalPages,
	onPageChange,
}: PaginationProps) {
	const canPrev = page > 1;
	const canNext = page < totalPages;

	return (
		<div className="flex items-center justify-between gap-3 pt-4">
			<p className="text-xs text-muted-foreground">
				Page {page} of {totalPages}
			</p>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!canPrev}
					onClick={() => onPageChange(page - 1)}
				>
					Previous
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!canNext}
					onClick={() => onPageChange(page + 1)}
				>
					Next
				</Button>
			</div>
		</div>
	);
}
