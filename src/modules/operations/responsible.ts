export function responsibleForProcess(client: { payableResponsibleId: string | null; receivableResponsibleId: string | null; generalResponsibleId: string | null; operationLeaderId: string | null }, process: { name: string; department?: string | null }) {
  const text = `${process.name} ${process.department || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const payable = /pagamento|contas a pagar|\bpagar\b/.test(text), receivable = /recebimento|contas a receber|\breceber\b|cobranca|faturamento/.test(text);
  return (payable !== receivable ? payable ? client.payableResponsibleId : client.receivableResponsibleId : null) || client.generalResponsibleId || client.operationLeaderId || null;
}
