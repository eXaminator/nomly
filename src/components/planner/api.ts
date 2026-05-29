async function jsonOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`request failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function apiCreateMeal(input: {
  recipeId: number;
  date: string;
  servingsOverride?: number | null;
  note?: string | null;
}): Promise<{ id: number }> {
  const res = await fetch("/api/v1/meal-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res) as Promise<{ id: number }>;
}

export async function apiUpdateMeal(
  id: number,
  patch: {
    servingsOverride?: number | null;
    note?: string | null;
    isLeftover?: boolean;
  },
): Promise<void> {
  const res = await fetch(`/api/v1/meal-plans/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  await jsonOrThrow(res);
}

/** Duplicate a meal onto the next day as a leftover. Returns the new id. */
export async function apiDuplicateMealToNextDay(
  id: number,
): Promise<{ id: number }> {
  const res = await fetch(`/api/v1/meal-plans/${id}/duplicate-next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return jsonOrThrow(res) as Promise<{ id: number }>;
}

export async function apiDeleteMeal(id: number): Promise<void> {
  const res = await fetch(`/api/v1/meal-plans/${id}`, { method: "DELETE" });
  await jsonOrThrow(res);
}

export async function apiDeleteMealWithShopping(
  id: number,
  mode: "keep" | "subtract",
): Promise<void> {
  const res = await fetch(`/api/v1/meal-plans/${id}/with-shopping`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  await jsonOrThrow(res);
}

export async function apiReorderMeal(
  id: number,
  direction: "up" | "down",
): Promise<void> {
  const res = await fetch(`/api/v1/meal-plans/${id}/reorder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ direction }),
  });
  await jsonOrThrow(res);
}

export async function apiMoveMeal(id: number, date: string): Promise<void> {
  const res = await fetch(`/api/v1/meal-plans/${id}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date }),
  });
  await jsonOrThrow(res);
}

export async function apiReorderDay(
  date: string,
  orderedIds: number[],
): Promise<void> {
  const res = await fetch("/api/v1/meal-plans/reorder-day", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, orderedIds }),
  });
  await jsonOrThrow(res);
}
