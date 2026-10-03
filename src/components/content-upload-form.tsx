"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withBase } from "@/lib/base-path";
import { UPLOAD_CHUNK_BYTES } from "@/lib/upload-chunks";

const RETRIES_PER_PIECE = 4;

type Reply = { message?: string; received?: number };

async function post(url: string, body: BodyInit, contentType: string): Promise<{ status: number; reply: Reply }> {
  const response = await fetch(url, { method: "POST", body, headers: { "Content-Type": contentType } });
  const reply = await response.json().catch(() => ({ message: `The server answered ${response.status}.` })) as Reply;
  return { status: response.status, reply };
}

/**
 * Upload course content in pieces (lib/upload-chunks.ts explains why), with
 * progress. A piece that fails is retried, and after a dropped connection the
 * upload resumes from what the server already holds rather than starting over.
 */
export function ContentUploadForm({ courseId, maxMb }: { courseId: string; maxMb: number }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  function selectFile(file: File | undefined) {
    if (!file || !inputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    setFileName(file.name);
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) { setMessage("Select a content file."); return; }
    // Said before the first piece goes up, not after 150 MB have been sent.
    if (file.size > maxMb * 1024 * 1024) { setMessage(`That file is ${(file.size / 1048576).toFixed(0)} MB. Files must be under ${maxMb} MB.`); return; }
    const uploadId = crypto.randomUUID();
    const base = withBase(`/api/courses/${courseId}/content-upload?uploadId=${uploadId}`);
    setMessage("");
    setProgress(0);
    try {
      let offset = 0;
      let failures = 0;
      while (offset < file.size) {
        const piece = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
        let result: { status: number; reply: Reply };
        try {
          result = await post(`${base}&offset=${offset}`, piece, "application/octet-stream");
        } catch {
          result = { status: 0, reply: { message: "The connection dropped." } };
        }
        if (result.status === 200) {
          offset = result.reply.received ?? offset + piece.size;
          failures = 0;
        } else if (result.status === 409 && typeof result.reply.received === "number") {
          offset = result.reply.received; // resume from what the server already has
        } else if ((result.status === 0 || result.status >= 500) && failures < RETRIES_PER_PIECE) {
          failures += 1;
          await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
        } else {
          throw new Error(result.reply.message ?? "Upload failed.");
        }
        setProgress(Math.round(offset / file.size * 100));
      }
      const done = await post(`${base}&complete=1`, JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }), "application/json");
      if (done.status !== 200) throw new Error(done.reply.message ?? "Upload failed.");
      setMessage(done.reply.message ?? "Upload queued for processing.");
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  const uploading = progress !== null;
  return <form onSubmit={upload} className="form">
    <label
      htmlFor={inputId}
      className={`dropzone ${dragging ? "dropzone-active" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        selectFile(event.dataTransfer.files[0]);
      }}
    >
      <span className="dropzone-title">Drag and drop course content here</span>
      <span className="muted">PDF, PowerPoint, or MP4, up to {maxMb} MB. Click to browse.</span>
      <span className="selected-file">{fileName || "No file selected"}</span>
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        type="file"
        name="file"
        accept=".pdf,.ppt,.pptx,.mp4"
        required
        disabled={uploading}
        onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")}
      />
    </label>
    {uploading && <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
    {message && <p className="message">{message}</p>}
    <button disabled={uploading}>{uploading ? `Uploading… ${progress}%` : "Upload and queue"}</button>
  </form>;
}
