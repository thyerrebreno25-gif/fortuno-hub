import { normalizeWhatsappIdentity, parseWhatsappChannelAddress, type WhatsAppIdentityKind } from "./core";
export type ClientLink = { kind: string; externalId: string; name: string; ticketId: string | null };
export type ClientLinkCoverage = { total: number; linked: number; unlinked: number; percentage: number; clients: Array<{ id: string; name: string; links: ClientLink[] }> };
type Identity = { kind: string; externalId: string; displayName: string | null };
type Client = { id: string; name: string; whatsappIdentities: Identity[] };
type Directory = { kind: string; externalId: string; displayName: string };
type Ticket = { id: string; clientId: string | null; senderEmail: string; senderName: string | null; subject: string };
export function summarizeClientLinks(clients: Client[], directory: Directory[], tickets: Ticket[]): ClientLinkCoverage {
  const key = (kind: string, id: string) => kind + ":" + normalizeWhatsappIdentity(kind as WhatsAppIdentityKind, id);
  const available = new Map(directory.map(entry => [key(entry.kind, entry.externalId), entry]));
  const latestTickets = new Map<string, Ticket>();
  for (const ticket of tickets) if (!latestTickets.has(ticket.senderEmail)) latestTickets.set(ticket.senderEmail, ticket);
  const rows = clients.map(client => {
    const links = new Map<string, ClientLink>();
    for (const identity of client.whatsappIdentities) {
      const entry = available.get(key(identity.kind, identity.externalId));
      if (entry) links.set(key(identity.kind, identity.externalId), { kind: identity.kind, externalId: identity.externalId, name: entry.displayName || identity.displayName || identity.externalId, ticketId: null });
    }
    for (const ticket of latestTickets.values()) if (ticket.clientId === client.id) {
      const identity = parseWhatsappChannelAddress(ticket.senderEmail), id = key(identity.kind, identity.externalId), entry = available.get(id);
      // One client may have many identities; repeated tickets for one chat count once.
      if (!links.get(id)?.ticketId) links.set(id, { kind: identity.kind, externalId: identity.externalId, name: entry?.displayName || ticket.senderName || ticket.subject, ticketId: ticket.id });
    }
    return { id: client.id, name: client.name, links: [...links.values()] };
  });
  const linked = rows.filter(client => client.links.length > 0).length;
  return { total: rows.length, linked, unlinked: rows.length - linked, percentage: rows.length ? Math.round(linked / rows.length * 1000) / 10 : 0, clients: rows };
}
