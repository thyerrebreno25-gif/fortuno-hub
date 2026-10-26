"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, FileInput, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { createClient } from "@/lib/supabase/client";
import { jsonRequest, meetingRequest } from "./client";
import { audioTypes, recordingLimit } from "./model";

export function RecordingCapture({ meetingId, configured, onSaved }: { meetingId: string; configured: boolean; onSaved: () => void }) {
  const [consent, setConsent] = useState(false), [recording, setRecording] = useState(false), [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null), [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const [downloadUrl, setDownloadUrl] = useState("");
  const localUrl = useRef("");
  function chooseFile(next: File | null) {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = next ? URL.createObjectURL(next) : "";
    setDownloadUrl(localUrl.current); setFile(next); setError("");
  }
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); stream.current?.getTracks().forEach((track) => track.stop()); if (timer.current) clearTimeout(timer.current); if (localUrl.current) URL.revokeObjectURL(localUrl.current); };
  }, []);
  useEffect(() => {
    if (!file && !recording) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [file, recording]);
  async function start() {
    if (file && !window.confirm("Há um áudio ainda não enviado. Baixe-o antes de substituir. Continuar?")) return;
    setError(""); setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Este navegador não permite gravação. Anexe um áudio já gravado.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48000 });
      const chunks: Blob[] = []; let size = 0;
      next.ondataavailable = (event) => { if (!event.data.size) return; chunks.push(event.data); size += event.data.size; if (size > recordingLimit - 1024 * 1024 && next.state === "recording") next.stop(); };
      next.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (timer.current) clearTimeout(timer.current);
        if (!active.current) return;
        const type = next.mimeType.split(";")[0] || "audio/webm";
        chooseFile(new File(chunks, `reuniao-${new Date().toISOString().slice(0, 10)}.${audioTypes[type] || "webm"}`, { type }));
        setRecording(false);
      };
      next.onerror = () => { if (next.state !== "inactive") next.stop(); if (active.current) setError("A gravação foi interrompida. Confira o áudio antes de enviar."); };
      recorder.current = next; chooseFile(null); next.start(10000); setRecording(true);
      timer.current = setTimeout(() => { if (next.state === "recording") next.stop(); }, 60 * 60_000);
    } catch (error) { stream.current?.getTracks().forEach((track) => track.stop()); setError(error instanceof Error ? error.message : "Não foi possível acessar o microfone."); }
    finally { if (active.current) setBusy(false); }
  }
  async function upload() {
    if (!file || !consent) return;
    setBusy(true); setError("");
    try {
      const mimeType = file.type.split(";")[0] || ({ mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm", ogg: "audio/ogg", flac: "audio/flac" } as Record<string, string>)[file.name.split(".").at(-1) || ""];
      if (!audioTypes[mimeType] || file.size > recordingLimit) throw new Error("Envie um áudio compatível com até 24 MB. Para gravações maiores, divida o arquivo.");
      const init = await meetingRequest<{ id: string; path: string; token: string }>("/api/meetings/recordings", jsonRequest("POST", { meetingId, name: file.name, mimeType, size: file.size, consent }));
      const { error } = await createClient().storage.from("meeting-recordings").uploadToSignedUrl(init.path, init.token, file, { contentType: mimeType });
      if (error) throw new Error("Não foi possível enviar o áudio. Seu arquivo local foi preservado para nova tentativa.");
      await meetingRequest("/api/meetings/recordings", jsonRequest("PATCH", { id: init.id }));
      chooseFile(null); onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Falha no envio."); }
    finally { setBusy(false); }
  }
  return <Paper withBorder radius="lg" p="md"><Stack gap="sm">
    <Title order={4}>Gravar ou anexar áudio</Title>
    <Text size="sm" c="dimmed">A gravação captura o microfone deste computador. Não captura automaticamente as vozes de uma chamada no Meet. Limite: 60 minutos por gravação e 24 MB por arquivo.</Text>
    <Checkbox label="Os participantes estão cientes e autorizaram a gravação e a transcrição." checked={consent} disabled={recording || busy} onChange={(event) => setConsent(event.currentTarget.checked)} />
    {!configured && <Alert color="orange">O armazenamento de gravações ainda precisa ser configurado.</Alert>}
    {error && <Alert color="red">{error}</Alert>}
    <Group><Button color={recording ? "red" : "blue"} disabled={!consent || busy || !configured} onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? "Parar gravação" : "Gravar microfone"}</Button>{recording && <Text c="red" size="sm">● Gravando — mantenha esta tela aberta</Text>}</Group>
    <FileInput label="Ou anexe um áudio" accept="audio/*,.webm,.m4a,.flac" value={file} clearable disabled={recording || busy || !configured} onChange={chooseFile} />
    {file && <><Text size="xs">{(file.size / 1024 / 1024).toFixed(1)} MB · Ainda não enviado</Text><audio controls src={downloadUrl} /><Group><Button loading={busy} disabled={!consent || recording} onClick={() => void upload()}>Salvar áudio e transcrever</Button><a href={downloadUrl} download={file.name}>Baixar cópia local</a></Group></>}
  </Stack></Paper>;
}
