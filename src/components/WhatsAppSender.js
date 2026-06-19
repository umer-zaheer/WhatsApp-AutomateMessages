"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  Paperclip,
  Phone,
  QrCode,
  RefreshCw,
  Send,
  Upload,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { parseCsvNumbers, parsePhoneNumbers, readCsvText } from "@/lib/phone";
import ThemeToggle from "./ThemeToggle";
import VoiceRecorder from "./VoiceRecorder";

const STATUS_LABELS = {
  initializing: "Starting WhatsApp client…",
  qr: "Scan QR code to connect",
  authenticated: "Authenticated, finishing setup…",
  ready: "Connected and ready",
  auth_failure: "Authentication failed",
  disconnected: "Disconnected",
  error: "Connection failed",
};

const STATUS_BADGE = {
  ready: "badge-ready",
  qr: "badge-qr",
  initializing: "badge-init",
  authenticated: "badge-auth",
  auth_failure: "badge-error",
  disconnected: "badge-offline",
  error: "badge-error",
};

const STUCK_MS = 45_000;

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

const stagger = {
  show: { transition: { staggerChildren: 0.07 } },
};

function Background() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 min-h-full overflow-hidden"
      aria-hidden
    >
      <div className="bg-layer-base absolute inset-0" />
      <div className="bg-layer-pulse animate-bg-breathe absolute inset-0" />
      <div className="bg-layer-pulse-alt animate-bg-breathe-alt absolute inset-0" />
      <div className="bg-grid absolute inset-0" />
      <div className="bg-dot-field absolute inset-0" />

      <div className="bg-line bg-line-1" />
      <div className="bg-line bg-line-2" />
      <div className="bg-ring bg-ring-1 animate-ring-drift" />
      <div className="bg-ring bg-ring-2 animate-ring-drift-reverse" />
      <div className="bg-ring bg-ring-3 animate-float-slow" />
      <div className="bg-ring bg-ring-4 animate-float" />
      <div className="bg-arc animate-arc-spin" />
      <div className="bg-arc-2 animate-ring-drift-reverse" />

      <div className="bg-orb-1 animate-float absolute -left-20 top-0 h-[480px] w-[480px] rounded-full blur-[90px] opacity-90" />
      <div className="bg-orb-2 animate-float-slow absolute -bottom-28 -right-20 h-[420px] w-[420px] rounded-full blur-[90px] opacity-90" />
      <div className="bg-orb-1 animate-bg-breathe-alt absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px] opacity-70" />

      <div className="bg-overlay absolute inset-0" />
    </div>
  );
}

