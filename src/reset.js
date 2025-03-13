/**
 * reset.js
 * 
 * Utility script to reset the extraction status for all or specific companies
 * in the database, allowing for reprocessing.
 * 
 * Usage: 
 *   node src/reset.js             - Reset all companies
 *   node src/reset.js companyId   - Reset specific company
 */

import persistence from './lib/persistence.js';

async function main() {
  // Initialize the database
  await persistence.initPersistence();
  
  // Get the company ID from command line arguments if provided
  const companyId = process.argv[2] || null;
  
  if (companyId) {
    console.log(`Resetting extraction status for company: ${companyId}`);
  } else {
    console.log('Resetting extraction status for ALL companies');
  }
  
  // Reset the extraction status
  await persistence.resetExtractionStatus(companyId);
  
  // Show current status
  const statusRecords = await persistence.getAllProcessingStatus();
  console.log('\nCurrent Processing Status:');
  console.log(`Total companies tracked: ${statusRecords.length}`);
  console.log(`Companies with completed extraction: ${statusRecords.filter(r => r.extraction_status === 'extraction_complete').length}`);
  
  // Print details for the specific company if requested
  if (companyId) {
    const companyRecord = statusRecords.find(r => r.company_id === companyId);
    if (companyRecord) {
      console.log(`\nDetails for ${companyId}:`);
      console.log(JSON.stringify(companyRecord, null, 2));
    } else {
      console.log(`\nCompany ${companyId} not found in the database`);
    }
  }
  
  // Close the database connection
  await persistence.closePersistence();
}

// Run the main function
main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});