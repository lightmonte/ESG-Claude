/**
 * claude-batch-extractor.js
 * 
 * This module implements batch processing using Claude's Message Batches API.
 * It allows for processing multiple PDFs in a single batch, with significant cost savings.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { logToFile, sleep, ensureDirectoryExists } from './utils.js';
import Anthropic from '@anthropic-ai/sdk';
import tokenTracker from './lib/token-tracker.js';
import * as persistence from './lib/persistence.js';
import esgCriteria from './lib/esg-criteria.js';
import errorHandler from './lib/error-handler.js';
import systemPrompt from './prompts/system-prompt.js';
import userPrompt from './prompts/user-prompt