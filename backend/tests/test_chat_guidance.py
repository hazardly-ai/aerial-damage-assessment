from app import rag_agent


def _ask(question, monkeypatch, answer=None):
    rag_agent.chat_histories.clear()
    captured = {}

    def fake_call_nemotron(prompt):
        captured["prompt"] = prompt
        return answer or (
            "LLM-generated Ready.gov guidance.\n"
            "Sources: Ready.gov Floods (https://www.ready.gov/floods)."
        )

    monkeypatch.setattr(rag_agent, "call_nemotron", fake_call_nemotron)
    response = rag_agent.handle_chat_query(
        question,
        session_id="test-disaster-guidance",
    )
    return response, captured


def test_chat_answers_flood_guidance_with_llm_markdown_context(monkeypatch):
    response, captured = _ask("What should I do during a flood?", monkeypatch)

    assert response["focus"] is None
    assert response["highlighted_buildings"] == []
    assert response["action"]["type"] == "none"
    assert "LLM-generated Ready.gov guidance" in response["answer"]
    assert "Do not walk, swim or drive through floodwaters" in captured["prompt"]
    assert "Ready.gov Floods" in captured["prompt"]


def test_chat_answers_hurricane_preparedness_guidance(monkeypatch):
    response, captured = _ask(
        "How should I prepare for a hurricane?",
        monkeypatch,
        answer=(
            "LLM-generated hurricane preparedness guidance.\n"
            "Sources: Ready.gov Hurricanes (https://www.ready.gov/hurricanes)."
        ),
    )

    assert response["focus"] is None
    assert "LLM-generated hurricane preparedness guidance" in response["answer"]
    assert "Make an Emergency Plan" in captured["prompt"]
    assert "Ready.gov Hurricanes" in captured["prompt"]


def test_chat_routes_hurricane_facts_to_guidance(monkeypatch):
    response, captured = _ask(
        "hurricane facts",
        monkeypatch,
        answer=(
            "LLM-generated hurricane facts.\n"
            "Sources: Ready.gov Hurricanes (https://www.ready.gov/hurricanes)."
        ),
    )

    assert response["focus"] is None
    assert response["highlighted_buildings"] == []
    assert response["action"]["type"] == "none"
    assert "LLM-generated hurricane facts" in response["answer"]
    assert "Ready.gov Hurricanes" in captured["prompt"]


def test_chat_uses_both_docs_when_both_guidance_topics_are_named(monkeypatch):
    response, captured = _ask(
        "hurricane/ flood guidance",
        monkeypatch,
        answer=(
            "LLM-generated hurricane and flood guidance.\n"
            "Sources: Ready.gov Floods (https://www.ready.gov/floods); Ready.gov Hurricanes (https://www.ready.gov/hurricanes)."
        ),
    )

    assert response["focus"] is None
    assert response["action"]["type"] == "none"
    assert "Ready.gov Floods" in captured["prompt"]
    assert "Ready.gov Hurricanes" in captured["prompt"]


def test_chat_allows_fema_flood_insurance_guidance(monkeypatch):
    response, captured = _ask("What does FEMA guidance say about flood insurance?", monkeypatch)

    assert response["action"]["type"] == "none"
    assert "National Flood Insurance Program" in captured["prompt"]
    assert "unsupported" not in response["answer"].lower()


def test_chat_uses_both_markdown_docs_for_general_disaster_guidance(monkeypatch):
    response, captured = _ask("Can you give me general disaster safety information?", monkeypatch)

    assert response["action"]["type"] == "none"
    assert "Ready.gov Floods" in captured["prompt"]
    assert "Ready.gov Hurricanes" in captured["prompt"]
