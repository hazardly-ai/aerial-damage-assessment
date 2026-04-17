/* DisasterResponsesAssistant.tsx
 * Created by Shriya Vetapalem
 * This handles the chatbot UI for disaster related questions.
 * It sends user questions to the backend and displays responses.
 */

import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Each message in the conversation
interface ResponseMssg {
	id: string;
	role: "fieldUser" | "responseAssistant";
	content: string;
}

export default function DisasterResponseAssistant() {
	const API_BASE_URL = import.meta.env.VITE_HAZARDLY_API_BASE_URL?.replace(
		/\/$/,
		"",
	);
	const [responseLog, setResponseLog] = useState<ResponseMssg[]>([
		{
			id: crypto.randomUUID(),
			role: "responseAssistant",
			content:
				"Hi, I'm your Disaster Response Assistant. I can help you review damage severity, impacted areas, and assessment insights. What would you like to explore?",
		},
	]);

	const [currentQuery, setCurrentQuery] = useState("");
	const [isOpen, setIsOpen] = useState(false);
	const bottomRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	});

	const handleQuery = async () => {
		if (!currentQuery.trim()) return;

		const userEntry: ResponseMssg = {
			id: crypto.randomUUID(),
			role: "fieldUser",
			content: currentQuery,
		};
		setResponseLog((prev) => [...prev, userEntry]);

		const queryToSend = currentQuery;
		setCurrentQuery("");

		try {
			const backendResponse = await fetch(`${API_BASE_URL}/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: queryToSend }),
			});
			const data = await backendResponse.json();

			const assistantEntry: ResponseMssg = {
				id: crypto.randomUUID(),
				role: "responseAssistant",
				content:
					data.response ||
					"Your request has been received. Results will appear here.",
			};
			setResponseLog((prev) => [...prev, assistantEntry]);
		} catch {
			setResponseLog((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					role: "responseAssistant",
					content:
						"I'm having trouble reaching the backend service right now. Please check your connection and try again!",
				},
			]);
		}
	};

	return (
		<div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
			{/* Chat Panel */}
			{isOpen && (
				<div className="w-80 h-[450px] bg-card text-card-foreground border border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
					{/* Header */}
					<div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-primary to-indigo-500 text-white">
						<div className="flex items-center gap-2 font-semibold">
							<Sparkles className="h-4 w-4" />
							Disaster Response Assistant
						</div>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="hover:opacity-80 transition-opacity duration-theme ease-theme"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					{/* Conversation */}
					<div className="flex-1 p-4 overflow-y-auto text-sm space-y-3 bg-background">
						{responseLog.map((entry) => (
							<div
								key={entry.id}
								className={`p-3 rounded-lg w-fit max-w-[85%] border ${
									entry.role === "fieldUser"
										? "ml-auto bg-primary text-primary-foreground border-primary"
										: "bg-muted text-foreground border-border"
								}`}
							>
								{entry.content}
							</div>
						))}
						<div ref={bottomRef} />
					</div>

					{/* Input */}
					<div className="border-t border-border p-3 flex gap-2 bg-card">
						<input
							type="text"
							value={currentQuery}
							onChange={(e) => setCurrentQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleQuery()}
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
								transition-colors duration-theme ease-theme
							"
							placeholder="Ask Disaster Response Assistant..."
						/>
						<button
							type="button"
							onClick={handleQuery}
							className="
								bg-primary
								text-primary-foreground
								px-4 py-2
								rounded-md
								text-sm
								hover:opacity-90
								transition-colors duration-theme ease-theme
							"
						>
							Send
						</button>
					</div>
				</div>
			)}

			{/* Floating Button */}
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				className="
					relative flex items-center justify-center
					h-14 w-14 rounded-full
					bg-gradient-to-br from-primary to-indigo-500
					text-white
					shadow-xl
					transition-all duration-theme ease-theme
					hover:scale-105
				"
			>
				{isOpen ? (
					<X className="h-5 w-5" />
				) : (
					<>
						<Sparkles className="h-6 w-6" />
						<span className="absolute -bottom-1 -right-1 bg-background text-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-border">
							AI
						</span>
					</>
				)}
			</button>
		</div>
	);
}
