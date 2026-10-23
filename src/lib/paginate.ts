import { ApiError } from "./auth";

export type Page = { page: number; perPage: number; skip: number; take: number };

export function getPage(request: Request): Page {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page") || 15)));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function pageMeta(page: Page, total: number) {
  return {
    current_page: page.page,
    data: undefined as never,
    from: total === 0 ? null : page.skip + 1,
    last_page: Math.max(1, Math.ceil(total / page.perPage)),
    per_page: page.perPage,
    to: total === 0 ? null : Math.min(total, page.skip + page.perPage),
    total,
  };
}

export function paginateResponse<T>(
  request: Request,
  rows: T[],
  total: number,
): { data: T[]; meta: Record<string, unknown> } {
  const page = getPage(request);
  return {
    data: rows,
    meta: {
      current_page: page.page,
      last_page: Math.max(1, Math.ceil(total / page.perPage)),
      per_page: page.perPage,
      total,
    },
  };
}

/** Laravel-style validation errors -> Zod flatten. */
export function zodErrors(error: {
  flatten(): { fieldErrors: Record<string, unknown> };
}): ApiError {
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(error.flatten().fieldErrors)) {
    const list = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    if (list.length > 0) fieldErrors[key] = list;
  }
  return new ApiError(422, "The given data was invalid.", fieldErrors);
}

export { ApiError };
