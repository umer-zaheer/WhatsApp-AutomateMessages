"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import {
  blobToRecordingFile,
  getRecordingMimeType,
} from "@/lib/recording";

export default function VoiceRecorder({ onRecorded, disabled = false }) {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef("");
  const previewUrlRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState(null);
  const [mimeType, setMimeType] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    setError(null);

    const type = getRecordingMimeType();
    if (!type) {
      setError("This browser does not support audio recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      mimeTypeRef.current = type;
      setMimeType(type);

      const mediaRecorder = new MediaRecorder(stream, { mimeType: type });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        stopStream();

        const recordedMime = mediaRecorder.mimeType || mimeTypeRef.current;
        const blob = new Blob(chunksRef.current, { type: recordedMime });

        if (blob.size === 0) {
          setError("Recording is empty. Speak for at least one second, then stop.");
          return;
        }

        const file = blobToRecordingFile(blob, recordedMime);

        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }

        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        onRecorded?.(file);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250);
      setRecording(true);
    } catch (err) {
      stopStream();
      setError(err.message || "Microphone access denied.");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.requestData();
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  const formatLabel = mimeType.includes("mp4")
    ? "Records M4A → converted to MP3 on send"
    : mimeType.includes("webm")
      ? "Records WebM → converted to MP3 on send"
      : "Plays reliably on mobile after send";

  return (
    <div className="space-y-2 rounded-xl border border-dashed px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-primary text-sm font-semibold">Record voice</p>
          <p className="text-muted text-xs">{formatLabel}</p>
        </div>
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            className="btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <Mic className="h-3.5 w-3.5" />
            Start
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="inline-flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-400"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop
          </button>
        )}
      </div>

      {recording && (
        <div className="text-accent flex items-center gap-2 text-xs font-medium">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Recording…
        </div>
      )}

      {previewUrl && <audio controls src={previewUrl} className="w-full" />}

      {error && <p className="text-xs font-medium text-red-400">{error}</p>}
    </div>
  );
}
