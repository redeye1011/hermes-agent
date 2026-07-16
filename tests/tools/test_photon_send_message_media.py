"""Regression coverage for Photon native attachments sent by send_message."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from gateway.config import Platform
from tools.send_message_tool import _send_to_platform, _send_via_adapter


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


def test_live_photon_adapter_sends_text_then_native_audio(monkeypatch) -> None:
    """The in-process gateway path must not drop Photon media files."""
    success = SimpleNamespace(success=True, message_id="msg-1", error=None)
    adapter = SimpleNamespace(
        send=AsyncMock(return_value=success),
        send_voice=AsyncMock(return_value=success),
        send_document=AsyncMock(return_value=success),
    )
    photon = Platform("photon")
    monkeypatch.setattr(
        "gateway.run._gateway_runner_ref",
        lambda: SimpleNamespace(adapters={photon: adapter}),
    )

    result = asyncio.run(
        _send_via_adapter(
            photon,
            SimpleNamespace(enabled=True, token="", extra={}),
            "any;-;+15550000000",
            "The complete text reply.",
            media_files=[("/tmp/reply.mp3", True)],
        )
    )

    assert result == {"success": True, "message_id": "msg-1"}
    adapter.send.assert_awaited_once()
    adapter.send_voice.assert_awaited_once_with(
        chat_id="any;-;+15550000000", audio_path="/tmp/reply.mp3", metadata=None
    )
    adapter.send_document.assert_not_awaited()
