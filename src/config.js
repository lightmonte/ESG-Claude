import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  // API Keys
  claudeApiKey: process.env.CLAUDE_API_KEY,
  
  // Processing parameters
  maxConcurrentExtractions: parseInt(process.env.MAX_CONCURRENT_EXTRACTIONS || '3'),
  
  // Batch processing parameters
  useBatchProcessing: process.env.USE_BATCH_PROCESSING === 'true',
  batchSize: parseInt(process.env.BATCH_SIZE || '50'),
  batchCheckIntervalMinutes: parseInt(process.env.BATCH_CHECK_INTERVAL_MINUTES || '15'),
  
  // Models
  claudeModel: process.env.CLAUDE_MODEL || 'claude-3-7-sonnet-20250219',
  
  // Paths
  rootDir: path.resolve(__dirname, '..'),
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || './data'),
  outputDir: path.resolve(__dirname, '..', process.env.OUTPUT_DIR || './output'),
  dbPath: path.resolve(__dirname, '..', process.env.DB_PATH || './data/esg_database.sqlite')
};

export default config;