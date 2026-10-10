export interface CommerceScrollState {
  key: string;
  y: number;
}

export interface CommerceRouteState {
  search?: string;
  message?: string;
  restoreScroll?: CommerceScrollState;
}

export function commerceContextKey(search: URLSearchParams | string) {
  const params = new URLSearchParams(typeof search === 'string' ? search : search.toString());
  params.sort();
  return params.toString();
}

export function rememberCommerceScroll(restoreScroll: CommerceScrollState) {
  const current = window.history.state ?? {};
  window.history.replaceState({...current, commerceScroll: restoreScroll}, '');
}

export function rememberedCommerceScroll(): CommerceScrollState | undefined {
  return window.history.state?.commerceScroll;
}

export function clearRememberedCommerceScroll() {
  const current = window.history.state;
  if (!current || !('commerceScroll' in current)) return;
  const next = {...current};
  delete next.commerceScroll;
  window.history.replaceState(next, '');
}
