/*DisasterResponsesAssistant.tsx
 *Created by Shriya Vetapalem
 *This handles the chatbot UI for disaster related questions.
  * It send user asked questions to the backend and displays the responses.
*/

import {useState, useRef,useEffect} from "react";

//Each message in the convrsation 
interface ResponseMssg {
    role: "fieldUser" | "responseAssistant";
    content: string;
}

export default function DisasterResponsesAssistant() {
    //This stores teh full conversation between user and the bot
    const [responseLog, setResponseLog] = useState<ResponseMssg[]> ([
        {
            role: "responseAssistant",
            content: "Hi, I'm your Disaster Response Assistant. I can help you review damage severity, impacted areas, and assessment insights. What would you like to explore?"
        }
        ]);

        //Stroing what the user says
        const [currentQuery, setCurrentQuery] = useState("");

        //manages the open/close status of the chatbot UI for the collapsible op up 
        const [isOpen, setIsOpen] = useState(false);

        //Used o auto-scroll when new messages appear
        const bottomRef = useRef<HTMLDivElement| null>(null);

        //Scroll to the latest message when the conversation updates
        useEffect(() => {
            bottomRef.current?.scrollIntoView({behavior: "smooth"} );

            },
            [responseLog]);
        //This function send the user's query to backend 
        const handleQuery = async () => {
            //Taking care of empty input
            if(!currentQuery.trim()) {
                return;
            }
            //Adding user message to the log
            const userEntry: ResponseMssg = {
                role: "fieldUser",
                content: currentQuery
            };
            
            setResponseLog(prev => [...prev, userEntry]);

            const queryToSend = currentQuery;
            setCurrentQuery("");

            try{
                const backendResponse = await fetch ("http://localhost:8000/chat", {
                    method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
            body: JSON.stringify({ query: queryToSend })});
            const data = await backendResponse.json();

            const assistantEntry: ResponseMssg = {
                role: "responseAssistant",
                content: data.response || "Your request has been received. Results will appear here." };
                
                setResponseLog(prev => [...prev, assistantEntry]);
            } catch {
                setResponseLog(prev => [...prev, 
                    {
                        role: "responseAssistant",
                        content: "I'm having trouble reaching the backend service right now. Please check your connection and try again!"
                    }
                ]);

                }
        };

            return (
                <div className = "fixed bottom-6 right-6 z-50">
                    {/* floating buble button*/}
                    {!isOpen && (
                        <button
                        onClick={()=> setIsOpen(true)}
                        className="w-14 h-14 rounded-full bg-orange-600/90 backdrop-blur shadow-lg text-white text-xl flex items-center justify-center hover:bg-orange-500 transition"
                        >
                        🗣️ 
                        </button>

                    )}
                    
    {/* Chat Panel */}
    {isOpen && (
      <div className="w-[380px] h-[520px] bg-gradient-to-br from-orange-900/60 to-blue-950/70 backdrop-blur-2xl rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] border border-orange-400/20 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-4 py-3 flex justify-between items-center border-b border-blue-800/50 bg-blue-900/70 text-orange-200 text-sm tracking-wide uppercase font-medium">
          Disaster Response Assistant
          <button
            onClick={() => setIsOpen(false)}
            className="text-blue-300 hover:text-white"
          >
           X
          </button>
        </div>

        {/* Conversation */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {responseLog.map((entry, index) => (
            <div
              key={index}
              className={`p-3 rounded-xl max-w-[80%] text-sm ${
                entry.role === "fieldUser"
                  ? "ml-auto bg-gradient-to-r from-white-500 to-blue-600 text-white shadow-md"
                  : "bg-blue-900/60 text-blue-100 border border-blue-500/20 backdrop-blur-md"
              }`}
            >
              {entry.content}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-blue-800/50 bg-blue-900/60 flex gap-2">
          <input
            type="text"
            value={currentQuery}
            onChange={(e) => setCurrentQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuery()}
            className="flex-1 bg-blue-950/80 border border-blue-700 rounded-lg px-3 py-2 text-sm text-blue-100 placeholder-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter query..."
          />
          <button
            onClick={handleQuery}
            className="bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded-lg text-sm text-white"
          >
            Send
          </button>
        </div>
      </div>
    )}
  </div>
);
}