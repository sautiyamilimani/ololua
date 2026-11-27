export type ServiceVariantCategory = "domestic" | "tankered" | "bottled";

export function getServiceVariantCategory(
  variantCode: string,
): ServiceVariantCategory | null {
  const normalizedCode = variantCode.toUpperCase();
  if (normalizedCode.includes("DOMESTIC")) return "domestic";
  if (normalizedCode.includes("TANKER")) return "tankered";
  if (normalizedCode.includes("BOTTLE")) return "bottled";
  return null;
}
