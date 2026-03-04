// Allows this component to render as a different element while keeping button styles
import { Slot } from "@radix-ui/react-slot";

// Utility for creating class variants (clean way to handle styling variations)
import { cva, type VariantProps } from "class-variance-authority";

import * as React from "react";

// Helper to merge Tailwind class names safely
import { cn } from "@/lib/utils";

// Define all base styles + variants for the button in one place
const buttonVariants = cva(
	// Base button styling (layout, typography, focus states, disabled states)
	"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background",
	{
		variants: {
			// Visual style variants
			variant: {
				// Default primary button
				default: "bg-primary text-primary-foreground hover:bg-primary/90",

				// Outline-style button (less emphasis)
				outline:
					"border border-input bg-background hover:bg-accent hover:text-accent-foreground",
			},

			// Size variants
			size: {
				default: "h-10 px-4 py-2", // Standard size
				sm: "h-9 rounded-md px-3", // Smaller compact button
				lg: "h-11 rounded-md px-8", // Larger emphasis button
			},
		},

		// Defaults if no variant/size is provided
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

// Button props combine:
// - Native HTML button props
// - Our custom variant props (size + variant)
// - Optional asChild prop to render as another element
export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

// ForwardRef allows parent components to access the underlying DOM node
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		
		// If asChild is true, render whatever child element is passed in (e.g., Link)
		// Otherwise, render a normal <button>
		const Comp = asChild ? Slot : "button";

		return (
			<Comp
				// Combine variant styles with any custom className passed in
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		);
	},
);

// Helps with debugging in React DevTools
Button.displayName = "Button";

export { Button, buttonVariants };