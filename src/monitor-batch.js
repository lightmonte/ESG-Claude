/**
 * monitor-batch.js
 * 
 * This script monitors batch processing status and automatically
 * runs the exporter when all batches are complete.
 */

import Anthropic from '@anthropic-ai/sdk';
import config from './config.js';
import { exportAllFormats } from './exporter.js';
import * as persistence from './lib/persistence.js';
import { logToFile } from './utils.js';
import path from 'path';

// Initialize the Claude client
const anthropic = new Anthropic({
  apiKey: config.claudeApiKey
});

// Check if batch API is available
const isBatchAPIAvailable = !!(anthropic && anthropic.messages && anthropic.messages.batches);
if (!isBatchAPIAvailable) {
  console.error('Batch API is not available in the current SDK version.');
  process.exit(1);
}

// Default check interval in milliseconds (can be overridden with command line arg)
const DEFAULT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check batch status
 * @param {string} batchId - ID of the batch to check
 * @returns {Promise<Object>} Batch status object
 */
async function checkBatchStatus(batchId) {
  try {
    const batch = await anthropic.messages.batches.retrieve(batchId);
    return batch;
  } catch (error) {
    console.error(`Error checking batch ${batchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Format time remaining estimate
 * @param {number} minutes - Minutes remaining
 * @returns {string} Formatted time string
 */
function formatTimeRemaining(minutes) {
  if (minutes < 60) {
    return `${Math.ceil(minutes)} minute${Math.ceil(minutes) !== 1 ? 's' : ''}`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.ceil(minutes % 60);
    return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  }
}

/**
 * Display batch progress
 * @param {Object} batch - Batch status object
 * @param {number} elapsedMinutes - Minutes elapsed since start of monitoring
 */
function displayProgress(batch, elapsedMinutes) {
  const total = batch.request_counts.processing + 
                batch.request_counts.succeeded + 
                batch.request_counts.errored +
                batch.request_counts.canceled +
                batch.request_counts.expired;
                
  const completed = batch.request_counts.succeeded + 
                    batch.request_counts.errored +
                    batch.request_counts.canceled +
                    batch.request_counts.expired;
                    
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  // Calculate estimated time remaining
  let timeRemaining = "unknown";
  if (percentComplete > 0 && elapsedMinutes > 0) {
    const minutesPerPercent = elapsedMinutes / percentComplete;
    const minutesRemaining = minutesPerPercent * (100 - percentComplete);
    timeRemaining = formatTimeRemaining(minutesRemaining);
  }
  
  // Create a progress bar
  const progressBarLength = 30;
  const filledLength = Math.round((percentComplete / 100) * progressBarLength);
  const progressBar = '█'.repeat(filledLength) + '░'.repeat(progressBarLength - filledLength);
  
  console.clear();
  console.log('=== Batch Processing Monitor ===');
  console.log(`\nBatch ID: ${batch.id}`);
  console.log(`Status: ${batch.processing_status.toUpperCase()}`);
  console.log(`Progress: ${percentComplete}% [${progressBar}]`);
  console.log('\nRequest counts:');
  console.log(`  Processing: ${batch.request_counts.processing}`);
  console.log(`  Succeeded: ${batch.request_counts.succeeded}`);
  console.log(`  Errored: ${batch.request_counts.errored}`);
  console.log(`  Canceled: ${batch.request_counts.canceled}`);
  console.log(`  Expired: ${batch.request_counts.expired}`);
  console.log(`\nStarted: ${new Date(batch.created_at).toLocaleString()}`);
  console.log(`Elapsed time: ${formatTimeRemaining(elapsedMinutes)}`);
  console.log(`Estimated time remaining: ${timeRemaining}`);
  console.log('\nPress Ctrl+C to stop monitoring (batch will continue processing)');
}

/**
 * Process completed batch results and run exporter
 * @param {Object} batch - Completed batch object
 */
async function processCompletedBatch(batch) {
  console.log(`\n✅ Batch ${batch.id} has completed processing!`);
  
  try {
    // Import the batch module dynamically to avoid circular dependencies
    const { processBatchResults } = await import('./claude-batch-extractor.js');
    
    console.log('Processing batch results...');
    const batchResults = await processBatchResults(batch.id);
    
    if (batchResults.status === 'completed' && batchResults.results) {
      console.log(`Successfully processed ${batchResults.results.filter(r => r.status === 'extraction_complete').length} results`);
      
      // Run the exporter
      console.log('\nRunning exporter...');
      const exportResults = await exportAllFormats(batchResults.results);
      
      // Display export results
      if (exportResults.json && exportResults.json.path) {
        console.log(`JSON output: ${exportResults.json.path} (${exportResults.json.count} profiles)`);
      }
      
      if (exportResults.csv && exportResults.csv.path) {
        console.log(`CSV output: ${exportResults.csv.path} (${exportResults.csv.count} profiles)`);
      }
      
      if (exportResults.excel && exportResults.excel.path) {
        console.log(`Excel output: ${exportResults.excel.path} (${exportResults.excel.count} profiles)`);
      }
      
      console.log('\n🎉 All processing completed successfully!');
    } else {
      console.log(`Batch processing completed with status: ${batchResults.status}`);
    }
  } catch (error) {
    console.error(`Error processing completed batch: ${error.message}`);
  }
}

/**
 * Monitor a specific batch until completion
 * @param {string} batchId - ID of the batch to monitor
 * @param {number} checkInterval - Check interval in milliseconds
 */
async function monitorBatch(batchId, checkInterval = DEFAULT_CHECK_INTERVAL) {
  console.log(`Starting monitoring of batch ${batchId}`);
  console.log(`Will check status every ${checkInterval / 1000} seconds`);
  
  const startTime = new Date();
  let isComplete = false;
  
  while (!isComplete) {
    try {
      const batch = await checkBatchStatus(batchId);
      
      // Calculate elapsed time
      const elapsedMs = new Date() - startTime;
      const elapsedMinutes = elapsedMs / 1000 / 60;
      
      // Display progress
      displayProgress(batch, elapsedMinutes);
      
      // Check if batch is complete
      if (batch.processing_status === 'ended') {
        isComplete = true;
        console.log('\n✨ Batch processing has completed!');
        await processCompletedBatch(batch);
        break;
      }
      
      // Check if batch is about to expire
      const created = new Date(batch.created_at);
      const now = new Date();
      const hoursElapsed = (now - created) / (1000 * 60 * 60);
      
      if (hoursElapsed > 22) {
        console.warn(`⚠️ Warning: Batch ${batchId} has been processing for ${hoursElapsed.toFixed(1)} hours and may expire soon!`);
      }
      
      // Wait for next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      console.error(`Error monitoring batch: ${error.message}`);
      console.log('Will retry in 1 minute...');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

/**
 * Find and monitor active batches
 */
async function findAndMonitorActiveBatches() {
  try {
    // Initialize persistence if needed
    await persistence.initPersistence();
    
    // Find active batches
    const activeBatches = await persistence.getActiveBatches();
    
    if (activeBatches.length === 0) {
      console.log('No active batches found to monitor.');
      return;
    }
    
    console.log(`Found ${activeBatches.length} active ${activeBatches.length === 1 ? 'batch' : 'batches'} to monitor.`);
    
    // Get the check interval
    const checkIntervalArg = process.argv.find(arg => arg.startsWith('--interval='));
    let checkInterval = DEFAULT_CHECK_INTERVAL;
    
    if (checkIntervalArg) {
      const intervalValue = checkIntervalArg.split('=')[1];
      checkInterval = parseInt(intervalValue) * 1000;
    }
    
    // Monitor the most recent active batch
    const latestBatch = activeBatches.sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    )[0];
    
    console.log(`Monitoring batch ${latestBatch.batch_id} (created ${new Date(latestBatch.created_at).toLocaleString()})`);
    
    await monitorBatch(latestBatch.batch_id, checkInterval);
  } catch (error) {
    console.error(`Error finding active batches: ${error.message}`);
  } finally {
    // Close database connection
    await persistence.closePersistence();
  }
}

/**
 * Main function
 */
async function main() {
  // Check if a batch ID was provided as a command-line argument
  const batchIdArg = process.argv.find(arg => arg.startsWith('--batchId='));
  
  if (batchIdArg) {
    const batchId = batchIdArg.split('=')[1];
    
    // Get the check interval
    const checkIntervalArg = process.argv.find(arg => arg.startsWith('--interval='));
    let checkInterval = DEFAULT_CHECK_INTERVAL;
    
    if (checkIntervalArg) {
      const intervalValue = checkIntervalArg.split('=')[1];
      checkInterval = parseInt(intervalValue) * 1000;
    }
    
    await monitorBatch(batchId, checkInterval);
  } else {
    // No batch ID provided, find and monitor active batches
    await findAndMonitorActiveBatches();
  }
}

// Run the main function
main().catch(console.error);
