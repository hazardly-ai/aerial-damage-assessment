import type React from "react";

export default function Container({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={`mx-auto max-w-[1600px] px-8 ${className}`}>{children}</div>
	);
}
