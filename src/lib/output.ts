import Table from 'cli-table3';

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputTable(headers: string[], rows: string[][]): void {
  const table = new Table({
    head: headers,
    style: { head: ['cyan'] },
  });
  for (const row of rows) {
    table.push(row);
  }
  console.log(table.toString());
}

export function outputSuccess(message: string): void {
  console.log(`✓ ${message}`);
}

export function outputInfo(message: string): void {
  console.log(message);
}
