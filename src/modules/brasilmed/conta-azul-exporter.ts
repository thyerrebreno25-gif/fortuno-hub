import * as XLSX from "xlsx";
import type { BrasilmedEmployeeRow } from "./types";

export function exportBrasilmedToContaAzul(rows: BrasilmedEmployeeRow[], competence: string, paymentDate: string) {
  const data = rows.map((row) => ({
    Data: paymentDate,
    Descrição: `Folha de pagamento - ${row.name}`,
    Valor: -Math.abs(row.netAmount),
    Fornecedor: row.name,
    Categoria: row.category ?? "Salários e ordenados",
    "Centro de custo": row.costCenter ?? row.section,
    Competência: competence,
    Observação: `${row.role ?? "Colaborador"} | ${row.bankName ?? "Banco não informado"}`,
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Conta Azul");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}
