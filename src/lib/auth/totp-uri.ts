/** Browser-safe: builds the otpauth:// URI an authenticator app understands. */
export function otpauthUri(secretB32: string, account: string, issuer = "FleetComply"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}`;
}
