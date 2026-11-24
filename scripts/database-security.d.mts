interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function assertFortunoDatabase(connectionString: string): void;
export function securePublicTables(args: {
  runtimeClient: QueryClient;
  adminClient: QueryClient;
  sql: string;
}): Promise<number>;
