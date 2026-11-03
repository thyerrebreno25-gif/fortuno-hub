// Email inbox queries must never include tickets owned by another channel.
export const emailChannel = { source: { in: ["GMAIL", "MANUAL"] } };
