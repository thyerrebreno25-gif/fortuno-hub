import {afterEach,beforeEach,expect,it,vi} from "vitest";
import { reviewWhatsAppDraft } from "./draft-review";
const network=vi.fn(()=>{throw Error("Local review must never use a network");});
beforeEach(()=>{network.mockClear();vi.stubGlobal("fetch",network);vi.stubEnv("OPENAI_API_KEY","");});
afterEach(()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("reviews greetings, accents and punctuation locally without an API key",()=>{
 expect(reviewWhatsAppDraft("ola tudo bem podemos conversar amanha").corrected).toBe("Olá, tudo bem? Podemos conversar amanhã?");
 expect(reviewWhatsAppDraft("vc pode enviar as informacoes amanha").corrected).toBe("Você pode enviar as informações amanhã?");
 expect(reviewWhatsAppDraft("ola tudo bem").corrected).toBe("Olá, tudo bem?");
});
it("cleans spaces, abbreviations and high-confidence agreement errors",()=>{
 expect(reviewWhatsAppDraft("segue em anexo os comprovantes ,confirme pfv").corrected).toBe("Seguem em anexo os comprovantes, confirme por favor");
 expect(reviewWhatsAppDraft("recebi  a mesnagem;obrigado!").corrected).toBe("Recebi a mensagem; obrigado!");
});
it("does not change financial amounts, dates, PIX keys, links, email addresses or mentions",()=>{
 const values=["R$ 1.234,56","15/11/2026","09:30","+55 61 99999-6882","https://exemplo.com/amanha?valor=50,00","financeiro@voce.com.br","@5511999999999","30.731.785/0001-33","abc123-Nao","f47ac10b-58cc-4372-a567-0e02b2c3d479"];
 const source="ola, conferir "+values.join(" • ");
 const result=reviewWhatsAppDraft(source);
 for(const value of values){expect(result.corrected).toContain(value);result.suggestions.forEach(item=>expect(item).toContain(value));}
});
it("never appends punctuation to the end of a protected URL, email or identifier",()=>{
 for(const value of ["https://site.com/teste","contato@site.com","@55119999","12345"]){expect(reviewWhatsAppDraft("voce pode conferir "+value).corrected).toBe("Você pode conferir "+value);}
});
it("keeps names, acronyms, intentional uppercase text, code blocks and ambiguous words",()=>{
 const source="FORTUNO Ana João MES VOCE esta e por PIX\n```nao  ola amanha```\n`vc nao`";
 expect(reviewWhatsAppDraft(source).corrected).toBe(source);
});
it("keeps multi-line lists and protected code indentation",()=>{
 expect(reviewWhatsAppDraft("ola\n- confirmar amanha\n- enviar informacoes").corrected).toBe("Olá\n- confirmar amanhã\n- enviar informações");
});
it("offers optional polite wording without adding dates, commitments or financial facts",()=>{
 expect(reviewWhatsAppDraft("envie o comprovante de R$ 50,00").suggestions).toContain("Por favor, envie o comprovante de R$ 50,00");
 expect(reviewWhatsAppDraft("ola tudo bem").suggestions).toContain("Olá! Tudo bem?");
 expect(reviewWhatsAppDraft("envie por favor o comprovante").suggestions).toEqual([]);
});
it("bounds pasted text and does not interpret placeholder-looking input",()=>{
 const long="nao ".repeat(1300);expect(reviewWhatsAppDraft(long)).toEqual({corrected:long,suggestions:[]});
 const sentinels="nao \uE0000\uE001";expect(reviewWhatsAppDraft(sentinels)).toEqual({corrected:sentinels,suggestions:[]});
});

it("does not expand a message past the composer limit or rewrite labeled payment identifiers",()=>{
 const long="vc ".repeat(1600);const result=reviewWhatsAppDraft(long);expect(result.corrected.length).toBeLessThanOrEqual(5000);expect(result.suggestions.every(item=>item.length<=5000)).toBe(true);
 expect(reviewWhatsAppDraft("ola, PIX: nao").corrected).toBe("Olá, PIX: nao");
});
