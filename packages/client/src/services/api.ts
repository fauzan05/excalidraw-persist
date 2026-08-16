import { authHeaders } from '../utils/embed';

const API_BASE_URL = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

type RequestBody = Record<string, unknown> | unknown[];

const parseResponse = async <T>(response: Response): Promise<ApiResponse<T>> => {
  const text = await response.text();
  if (!text) {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return { success: true };
  }
  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 180)}`);
  }
};

const assertOk = <T>(response: Response, data: ApiResponse<T>): void => {
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
};

export const api = {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        ...authHeaders(),
      },
    });

    const data = await parseResponse<T>(response);
    assertOk(response, data);

    return (data.data ?? data) as T;
  },

  async post<T>(endpoint: string, body?: RequestBody): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(body),
    });
    const data = await parseResponse<T>(response);
    assertOk(response, data);

    return data.data as T;
  },

  async put<T>(endpoint: string, body: RequestBody): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(body),
    });
    const data = await parseResponse<T>(response);
    assertOk(response, data);

    return data.data as T;
  },

  async delete(endpoint: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: {
        ...authHeaders(),
      },
    });
    const data = await parseResponse<void>(response);
    assertOk(response, data);
  },
};