function Card({ children, delay = 0 }) {
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      animate="show"
      whileHover={{ y: -6, transition: { duration: 0.3, ease: [0.34, 1.2, 0.64, 1] } }}
      transition={{ duration: 0.45, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="card relative overflow-hidden rounded-2xl"
    >
      <div className="card-accent-line" />
      <div className="relative z-[1] p-6">{children}</div>
    </motion.section>
  );
}

function StatusBadge({ status, label, isReady }) {
  return (
    <motion.span
      layout
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS_BADGE[status] || STATUS_BADGE.initializing}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isReady && (
          <span className="absolute h-full w-full animate-ping rounded-full bg-current opacity-50" />
        )}
        <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {label}
    </motion.span>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <div className="segment-track flex rounded-xl p-1">
      {[
        { id: "type", label: "Type", icon: Phone },
        { id: "upload", label: "Upload CSV", icon: FileSpreadsheet },
      ].map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${
            mode === id ? "segment-active" : "segment-idle"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ResultBadge({ status, error }) {
  if (status === "sent") {
    return (
      <span className="result-sent inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
        <CheckCircle2 className="h-3 w-3" />
        Sent
      </span>
    );
  }
  if (status === "not_registered") {
    return (
      <span className="result-miss inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
        <WifiOff className="h-3 w-3" />
        Not on WhatsApp
      </span>
    );
  }
  return (
    <span
      className="result-fail inline-flex max-w-[55%] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
      title={error || "Failed"}
    >
      <XCircle className="h-3 w-3 shrink-0" />
      <span className="truncate">{error || "Failed"}</span>
    </span>
  );
}

export default function WhatsAppSender() {
  const [connection, setConnection] = useState({
    status: "initializing",
    qrDataUrl: null,
    ready: false,
  });
  const [numbers, setNumbers] = useState("");
  const [numberInputMode, setNumberInputMode] = useState("type");
  const [csvFile, setCsvFile] = useState(null);
  const [csvNumbers, setCsvNumbers] = useState([]);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [now, setNow] = useState(Date.now());
  const csvInputRef = useRef(null);
  const eventSourceRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp", {
        credentials: "include",
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch status");
      setConnection(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const connectEvents = useCallback(() => {
    eventSourceRef.current?.close();

    const source = new EventSource("/api/whatsapp/events", {
      withCredentials: true,
    });
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setError(data.error);
          return;
        }
        setConnection(data);
      } catch {
        // Ignore malformed event payloads.
      }
    };

    source.onerror = () => {
      source.close();
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      await fetchStatus();
      if (active) connectEvents();
    })();

    return () => {
      active = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [fetchStatus, connectEvents]);

  async function handleCheckConnection() {
    setCheckingConnection(true);
    try {
      await fetchStatus();
    } finally {
      setCheckingConnection(false);
    }
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/whatsapp", {
        method: "PATCH",
        credentials: "include",
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to disconnect");

      setConnection({
        status: "disconnected",
        qrDataUrl: null,
        ready: false,
        error: null,
        loadingMessage: null,
      });

      await fetchStatus();
      connectEvents();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleReset(clearAuth = false) {
    setResetting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/whatsapp${clearAuth ? "?clearAuth=true" : ""}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "ngrok-skip-browser-warning": "true" },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset connection");

      setConnection({
        status: data.status || "initializing",
        qrDataUrl: null,
        ready: false,
        error: null,
        loadingMessage: null,
      });
      connectEvents();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function handleCsvChange(e) {
    const file = e.target.files?.[0];
    setError(null);

    if (!file) {
      setCsvFile(null);
      setCsvNumbers([]);
      return;
    }

    try {
      const parsed = parseCsvNumbers(await readCsvText(file));
      if (parsed.length === 0) {
        throw new Error("No valid phone numbers found in the CSV file.");
      }
      setCsvFile(file);
      setCsvNumbers(parsed);
    } catch (err) {
      setCsvFile(null);
      setCsvNumbers([]);
      setError(err.message);
      e.target.value = "";
    }
  }

  function removeCsv() {
    setCsvFile(null);
    setCsvNumbers([]);
    setError(null);
    if (csvInputRef.current) {
      csvInputRef.current.value = "";
    }
  }

  function handleRecordedAudio(file) {
    setError(null);

    if (!file || file.size === 0) {
      setError("Recording is empty. Try recording for at least one second.");
      return;
    }

    setAttachments((current) => [...current, file]);
  }

  function handleAttachmentChange(e) {
    const selected = Array.from(e.target.files || []);
    setError(null);

    if (selected.length === 0) return;

    setAttachments((current) => [...current, ...selected]);
    e.target.value = "";
  }

  function removeAttachment(index) {
    setAttachments((current) => current.filter((_, i) => i !== index));
  }

  async function handleSend(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    setResults(null);
    const parsed =
      numberInputMode === "type" ? parsePhoneNumbers(numbers) : csvNumbers;

    if (parsed.length === 0) {
      setError("Provide at least one valid phone number.");
      setSending(false);
      return;
    }

    if (!message.trim() && attachments.length === 0) {
      setError("Provide a message, at least one file, or both.");
      setSending(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("numbers", JSON.stringify(parsed));
      formData.append("message", message);
      attachments.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/whatsapp", {
        method: "POST",
        credentials: "include",
        headers: {
          "ngrok-skip-browser-warning": "true",
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send messages");
      }
      setResults(data.results);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const statusLabel =
    connection.loadingMessage &&
    (connection.status === "initializing" || connection.status === "authenticated")
      ? connection.loadingMessage
      : STATUS_LABELS[connection.status] || connection.status;
  const isReady = connection.ready;
  const isStuck =
    connection.status === "initializing" &&
    connection.startedAt &&
    now - connection.startedAt > STUCK_MS;
  const showReset =
    isStuck ||
    connection.status === "error" ||
    connection.status === "auth_failure" ||
    connection.status === "disconnected";
  const hasNumbers =
    numberInputMode === "type" ? numbers.trim().length > 0 : csvNumbers.length > 0;
  const hasContent = message.trim().length > 0 || attachments.length > 0;
  const canSend = isReady && hasNumbers && hasContent;

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden">
      <ThemeToggle />
      <Background />

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-12 sm:px-6"
      >
        <motion.header variants={fadeUp} className="space-y-3">
          <div className="flex items-center gap-3.5">
            <motion.div
              whileHover={{ scale: 1.1, rotate: 8 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 14 }}
              className="logo-mark flex h-11 w-11 cursor-default items-center justify-center rounded-xl"
            >
              <MessageSquare className="h-5 w-5 text-white" />
            </motion.div>
            <div>
              <h1 className="brand-title text-[1.65rem] sm:text-[1.85rem]">
                <span className="gradient-text font-semibold">WhatsApp</span>{" "}
                <span className="text-primary font-semibold">Sender</span>
              </h1>
              <p className="brand-subtitle text-muted flex items-center gap-1.5 text-[0.8125rem] font-semibold">
                <motion.span
                  whileHover={{ rotate: 12, scale: 1.2 }}
                  transition={{ type: "spring", stiffness: 400, damping: 12 }}
                >
                  <Zap className="text-accent h-3.5 w-3.5" />
                </motion.span>
                Professional bulk messaging
              </p>
            </div>
          </div>
          <p className="text-secondary max-w-md text-sm leading-relaxed">
            Connect your account via QR, then send messages and files to multiple
            contacts from one place.
          </p>
        </motion.header>

        <Card delay={0.08}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <motion.div
                whileHover={{ scale: 1.15, rotate: -10 }}
                className="icon-box flex h-8 w-8 cursor-default items-center justify-center rounded-lg"
              >
                {isReady ? (
                  <Wifi className="h-4 w-4" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
              </motion.div>
              <h2 className="section-title text-primary text-sm">Connection</h2>
            </div>
            <StatusBadge
              status={connection.status}
              label={statusLabel}
              isReady={isReady}
            />
          </div>

          <AnimatePresence mode="wait">
            {connection.qrDataUrl && (
              <motion.div
                key="qr"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="flex flex-col items-center gap-4 py-2"
              >
                <motion.div
                  whileHover={{ scale: 1.04 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="relative"
                >
                  <div className="bg-orb-2 animate-pulse-soft absolute inset-2 rounded-2xl" />
                  <img
                    src={connection.qrDataUrl}
                    alt="WhatsApp QR code"
                    width={256}
                    height={256}
                    className="qr-frame relative rounded-xl bg-white p-2.5"
                  />
                </motion.div>
                <p className="text-muted max-w-[260px] text-center text-xs leading-relaxed">
                  Open WhatsApp → Linked devices → Link a device → scan this code
                </p>
                <button
                  type="button"
                  onClick={handleCheckConnection}
                  disabled={checkingConnection}
                  className="btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  {checkingConnection ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wifi className="h-3.5 w-3.5" />
                  )}
                  {checkingConnection ? "Checking…" : "Refresh status"}
                </button>
              </motion.div>
            )}

            {isReady && !connection.qrDataUrl && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <div className="alert-success flex items-center gap-2.5 rounded-xl px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">Connected — ready to send.</p>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="segment-idle inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-50 sm:w-auto"
                >
                  {disconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  Disconnect WhatsApp
                </button>
              </motion.div>
            )}

            {!isReady && !connection.qrDataUrl && (
              <motion.div
                key="status"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                {(connection.status === "initializing" ||
                  connection.status === "authenticated") && (
                  <div className="alert-success flex items-center gap-2.5 rounded-xl px-4 py-3">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <p className="text-sm font-medium">
                      {connection.loadingMessage || statusLabel}
                    </p>
                  </div>
                )}

                {(connection.error || isStuck) && (
                  <div className="alert-error rounded-xl px-4 py-3 text-sm">
                    <p className="font-medium">
                      {connection.error ||
                        "WhatsApp is taking too long to start. This often happens after a dev reload or a stale browser session."}
                    </p>
                  </div>
                )}

                {showReset && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleReset(false)}
                      disabled={resetting}
                      className="btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {resetting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Restart connection
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReset(true)}
                      disabled={resetting}
                      className="segment-idle inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Reset & scan QR again
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <Card delay={0.14}>
          <form onSubmit={handleSend} className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="section-title text-primary flex items-center gap-2 text-sm">
                  <Phone className="text-accent h-4 w-4" />
                  Recipients
                </label>
                <ModeToggle mode={numberInputMode} onChange={setNumberInputMode} />
              </div>

              <AnimatePresence mode="wait">
                {numberInputMode === "type" ? (
                  <motion.div
                    key="type"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="space-y-1.5"
                  >
                    <textarea
                      id="numbers"
                      rows={5}
                      value={numbers}
                      onChange={(e) => setNumbers(e.target.value)}
                      placeholder={"+923001234567\n03001234567\n923001234567"}
                      className="field font-mono w-full resize-y rounded-xl px-4 py-3 text-sm"
                    />
                    <p className="text-muted text-xs">
                      One per line · supports 923…, +92…, or 03…
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="upload"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="space-y-2"
                  >
                    <label
                      htmlFor="csv-upload"
                      className="upload-zone flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-dashed px-4 py-8 text-center transition"
                    >
                      <div className="upload-icon flex h-12 w-12 items-center justify-center rounded-xl">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="text-primary block text-sm font-semibold">
                          Attach CSV file
                        </span>
                        <span className="text-muted mt-0.5 block text-xs">
                          One number per row or column
                        </span>
                      </div>
                      <input
                        ref={csvInputRef}
                        id="csv-upload"
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleCsvChange}
                        className="sr-only"
                      />
                    </label>
                    {csvFile && (
                      <div className="result-row flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                        <p className="text-accent flex min-w-0 items-center gap-1.5 text-xs font-medium">
                          <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {csvNumbers.length} loaded from {csvFile.name}
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={removeCsv}
                          className="text-muted hover:text-primary shrink-0 rounded p-1 transition"
                          aria-label={`Remove ${csvFile.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="message"
                className="section-title text-primary flex items-center gap-2 text-sm"
              >
                <MessageSquare className="text-accent h-4 w-4" />
                Message
                <span className="text-muted text-xs font-normal">(optional with files)</span>
              </label>
              <textarea
                id="message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write your message here… (caption on images · separate text with audio)"
                className="field w-full resize-y rounded-xl px-4 py-3 text-sm"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="file-upload"
                className="section-title text-primary flex items-center gap-2 text-sm"
              >
                <Paperclip className="text-accent h-4 w-4" />
                Attachments
                <span className="text-muted text-xs font-normal">(optional)</span>
              </label>
              <label
                htmlFor="file-upload"
                className="upload-zone flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition"
              >
                <div className="upload-icon flex h-10 w-10 items-center justify-center rounded-xl">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-primary block text-sm font-semibold">
                    Attach files
                  </span>
                  <span className="text-muted mt-0.5 block text-xs">
                    Images, videos, audio, PDFs, and documents
                  </span>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                  onChange={handleAttachmentChange}
                  className="sr-only"
                />
              </label>
              <VoiceRecorder onRecorded={handleRecordedAudio} disabled={!isReady} />
              {attachments.length > 0 && (
                <ul className="space-y-1.5">
                  {attachments.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="result-row flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                    >
                      <span className="text-secondary flex min-w-0 items-center gap-1.5 truncate text-xs font-medium">
                        {/\.(m4a|webm|ogg|mp3|wav|aac|opus)$/i.test(file.name) ? (
                          <Mic className="text-accent h-3.5 w-3.5 shrink-0" />
                        ) : null}
                        {file.name}
                        <span className="text-muted shrink-0">
                          ({Math.max(1, Math.round(file.size / 1024))} KB)
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(index)}
                        className="text-muted hover:text-primary shrink-0 rounded p-1 transition"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="alert-error flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium"
                >
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={!canSend || sending}
              className="btn-primary group flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative flex items-center gap-2">
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    {attachments.length > 0 ? "Send messages & files" : "Send messages"}
                  </>
                )}
              </span>
            </button>
          </form>
        </Card>

        <AnimatePresence>
          {results && results.length > 0 && (
            <Card delay={0}>
              <h2 className="section-title text-primary mb-4 flex items-center gap-2 text-sm">
                <CheckCircle2 className="text-accent h-4 w-4" />
                Results
                <span className="result-count ml-auto rounded-full px-2 py-0.5 text-xs font-medium">
                  {results.length}
                </span>
              </h2>
              <ul className="space-y-2">
                {results.map((item, i) => (
                  <motion.li
                    key={item.number}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    whileHover={{ x: 6, transition: { duration: 0.2 } }}
                    transition={{ delay: i * 0.03 }}
                    className="result-row flex cursor-default items-center justify-between gap-3 rounded-xl px-4 py-2.5"
                  >
                    <span className="text-secondary font-mono text-sm font-medium">
                      {item.number}
                    </span>
                    <ResultBadge status={item.status} error={item.error} />
                  </motion.li>
                ))}
              </ul>
            </Card>
          )}
        </AnimatePresence>

        <motion.p
          variants={fadeUp}
          className="text-muted pb-2 text-center text-xs"
        >
          Secure session per browser · whatsapp-web.js
        </motion.p>
      </motion.div>
    </div>
  );
}
