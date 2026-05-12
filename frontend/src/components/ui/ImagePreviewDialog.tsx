import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ImagePreviewDialogProps = {
	imageSrc: string;
	imageAlt: string;
	title?: string;
	subtitle?: string;
	onClose: () => void;
};

export default function ImagePreviewDialog({
	imageSrc,
	imageAlt,
	title,
	subtitle,
	onClose,
}: ImagePreviewDialogProps) {
	const [isMounted, setIsMounted] = useState(false);

	useEffect(() => {
		setIsMounted(true);

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			setIsMounted(false);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [onClose]);

	if (!isMounted) {
		return null;
	}

	return createPortal(
		<div
			className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
		>
			<button
				type="button"
				className="absolute inset-0 bg-black/70"
				onClick={onClose}
				aria-label="Close image preview"
			/>
			<div className="relative flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
				<div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
					<div className="min-w-0">
						{title && (
							<p className="truncate text-sm font-semibold text-card-foreground">
								{title}
							</p>
						)}
						{subtitle && (
							<p className="truncate text-xs text-muted-foreground">
								{subtitle}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						aria-label="Close image preview"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="flex items-center justify-center overflow-auto bg-background p-4">
					<img
						src={imageSrc}
						alt={imageAlt}
						className="max-h-[calc(90dvh-5rem)] w-auto max-w-full object-contain"
					/>
				</div>
			</div>
		</div>,
		document.body,
	);
}
