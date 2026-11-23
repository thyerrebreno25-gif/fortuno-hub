"use client";
import {useState} from "react";
import {Alert,Badge,Button,Group,Stack} from "@mantine/core";
export type OperationApprovalNotice={activityId:string;requestId:string;status:string};
export function DisregardNoticeActions({review,canDecide,onChanged}:{review:OperationApprovalNotice;canDecide:boolean;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[resolved,setResolved]=useState("");
 const status=resolved||review.status;
 async function decide(action:"approve"|"reject"){if(busy)return;setBusy(true);setError("");try{const response=await fetch(`/api/operations/activities/${review.activityId}/disregard`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,requestId:review.requestId})});const body=await response.json();if(!response.ok)throw Error(body.error);setResolved(body.status);window.dispatchEvent(new Event("fortuno:notifications-refresh"));onChanged();}catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível registrar a decisão.");}finally{setBusy(false);}}
 return <Stack gap="xs" mt="md">{error&&<Alert color="red">{error}</Alert>}{status!=="PENDING"?<Badge color={status==="APPROVED"?"teal":"orange"}>{status==="APPROVED"?"Aprovada · tarefa desconsiderada":status==="CANCELLED"?"Atividade excluída · solicitação encerrada":"Recusada · tarefa reaberta"}</Badge>:canDecide?<Group><Button color="teal" loading={busy} onClick={()=>void decide("approve")}>Sim, aceitar justificativa</Button><Button color="red" variant="light" disabled={busy} onClick={()=>void decide("reject")}>Não, devolver como aberta</Button></Group>:<Alert color="yellow">Aguardando análise do gestor.</Alert>}</Stack>;
}
