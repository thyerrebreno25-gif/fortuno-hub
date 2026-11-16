export type CompletionFinding={id:string;status:string;ruleCode:string|null};
export function completionBlocker(findings:CompletionFinding[],checklist:Array<{id:string;mandatory:boolean;status:string}>){
 if(findings.some(item=>!["VALIDATED","DISMISSED"].includes(item.status)))return "Resolva e valide todos os apontamentos antes de finalizar.";
 if(checklist.some(item=>item.mandatory&&item.status==="PENDING"))return "Revise todos os itens obrigatórios do checklist.";
 if(checklist.some(item=>item.status==="NON_COMPLIANT"&&!findings.some(finding=>finding.ruleCode===`CHECKLIST:${item.id}`&&["VALIDATED","DISMISSED"].includes(finding.status))))return "Uma não conformidade do checklist ainda não possui correção validada.";
 return null;
}
export type AuditCompletionReport={version:1;auditId:string;client:string;periodStart:string|null;periodEnd:string|null;completedAt:string;completedBy:string;note:string;source:string;history:string;criteria:string;limitations:string[];findings:Array<{title:string;description:string;status:string;subject:string|null;category:string|null;amount:string|null;operator:string;supervisorNote:string|null;evidence:Array<{label:string;value:string}>;history:Array<{action:string;actor:string;date:string;note:string|null}>}>;checklist:Array<{title:string;category:string;status:string;note:string|null;reviewedBy:string;reviewedAt:string|null}>};
