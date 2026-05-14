import { Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ItemProps = {
	imageSrc?: string | null;
	imageAlt: string;
	title: string;
	subtitle?: string;
	meta?: string;
	titleAccessory?: ReactNode;
	imageOverlayLabel?: string;
	onImageClick?: () => void;
	imageButtonLabel?: string;
	className?: string;
};

export default function Item({
	imageSrc,
	imageAlt,
	title,
	subtitle,
	meta,
	titleAccessory,
	imageOverlayLabel,
	onImageClick,
	imageButtonLabel,
	className,
}: ItemProps) {
	const imageContent = (
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
	);

	return (
		<div className={cn("flex items-center gap-3", className)}>
			{onImageClick ? (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onImageClick();
					}}
					className="shrink-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
					aria-label={imageButtonLabel ?? imageOverlayLabel ?? imageAlt}
				>
					{imageContent}
				</button>
			) : (
				imageContent
			)}

			<div className="min-w-0">
				<div className="flex items-start gap-2">
					<p className="min-w-0 flex-1 truncate text-sm font-medium text-card-foreground">
						{title}
					</p>
					{titleAccessory ? (
						<div className="shrink-0">{titleAccessory}</div>
					) : null}
				</div>
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
