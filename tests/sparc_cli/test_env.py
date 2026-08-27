from dataclasses import dataclass
import os

import pytest

from sparc_cli.env import validate_environment


@dataclass
class Args:
    provider: str
    expert_provider: str


def test_validate_environment_disables_unconfigured_expert(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "base-key")
    monkeypatch.delenv("EXPERT_OPENAI_API_KEY", raising=False)

    expert_enabled, missing = validate_environment(Args("anthropic", "openai"))

    assert expert_enabled is False
    assert missing == ["EXPERT_OPENAI_API_KEY environment variable is not set"]


def test_validate_environment_exits_when_base_key_is_missing(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(SystemExit) as exc_info:
        validate_environment(Args("anthropic", "openai"))

    assert exc_info.value.code == 1


def test_validate_environment_requires_compatible_base_url(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "base-key")
    monkeypatch.delenv("OPENAI_API_BASE", raising=False)

    with pytest.raises(SystemExit):
        validate_environment(Args("openai-compatible", "openai"))


def test_validate_environment_expert_fallback(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "base-key")
    monkeypatch.delenv("EXPERT_ANTHROPIC_API_KEY", raising=False)

    expert_enabled, missing = validate_environment(Args("anthropic", "anthropic"))

    assert expert_enabled is True
    assert missing == []
    assert os.environ["EXPERT_ANTHROPIC_API_KEY"] == "base-key"


@pytest.mark.parametrize(
    ("provider", "expert_provider", "message"),
    [
        ("invalid", "openai", "Unsupported provider"),
        ("openai", "invalid", "Unsupported expert provider"),
    ],
)
def test_validate_environment_rejects_unknown_providers(
    provider, expert_provider, message
):
    with pytest.raises(ValueError, match=message):
        validate_environment(Args(provider, expert_provider))
