export const API_BUDGET_MESSAGE =
  "Vox has temporarily run out of API budget, but it should be back soon.";

export function isProviderBudgetError(response: Response, payload?: unknown) {
  if (response.status === 402 || response.status === 429) return true;
  if (response.status !== 400 && response.status !== 403) return false;

  let detail = "";
  try {
    detail = JSON.stringify(payload ?? "").toLocaleLowerCase();
  } catch {
    return false;
  }
  return /insufficient[_ -]?quota|billing|credit|budget|payment[_ -]?required/.test(
    detail,
  );
}

export class ProviderBudgetError extends Error {
  constructor() {
    super(API_BUDGET_MESSAGE);
    this.name = "ProviderBudgetError";
  }
}
