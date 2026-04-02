import { cn } from "@/lib/utils";

type ItemProps = {
	imageSrc?: string | null;
	imageAlt: string;
	title: string;
	subtitle?: string;
	meta?: string;
	className?: string;
};

export default function Item({
	imageSrc,
	imageAlt,
	title,
	subtitle,
	meta,
	className,
}: ItemProps) {
	return (
		<div className={cn("flex items-center gap-3", className)}>
			<div className="h-12 w-12 overflow-hidden rounded-md border border-border bg-muted">
				{imageSrc ? (
					<img
						src={imageSrc}
						alt={imageAlt}
						className="h-full w-full object-cover"
						loading="lazy"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
						No Image
					</div>
				)}
			</div>

			<div className="min-w-0">
				<p className="truncate text-sm font-medium text-card-foreground">
					{title}
				</p>
				{subtitle && (
					<p className="truncate text-xs text-muted-foreground">{subtitle}</p>
				)}
				{meta && (
					<p className="truncate text-xs text-muted-foreground">{meta}</p>
				)}
			</div>
		</div>
	);
}
