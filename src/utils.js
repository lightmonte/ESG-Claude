/**
 * utils.js
 * 
 * Utility functions used across the application
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dir - Directory path
 */
export async function ensureDirectoryExists(dir) {
  try {
    await fs.access(dir);
  } catch (error) {
    console.log(`Creating directory ${dir}`);
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Log a message to a file
 * @param {string} message - Message to log
 * @param {string} filename - Log file name
 */
export async function logToFile(message, filename = 'process.log') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  try {
    await ensureDirectoryExists(config.dataDir);
    const logPath = path.join(config.dataDir, filename);
    await fs.appendFile(logPath, logMessage);
  } catch (error) {
    console.error(`Error writing to log: ${error.message}`);
  }
}

/**
 * Sleep for a specified time
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after the sleep time
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function concurrently on an array of items with a limit on concurrency
 * @param {Array} items - Items to process
 * @param {Function} fn - Function to execute on each item
 * @param {number} concurrency - Maximum number of concurrent executions
 * @returns {Promise<Array>} - Results of function execution
 */
export async function concurrentMap(items, fn, concurrency = 3) {
  const results = [];
  const executing = new Set();
  
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

/**
 * Generate a unique identifier for a company based on its name
 * @param {string} name - Company name
 * @returns {string} - Normalized company ID
 */
export function normalizeCompanyId(name) {
  if (!name) return `unknown_${Date.now()}`;
  
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '_')     // Replace spaces with underscores
    .trim();
}

/**
 * Format a date as YYYY-MM-DD
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
export function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Create a deep clone of an object
 * @param {object} obj - Object to clone
 * @returns {object} - Cloned object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Extract filename from a URL or path
 * @param {string} urlOrPath - URL or file path
 * @returns {string} - Extracted filename
 */
export function extractFilename(urlOrPath) {
  if (!urlOrPath) return null;
  
  try {
    // Try to parse as URL
    const url = new URL(urlOrPath);
    const pathname = url.pathname;
    const filename = path.basename(pathname);
    return filename || `document_${Date.now()}.pdf`;
  } catch (e) {
    // Not a URL, treat as path
    return path.basename(urlOrPath);
  }
}