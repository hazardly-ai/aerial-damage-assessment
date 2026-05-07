import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ItemProps = {
	imageSrc?: string | null;
	imageAlt: string;
	title: string;
	subtitle?: string;
	meta?: string;
	imageOverlayLabel?: string;
	className?: string;
};

export default function Item({
	imageSrc,
	imageAlt,
	title,
	subtitle,
	meta,
	imageOverlayLabel,
	className,
}: ItemProps) {
	return (
		<div className={cn("flex items-center gap-3", className)}>
			<div className="group/image relative h-12 w-12 overflow-hidden rounded-md border border-border bg-muted">
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
				{imageSrc && imageOverlayLabel && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100">
						<span className="rounded-full border border-white/30 bg-black/40 p-1 text-white">
							<Maximize2 className="h-3 w-3" aria-hidden="true" />
						</span>
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
