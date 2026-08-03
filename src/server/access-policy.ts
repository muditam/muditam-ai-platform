export function isProduction(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function directProcessingAllowed(
  nodeEnv: string | undefined,
  remoteAddress: string | undefined,
): boolean {
  return !isProduction(nodeEnv) || isLoopbackAddress(remoteAddress);
}

export function reviewUiAllowed(nodeEnv = process.env.NODE_ENV): boolean {
  return !isProduction(nodeEnv);
}
