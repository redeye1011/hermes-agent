"""Photon-specific delivery regressions for TTS and native audio attachments."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, MessageEvent, MessageType, SendResult
from gateway.session import SessionSource, build_session_key


class DummyPhotonAdapter(BasePlatformAdapter):
    def __init__(self) -> None:
        super().__init__(PlatformConfig(enabled=True, token="test-token"), Platform("photon"))
        self.sent: list[dict] = []
        self.voice_paths: list[str] = []
        self.document_paths: list[str] = []

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        return True

    async def disconnect(self) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict:
        return {"id": chat_id}

    async def send(self, chat_id, content, reply_to=None, metadata=None) -> SendResult:
        self.sent.append({"chat_id": chat_id, "content": content, "reply_to": reply_to, "metadata": metadata})
        return SendResult(success=True, message_id="text-1")

    async def send_voice(self, chat_id, audio_path, **kwargs) -> SendResult:
        self.voice_paths.append(audio_path)
        return SendResult(success=True, message_id="voice-1")

    async def send_document(self, chat_id, file_path, **kwargs) -> SendResult:
        self.document_paths.append(file_path)
        return SendResult(success=True, message_id="document-1")


def _event(message_type: MessageType = MessageType.TEXT) -> MessageEvent:
    return MessageEvent(
        text="please reply",
        message_type=message_type,
        source=SessionSource(platform=Platform("photon"), chat_id="any;-;+15550000000", chat_type="dm"),
        message_id="incoming-1",
    )


def _hold_typing():
    async def hold(*_args, **_kwargs):
        await asyncio.Event().wait()

    return hold


@pytest.mark.asyncio
async def test_photon_deduplicates_bare_and_media_tag_audio_before_delivery(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A TTS result must never send both raw MP3 and converted Photon voice."""
    audio = tmp_path / "reply.mp3"
    audio.write_bytes(b"audio")
    adapter = DummyPhotonAdapter()
    adapter._keep_typing = _hold_typing()
    adapter.set_message_handler(
        lambda _event: asyncio.sleep(
            0,
            result=f"Full voice answer.\n{audio}\nMEDIA:{audio}",
        )
    )
    monkeypatch.setattr(
        DummyPhotonAdapter,
        "validate_media_delivery_path",
        staticmethod(lambda path: path if Path(path).is_file() else None),
    )

    event = _event()
    await adapter._process_message_background(event, build_session_key(event.source))

    assert [item["content"] for item in adapter.sent] == ["Full voice answer."]
    assert adapter.voice_paths == [str(audio)]
    assert adapter.document_paths == []


@pytest.mark.asyncio
async def test_photon_auto_tts_always_sends_the_full_text_reply(
    tmp_path: Path,
) -> None:
    """Photon never uses an attachment caption as a substitute for response text."""
    audio = tmp_path / "reply.mp3"
    audio.write_bytes(b"audio")
    adapter = DummyPhotonAdapter()
    adapter._keep_typing = _hold_typing()
    adapter._should_auto_tts_for_chat = lambda _chat_id: True
    adapter.play_tts = AsyncMock(return_value=SendResult(success=True, message_id="voice-1"))
    full_reply = "This is the complete text reply, not merely an audio title."
    adapter.set_message_handler(lambda _event: asyncio.sleep(0, result=full_reply))

    event = _event(MessageType.VOICE)
    with patch("tools.tts_tool.check_tts_requirements", return_value=True), patch(
        "tools.tts_tool.text_to_speech_tool",
        return_value=f'{{"file_path": "{audio}"}}',
    ):
        await adapter._process_message_background(event, build_session_key(event.source))

    adapter.play_tts.assert_awaited_once()
    assert adapter.play_tts.await_args.kwargs["caption"] is None
    assert [item["content"] for item in adapter.sent] == [full_reply]
