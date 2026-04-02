import * as React from "react";

import { cn } from "@/lib/utils";

export function Breadcrumb({
	className,
	...props
}: React.ComponentPropsWithoutRef<"nav">) {
	return <nav aria-label="breadcrumb" className={cn(className)} {...props} />;
}

export function BreadcrumbList({
	className,
	...props
}: React.ComponentPropsWithoutRef<"ol">) {
	return (
		<ol
			className={cn(
				"flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export function BreadcrumbItem({
	className,
	...props
}: React.ComponentPropsWithoutRef<"li">) {
	return <li className={cn("inline-flex items-center gap-1.5", className)} {...props} />;
}

export function BreadcrumbLink({
	className,
	...props
}: React.ComponentPropsWithoutRef<"button">) {
	return (
		<button
			type="button"
			className={cn("transition-colors hover:text-foreground", className)}
			{...props}
		/>
	);
}

export function BreadcrumbPage({
	className,
	...props
}: React.ComponentPropsWithoutRef<"span">) {
	return <span aria-current="page" className={cn("font-medium text-foreground", className)} {...props} />;
}

export function BreadcrumbSeparator({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<"li">) {
	return (
		<li
			role="presentation"
			aria-hidden="true"
			className={cn("text-muted-foreground/70", className)}
			{...props}
		>
			{children ?? "/"}
		</li>
	);
}
