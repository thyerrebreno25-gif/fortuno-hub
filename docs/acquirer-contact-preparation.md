# Acquirer identity and financial export preparation

The shared resolver prepares the same CA person as Cliente for gross receipts and
Fornecedor for fees. All destination validation and contact preparation finish
before financial event creation. The existing source/line keys, lease, uncertainty
reconciliation and settlement checks remain unchanged.

Legacy persons without a document can fail when adding the second profile. The
CA help center documents this requirement:
https://ajuda.contaazul.com/hc/pt-br/articles/44422468381965-Lan%C3%A7amentos-financeiros-por-que-preciso-informar-CPF-ou-CNPJ-ao-importar-planilha

The resolver supplies verified public corporate identities for Cielo and
Rede/Redecard, including their exact legal-name aliases. Sources checked on
2026-11-24:

- Cielo: 01.027.058/0001-91, https://www.cielo.com.br/
- Rede/Redecard: 01.425.787/0001-04, https://developer.userede.com.br/

These identities are shared across client integrations, not copied from a client.
Existing branch CNPJs belonging to the same corporate root remain unchanged.
A conflicting CPF/CNPJ, inactive person, changed profiles or ambiguous search
stops preparation instead of overwriting identity data or creating a duplicate.
Other acquirers use the document already registered in CA; an unknown document
must be completed in that existing registration, never invented from the name.

PATCH sends only the original CPF/CNPJ (or a verified missing CNPJ), the matching
person type and the union of existing and required profiles. It never replaces the
full person, addresses, name, contacts or fiscal details. New verified persons are
created with both financial profiles at once, preventing a second registration.

After any PATCH outcome, GET confirms the document and profiles on the same ID.
A 500/timeout after saving is treated as success only when that read confirms the
change. Transient failures can be retried up to three times, with intervening reads,
backoff and freshly read profiles; validation/permission/rate-limit failures are not replayed.
A failed confirmation read stops all further writes. No fallback creates another
person or performs a full PUT. Persistent provider failures remain explicit errors.

The API contract for partial person updates and HTTP 204 responses:
https://developers.contaazul.com/open-api-docs/open-api-person/v1/atualizarparcialmentepessoa

Provider guidance on checking an uncertain mutation before repeating it:
https://developers.contaazul.com/commonmistakes

Automated API-route regressions cover receipt + fee creation/settlement, reuse of
the same person, replay of the same batch, a saved update returning HTTP 500, and
rejected preparation preventing all financial writes. They use mocked providers;
they do not send real entries or settle customer amounts during verification.
