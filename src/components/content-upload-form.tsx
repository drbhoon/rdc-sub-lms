"use client";

import { useId, useRef, useState, useActionState } from "react";
import { uploadContent } from "@/actions/content";

export function ContentUploadForm({ courseId }: { courseId: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const initialState: { message?: string } = {};
  const [state, formAction, pending] = useActionState(uploadContent, initialState);

  function selectFile(file: File | undefined) {
    if (!file || !inputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    setFileName(file.name);
  }

  return <form action={formAction} className="form">
    <input type="hidden" name="courseId" value={courseId} />
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
      <span className="muted">PDF, PowerPoint, or MP4. Click to browse.</span>
      <span className="selected-file">{fileName || "No file selected"}</span>
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        type="file"
        name="file"
        accept=".pdf,.ppt,.pptx,.mp4"
        required
        onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")}
      />
    </label>
    {state.message && <p className="message">{state.message}</p>}
    <button disabled={pending}>{pending ? "Uploading..." : "Upload and queue"}</button>
  </form>;
}
