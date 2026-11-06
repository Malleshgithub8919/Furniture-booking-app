import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';

try {
  await connectDatabase();
  const server = app.listen(env.port, () => console.log(`API listening on http://localhost:${env.port}`));
  const shutdown = async () => {
    server.close(async () => {
      const mongoose = await import('mongoose');
      await mongoose.default.disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Failed to start API:', error.name || 'Error');
  process.exit(1);
}
