import { createServer } from './server.js';

const server = createServer();
const { config } = server;
const { port } = await server.listen();

console.log('');
console.log('  SPEKTRUM çalışıyor');
console.log(`  → Yerel adres : http://localhost:${port}`);
console.log(`  → Ortam       : ${config.env}`);
console.log(`  → Veritabanı  : ${config.dbPath}`);
console.log('');

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
