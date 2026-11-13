import {afterEach,beforeEach,expect,it,vi} from "vitest";
import { reviewWhatsAppDraft,sameDraftFacts } from "./draft-review";
const mock=vi.fn();
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("OPENAI_API_KEY","unit-key");vi.stubGlobal("fetch",mock);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("preserves numeric facts, links, email addresses and WhatsApp mentions",()=>{expect(sameDraftFacts("@123 pagar R$ 50,00 dia 15/11","@123, pagar R$ 50,00, dia 15/11.")).toBe(true);expect(sameDraftFacts("PIX a@b.com R$ 50,00","PIX c@b.com R$ 55,00")).toBe(false);});
it("reviews only the draft, without tools, history, storage or automatic sending",async()=>{mock.mockResolvedValue(Response.json({output_text:JSON.stringify({corrected:"Olá, tudo bem?",suggestions:["Olá! Tudo bem?"]})}));expect(await reviewWhatsAppDraft("ola tudo bem")).toEqual({corrected:"Olá, tudo bem?",suggestions:["Olá! Tudo bem?"]});const body=JSON.parse(mock.mock.calls[0][1].body);expect(body.store).toBe(false);expect(body.tools).toBeUndefined();expect(body.previous_response_id).toBeUndefined();expect(body.text.format.strict).toBe(true);});
it("rejects numeric changes and discards suggestions with fabricated financial facts",async()=>{mock.mockResolvedValueOnce(Response.json({output_text:JSON.stringify({corrected:"Pagar 500.",suggestions:[]})}));await expect(reviewWhatsAppDraft("pagar 50")).rejects.toThrow("alterou");mock.mockResolvedValueOnce(Response.json({output_text:JSON.stringify({corrected:"Pagar 50.",suggestions:["Pagar 100."]})}));expect((await reviewWhatsAppDraft("pagar 50")).suggestions).toEqual([]);});
it("reports unavailable credit/configuration without modifying or sending the draft",async()=>{mock.mockResolvedValue(new Response("private provider body",{status:429}));await expect(reviewWhatsAppDraft("olá")).rejects.toThrow("saldo");vi.stubEnv("OPENAI_API_KEY","");await expect(reviewWhatsAppDraft("olá")).rejects.toThrow("configuração");});
it("distinguishes financial quota from temporary processing limits",async()=>{
 mock.mockResolvedValueOnce(Response.json({error:{code:"insufficient_quota",message:"private"}},{status:429}));await expect(reviewWhatsAppDraft("olá")).rejects.toThrow("cota financeira");
 mock.mockResolvedValueOnce(Response.json({error:{code:"rate_limit_exceeded"}},{status:429}));await expect(reviewWhatsAppDraft("olá")).rejects.toThrow("temporário");
});
