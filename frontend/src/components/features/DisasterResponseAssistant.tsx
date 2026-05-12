/* DisasterResponsesAssistant.tsx */
import { Eraser, MessageCircle, SendHorizontal, Trash2, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ChatMessage, ChatResponse } from "@/types/chat";

interface DisasterResponseAssistantProps {
	onChatResponse?: (response: ChatResponse) => void;
	onClearMapHighlights?: () => void;
	onRunSuggestedAction?: (response: ChatResponse) => void;
}

const stripInlineMarkdown = (content: string): string =>
	content
		.replace(/\*\*(.*?)\*\*/g, "$1")
		.replace(/__(.*?)__/g, "$1")
		.replace(/\*(.*?)\*/g, "$1")
		.replace(/_(.*?)_/g, "$1")
		.replace(/`(.*?)`/g, "$1");

const normalizeMessageContent = (content: string): string => content.trim();

function AnimatedAssistantText({
	content,
	animate,
	onProgress,
	onComplete,
}: {
	content: string;
	animate: boolean;
	onProgress?: () => void;
	onComplete?: () => void;
}) {
	const [visibleLength, setVisibleLength] = useState(
		animate ? 0 : content.length,
	);
	const onProgressRef = useRef(onProgress);
	const onCompleteRef = useRef(onComplete);

	useEffect(() => {
		onProgressRef.current = onProgress;
		onCompleteRef.current = onComplete;
	}, [onProgress, onComplete]);

	useEffect(() => {
		if (!animate) {
			setVisibleLength(content.length);
			return;
		}

		setVisibleLength(0);
		if (!content) return;

		let index = 0;
		const timer = window.setInterval(() => {
			index += 3;
			if (index >= content.length) {
				window.clearInterval(timer);
				setVisibleLength(content.length);
				onProgressRef.current?.();
				onCompleteRef.current?.();
				return;
			}
			setVisibleLength(index);
			onProgressRef.current?.();
		}, 12);

		return () => window.clearInterval(timer);
	}, [animate, content]);

	return <>{content.slice(0, visibleLength)}</>;
}

function SelectableMessageText({
	children,
	enableTripleClickSelectAll,
}: {
	children: ReactNode;
	enableTripleClickSelectAll: boolean;
}) {
	const containerRef = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		const node = containerRef.current;
		if (!node || !enableTripleClickSelectAll) {
			return;
		}

		const handleMouseDown = (event: MouseEvent) => {
			if (event.detail !== 3) {
				return;
			}

			const selection = window.getSelection();
			if (!selection) {
				return;
			}

			const range = document.createRange();
			range.selectNodeContents(node);
			selection.removeAllRanges();
			selection.addRange(range);
			event.preventDefault();
		};

		node.addEventListener("mousedown", handleMouseDown);
		return () => {
			node.removeEventListener("mousedown", handleMouseDown);
		};
	}, [enableTripleClickSelectAll]);

	return <span ref={containerRef}>{children}</span>;
}

const requiresExplicitExampleAction = (response: ChatResponse): boolean =>
	response.action?.reason === "address_query" &&
	response.action?.target === "map" &&
	!response.focus;

const shouldAutoRunExplicitExample = (
	query: string,
	response: ChatResponse,
): boolean => {
	if (!requiresExplicitExampleAction(response)) {
		return false;
	}

	const normalizedQuery = query.trim().toLowerCase();
	return (
		normalizedQuery.startsWith("show ") ||
		normalizedQuery.startsWith("show me ") ||
		normalizedQuery.startsWith("take me ") ||
		normalizedQuery.startsWith("open ") ||
		normalizedQuery.startsWith("go to ")
	);
};

const buildExplicitExampleSummary = (
	response: ChatResponse,
): string | undefined => {
	const targetXbdId = response.action?.params?.xbd_id;
	const addressText =
		typeof response.action?.params?.address === "string"
			? response.action.params.address
			: undefined;

	if (addressText && typeof targetXbdId === "number") {
		return `Matched buildings for ${addressText}. Representative scene available on XBD ${targetXbdId}.`;
	}
	if (addressText) {
		return `Matched buildings for ${addressText}. Representative scene available.`;
	}
	if (typeof targetXbdId === "number") {
		return `Representative scene available on XBD ${targetXbdId}.`;
	}
	return "Representative scene available.";
};

