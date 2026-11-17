import {readMailboxResponse} from "./mailbox-response";
export type ArchiveDeletionProgress = {deleted: number; remaining: number};
type Batch = {count:number; remaining:number; cutoff:string};
export class ArchiveDeletionError extends Error {
  constructor(message:string, readonly confirmedDeleted:number) { super(message); }
}
export async function deleteArchivedMailbox(options: {
  confirmation:string;
  request?:typeof fetch;
  onProgress?:(progress:ArchiveDeletionProgress)=>void;
}) {
  const request=options.request??fetch;
  let cutoff:string|undefined,deleted=0;
  try {
    for(let batch=0;batch<1000;batch++) {
      const response=await request("/api/atendimento/archive",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmation:options.confirmation,...(cutoff?{cutoff}:{})})});
      const result=await readMailboxResponse<Batch>(response,"Não foi possível excluir os arquivados.");
      if(!Number.isInteger(result.count)||result.count<0||result.count>50||!Number.isInteger(result.remaining)||result.remaining<0||typeof result.cutoff!=="string"||!Number.isFinite(Date.parse(result.cutoff))||cutoff&&cutoff!==result.cutoff)throw new Error("O servidor não confirmou o progresso da exclusão. Atualize a caixa antes de continuar.");
      cutoff=result.cutoff;deleted+=result.count;
      options.onProgress?.({deleted,remaining:result.remaining});
      if(result.remaining===0)return {deleted};
      if(result.count===0)throw new Error("A caixa foi alterada durante a exclusão. Atualize para conferir os arquivados restantes.");
    }
    throw new Error("O limite desta execução foi atingido. Atualize a caixa e continue pelos arquivados restantes.");
  } catch(error) {
    throw new ArchiveDeletionError(error instanceof Error?error.message:"Não foi possível confirmar a exclusão. Atualize a caixa antes de continuar.",deleted);
  }
}
