import { Sparkles, X } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"

const ASSISTANT_NAME = "Hazardly AI"
const WELCOME_MESSAGE =
	"Hello — I'm your AI assistant. Ask me about damage metrics, properties, streets, or data exports."
const INPUT_PLACEHOLDER = `Ask ${ASSISTANT_NAME}...`
const SEND_BUTTON_TEXT = "Send"
const AI_BADGE_TEXT = "AI"

export function ChatWidget() {
	const [open, setOpen] = React.useState(false)
	const [mounted, setMounted] = React.useState(false)

	React.useEffect(() => {
		setMounted(true)
	}, [])

	if (!mounted) return null

	return createPortal(
		<div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
			{open && (
				<div className="w-80 h-[450px] bg-card text-card-foreground border border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">

					{/* Header (Gradient Kept) */}
					<div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-primary to-indigo-500 text-white">
						<div className="flex items-center gap-2 font-semibold">
							<Sparkles className="h-4 w-4" />
							{ASSISTANT_NAME}
						</div>
						<button
							onClick={() => setOpen(false)}
							className="hover:opacity-80 transition"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					{/* Messages */}
					<div className="flex-1 p-4 overflow-y-auto text-sm space-y-3 bg-background">
						<div className="bg-muted text-foreground p-3 rounded-lg w-fit max-w-[85%] border border-border">
							{WELCOME_MESSAGE}
						</div>
					</div>

					{/* Input */}
					<div className="border-t border-border p-3 flex gap-2 bg-card">
						<input
							className="
								flex-1
								bg-background
								text-foreground
								border border-border
								rounded-md
								px-3 py-2
								text-sm
								placeholder:text-muted-foreground
								focus:outline-none
								focus:ring-2
								focus:ring-primary
								transition-colors
							"
							placeholder={INPUT_PLACEHOLDER}
						/>
						<Button size="sm">
							{SEND_BUTTON_TEXT}
						</Button>
					</div>
				</div>
			)}

			{/* Floating Button (Gradient Kept) */}
			<button
				onClick={() => setOpen((prev) => !prev)}
				className="
					relative flex items-center justify-center
					h-14 w-14 rounded-full
					bg-gradient-to-br from-primary to-indigo-500
					text-white
					shadow-xl
					transition-all duration-300
					hover:scale-105
				"
			>
				{open ? (
					<X className="h-5 w-5" />
				) : (
					<>
						<Sparkles className="h-6 w-6" />
						<span className="absolute -bottom-1 -right-1 bg-background text-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-border">
							{AI_BADGE_TEXT}
						</span>
					</>
				)}
			</button>
		</div>,
		document.body
	)
}