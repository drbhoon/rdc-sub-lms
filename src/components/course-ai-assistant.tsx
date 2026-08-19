"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { askCourseAi, type CourseAiState } from "@/actions/course-ai";
import { withBase } from "@/lib/base-path";

type VoiceTurn = { question: string; answer: string };
type RealtimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
  input_tokens_details?: { text_tokens?: number; audio_tokens?: number };
  output_tokens_details?: { text_tokens?: number; audio_tokens?: number };
};

function transcriptFromResponse(response: unknown) {
  const payload = response as { output?: Array<{ content?: Array<{ transcript?: string; text?: string }> }> };
  return (payload.output ?? []).flatMap((item) => item.content ?? []).map((content) => content.transcript ?? content.text ?? "").join(" ").trim();
}

export function CourseAiAssistant({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [voiceStatus, setVoiceStatus] = useState("Voice is off.");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);
  const [state, formAction, pending] = useActionState<CourseAiState, FormData>(askCourseAi, {});
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const questionRef = useRef("");
  const answerRef = useRef("");
  const modelRef = useRef("gpt-realtime-2.1-mini");
  const loggedResponses = useRef(new Set<string>());
  const pendingResponseRef = useRef<Record<string, unknown> | null>(null);

  const stopVoice = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    audioRef.current = null;
    questionRef.current = "";
    answerRef.current = "";
    pendingResponseRef.current = null;
    setVoiceActive(false);
    setVoiceStatus("Voice is off.");
  }, []);

  useEffect(() => stopVoice, [stopVoice]);

  async function saveVoiceTurn(response: Record<string, unknown>) {
    const responseId = String(response.id ?? crypto.randomUUID());
    if (loggedResponses.current.has(responseId)) return;
    const question = questionRef.current.trim();
    const answer = (answerRef.current || transcriptFromResponse(response)).trim();
    if (!question || !answer) return false;
    loggedResponses.current.add(responseId);
    const usage = (response.usage ?? {}) as RealtimeUsage;
    const inputDetails = usage.input_token_details ?? usage.input_tokens_details ?? {};
    const outputDetails = usage.output_token_details ?? usage.output_tokens_details ?? {};
    const inputAudioTokens = inputDetails.audio_tokens ?? 0;
    const outputAudioTokens = outputDetails.audio_tokens ?? 0;
    const body = {
      question,
      answer,
      language,
      model: modelRef.current,
      inputTokens: inputDetails.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - inputAudioTokens),
      outputTokens: outputDetails.text_tokens ?? Math.max(0, (usage.output_tokens ?? 0) - outputAudioTokens),
      inputAudioTokens,
      outputAudioTokens,
    };
    setVoiceTurns((turns) => [...turns, { question, answer }]);
    questionRef.current = "";
    answerRef.current = "";
    pendingResponseRef.current = null;
    const saved = await fetch(withBase(`/api/courses/${courseId}/ai-voice/log`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await saved.json().catch(() => null) as { limitReached?: boolean } | null;
    if (result?.limitReached) {
      stopVoice();
      setVoiceStatus("The AI allowance for this course has been reached.");
    }
    return true;
  }

  async function startVoice() {
    stopVoice();
    setVoiceStatus("Requesting microphone access...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      peer.ontrack = (event) => { audio.srcObject = event.streams[0]; };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setVoiceActive(true);
          setVoiceStatus(language === "hi" ? "Listening in Hindi. Speak naturally." : "Listening in English. Speak naturally.");
        } else if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          stopVoice();
        }
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events");
      channel.onmessage = (message) => {
        let event: Record<string, unknown>;
        try { event = JSON.parse(String(message.data)) as Record<string, unknown>; } catch { return; }
        const type = String(event.type ?? "");
        if (type === "conversation.item.input_audio_transcription.completed" || type === "conversation.item.input_audio_transcription.done") {
          questionRef.current = String(event.transcript ?? "").trim();
          if (pendingResponseRef.current) void saveVoiceTurn(pendingResponseRef.current);
        }
        if (type === "response.output_audio_transcript.delta") answerRef.current += String(event.delta ?? "");
        if (type === "response.output_audio_transcript.done") {
          answerRef.current = String(event.transcript ?? answerRef.current).trim();
          if (pendingResponseRef.current) void saveVoiceTurn(pendingResponseRef.current);
        }
        if (type === "response.done" && event.response && typeof event.response === "object") {
          pendingResponseRef.current = event.response as Record<string, unknown>;
          void saveVoiceTurn(pendingResponseRef.current);
        }
        if (type === "error") setVoiceStatus("Voice AI reported an error. Stop and try again.");
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch(withBase(`/api/courses/${courseId}/ai-voice/session?language=${language}`), {
        method: "POST",
        body: offer.sdp,
        headers: { "Content-Type": "application/sdp" },
      });
      if (!response.ok) throw new Error(await response.text());
      modelRef.current = response.headers.get("X-RDC-AI-Model") ?? modelRef.current;
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
      setVoiceStatus("Connecting to OpenAI voice...");
    } catch (error) {
      stopVoice();
      setVoiceStatus(error instanceof Error ? error.message : "Voice could not be started. Check microphone permission and try again.");
    }
  }

  function closeAssistant() {
    stopVoice();
    setOpen(false);
  }

  return <div className="card">
    <h2>AI course assistant</h2>
    {!open ? <button type="button" onClick={() => setOpen(true)}>Ask AI about this course</button> : <div className="form">
      <div className="ai-mode-tabs" role="tablist" aria-label="AI assistant mode">
        <button className={mode === "text" ? "" : "secondary"} type="button" onClick={() => { stopVoice(); setMode("text"); }}>Text</button>
        <button className={mode === "voice" ? "" : "secondary"} type="button" onClick={() => setMode("voice")}>Continuous voice</button>
      </div>

      {mode === "text" ? <form action={formAction} className="form">
        <input type="hidden" name="courseId" value={courseId} />
        <label>Your question<textarea name="question" placeholder="Ask anything related to this course content..." required /></label>
        <button disabled={pending}>{pending ? "Asking..." : "Ask AI"}</button>
        {state.message && <p className="message error">{state.message}</p>}
        {state.answer && <div className="ai-answer"><strong>Answer</strong><p>{state.answer}</p></div>}
      </form> : <div className="form">
        <label>Conversation language
          <select value={language} disabled={voiceActive} onChange={(event) => setLanguage(event.target.value === "hi" ? "hi" : "en")}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
        <div className={`voice-status ${voiceActive ? "voice-live" : ""}`}><span aria-hidden="true" />{voiceStatus}</div>
        <div className="button-row">
          {!voiceActive ? <button type="button" onClick={startVoice}>Start continuous voice</button> : <button className="danger" type="button" onClick={stopVoice}>Stop voice</button>}
        </div>
        <p className="muted">Your microphone audio is sent to OpenAI for this live conversation. Spoken questions and AI answers are transcribed and stored in learner AI history.</p>
        {voiceTurns.length > 0 && <div className="voice-transcript" aria-live="polite">
          <strong>Conversation transcript</strong>
          {voiceTurns.map((turn, index) => <div className="voice-turn" key={`${index}-${turn.question}`}><p><b>You:</b> {turn.question}</p><p><b>AI:</b> {turn.answer}</p></div>)}
        </div>}
      </div>}
      <p className="muted">Answers are limited to the published course material.</p>
      <button className="secondary" type="button" onClick={closeAssistant}>Close assistant</button>
    </div>}
  </div>;
}