const buildMapCommandSummary = (response: ChatResponse): string | undefined => {
	const targetXbdId = response.action?.params?.xbd_id;
	const actionAddress =
		typeof response.action?.params?.address === "string"
			? response.action.params.address
			: undefined;
	const displayAddress = response.focus?.address ?? actionAddress;
	const totalMatchedBuildings =
		response.action?.params?.building_ids?.length ?? 0;
	const showingRepresentativeScene =
		typeof targetXbdId === "number" &&
		totalMatchedBuildings > 0 &&
		response.highlighted_buildings.length > 0 &&
		totalMatchedBuildings > response.highlighted_buildings.length;
	if (response.action?.target === "building") {
		return typeof targetXbdId === "number"
			? `Opened the matched building on XBD ${targetXbdId}.`
			: "Opened the matched building on the map.";
	}
	if (
		response.action?.reason === "address_query" &&
		displayAddress &&
		response.action?.target === "map"
	) {
		return typeof targetXbdId === "number"
			? showingRepresentativeScene
				? `Moved the map to ${displayAddress}, showing representative XBD ${targetXbdId}.`
				: `Moved the map to ${displayAddress} on XBD ${targetXbdId}.`
			: `Moved the map to ${displayAddress}.`;
	}
	if (response.action?.target === "map" && response.focus?.address) {
		return typeof targetXbdId === "number"
			? showingRepresentativeScene
				? `Moved the map to ${response.focus.address}, showing representative XBD ${targetXbdId}.`
				: `Moved the map to ${response.focus.address} on XBD ${targetXbdId}.`
			: `Moved the map to ${response.focus.address}.`;
	}
	if (response.highlighted_buildings.length > 0) {
		const count = response.highlighted_buildings.length;
		return `Highlighted ${count} building${count === 1 ? "" : "s"} on the map.`;
	}
	if (response.focus) {
		return "Moved the map to the referenced location.";
	}
	return undefined;
};

