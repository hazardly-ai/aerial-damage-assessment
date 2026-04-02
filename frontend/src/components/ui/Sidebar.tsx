import * as React from "react";

import { cn } from "@/lib/utils";

export function Sidebar({
	className,
	children,
}: React.HTMLAttributes<HTMLElement>) {
	return (
		<aside
			className={cn(
				"rounded-xl border border-border bg-card text-card-foreground p-4",
				className,
			)}
		>
			{children}
		</aside>
	);
}

export function SidebarGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-2">
			<p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
				{title}
			</p>
			<div className="space-y-1">{children}</div>
		</div>
	);
}

export function SidebarItem({
	active,
	children,
	onClick,
}: {
	active?: boolean;
	children: React.ReactNode;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
				active
					? "border-primary bg-primary/10 text-foreground"
					: "border-border bg-background/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
			)}
		>
			{children}
		</button>
	);
}
