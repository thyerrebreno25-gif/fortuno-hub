export type MeetingCapture = { stream: MediaStream; stop: () => void };

/** Mix only audio; the browser's shared video is never recorded or uploaded. */
export async function captureMeetingAudio(withTab: boolean, onEnded: () => void): Promise<MeetingCapture> {
  const sources: MediaStream[] = [];
  const nodes: MediaStreamAudioSourceNode[] = [];
  let context: AudioContext | undefined;
  let output: MediaStream | undefined;
  let stopped = false;
  const ended = () => { if (!stopped) onEnded(); };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const source of sources) for (const track of source.getTracks()) { track.removeEventListener("ended", ended); track.stop(); }
    for (const node of nodes) node.disconnect();
    output?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  };
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("O navegador não permite acessar o microfone.");
    if (withTab) {
      if (!navigator.mediaDevices.getDisplayMedia || typeof AudioContext === "undefined") throw new Error("Para gravar a reunião, abra o Hub no Chrome ou Edge e use a reunião em outra aba.");
      const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      sources.push(shared);
      if (!shared.getAudioTracks().length) throw new Error("Nenhum áudio foi compartilhado. Selecione a aba da reunião e marque Compartilhar áudio da aba.");
      context = new AudioContext();
      await context.resume();
    }
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    sources.push(microphone);
    if (sources.some((source) => source.getTracks().some((track) => track.readyState === "ended"))) throw new Error("O compartilhamento foi interrompido. Inicie a gravação novamente.");
    if (context) {
      const destination = context.createMediaStreamDestination();
      output = destination.stream;
      for (const source of sources) {
        const node = context.createMediaStreamSource(new MediaStream(source.getAudioTracks()));
        node.connect(destination);
        nodes.push(node);
      }
    } else output = microphone;
    for (const source of sources) for (const track of source.getTracks()) track.addEventListener("ended", ended);
    return { stream: output, stop };
  } catch (error) { stop(); throw error; }
}
