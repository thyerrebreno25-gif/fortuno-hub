import "server-only";
import { apiItems, contaAzulOptions, normalizeContaAzulLabel } from "./financial-export";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
export async function resolveAcquirerContact(clientId: string, direction: "PAYABLE" | "RECEIVABLE", name?: string | null, knownId?: string | null) {
    const label = name?.trim();
    if (!label || /^(adquirente|movimentacoes de adquirentes|lancamento automatico(?: receitas| financeiro)?)$/.test(normalizeContaAzulLabel(label)))
        throw Error("Identifique a adquirente antes de enviar os lançamentos.");
    // Public corporate identity: https://www.cielo.com.br/ (legal footer).
    const document = normalizeContaAzulLabel(label) === "cielo" ? "01027058000191" : null;
    if (knownId) {
        const body = await contaAzulRequest<Record<string, unknown>>(clientId, "/v1/pessoas/" + knownId);
        const person = apiItems(body)[0] || body;
        const actualName = normalizeContaAzulLabel(String(person.nome || ""));
        const requestedName = normalizeContaAzulLabel(label);
        const profiles = Array.isArray(person.perfis) ? person.perfis.map(item => normalizeContaAzulLabel(typeof item === "string" ? item : String((item as Record<string, unknown>)?.tipo_perfil || ""))) : [];
        if (person.ativo !== false && actualName === requestedName && profiles.includes(direction === "PAYABLE" ? "fornecedor" : "cliente"))
            return { value: knownId, label: String(person.nome) };
    }
    const candidates = new Map<string, Record<string, unknown>>();
    for (const profile of ["Fornecedor", "Cliente", "Transportadora"]) {
        for (const personType of ["Jurídica", "Física"]) {
            for (const search of document ? ["document", "name"] : ["name"]) {
                const params = new URLSearchParams({ pagina: "1", tamanho_pagina: "1000", busca: label, tipo_perfil: profile, tipos_pessoa: personType, com_endereco: "false" });
                if (document && search === "document") {
                    params.delete("busca");
                    params.set("documentos", document);
                }
                const body = await contaAzulRequest<unknown>(clientId, "/v1/pessoas?" + params);
                const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
                const list = Array.isArray(body) ? body : [root.items, root.itens].find(Array.isArray);
                if (!list && root.totalItems !== 0)
                    throw Error("Não foi possível confirmar a busca da adquirente no CA. Nenhum fornecedor foi criado.");
                const rows = apiItems(body);
                if (rows.length >= 1000 || typeof root.totalItems === "number" && root.totalItems > rows.length)
                    throw Error("A busca da adquirente ficou incompleta. Nenhum fornecedor foi criado.");
                for (const row of rows) {
                    const rowDocument = String(row.documento || row.cnpj || "").replace(/\D/g, "");
                    const sameName = normalizeContaAzulLabel(String(row.nome || "")) === normalizeContaAzulLabel(label);
                    if (document && sameName && rowDocument && rowDocument !== document)
                        throw Error("O cadastro Cielo localizado possui outro CNPJ. Confira o cadastro no CA antes de enviar.");
                    if (typeof row.id === "string" && (document ? rowDocument === document || sameName && !rowDocument : normalizeContaAzulLabel(String(row.nome || "")) === normalizeContaAzulLabel(label)))
                        candidates.set(row.id, row);
                }
            }
        }
    }
    const exact = document ? [] : [...candidates.entries()].filter(([, row]) => normalizeContaAzulLabel(String(row.nome || "")) === normalizeContaAzulLabel(label));
    if (exact.length) {
        candidates.clear();
        for (const [id, row] of exact)
            candidates.set(id, row);
    }
    if (candidates.size > 1)
        throw Error("Há mais de um cadastro da adquirente com o mesmo nome no CA. Revise os cadastros para evitar duplicidade.");
    if (candidates.size) {
        const row = [...candidates.values()][0];
        const body = await contaAzulRequest<Record<string, unknown>>(clientId, "/v1/pessoas/" + row.id);
        const person = apiItems(body)[0] || body;
        if (person.ativo === false)
            throw Error("O cadastro da adquirente está inativo no CA. Ative o cadastro antes de enviar.");
        const profile = direction === "PAYABLE" ? "Fornecedor" : "Cliente";
        const profiles = Array.isArray(person.perfis) ? person.perfis.map(item => normalizeContaAzulLabel(typeof item === "string" ? item : String((item as Record<string, unknown>)?.tipo_perfil || ""))) : [];
        if (!profiles.includes(normalizeContaAzulLabel(profile)))
            throw Error(`A adquirente já está cadastrada no CA. Habilite o perfil ${profile} nesse cadastro para enviar sem duplicá-lo.`);
        return { value: String(row.id), label: String(person.nome || row.nome || label) };
    }
    const created = await contaAzulRequest<unknown>(clientId, "/v1/pessoas", { method: "POST", body: JSON.stringify({ ativo: true, nome: label, tipo_pessoa: "Jurídica", ...(document ? { cnpj: document } : {}), perfis: document ? [{ tipo_perfil: "Fornecedor" }, { tipo_perfil: "Cliente" }] : [{ tipo_perfil: direction === "PAYABLE" ? "Fornecedor" : "Cliente" }], observacao: "Adquirente vinculada pelo Fortuno Hub para receitas e despesas de cartões." }) });
    const createdId = apiItems(created)[0]?.id;
    const option = contaAzulOptions(created)[0] || (typeof createdId === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(createdId) ? { value: createdId, label } : null);
    if (!option)
        throw Error("O CA não confirmou o cadastro da adquirente. Confira no CA antes de tentar novamente.");
    return option;
}
