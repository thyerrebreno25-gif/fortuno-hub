import "server-only";
import { apiItems, contaAzulOptions, normalizeContaAzulLabel } from "./financial-export";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
const profileNames:Record<string,string>={cliente:"Cliente",fornecedor:"Fornecedor",transportadora:"Transportadora"};
// Public identities verified in the providers' own legal notices. Do not infer a
// corporate document from an arbitrary name, account or the importing client's CNPJ.
const corporateDocuments: Record<string, string> = {
    cielo: "01027058000191", // https://www.cielo.com.br/
    "cielo sa": "01027058000191",
    "cielo s a": "01027058000191",
    rede: "01425787000104", // https://developer.userede.com.br/
    redecard: "01425787000104",
    "redecard sa": "01425787000104",
    "redecard s a": "01425787000104",
    "redecard instituicao de pagamento sa": "01425787000104",
    "redecard instituicao de pagamento s a": "01425787000104",
};
function personDocument(person: Record<string, unknown>) {
    return String(person.documento || person.cnpj || person.cpf || "").replace(/[^a-z\d]/gi, "").toUpperCase();
}
function sameCorporateIdentity(actual: string, expected: string) {
    // Keep an existing branch document; never replace it with the matrix CNPJ.
    return /^[A-Z\d]{12}\d{2}$/.test(actual) && actual.slice(0, 8) === expected.slice(0, 8);
}
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
function updateCanBeRetried(error: unknown) {
    const details = error && typeof error === "object" ? error as { status?: number; transient?: boolean; name?: string } : {};
    // A 429 needs the provider's Retry-After window, not a short mutation retry.
    if (details.status === 429) return false;
    return details.transient || details.status !== undefined && ([408, 425].includes(details.status) || details.status >= 500)
        || error instanceof TypeError || details.name === "AbortError" || details.name === "TimeoutError";
}
function personProfiles(person:Record<string,unknown>){
    if(!Array.isArray(person.perfis))throw Error("O CA não retornou os perfis do cadastro existente. Nenhum cadastro foi alterado.");
    return person.perfis.map(item=>{const key=normalizeContaAzulLabel(typeof item==="string"?item:String((item as Record<string,unknown>)?.tipo_perfil||""));if(!profileNames[key])throw Error("O cadastro possui um perfil não reconhecido. Confira os perfis no CA.");return profileNames[key];});
}
function profileUpdate(person: Record<string, unknown>, profiles: string[], required: string, verifiedDocument: string | null) {
    const currentDocument = personDocument(person);
    if (verifiedDocument && currentDocument && !sameCorporateIdentity(currentDocument, verifiedDocument)) {
        throw Error("O cadastro da adquirente possui outro CPF/CNPJ. Confira o cadastro no CA antes de enviar.");
    }
    const document = currentDocument || verifiedDocument;
    // Conta Azul can reject a second profile when the person lacks a document.
    // Supply only a verified identity, keeping all other registration fields intact.
    if (!document) throw Error("O cadastro da adquirente precisa de CPF/CNPJ para reunir os perfis Cliente e Fornecedor. Preencha o documento no mesmo cadastro do CA; nenhum cadastro foi duplicado.");
    const kind = normalizeContaAzulLabel(String(person.tipo_pessoa || ""));
    const cnpj = /^[A-Z\d]{12}\d{2}$/.test(document);
    const cpf = /^\d{11}$/.test(document);
    if ((!cnpj && !cpf) || kind && !["juridica", "legal", "fisica", "natural"].includes(kind)
        || cnpj && ["fisica", "natural"].includes(kind) || cpf && ["juridica", "legal"].includes(kind)) {
        throw Error("Confira o tipo de pessoa e o CPF/CNPJ da adquirente no CA. Nenhum outro dado cadastral foi alterado.");
    }
    return {
        ...(cnpj ? { cnpj: document, tipo_pessoa: "Jurídica" } : { cpf: document, tipo_pessoa: "Física" }),
        perfis: [...new Set([...profiles, required])].map(tipo_perfil => ({ tipo_perfil })),
    };
}
async function ensureProfile(clientId:string,id:string,person:Record<string,unknown>,direction:"PAYABLE"|"RECEIVABLE",verifiedDocument:string|null){
    if(person.ativo===false)throw Error("O cadastro da adquirente está inativo no CA. Ative o cadastro antes de enviar.");
    if(verifiedDocument && personDocument(person) && !sameCorporateIdentity(personDocument(person), verifiedDocument))throw Error("O cadastro da adquirente possui outro CPF/CNPJ. Confira o cadastro no CA antes de enviar.");
    const required=direction==="PAYABLE"?"Fornecedor":"Cliente",profiles=personProfiles(person);
    if(profiles.includes(required))return;
    const path = "/v1/pessoas/" + encodeURIComponent(id);
    let current = person;
    for (let attempt = 0; attempt < 3; attempt++) {
        const payload = profileUpdate(current, personProfiles(current), required, verifiedDocument);
        let failure: unknown;
        try { await contaAzulRequest(clientId, path, { method: "PATCH", body: JSON.stringify(payload) }); }
        catch (error) { failure = error; }
        // A timeout/500 can happen after the change was saved. Always read the
        // same person before retrying; never POST a second supplier as a fallback.
        for (let readAttempt = 0; readAttempt < 3; readAttempt++) {
            if (readAttempt) await wait(400 * readAttempt);
            const response = await contaAzulRequest<Record<string, unknown>>(clientId, path);
            current = apiItems(response)[0] || response;
            const actual = personProfiles(current);
            if (current.ativo === false || profiles.some(profile => !actual.includes(profile))) {
                throw Error("O cadastro da adquirente mudou durante a validação. Confira os perfis no CA; nenhum novo cadastro foi criado.");
            }
            const confirmedDocument = personDocument(current);
            const sentDocument = "cnpj" in payload ? payload.cnpj : payload.cpf;
            if (confirmedDocument && confirmedDocument !== sentDocument) {
                throw Error("O CPF/CNPJ da adquirente mudou durante a validação. Confira o cadastro no CA antes de reenviar.");
            }
            if (actual.includes(required) && confirmedDocument === sentDocument) return;
        }
        if (!failure || !updateCanBeRetried(failure) || attempt === 2) {
            const detail = failure instanceof Error ? ` ${failure.message}` : "";
            throw Error(`O CA não confirmou o perfil ${required} da adquirente.${detail} O mesmo cadastro foi preservado; nenhum lançamento financeiro foi iniciado nesta tentativa.`);
        }
        await wait(600 * (attempt + 1));
    }
}
export async function resolveAcquirerContact(clientId: string, direction: "PAYABLE" | "RECEIVABLE", name?: string | null, knownId?: string | null) {
    const label = name?.trim();
    if (!label || /^(adquirente|movimentacoes de adquirentes|lancamento automatico(?: receitas| financeiro)?)$/.test(normalizeContaAzulLabel(label)))
        throw Error("Identifique a adquirente antes de enviar os lançamentos.");
    const document = corporateDocuments[normalizeContaAzulLabel(label)] || null;
    if (knownId) {
        const body = await contaAzulRequest<Record<string, unknown>>(clientId, "/v1/pessoas/" + encodeURIComponent(knownId));
        const person = apiItems(body)[0] || body;
        const actualName = normalizeContaAzulLabel(String(person.nome || ""));
        const requestedName = normalizeContaAzulLabel(label);
        const actualDocument=personDocument(person);
        if(document&&actualDocument&&!sameCorporateIdentity(actualDocument,document)&&actualName===requestedName)throw Error("O cadastro da adquirente localizado possui outro CNPJ. Confira o cadastro no CA antes de enviar.");
        if (actualName === requestedName || document && sameCorporateIdentity(actualDocument,document)){await ensureProfile(clientId,knownId,person,direction,document);return { value: knownId, label: String(person.nome || label) };}
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
                    const rowDocument = personDocument(row);
                    const sameName = normalizeContaAzulLabel(String(row.nome || "")) === normalizeContaAzulLabel(label);
                    if (document && sameName && rowDocument && !sameCorporateIdentity(rowDocument, document))
                        throw Error("O cadastro da adquirente localizado possui outro CNPJ. Confira o cadastro no CA antes de enviar.");
                    if (typeof row.id === "string" && (document ? sameCorporateIdentity(rowDocument,document) || sameName && !rowDocument : normalizeContaAzulLabel(String(row.nome || "")) === normalizeContaAzulLabel(label)))
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
        const body = await contaAzulRequest<Record<string, unknown>>(clientId, "/v1/pessoas/" + encodeURIComponent(String(row.id)));
        const person = apiItems(body)[0] || body;
        if (person.ativo === false)
            throw Error("O cadastro da adquirente está inativo no CA. Ative o cadastro antes de enviar.");
        await ensureProfile(clientId,String(row.id),person,direction,document);
        return { value: String(row.id), label: String(person.nome || row.nome || label) };
    }
    const created = await contaAzulRequest<unknown>(clientId, "/v1/pessoas", { method: "POST", body: JSON.stringify({ ativo: true, nome: label, tipo_pessoa: "Jurídica", ...(document ? { cnpj: document } : {}), perfis: document ? [{ tipo_perfil: "Fornecedor" }, { tipo_perfil: "Cliente" }] : [{ tipo_perfil: direction === "PAYABLE" ? "Fornecedor" : "Cliente" }], observacao: "Adquirente vinculada pelo Fortuno Hub para receitas e despesas de cartões." }) });
    const createdId = apiItems(created)[0]?.id;
    const option = contaAzulOptions(created)[0] || (typeof createdId === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(createdId) ? { value: createdId, label } : null);
    if (!option)
        throw Error("O CA não confirmou o cadastro da adquirente. Confira no CA antes de tentar novamente.");
    return option;
}
