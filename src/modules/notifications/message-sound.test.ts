import {afterEach,expect,it,vi} from "vitest";
import {freshMessageSound,playMessageBlip,unlockMessageSound} from "./message-sound";
afterEach(()=>vi.unstubAllGlobals());
it("only chooses fresh inbound WhatsApp notifications, not old backlog or payments",()=>{
 const since=Date.parse("2026-11-12T12:00:00Z");
 expect(freshMessageSound([{id:"whatsapp-message-old",createdAt:"2026-11-11T12:00:00Z"},{id:"payment-request-new",createdAt:"2026-11-12T12:10:00Z"}],since)).toBeNull();
 expect(freshMessageSound([{id:"whatsapp-message-new",createdAt:"2026-11-12T12:10:00Z"}],since)).toBe("whatsapp-message-new");
});
it("requires browser audio unlock and plays a short blip once per message",async()=>{
 const tone={frequency:{setValueAtTime:vi.fn()},connect:vi.fn(),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn()},gain={gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};
 const audio={state:"running",currentTime:2,destination:{},createGain:()=>gain,createOscillator:()=>tone};
 vi.stubGlobal("window",{AudioContext:class{constructor(){return audio;}}});vi.stubGlobal("AudioContext",class{constructor(){return audio;}});vi.stubGlobal("navigator",{});vi.stubGlobal("localStorage",{getItem:()=>null,setItem:vi.fn()});
 await playMessageBlip("test","first");expect(tone.start).not.toHaveBeenCalled();
 unlockMessageSound();await playMessageBlip("test","second");await playMessageBlip("test","second");expect(tone.start).toHaveBeenCalledOnce();expect(tone.stop).toHaveBeenCalledWith(2.25);
});
