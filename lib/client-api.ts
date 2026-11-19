export async function readApiResponse<T>(response: Response, service: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`${service} returned an empty response (HTTP ${response.status}). Please try again.`);
  let payload: T;
  try {
    payload = JSON.parse(body) as T;
  } catch {
    throw new Error(`${service} returned an invalid response (HTTP ${response.status}). Please try again.`);
  }
  if (!response.ok) {
    const message = (payload as { error?: string }).error;
    throw new Error(message || `${service} request failed (HTTP ${response.status}).`);
  }
  return payload;
}

export function withSession(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}
