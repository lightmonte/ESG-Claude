/**
 * index.js
 * 
 * Main entry point for the ESG-Claude application.
 * This orchestrates the entire process:
 * 1. Load company information and PDF URLs
 * 2. Send PDF URLs directly to Claude API for ESG data extraction
 * 3. Export to various formats
 * 
 * Usage: node src/index.js
 */

import fs from 'fs/promises';
import path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import config from './config.js';
import { ensureDirectoryExists, logToFile, normalizeCompanyId } from './utils.js';
import { processAllPdfUrls } from './claude-extractor.js';
import { processBatchCompanies, checkAndProcessCompletedBatches } from './claude-batch-extractor.js';
import { exportAllFormats } from './exporter.js';
import * as persistence from './lib/persistence.js';
import tokenTracker from './lib/token-tracker.js';

/**
 * Load company URLs from a CSV file
 * @param {string} csvPath - Path to the CSV file
 * @returns {Promise<Array>} - Array of company URL objects
 */
async function loadCompanyUrls(csvPath) {
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
      const industry = record.industry || record.industryId || '';
      
      // Generate a consistent company ID
      const companyId = record.company_id || record.companyId || normalizeCompanyId(name);
      
      // Check for shouldUpdate flag - convert to proper boolean
      let shouldUpdate = false; // Default to false unless explicitly set to true
      if (record.shouldUpdate !== undefined) {
        if (typeof record.shouldUpdate === 'boolean') {
          shouldUpdate = record.shouldUpdate;
        } else if (typeof record.shouldUpdate === 'string') {
          shouldUpdate = record.shouldUpdate.toLowerCase() === 'true';
        } else if (typeof record.shouldUpdate === 'number') {
          shouldUpdate = record.shouldUpdate === 1;
        }
      }
      
      return { 
        companyId, 
        name, 
        url,
        industry,
        shouldUpdate
      };
    }).filter(company => company.url); // Only keep records with URLs
  } catch (error) {
    console.error(`Error loading company URLs: ${error.message}`);
    return [];
  }
}

/**
 * Filter out duplicate companies from the processing list
 * @param {Array} companies - List of company objects
 * @returns {Array} - Filtered list with no duplicates
 */
function filterDuplicateCompanies(companies) {
  const uniqueCompanies = [];
  const companyIds = new Set();
  
  for (const company of companies) {
    const companyId = company.companyId || company.company_id;
    
    if (companyId && !companyIds.has(companyId)) {
      companyIds.add(companyId);
      uniqueCompanies.push(company);
    } else if (companyId) {
      console.log(`Filtering out duplicate company: ${companyId}`);
    }
  }
  
  console.log(`Filtered ${companies.length - uniqueCompanies.length} duplicate companies from processing list`);
  return uniqueCompanies;
}

/**
 * Main function to run the entire pipeline
 */
