/**
 * export-to-excel.js
 * 
 * This script loads already extracted ESG data from the output/extracted directory
 * and exports it to Excel format without running the extraction process.
 * 
 * Usage: node src/export-to-excel.js
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { ensureDirectoryExists } from './utils.js';
import { exportToExcel } from './exporter.js';

/**
 * Load extracted data from JSON files
 */
async function loadExtractedData() {
  const extractedDir = path.join(config.outputDir, 'extracted');
  
  try {
    // Check if the directory exists
    await fs.access(extractedDir);
  } catch (error) {
    console.error(`Extracted data directory not found: ${extractedDir}`);
    return [];
  }
  
  try {
    // Get all JSON files in the extracted directory
    const files = await fs.readdir(extractedDir);
    const jsonFiles = files.filter(file => file.endsWith('_extracted.json'));
    
    if (jsonFiles.length === 0) {
      console.log('No extracted data files found');
      return [];
    }
    
    console.log(`Found ${jsonFiles.length} extracted data files`);
    
    // Load each JSON file
    const extractedData = [];
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(extractedDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);
        
        // Extract companyId from filename (remove _extracted.json)
        const companyId = file.replace('_extracted.json', '');
        
        extractedData.push({
          companyId,
          extractedData: data,
          status: 'extraction_complete'
        });
      } catch (fileError) {
        console.error(`Error loading file ${file}: ${fileError.message}`);
      }
    }
    
    return extractedData;
  } catch (error) {
    console.error(`Error loading extracted data: ${error.message}`);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting export of extracted ESG data to Excel');
    
    // Ensure output directory exists
    await ensureDirectoryExists(config.outputDir);
    
    // Load already extracted data
    console.log('Loading extracted data from files...');
    const extractedData = await loadExtractedData();
    
    if (extractedData.length === 0) {
      console.log('No extracted data found. Please run the extraction process first.');
      process.exit(0);
    }
    
    // Export to Excel
    console.log(`Exporting ${extractedData.length} records to Excel...`);
    const result = await exportToExcel(extractedData);
    
    if (result.success) {
      console.log(`Successfully exported ${result.count} records to Excel: ${result.path}`);
    } else {
      console.error(`Failed to export to Excel: ${result.error}`);
    }
    
  } catch (error) {
    console.error(`Error in export process: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();