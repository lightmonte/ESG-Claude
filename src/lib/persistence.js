/**
 * persistence.js
 * 
 * This module provides database functionalities for tracking extraction and processing status.
 * Uses SQLite for simple persistence without additional infrastructure requirements.
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import config from '../config.js';

let db;

/**
 * Initialize the persistence layer
 */
export async function initPersistence() {
  console.log(`Initializing database at ${config.dbPath}`);
  
  // Open the database connection
  db = await open({
    filename: config.dbPath,
    driver: sqlite3.Database
  });
  
  // Create tables if they don't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      company_id TEXT PRIMARY KEY,
      name TEXT,
      url TEXT,
      document_path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS processing_status (
      company_id TEXT PRIMARY KEY,
      download_status TEXT,
      download_message TEXT,
      extraction_status TEXT,
      extraction_message TEXT,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies (company_id)
    )
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT,
      process TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies (company_id)
    )
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      batch_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'in_progress',
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS batch_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT,
      company_id TEXT,
      FOREIGN KEY (batch_id) REFERENCES batches (batch_id),
      FOREIGN KEY (company_id) REFERENCES companies (company_id)
    )
  `);
  
  console.log('Database initialization complete');
  return db;
}

/**
 * Record or update company information
 */
export async function updateCompany(companyId, name, url, documentPath = null) {
  if (!db) await initPersistence();
  
  try {
    // Try to update first
    const result = await db.run(
      `UPDATE companies 
       SET name = ?, url = ?, document_path = COALESCE(?, document_path), last_updated = CURRENT_TIMESTAMP
       WHERE company_id = ?`,
      [name, url, documentPath, companyId]
    );
    
    // If no rows were updated, insert a new record
    if (result.changes === 0) {
      await db.run(
        `INSERT INTO companies (company_id, name, url, document_path)
         VALUES (?, ?, ?, ?)`,
        [companyId, name, url, documentPath]
      );
    }
    
    return true;
  } catch (error) {
    console.error(`Error updating company ${companyId}: ${error.message}`);
    return false;
  }
}

/**
 * Update processing status for a company
 */
export async function updateProcessingStatus(companyId, stage, status, message = null) {
  if (!db) await initPersistence();
  
  try {
    // Check if we have a record for this company
    const existingRecord = await db.get(
      'SELECT company_id FROM processing_status WHERE company_id = ?',
      [companyId]
    );
    
    if (existingRecord) {
      // Update the existing record
      let updateQuery;
      let params;
      
      if (stage === 'download') {
        updateQuery = `
          UPDATE processing_status 
          SET download_status = ?, download_message = ?, last_updated = CURRENT_TIMESTAMP
          WHERE company_id = ?
        `;
        params = [status, message, companyId];
      } else if (stage === 'extraction') {
        updateQuery = `
          UPDATE processing_status 
          SET extraction_status = ?, extraction_message = ?, last_updated = CURRENT_TIMESTAMP
          WHERE company_id = ?
        `;
        params = [status, message, companyId];
      }
      
      await db.run(updateQuery, params);
    } else {
      // Create a new record
      let insertQuery;
      let params;
      
      if (stage === 'download') {
        insertQuery = `
          INSERT INTO processing_status (company_id, download_status, download_message)
          VALUES (?, ?, ?)
        `;
        params = [companyId, status, message];
      } else if (stage === 'extraction') {
        insertQuery = `
          INSERT INTO processing_status (company_id, extraction_status, extraction_message)
          VALUES (?, ?, ?)
        `;
        params = [companyId, status, message];
      }
      
      await db.run(insertQuery, params);
    }
    
    return true;
  } catch (error) {
    console.error(`Error updating processing status for ${companyId}: ${error.message}`);
    return false;
  }
}

/**
 * Check if a company should be processed based on its status
 * NOTE: This doesn't consider the shouldUpdate flag from the input data,
 * which is handled separately in filterCompaniesToProcess
 */
export async function shouldProcessCompany(companyId, stage) {
  if (!db) await initPersistence();
  
  try {
    const statusField = stage === 'download' ? 'download_status' : 'extraction_status';
    
    const record = await db.get(
      `SELECT ${statusField} FROM processing_status WHERE company_id = ?`,
      [companyId]
    );
    
    // If no record exists or the status field is null, we should process
    if (!record || !record[statusField]) return true;
    
    // Process if the current status is 'failed' (retry logic)
    if (record[statusField] === 'failed') return true;
    
    // Otherwise, don't process if already completed or skipped
    // (The shouldUpdate flag will override this in filterCompaniesToProcess)
    return !['complete', 'downloaded', 'existing', 'extraction_complete', 'skipped'].includes(record[statusField]);
  } catch (error) {
    console.error(`Error checking processing status for ${companyId}: ${error.message}`);
    return true; // Default to processing on error
  }
}

/**
 * Filter a list of companies to only those that should be processed
 */
export async function filterCompaniesToProcess(companies, stage) {
  const filteredCompanies = [];
  
  for (const company of companies) {
    const companyId = company.companyId || company.company_id;
    
    // Check shouldUpdate flag - this takes precedence over database status
    // Only process if shouldUpdate is EXPLICITLY true
    if (company.shouldUpdate !== true) {
      console.log(`Skipping ${companyId} based on shouldUpdate flag not being explicitly true`);
      continue;
    }

    // Log the status of shouldUpdate for debugging
    console.log(`Processing company ${companyId}, shouldUpdate=${company.shouldUpdate} (type: ${typeof company.shouldUpdate})`);
    
    // At this point, shouldUpdate is explicitly true, so we process the company
    console.log(`${companyId}: Processing because shouldUpdate is explicitly true`);
    
    // If we get here, either shouldUpdate is true or there's no previous successful processing
    filteredCompanies.push(company);
  }
  
  return filteredCompanies;
}

/**
 * Helper to get extraction status for a company
 */
async function getExtractionStatus(companyId) {
  try {
    const record = await db.get(
      'SELECT extraction_status FROM processing_status WHERE company_id = ?',
      [companyId]
    );
    return record?.extraction_status || 'none';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get all processing status records
 */
export async function getAllProcessingStatus() {
  if (!db) await initPersistence();
  
  try {
    return await db.all(`
      SELECT c.company_id, c.name, c.url, c.document_path, 
             ps.download_status, ps.download_message,
             ps.extraction_status, ps.extraction_message,
             ps.last_updated
      FROM companies c
      LEFT JOIN processing_status ps ON c.company_id = ps.company_id
    `);
  } catch (error) {
    console.error(`Error retrieving processing status: ${error.message}`);
    return [];
  }
}

/**
 * Reset the extraction status for all companies or a specific company
 */
export async function resetExtractionStatus(companyId = null) {
  if (!db) await initPersistence();
  
  try {
    if (companyId) {
      // Reset for a specific company
      await db.run(
        'UPDATE processing_status SET extraction_status = NULL, extraction_message = NULL WHERE company_id = ?',
        [companyId]
      );
      console.log(`Reset extraction status for company: ${companyId}`);
    } else {
      // Reset for all companies
      await db.run('UPDATE processing_status SET extraction_status = NULL, extraction_message = NULL');
      console.log('Reset extraction status for all companies');
    }
    return true;
  } catch (error) {
    console.error(`Error resetting extraction status: ${error.message}`);
    return false;
  }
}

/**
 * Store batch information and associate companies with it
 */
export async function storeBatchInfo(batchId, companyIds) {
  if (!db) await initPersistence();
  
  try {
    // Insert batch info
    await db.run(
      `INSERT INTO batches (batch_id, status) VALUES (?, 'in_progress')`,
      [batchId]
    );
    
    // Associate companies with this batch
    for (const companyId of companyIds) {
      await db.run(
        `INSERT INTO batch_companies (batch_id, company_id) VALUES (?, ?)`,
        [batchId, companyId]
      );
    }
    
    return true;
  } catch (error) {
    console.error(`Error storing batch info: ${error.message}`);
    return false;
  }
}

/**
 * Update batch status
 */
export async function updateBatchStatus(batchId, status, message = null) {
  if (!db) await initPersistence();
  
  try {
    await db.run(
      `UPDATE batches SET status = ?, message = ?, last_updated = CURRENT_TIMESTAMP WHERE batch_id = ?`,
      [status, message, batchId]
    );
    
    return true;
  } catch (error) {
    console.error(`Error updating batch status: ${error.message}`);
    return false;
  }
}

/**
 * Get all company IDs associated with a batch
 */
export async function getBatchCompanyIds(batchId) {
  if (!db) await initPersistence();
  
  try {
    const records = await db.all(
      `SELECT company_id FROM batch_companies WHERE batch_id = ?`,
      [batchId]
    );
    
    return records.map(record => record.company_id);
  } catch (error) {
    console.error(`Error getting batch company IDs: ${error.message}`);
    return [];
  }
}

/**
 * Get all active (in-progress) batches
 */
export async function getActiveBatches() {
  if (!db) await initPersistence();
  
  try {
    return await db.all(
      `SELECT * FROM batches WHERE status = 'in_progress'`
    );
  } catch (error) {
    console.error(`Error getting active batches: ${error.message}`);
    return [];
  }
}

/**
 * Get company by ID
 */
export async function getCompany(companyId) {
  if (!db) await initPersistence();
  
  try {
    return await db.get(
      `SELECT * FROM companies WHERE company_id = ?`,
      [companyId]
    );
  } catch (error) {
    console.error(`Error getting company: ${error.message}`);
    return null;
  }
}

/**
 * Close the database connection
 */
export async function closePersistence() {
  if (db) {
    await db.close();
    console.log('Database connection closed');
  }
}

// Export for direct module usage
export default {
  initPersistence,
  updateCompany,
  updateProcessingStatus,
  shouldProcessCompany,
  filterCompaniesToProcess,
  getAllProcessingStatus,
  resetExtractionStatus,
  storeBatchInfo,
  updateBatchStatus,
  getBatchCompanyIds,
  getActiveBatches,
  getCompany,
  closePersistence
};