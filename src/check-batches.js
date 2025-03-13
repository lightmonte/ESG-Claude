/**
 * check-batches.js
 * 
 * This script checks for any completed batches and processes their results.
 * It's designed to be run periodically after submitting batches,
 * either as a scheduled task or manually.
 */

import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { logToFile } from './utils.js';
import { checkAndProcessCompletedBatches } from './claude-batch-extractor.js';
import { exportAllFormats } from './exporter.js';
import * as persistence from './lib/persistence.js';
import tokenTracker from './lib/token-tracker.js';

/**
 * Main function to check and process completed batches
 */
async function main() {
  try {
    console.log('Starting ESG-Claude - Batch Processing Check');
    
    // Initialize log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logfile = `batch_check_${timestamp}.log`;
    await logToFile('Starting ESG-Claude - Batch Processing Check', logfile);
    
    // Initialize database for tracking status
    await persistence.initPersistence();
    console.log('Persistence system initialized');
    
    // Check for completed batches
    console.log('Checking for completed batches...');
    const batchResults = await checkAndProcessCompletedBatches();
    
    // Count results by status
    let completedBatches = 0;
    let completedCompanies = 0;
    let failedCompanies = 0;
    let exportedResults = [];
    
    for (const batchResult of batchResults) {
      if (batchResult.status === 'completed') {
        completedBatches++;
        
        // Add results to export list
        if (batchResult.results && Array.isArray(batchResult.results)) {
          exportedResults = exportedResults.concat(batchResult.results);
          
          // Count successes and failures
          completedCompanies += batchResult.results.filter(r => r.status === 'extraction_complete').length;
          failedCompanies += batchResult.results.filter(r => r.status === 'extraction_failed').length;
        }
      }
    }
    
    // Log summary
    console.log(`Processed ${completedBatches} completed batches`);
    console.log(`Found ${completedCompanies} successfully extracted companies and ${failedCompanies} failed companies`);
    await logToFile(`Processed ${completedBatches} completed batches`, logfile);
    await logToFile(`Found ${completedCompanies} successfully extracted companies and ${failedCompanies} failed companies`, logfile);
    
    // If we have any completed results, export them
    if (exportedResults.length > 0) {
      console.log(`Exporting ${exportedResults.length} company results`);
      const exportResults = await exportAllFormats(exportedResults);
      
      if (exportResults.json && exportResults.json.path) {
        console.log(`JSON output: ${exportResults.json.path}`);
        await logToFile(`Exported to JSON: ${exportResults.json.path} (${exportResults.json.count} profiles)`, logfile);
      }
      
      if (exportResults.csv && exportResults.csv.path) {
        console.log(`CSV output: ${exportResults.csv.path}`);
        await logToFile(`Exported to CSV: ${exportResults.csv.path} (${exportResults.csv.count} profiles)`, logfile);
      }
      
      if (exportResults.excel && exportResults.excel.path) {
        console.log(`Excel output: ${exportResults.excel.path}`);
        await logToFile(`Exported to Excel: ${exportResults.excel.path} (${exportResults.excel.count} profiles)`, logfile);
      }
    } else {
      console.log('No completed results to export at this time');
      await logToFile('No completed results to export at this time', logfile);
    }
    
    // Show status of remaining batches
    const activeBatches = await persistence.getActiveBatches();
    if (activeBatches.length > 0) {
      console.log(`Remaining active batches: ${activeBatches.length}`);
      await logToFile(`Remaining active batches: ${activeBatches.length}`, logfile);
      
      for (const batch of activeBatches) {
        const companyIds = await persistence.getBatchCompanyIds(batch.batch_id);
        console.log(`Batch ${batch.batch_id}: ${companyIds.length} companies, created at ${batch.created_at}`);
        
        // Check if the batch is about to expire
        const created = new Date(batch.created_at);
        const now = new Date();
        const hoursElapsed = (now - created) / (1000 * 60 * 60);
        
        if (hoursElapsed > 22) {
          const warning = `⚠️ Batch ${batch.batch_id} has been processing for ${hoursElapsed.toFixed(1)} hours and may expire soon!`;
          console.warn(warning);
          await logToFile(warning, logfile);
        }
      }
    } else {
      console.log('No active batches remaining');
      await logToFile('No active batches remaining', logfile);
    }
    
    // Generate and display token usage report
    console.log('\nToken Usage Report:');
    const usageReport = tokenTracker.generateUsageReport();
    console.log(usageReport);
    
    // Save token usage report and data
    const reportPath = await tokenTracker.saveUsageReport();
    const usagePath = await tokenTracker.saveTokenUsage();
    
    console.log(`Token usage report saved to: ${reportPath}`);
    console.log(`Token usage data saved to: ${usagePath}`);
    await logToFile(`Token usage report saved to: ${reportPath}`, logfile);
    await logToFile(`Token usage data saved to: ${usagePath}`, logfile);
    
    // Close database connection
    await persistence.closePersistence();
    console.log(`Log file: ${path.join(config.dataDir, logfile)}`);
    
  } catch (error) {
    console.error(`Error in batch check process: ${error.message}`);
    await logToFile(`Error in batch check process: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();