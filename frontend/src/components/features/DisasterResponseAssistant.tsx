/* DisasterResponsesAssistant.tsx */
import { Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ResponseMessage {
	id: string;
	role: "fieldUser" | "responseAssistant";
	content: string;
}

export default function DisasterResponseAssistant() {
	const API_BASE_URL = import.meta.env.VITE_HAZARDLY_API_BASE_URL?.replace(
		/\/*$/,
		"",
	);

	const initialMessage: ResponseMessage = {
		id: crypto.randomUUID(),
		role: "responseAssistant",
		content:
			"Hi, I'm your Disaster Response Assistant. I can help you review damage severity, impacted areas, and assessment insights. What would you like to explore?",
	};

	const [responseLog, setResponseLog] = useState<ResponseMessage[]>(() => {
		const saved = sessionStorage.getItem("chatHistory");
		return saved ? JSON.parse(saved) : [initialMessage];
	});

	// Persist only for the current browser tab/session.
	const [isOpen, setIsOpen] = useState(() => {
		return sessionStorage.getItem("chatOpen") === "true";
	});

	const [currentQuery, setCurrentQuery] = useState("");
	const bottomRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	useEffect(() => {
		sessionStorage.setItem("chatHistory", JSON.stringify(responseLog));
		sessionStorage.setItem("chatOpen", isOpen.toString());
	}, [responseLog, isOpen]);

	const clearChat = () => {
		setResponseLog([initialMessage]);
		sessionStorage.removeItem("chatHistory");
	};

	const handleQuery = async () => {
		if (!currentQuery.trim()) return;
		const userEntry: ResponseMessage = {
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
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: queryToSend }),
			});
			const data = await backendResponse.json();
			const assistantEntry: ResponseMessage = {
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
						"I'm having trouble reaching the backend service right now. Please try again.",
				},
			]);
		}
	};

	return (
		<div className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
			<div
				className={`chat-panel-container pointer-events-auto w-[min(360px,calc(100vw-3rem))] h-[min(calc(100dvh-12rem),700px)] bg-card text-card-foreground border border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden ${
					isOpen ? "chat-panel-open" : "chat-panel-closed"
				}`}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-primary to-indigo-500 text-white">
					<div className="flex flex-col">
						<span className="flex items-center gap-2 font-semibold">
							<Sparkles className="h-4 w-4" />
							Disaster Response Assistant
						</span>
						<span className="text-[11px] opacity-80">
							Chat history persists in session
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={clearChat}
							className="p-1 rounded-md hover:bg-white/20 transition"
						>
							<Trash2 className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="hover:opacity-80 transition-opacity"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				{/* Messages */}
				<div className="flex-1 p-4 overflow-y-auto text-sm space-y-4 bg-background">
					{responseLog.map((entry) => (
						<div
							key={entry.id}
							className={`p-3 rounded-xl max-w-[85%] border transition-all duration-300 ${
								entry.role === "fieldUser"
									? "ml-auto bg-primary text-primary-foreground border-primary"
									: "bg-card text-foreground border-border shadow-sm"
							}`}
						>
							{entry.content}
						</div>
					))}
					<div ref={bottomRef} />
				</div>

				{/* Input */}
				<div className="border-t border-border p-3 bg-card">
					<div className="flex gap-2">
						<input
							type="text"
							value={currentQuery}
							onChange={(e) => setCurrentQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleQuery()}
							className="flex-1 bg-background text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
							placeholder="Ask Disaster Response Assistant..."
						/>
						<button
							type="button"
							onClick={handleQuery}
							className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90"
						>
							Send
						</button>
					</div>
				</div>
			</div>

			{/* Floating Button with Restored AI Badge */}
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				className="pointer-events-auto relative flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-primary to-indigo-500 text-white shadow-xl hover:scale-105 active:scale-95 transition-all"
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