export default function DisasterResponseAssistant({
	onChatResponse,
	onClearMapHighlights,
	onRunSuggestedAction,
}: DisasterResponseAssistantProps) {
	const API_BASE_URL = import.meta.env.VITE_HAZARDLY_API_BASE_URL?.replace(
		/\/*$/,
		"",
	);

	const initialMessage: ChatMessage = {
		id: crypto.randomUUID(),
		role: "responseAssistant",
		content:
			"Hi, I'm Hazardly. I can help you review damage severity, impacted areas, and assessment insights. What would you like to explore?",
	};

	const sanitizeStoredMessages = (
		messages: ChatMessage[] | null | undefined,
	): ChatMessage[] => {
		if (!Array.isArray(messages) || messages.length === 0) {
			return [initialMessage];
		}

		const cleanedMessages = messages.filter(
			(entry) =>
				!(
					entry.isPending ||
					(entry.role === "responseAssistant" &&
						entry.content === "" &&
						!entry.mapCommandSummary &&
						!entry.suggestedActionLabel &&
						!entry.actionPayload)
				),
		);

		const normalizedMessages = cleanedMessages.map((entry) => ({
			...entry,
			content: normalizeMessageContent(entry.content),
		}));

		return normalizedMessages.length > 0
			? normalizedMessages
			: [initialMessage];
	};

	const [responseLog, setResponseLog] = useState<ChatMessage[]>(() => {
		const saved = sessionStorage.getItem("chatHistory");
		return saved
			? sanitizeStoredMessages(JSON.parse(saved) as ChatMessage[])
			: [initialMessage];
	});

	// Persist only for the current browser tab/session.
	const [isOpen, setIsOpen] = useState(() => {
		return sessionStorage.getItem("chatOpen") === "true";
	});

	const [currentQuery, setCurrentQuery] = useState("");
	const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
	const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(
		null,
	);
	const bottomRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);

	const resizeComposer = useCallback(() => {
		const textarea = inputRef.current;
		if (!textarea) return;
		const computedStyle = window.getComputedStyle(textarea);
		const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
		const verticalPadding =
			Number.parseFloat(computedStyle.paddingTop) +
				Number.parseFloat(computedStyle.paddingBottom) || 0;
		const maxHeight = lineHeight * 6 + verticalPadding;

		textarea.style.height = "auto";
		const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY =
			textarea.scrollHeight > maxHeight ? "auto" : "hidden";
	}, []);

	useEffect(() => {
		resizeComposer();
	}, [resizeComposer]);

	useEffect(() => {
		if (responseLog.length > 0) {
			bottomRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [responseLog]);

	useEffect(() => {
		const persistedMessages = responseLog.filter((entry) => !entry.isPending);
		sessionStorage.setItem("chatHistory", JSON.stringify(persistedMessages));
		sessionStorage.setItem("chatOpen", isOpen.toString());
	}, [responseLog, isOpen]);

	const clearChat = () => {
		setResponseLog([initialMessage]);
		setIsAwaitingResponse(false);
		setAnimatingMessageId(null);
		setCurrentQuery("");
		sessionStorage.removeItem("chatHistory");
	};

	const handleQuery = async () => {
		if (!currentQuery.trim() || isAwaitingResponse) return;
		const userEntry: ChatMessage = {
			id: crypto.randomUUID(),
			role: "fieldUser",
			content: normalizeMessageContent(currentQuery),
		};
		const pendingMessageId = crypto.randomUUID();
		setResponseLog((prev) => [...prev, userEntry]);
		const queryToSend = currentQuery;
		setCurrentQuery("");
		window.requestAnimationFrame(() => resizeComposer());
		setIsAwaitingResponse(true);
		setResponseLog((prev) => [
			...prev,
			{
				id: pendingMessageId,
				role: "responseAssistant",
				content: "",
				isPending: true,
			},
		]);
		try {
			const backendResponse = await fetch(`${API_BASE_URL}/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question: queryToSend }),
			});
			if (!backendResponse.ok) {
				setResponseLog((prev) =>
					prev.map((entry) =>
						entry.id === pendingMessageId
							? {
									id: crypto.randomUUID(),
									role: "responseAssistant",
									content:
										"I'm having trouble reaching the backend service right now. Please try again.",
								}
							: entry,
					),
				);
				setIsAwaitingResponse(false);
				return;
			}
			const data = (await backendResponse.json()) as ChatResponse;
			const autoRunExplicitExample = shouldAutoRunExplicitExample(
				queryToSend,
				data,
			);
			const assistantEntry: ChatMessage = {
				id: crypto.randomUUID(),
				role: "responseAssistant",
				content: normalizeMessageContent(
					data.answer ||
						data.response ||
						"Your request has been received. Results will appear here.",
				),
				mapCommandSummary: requiresExplicitExampleAction(data)
					? autoRunExplicitExample
						? buildMapCommandSummary(data)
						: buildExplicitExampleSummary(data)
					: buildMapCommandSummary(data),
				suggestedActionLabel: requiresExplicitExampleAction(data)
					? autoRunExplicitExample
						? undefined
						: "Show example XBD"
					: undefined,
				actionPayload:
					requiresExplicitExampleAction(data) && !autoRunExplicitExample
						? data
						: undefined,
			};
			setResponseLog((prev) =>
				prev.map((entry) =>
					entry.id === pendingMessageId ? assistantEntry : entry,
				),
			);
			setIsAwaitingResponse(false);
			setAnimatingMessageId(assistantEntry.id);
			if (
				onChatResponse &&
				(!requiresExplicitExampleAction(data) || autoRunExplicitExample)
			) {
				try {
					onChatResponse(data);
				} catch (error) {
					console.error("Chat response handling failed:", error);
				}
			}
		} catch {
			setResponseLog((prev) =>
				prev.map((entry) =>
					entry.id === pendingMessageId
						? {
								id: crypto.randomUUID(),
								role: "responseAssistant",
								content:
									"I'm having trouble reaching the backend service right now. Please try again.",
							}
						: entry,
				),
			);
			setIsAwaitingResponse(false);
			setAnimatingMessageId(null);
		}
	};

	return (
		<div className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
			<div
				className={`chat-panel-container pointer-events-auto w-[min(408px,calc(100vw-2rem))] h-[min(calc(100dvh-10rem),720px)] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl backdrop-blur-sm flex flex-col ${
					isOpen ? "chat-panel-open" : "chat-panel-closed"
				}`}
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-primary via-primary to-indigo-500 px-4 py-3 text-white">
					<div className="flex flex-col">
						<span className="flex items-center gap-2 font-semibold">
							<MessageCircle className="h-4 w-4" />
							Hazardly
						</span>
						<span className="text-[11px] opacity-80">
							Chat history persists in session
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClearMapHighlights}
							className="rounded-md p-1.5 transition-colors duration-200 hover:bg-white/15"
							aria-label="Clear highlighted buildings"
							title="Clear highlights"
						>
							<Eraser className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={clearChat}
							className="rounded-md p-1.5 transition-colors duration-200 hover:bg-white/15"
							aria-label="Clear chat"
							title="Clear chat"
						>
							<Trash2 className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="rounded-md p-1.5 transition-colors duration-200 hover:bg-white/15"
							aria-label="Close chat"
							title="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				{/* Messages */}
				<div className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-4 text-sm">
					{responseLog.map((entry) => (
						<div
							key={entry.id}
							className={
								entry.role === "fieldUser"
									? "ml-auto max-w-[88%]"
									: "max-w-[88%]"
							}
						>
							<div
								className={`mb-1 px-1 text-[11px] font-medium uppercase tracking-[0.08em] ${
									entry.role === "fieldUser"
										? "text-right text-primary/80"
										: "text-muted-foreground"
								}`}
							>
								{entry.role === "fieldUser" ? "You" : "Hazardly"}
							</div>
							<div
								className={`rounded-2xl border transition-colors duration-theme ease-theme ${
									entry.role === "fieldUser"
										? "bg-primary px-3.5 py-3 text-primary-foreground border-primary shadow-sm"
										: entry.isPending
											? "w-fit max-w-[72px] border-border bg-card px-3 py-2 text-foreground shadow-sm"
											: "border-border bg-card px-3.5 py-3 text-foreground shadow-sm"
								}`}
							>
								{entry.isPending ? (
									<div className="flex items-center gap-1.5 py-1">
										<span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
										<span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
										<span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
									</div>
								) : (
									<div className="whitespace-pre-wrap break-words leading-6">
										<SelectableMessageText
											enableTripleClickSelectAll={entry.role === "fieldUser"}
										>
											<AnimatedAssistantText
												content={stripInlineMarkdown(entry.content)}
												animate={
													entry.role === "responseAssistant" &&
													animatingMessageId === entry.id
												}
												onProgress={() =>
													bottomRef.current?.scrollIntoView({
														behavior: "auto",
													})
												}
												onComplete={() => {
													if (animatingMessageId === entry.id) {
														setAnimatingMessageId(null);
													}
												}}
											/>
										</SelectableMessageText>
									</div>
								)}
								{entry.mapCommandSummary ? (
									<div className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">
										{entry.mapCommandSummary}
									</div>
								) : null}
								{entry.suggestedActionLabel && entry.actionPayload ? (
									<div className="mt-3">
										<button
											type="button"
											onClick={() => {
												if (entry.actionPayload) {
													onRunSuggestedAction?.(entry.actionPayload);
												}
											}}
											className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
										>
											{entry.suggestedActionLabel}
										</button>
									</div>
								) : null}
							</div>
						</div>
					))}
					<div ref={bottomRef} />
				</div>

				{/* Input */}
				<div className="border-t border-border bg-card p-3">
					<div className="flex items-center gap-2">
						<textarea
							ref={inputRef}
							value={currentQuery}
							onChange={(e) => {
								setCurrentQuery(e.target.value);
								resizeComposer();
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleQuery();
								}
							}}
							disabled={isAwaitingResponse}
							rows={1}
							className="min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-70"
							placeholder="Ask Hazardly..."
						/>
						<button
							type="button"
							onClick={handleQuery}
							disabled={isAwaitingResponse}
							className="inline-flex h-11 w-[112px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
						>
							<SendHorizontal className="h-4 w-4" />
							{isAwaitingResponse ? "Waiting" : "Send"}
						</button>
					</div>
				</div>
			</div>

			{/* Floating Button with Restored AI Badge */}
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-indigo-500 text-white shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95"
			>
				{isOpen ? (
					<X className="h-5 w-5" />
				) : (
					<>
						<MessageCircle className="h-6 w-6" />
						<span className="absolute -bottom-1 -right-1 bg-background text-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-border">
							AI
						</span>
					</>
				)}
			</button>
		</div>
	);
}
