import http from 'http';
import { serverConfig } from './config';
import { openDatabase, initializeDatabase, closeDatabase } from './lib/database';
import { createApp } from './app';
import { attachCollab } from './lib/collab';
import logger from './utils/logger';

const app = createApp();
const PORT = serverConfig.port;

const startServer = async () => {
  try {
    await openDatabase();
    logger.info('Database connection established');

    await initializeDatabase();
    logger.info('Database initialized');

    const server = http.createServer(app);
    attachCollab(server);

    const HOST = process.env.HOST || '0.0.0.0';
    server.listen(PORT, HOST, () => {
      logger.info(`Server is running on http://${HOST}:${PORT}`);
    });

    const shutdown = async () => {
      logger.info('Shutting down server...');
      await closeDatabase();
      logger.info('Database connection closed');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    process.on('uncaughtException', function (err) {
      logger.error('Unhandled Exception:', err);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
