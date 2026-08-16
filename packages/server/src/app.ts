import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import apiRoutes from './routes';
import logger from './utils/logger';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(morgan('dev'));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', apiRoutes);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  });

  return app;
};
