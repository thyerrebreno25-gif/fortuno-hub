import {expect,it} from "vitest";
import {noticeOriginLabel,noticeOriginWhere,validNoticeOrigin} from "./origin";
it("classifies old and newly generated Daily notices independently of their display title",()=>{
 expect(noticeOriginLabel({id:"daily-overdue:action",title:"Changed",body:null})).toBe("Atividades Daily");
 expect(noticeOriginLabel({id:"legacy",title:"Atividade não concluída · Fechamento",body:"Acompanhe em Atividades Daily ou na reunião: /reunioes?meeting=id"})).toBe("Atividades Daily");
 expect(noticeOriginLabel({id:"manual",title:"Atividade não concluída",body:"Nota pessoal"})).toBe("Outros avisos");
});
it("separates disregard authorizations and includes them in the overall task-management origin",()=>{
 expect(noticeOriginLabel({id:"operation-disregard:request",title:"Approval",body:null})).toBe("Desconsideração");
 expect(noticeOriginWhere("disregard")).toEqual({id:{startsWith:"operation-disregard:"}});
 expect(noticeOriginWhere("operations")).toMatchObject({OR:[{id:{startsWith:"operation-"}},{body:{contains:"/operacoes?activity="}}]});
 expect(validNoticeOrigin("forged")).toBe(false);expect(noticeOriginWhere("all")).toEqual({});
});
