"""Regression coverage for Photon native attachments sent by send_message."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from gateway.config import Platform
from tools.send_message_tool import _send_to_platform


def test_send_message_routes_photon_media_through_live_adapter(monkeypatch) -> None:
    """Photon must not fall through to the non-media sender and drop attachments."""
    adapter_send = AsyncMock(return_value={"success": True, "message_id": "msg-1"})
    monkeypatch.setattr("tools.send_message_tool._send_via_adapter", adapter_send)

    pconfig = SimpleNamespace(enabled=True, token="", extra={})
    result = asyncio.run(
        _send_to_platform(
            Platform("photon"),
            pconfig,
            "any;-;+15550000000",
            "Full text must remain separate from the native attachment.",
            media_files=[("/tmp/reply.mp3", True)],
        )
    )

    assert result == {"success": True, "message_id": "msg-1"}
    adapter_send.assert_awaited_once()
    assert adapter_send.call_args.args == (
        Platform("photon"),
        pconfig,
        "any;-;+15550000000",
        "Full text must remain separate from the native attachment.",
    )
    assert adapter_send.call_args.kwargs == {
        "thread_id": None,
        "media_files": [("/tmp/reply.mp3", True)],
        "force_document": False,
    }
