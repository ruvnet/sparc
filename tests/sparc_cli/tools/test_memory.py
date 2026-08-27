from unittest.mock import patch

import pytest

from sparc_cli.tools.memory import (
    MEMORY_LIMITS,
    MemoryPriority,
    _global_memory,
    delete_key_facts,
    delete_tasks,
    deregister_related_files,
    emit_key_facts,
    emit_key_snippets,
    emit_plan,
    emit_related_files,
    emit_research_notes,
    emit_task,
    get_memory_value,
    get_related_files,
    get_work_log,
    log_work_event,
    one_shot_completed,
    plan_implementation_completed,
    reset_work_log,
    swap_task_order,
    task_completed,
)


def initial_memory():
    return {
        "research_notes": [],
        "plans": [],
        "tasks": {},
        "task_completed": False,
        "completion_message": "",
        "task_id_counter": 1,
        "key_facts": {},
        "key_fact_id_counter": 1,
        "key_snippets": {},
        "key_snippet_id_counter": 1,
        "implementation_requested": False,
        "related_files": {},
        "related_file_id_counter": 1,
        "plan_completed": False,
        "agent_depth": 0,
        "work_log": [],
    }


@pytest.fixture(autouse=True)
def reset_global_memory():
    _global_memory.clear()
    _global_memory.update(initial_memory())
    with patch("sparc_cli.tools.memory.console"):
        yield


def test_research_notes_respect_limit_and_priority():
    limit = MEMORY_LIMITS["research_notes"]
    for index in range(limit):
        emit_research_notes.invoke(
            {"notes": f"Old note {index}", "priority": MemoryPriority.LOW}
        )
    emit_research_notes.invoke(
        {"notes": "Important note", "priority": MemoryPriority.HIGH}
    )

    notes = _global_memory["research_notes"]
    assert len(notes) == limit
    assert any(note["content"] == "Important note" for note in notes)


def test_key_facts_respect_limit_and_can_be_deleted():
    limit = MEMORY_LIMITS["key_facts"]
    emit_key_facts.invoke(
        {
            "facts": [f"Old fact {index}" for index in range(limit)],
            "priority": MemoryPriority.LOW,
        }
    )
    emit_key_facts.invoke(
        {"facts": ["Critical fact"], "priority": MemoryPriority.CRITICAL}
    )

    facts = _global_memory["key_facts"]
    assert len(facts) == limit
    assert "Critical fact" in get_memory_value("key_facts")
    critical_id = next(
        fact_id for fact_id, fact in facts.items() if fact["content"] == "Critical fact"
    )
    delete_key_facts.invoke({"fact_ids": [critical_id]})
    assert "Critical fact" not in get_memory_value("key_facts")


def test_work_log_respects_limit_through_public_writer():
    limit = MEMORY_LIMITS["work_log"]
    for index in range(limit + 10):
        log_work_event(f"Event {index}")

    assert len(_global_memory["work_log"]) == limit
    assert _global_memory["work_log"][0]["event"] == "Event 10"
    assert _global_memory["work_log"][-1]["event"] == f"Event {limit + 9}"
    assert "Event 109" in get_work_log()
    assert reset_work_log() == "Work log cleared"
    assert get_work_log() == "No work log entries"


def test_plan_and_task_collections_enforce_declared_limits():
    for index in range(MEMORY_LIMITS["plans"] + 2):
        emit_plan.invoke({"plan": f"Plan {index}"})
    for index in range(MEMORY_LIMITS["tasks"] + 2):
        emit_task.invoke({"task": f"Task {index}"})

    assert len(_global_memory["plans"]) == MEMORY_LIMITS["plans"]
    assert _global_memory["plans"][0] == "Plan 2"
    assert len(_global_memory["tasks"]) == MEMORY_LIMITS["tasks"]
    assert min(_global_memory["tasks"]) == 3


def test_task_tools_use_structured_tool_contract():
    assert emit_task.invoke({"task": "first"}) == "Task #1 stored."
    assert emit_task.invoke({"task": "second"}) == "Task #2 stored."
    assert swap_task_order.invoke({"id1": 1, "id2": 2}) == "Tasks swapped."
    assert _global_memory["tasks"] == {1: "second", 2: "first"}
    delete_tasks.invoke({"task_ids": [1]})
    assert _global_memory["tasks"] == {2: "first"}


def test_snippets_register_related_files_and_preserve_priority():
    snippet = {
        "filepath": "module.py",
        "line_number": 7,
        "snippet": "answer = 42",
        "description": "The answer",
    }
    emit_key_snippets.invoke(
        {"snippets": [snippet], "priority": MemoryPriority.HIGH}
    )

    assert _global_memory["key_snippets"][1]["priority"] == MemoryPriority.HIGH
    assert "answer = 42" in get_memory_value("key_snippets")
    assert get_related_files() == ["ID#1 module.py"]


def test_related_file_tools_deduplicate_and_deregister():
    first = emit_related_files.invoke({"files": ["one.py", "one.py", "two.py"]})
    assert first.count("File ID #1: one.py") == 2
    assert get_related_files() == ["ID#1 one.py", "ID#2 two.py"]

    deregister_related_files.invoke({"file_ids": [1]})
    assert get_related_files() == ["ID#2 two.py"]


def test_completion_tools_update_flags_and_clear_tasks():
    emit_task.invoke({"task": "finish"})
    task_completed.invoke({"message": "Task done"})
    assert _global_memory["task_completed"] is True
    assert _global_memory["completion_message"] == "Task done"

    plan_implementation_completed.invoke({"message": "Plan done"})
    assert _global_memory["plan_completed"] is True
    assert _global_memory["tasks"] == {}

    _global_memory["implementation_requested"] = False
    one_shot_completed.invoke({"message": "One shot"})
    assert _global_memory["completion_message"] == "One shot"


@pytest.mark.parametrize("priority", [None, True, 1.5, "high"])
def test_priority_tools_reject_non_integer_priority(priority):
    with pytest.raises(ValueError, match="priority"):
        emit_research_notes.invoke({"notes": "note", "priority": priority})
