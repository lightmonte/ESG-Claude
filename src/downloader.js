/**
 * downloader.js
 * 
 * This module handles downloading PDF documents from URLs.
 * It ensures documents are saved with consistent naming and handles error cases.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';
import { parse as parseCsv } from 'csv-parse/sync';
import { normalizeCompanyId, ensureDirectoryExists, concurrentMap, extractFilename, logToFile } from './utils.js';
import config from './config.js';
import * as persistence from './lib/persistence.js';

/**
 * Load company URLs from a CSV file
 * @param {string} csvPath - Path to the CSV file
 * @returns {Promise<Array>} - Array of company URL objects
 */
export async function loadCompanyUrls(csvPath) {
  try {
    const csvContent = await fs.readFile(csvPath, 'utf8');
    
    // Parse CSV
    const records = parseCsv(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    // Convert records to our expected format
    return records.map(record => {
      const name = record.name || record.company_name || record.companyName || '';
      const url = record.url || record.document_url || record.documentUrl || '';
      
      // Generate a consistent company ID
      const companyId = record.company_id || record.companyId || normalizeCompanyId(name);
      
      // Check for shouldUpdate flag
      let shouldUpdate = true; // Default to true unless explicitly set to false
      if (record.shouldUpdate !== undefined) {
        // Convert various forms of 'false' to boolean false
        const shouldUpdateStr = String(record.shouldUpdate).toLowerCase().trim();
        shouldUpdate = !(shouldUpdateStr === 'false' || shouldUpdateStr === '0' || shouldUpdateStr === 'no' || shouldUpdateStr === 'n');
        console.log(`Setting shouldUpdate=${shouldUpdate} for ${name} from value '${record.shouldUpdate}'`);
      }
      
      return { 
        companyId, 
        name, 
        url,
        shouldUpdate
      };
    }).filter(company => company.url); // Only keep records with URLs
  } catch (error) {
    console.error(`Error loading company URLs: ${error.message}`);
    return [];
  }
}

/**
 * Download a document from a URL
 * @param {object} company - Company object with URL
 * @returns {Promise<object>} - Result of download
 */
export async function downloadDocument(company) {
  const { companyId, name, url, shouldUpdate } = company;
  
  // Skip if shouldUpdate is explicitly false
  if (shouldUpdate === false) {
    console.log(`Skipping download for ${companyId} based on shouldUpdate flag`);
    return { 
      ...company, 
      status: 'skipped', 
      message: 'Skipped based on shouldUpdate flag' 
    };
  }
  
  // Check if we should process this company or if it's already been processed
  const shouldProcess = await persistence.shouldProcessCompany(companyId, 'download');
  if (!shouldProcess) {
    console.log(`Skipping download for ${companyId} based on existing processing status`);
    
    // Try to get the existing document path
    const existingRecord = await persistence.getAllProcessingStatus();
    const companyRecord = existingRecord.find(record => record.company_id === companyId);
    
    if (companyRecord && companyRecord.document_path) {
      const documentPath = companyRecord.document_path;
      // Check if the file exists
      try {
        await fs.access(documentPath);
        console.log(`Using existing document for ${companyId}: ${documentPath}`);
        
        return {
          ...company,
          documentPath,
          status: 'existing',
          message: 'Using existing document'
        };
      } catch (fileError) {
        // File doesn't exist, so we should download it
        console.log(`Document file not found for ${companyId}, will download again`);
      }
    }
  }
  
  try {
    console.log(`Downloading document for ${companyId} from ${url}`);
    
    // Create target directory
    const documentsDir = path.join(config.dataDir, 'documents');
    await ensureDirectoryExists(documentsDir);
    
    // Determine filename from URL or use company ID
    let filename = extractFilename(url);
    
    // Make sure filename ends with .pdf
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename = `${filename}.pdf`;
    }
    
    // Use companyId as prefix to ensure uniqueness
    const documentPath = path.join(documentsDir, `${companyId}_${filename}`);
    
    // Check if the file already exists
    try {
      await fs.access(documentPath);
      console.log(`Document already exists for ${companyId}: ${documentPath}`);
      
      // Update the database with the company info and document path
      await persistence.updateCompany(companyId, name, url, documentPath);
      await persistence.updateProcessingStatus(companyId, 'download', 'existing');
      
      return {
        ...company,
        documentPath,
        status: 'existing',
        message: 'Document already exists'
      };
    } catch (fileError) {
      // File doesn't exist, so we can proceed with download
    }
    
    // Download the file
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 30000, // 30 second timeout
      maxContentLength: 100 * 1024 * 1024, // Max 100MB
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Create write stream
    const writer = fsSync.createWriteStream(documentPath);
    
    // Pipe response to file
    response.data.pipe(writer);
    
    // Wait for download to complete
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log(`Successfully downloaded document for ${companyId} to ${documentPath}`);
    await logToFile(`Downloaded document for ${companyId} to ${documentPath}`);
    
    // Update the database with the company info and document path
    await persistence.updateCompany(companyId, name, url, documentPath);
    await persistence.updateProcessingStatus(companyId, 'download', 'downloaded');
    
    return {
      ...company,
      documentPath,
      status: 'downloaded',
      message: 'Successfully downloaded'
    };
  } catch (error) {
    console.error(`Error downloading document for ${companyId}: ${error.message}`);
    await logToFile(`Error downloading document for ${companyId}: ${error.message}`);
    
    // Update the database with the error
    await persistence.updateCompany(companyId, name, url);
    await persistence.updateProcessingStatus(companyId, 'download', 'failed', error.message);
    
    return {
      ...company,
      error: error.message,
      status: 'failed',
      message: `Download failed: ${error.message}`
    };
  }
}

/**
 * Download all documents concurrently
 * @param {Array} companies - Array of company objects
 * @returns {Promise<Array>} - Results of downloads
 */
export async function downloadAllDocuments(companies) {
  console.log(`Starting download for ${companies.length} documents`);
  
  // Download with concurrency control
  const results = await concurrentMap(
    companies, 
    downloadDocument, 
    3 // Limit concurrent downloads
  );
  
  // Summary
  const succeeded = results.filter(r => r.status === 'downloaded' || r.status === 'existing').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  
  console.log(`Download summary: ${succeeded} succeeded (${results.filter(r => r.status === 'downloaded').length} new, ${results.filter(r => r.status === 'existing').length} existing), ${failed} failed, ${skipped} skipped`);
  
  return results;
}