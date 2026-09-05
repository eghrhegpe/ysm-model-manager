// [doc:architecture] Card container helper — UI layout leaf.
// Extracted from @/core/utils as part of de-barreling (mis-numbered as ADR-191; corrected in ADR-189 D5).
// Zero dependencies: only touches DOM, no app-state imports.
// 自 MikuMikuAR 迁移：无应用层依赖，原样保留。

/**
 * Card container helper: removes render-card bg, wraps content in an lcard.
 * Returns dispose callback from callback if provided.
 */
export function cardContainer(
  container: HTMLElement,
  fn: (c: HTMLElement) => (() => void) | undefined,
): (() => void) | undefined {
  container.classList.remove("render-card");
  const card = document.createElement("div");
  card.className = "lcard";
  const dispose = fn(card);
  container.appendChild(card);
  return dispose;
}
