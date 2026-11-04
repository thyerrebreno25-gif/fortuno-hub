import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMeetingAudio } from "./recording-stream";
function track(kind: string) { return { kind, readyState: "live", stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }; }
function stream(tracks: ReturnType<typeof track>[]) { return { getTracks: () => tracks, getAudioTracks: () => tracks.filter((item) => item.kind === "audio") }; }
afterEach(() => vi.unstubAllGlobals());
describe("meeting audio capture", () => {
  it("mixes tab and microphone, excludes video, releases every source", async () => {
    const video = track("video"), tab = track("audio"), mic = track("audio"), mixed = track("audio");
    const destination = { stream: stream([mixed]) };
    const connect = vi.fn(), disconnect = vi.fn(), close = vi.fn().mockResolvedValue(undefined);
    const source = vi.fn(() => ({ connect, disconnect }));
    vi.stubGlobal("MediaStream", class { constructor(public tracks: unknown[]) {} });
    vi.stubGlobal("AudioContext", class { state = "running"; resume = vi.fn(); close = close; createMediaStreamDestination = () => destination; createMediaStreamSource = source; });
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream([video, tab])), getUserMedia: vi.fn().mockResolvedValue(stream([mic])) } });
    const capture = await captureMeetingAudio(true, vi.fn());
    expect(capture.stream.getTracks()).toEqual([mixed]);
    expect(source).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(2);
    capture.stop(); capture.stop();
    for (const item of [video, tab, mic, mixed]) expect(item.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects sharing without audio and stops the shared video", async () => {
    const video = track("video"), microphone = vi.fn();
    vi.stubGlobal("AudioContext", class {});
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream([video])), getUserMedia: microphone } });
    await expect(captureMeetingAudio(true, vi.fn())).rejects.toThrow("Nenhum áudio");
    expect(video.stop).toHaveBeenCalledOnce(); expect(microphone).not.toHaveBeenCalled();
  });
  it("keeps microphone-only recording available and forwards source ending", async () => {
    const mic = track("audio"), onEnded = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream([mic])) } });
    const capture = await captureMeetingAudio(false, onEnded);
    const listener = mic.addEventListener.mock.calls[0][1]; listener();
    expect(onEnded).toHaveBeenCalledOnce();
    capture.stop(); listener(); expect(onEnded).toHaveBeenCalledOnce();
  });
});
