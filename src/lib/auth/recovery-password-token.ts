// The server consumes the one-time token only when the owner submits a new
// password. Merely opening an email (including scanners) never consumes it.
export function recoveryPasswordToken(value: string) {
  const url = new URL(value);
  const token = url.searchParams.get("token_hash");
  return url.searchParams.get("type") === "recovery" &&
    !url.searchParams.has("error") && !url.searchParams.has("error_code") &&
    token && token.length >= 16 && token.length <= 256 ? token : null;
}
