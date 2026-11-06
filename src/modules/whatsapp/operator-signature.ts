export function signedWhatsappText(name: string | null | undefined, content: string) {
  const operator = (name || "Equipe Fortuno").replace(/[\r\n*_~`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Equipe Fortuno";
  return `*${operator}*\n${content}`;
}
