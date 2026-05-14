import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
	Navigate,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router-dom";
import { Toaster, toast } from "sonner";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import Dashboard from "@/pages/Dashboard";
import type { ChatMapCommand, ChatResponse } from "@/types/chat";
import {
	buildChatCommand,
	buildChatNavigationUrl,
} from "@/utils/chatNavigation";

const MapPage = lazy(() => import("@/pages/MapPage.tsx"));

function NotFoundRedirect() {
	useEffect(() => {
		toast.warning("Page not found. Redirected to the dashboard.", {
			id: "route-not-found",
		});
	}, []);

	return <Navigate to="/" replace />;
}

function RouteLoadingFallback() {
	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="flex min-h-screen items-center justify-center px-4">
				<SpinnerEmpty
					title="Loading View"
					description="Opening the requested map state..."
					className="border-0"
				/>
			</div>
		</div>
	);
}

function getCurrentMapRouteContext(pathname: string): {
	onMapRoute: boolean;
	disasterName: string | null;
} {
	const match = pathname.match(/^\/map(?:\/([^/]+))?/);
	if (!match) {
		return { onMapRoute: false, disasterName: null };
	}

	return {
		onMapRoute: true,
		disasterName: match[1] ? decodeURIComponent(match[1]) : null,
	};
}

export default function App() {
	const location = useLocation();
	const navigate = useNavigate();
	const [chatCommand, setChatCommand] = useState<ChatMapCommand | null>(null);
	const [highlightResetToken, setHighlightResetToken] = useState(0);

	const handleChatResponse = useCallback(
		(response: ChatResponse) => {
			try {
				const nextCommand = buildChatCommand(response);
				setChatCommand(nextCommand);

				const nextUrl = buildChatNavigationUrl(response);
				if (!nextUrl) {
					return;
				}

				const currentMapRoute = getCurrentMapRouteContext(location.pathname);
				const targetDisasterName =
					response.action?.params?.disaster_name?.trim() ?? null;
				const canHandleInsideCurrentMapRoute =
					currentMapRoute.onMapRoute &&
					(currentMapRoute.disasterName === null ||
						targetDisasterName === null ||
						currentMapRoute.disasterName === targetDisasterName);
				if (canHandleInsideCurrentMapRoute) {
					return;
				}

				if (`${location.pathname}${location.search}` !== nextUrl) {
					navigate(nextUrl);
				}
			} catch (error) {
				console.error("App chat navigation failed:", error);
			}
		},
		[location.pathname, location.search, navigate],
	);

	const handleRunSuggestedAction = useCallback(
		(response: ChatResponse) => {
			handleChatResponse(response);
		},
		[handleChatResponse],
	);

	const handleClearMapHighlights = useCallback(() => {
		setHighlightResetToken((value) => value + 1);
	}, []);

	return (
		<>
			<Toaster position="bottom-center" richColors closeButton />
			<Suspense fallback={<RouteLoadingFallback />}>
				<Routes>
					<Route path="/" element={<Dashboard />} />
					<Route path="/dashboard" element={<Navigate to="/" replace />} />
					<Route
						path="/map/:disaster_name?/:xbdid?"
						element={
							<MapPage
								chatCommand={chatCommand}
								highlightResetToken={highlightResetToken}
							/>
						}
					/>
					<Route
						path="/map"
						element={
							<MapPage
								chatCommand={chatCommand}
								highlightResetToken={highlightResetToken}
							/>
						}
					/>
					<Route path="*" element={<NotFoundRedirect />} />
				</Routes>
			</Suspense>
			<DisasterResponseAssistant
				onChatResponse={handleChatResponse}
				onClearMapHighlights={handleClearMapHighlights}
				onRunSuggestedAction={handleRunSuggestedAction}
			/>
		</>
	);
}
