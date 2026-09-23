export function createTodoRequestGuard(initialView: string) {
  let view = initialView;
  let sequence = 0;
  return {
    select(nextView: string) { if (view !== nextView) { view = nextView; sequence++; } },
    begin(requestView: string) { return requestView === view ? ++sequence : null; },
    isCurrent(token: number | null) { return token !== null && token === sequence; },
  };
}
