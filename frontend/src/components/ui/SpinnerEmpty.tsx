import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

type SpinnerEmptyProps = {
	title: string;
	description: string;
	className?: string;
};

export function SpinnerEmpty({ title, description, className }: SpinnerEmptyProps) {
	return (
		<Empty className={className}>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Spinner className="size-6" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