async function main() {
  try {
    console.log('Starting ESG-Claude - ESG Data Extractor with Claude API Integration');
    
    // Ensure directories exist
    await ensureDirectoryExists(config.dataDir);
    await ensureDirectoryExists(config.outputDir);
    
    // Initialize log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logfile = `process_${timestamp}.log`;
    await logToFile('Starting ESG-Claude - ESG Data Extractor with Claude API Integration', logfile);
    
    // Initialize database for tracking status
    await persistence.initPersistence();
    console.log('Persistence system initialized');
    await logToFile('Persistence system initialized', logfile);
    
    // Step 1: Load company URLs
    console.log('Loading company URLs');
    const csvPath = path.join(config.dataDir, 'company_urls.csv');
    
    // Check if the file exists, if not create a sample file
    try {
      await fs.access(csvPath);
    } catch (error) {
      console.log('Creating sample company_urls.csv file');
      
      // Create a sample CSV with some example companies
      await fs.writeFile(
        csvPath,
        'name,url,industry,shouldUpdate\n' +
        'apple,https://www.apple.com/environment/pdf/Apple_Environmental_Progress_Report_2023.pdf,technology,true\n' +
        'microsoft,https://query.prod.cms.rt.microsoft.com/cms/api/am/binary/RE5bq0G,technology,true\n'
      );
      
      console.log('Created sample company_urls.csv. Please edit this file with your target companies and run again.');
      process.exit(0);
    }
    
    // Load and clean up company URLs
    let companyUrls = await loadCompanyUrls(csvPath);
    
    if (companyUrls.length === 0) {
      throw new Error('No company URLs found. Please check your company_urls.csv file');
    }
    
    // Filter duplicates from the source data
    const uniqueCompanyUrls = filterDuplicateCompanies(companyUrls);
    
    console.log(`Loaded ${companyUrls.length} company URLs (${uniqueCompanyUrls.length} unique)`);
    await logToFile(`Loaded ${companyUrls.length} company URLs (${uniqueCompanyUrls.length} unique)`, logfile);
    
    // Step 2: Filter companies based on shouldUpdate flag
    const filteredCompanies = await persistence.filterCompaniesToProcess(
      uniqueCompanyUrls,
      'extraction'
    );
    
    console.log(`Processing ${filteredCompanies.length} out of ${uniqueCompanyUrls.length} companies for direct extraction`);
    
    // Step 3: Extract data from PDF URLs
    let extractionResults = [];
    
    // Debug the batch processing configuration
    console.log(`Batch processing configuration: useBatchProcessing=${config.useBatchProcessing} (type: ${typeof config.useBatchProcessing})`);
    console.log(`USE_BATCH_PROCESSING environment variable: '${process.env.USE_BATCH_PROCESSING}' (type: ${typeof process.env.USE_BATCH_PROCESSING})`);
    
    if (config.useBatchProcessing) {
      console.log('Using batch processing mode for PDF extraction');
      await logToFile('Using batch processing mode for PDF extraction', logfile);
      
      // Try initializing batch processing to verify API availability
      try {
        // Break companies into batches of configured size
        const batches = [];
        for (let i = 0; i < filteredCompanies.length; i += config.batchSize) {
          batches.push(filteredCompanies.slice(i, i + config.batchSize));
        }
        
        console.log(`Created ${batches.length} batches of up to ${config.batchSize} companies each`);
        await logToFile(`Created ${batches.length} batches of up to ${config.batchSize} companies each`, logfile);
        
        // Submit all batches
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          console.log(`Submitting batch ${i+1}/${batches.length} with ${batch.length} companies`);
          
          try {
            const batchResult = await processBatchCompanies(batch);
            console.log(`Batch ${i+1} submitted with ID: ${batchResult.batchId}`);
            await logToFile(`Batch ${i+1}/${batches.length} submitted with ID: ${batchResult.batchId}`, logfile);
          } catch (error) {
            console.error(`Error submitting batch ${i+1}: ${error.message}`);
            await logToFile(`Error submitting batch ${i+1}: ${error.message}`, logfile);
            
            // If we have a specific API availability error, fall back to one-by-one processing
            if (error.message && error.message.includes('Batch API is not available')) {
              console.log('Falling back to one-by-one processing due to Batch API unavailability');
              await logToFile('Falling back to one-by-one processing due to Batch API unavailability', logfile);
              
              console.log('Extracting ESG data from PDF URLs using Claude API (one-by-one)');
              extractionResults = await processAllPdfUrls(filteredCompanies);
              
              await logToFile(`Extracted ESG data from ${extractionResults.filter(r => r.status === 'extraction_complete').length} PDF URLs, failed ${extractionResults.filter(r => r.status === 'extraction_failed').length}`, logfile);
              
              // Exit the batch processing flow
              break;
            }
          }
        }
        
        // Check for any completed batches
        console.log('Checking for any completed batches...');
        const completedBatchResults = await checkAndProcessCompletedBatches();
        
        // If we have any completed batch results, add them to the extraction results
        for (const batchResult of completedBatchResults) {
          if (batchResult.status === 'completed' && batchResult.results) {
            extractionResults = extractionResults.concat(batchResult.results);
          }
        }
        
        console.log(`Current batch extraction results: ${extractionResults.length} companies processed`);
        await logToFile(`Current batch extraction results: ${extractionResults.filter(r => r.status === 'extraction_complete').length} completed, ${extractionResults.filter(r => r.status === 'extraction_failed').length} failed`, logfile);
        
      } catch (error) {
        console.error(`Error in batch processing: ${error.message}`);
        await logToFile(`Error in batch processing: ${error.message}. Falling back to one-by-one processing.`, logfile);
        
        // Fall back to one-by-one processing
        console.log('Falling back to one-by-one processing due to batch processing error');
        console.log('Extracting ESG data from PDF URLs using Claude API (one-by-one)');
        extractionResults = await processAllPdfUrls(filteredCompanies);
        
        await logToFile(`Extracted ESG data from ${extractionResults.filter(r => r.status === 'extraction_complete').length} PDF URLs, failed ${extractionResults.filter(r => r.status === 'extraction_failed').length}`, logfile);
      }
      
    } else {
      // Traditional one-by-one processing
      console.log('Extracting ESG data from PDF URLs using Claude API (one-by-one)');
      extractionResults = await processAllPdfUrls(filteredCompanies);
      
      await logToFile(`Extracted ESG data from ${extractionResults.filter(r => r.status === 'extraction_complete').length} PDF URLs, failed ${extractionResults.filter(r => r.status === 'extraction_failed').length}`, logfile);
    }
    
    // Step 4: Export to various formats
    console.log('Exporting results');
    const exportResults = await exportAllFormats(extractionResults);
    
    if (exportResults.json && exportResults.json.path) {
      console.log(`JSON output: ${exportResults.json.path}`);
      await logToFile(`Exported to JSON: ${exportResults.json.path} (${exportResults.json.count} profiles)`, logfile);
    } else {
      console.log('No JSON output generated');
    }
    
    if (exportResults.csv && exportResults.csv.path) {
      console.log(`CSV output: ${exportResults.csv.path}`);
      await logToFile(`Exported to CSV: ${exportResults.csv.path} (${exportResults.csv.count} profiles)`, logfile);
    } else {
      console.log('No CSV output generated');
    }
    
    if (exportResults.excel && exportResults.excel.path) {
      console.log(`Excel output: ${exportResults.excel.path}`);
      await logToFile(`Exported to Excel: ${exportResults.excel.path} (${exportResults.excel.count} profiles)`, logfile);
    } else {
      console.log('No Excel output generated');
    }
    
    console.log(`Log file: ${path.join(config.dataDir, logfile)}`);
    
    // Show persistence status summary
    const statusRecords = await persistence.getAllProcessingStatus();
    console.log('\nProcessing Status Summary:');
    console.log(`Total companies tracked: ${statusRecords.length}`);
    console.log(`Companies with completed extraction: ${statusRecords.filter(r => r.extraction_status === 'extraction_complete').length}`);
    
    // Generate and display token usage report
    console.log('\nToken Usage Report:');
    const usageReport = tokenTracker.generateUsageReport();
    console.log(usageReport);
    
    // Save token usage report and data
    const reportPath = await tokenTracker.saveUsageReport();
    const usagePath = await tokenTracker.saveTokenUsage();
    
    console.log(`Token usage report saved to: ${reportPath}`);
    console.log(`Token usage data saved to: ${usagePath}`);
    await logToFile(`Token usage report saved to: ${reportPath}`);
    await logToFile(`Token usage data saved to: ${usagePath}`);
    
    // Close database connection
    await persistence.closePersistence();
    
  } catch (error) {
    console.error(`Error in main process: ${error.message}`);
    await logToFile(`Error in main process: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();