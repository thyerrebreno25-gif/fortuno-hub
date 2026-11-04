import {openAIRequestError} from "@/modules/assistant/openai-errors";
export async function meetingAIError(response:Response){
 const body=await response.json().catch(()=>({})) as {error?:{code?:unknown;type?:unknown;message?:unknown}};
 const error=openAIRequestError(response.status,body.error,response.headers);
 error.message=error.message.replace(" O botão Aprender categorias continua disponível sem depender da inteligência.","").replace("A assistente atingiu","O processamento da reunião atingiu");
 if(error.details.code)error.message+=" Código: "+error.details.code+".";
 return error;
}
