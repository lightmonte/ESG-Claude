/**
 * test-criteria.js
 * 
 * This is a test file to debug the ESG criteria loading.
 */

import esgCriteria from './lib/esg-criteria.js';

async function testCriteriaLoading() {
  console.log('==== Testing ESG Criteria Loading ====');
  
  // List all available industries
  const industries = await esgCriteria.getAllIndustries();
  console.log(`Found ${industries.length} industries`);
  console.log('Sample industries:', industries.slice(0, 10));
  
  // Test a few specific industries
  const testIndustries = [
    'technology', 
    'construction', 
    'energy_production',
    'it', 
    'food_processing',
    'general',
    'invalid_industry'
  ];
  
  for (const industry of testIndustries) {
    console.log(`\nTesting industry: ${industry}`);
    const criteria = await esgCriteria.getIndustryCriteria(industry);
    console.log(`Found ${criteria.length} criteria for ${industry}:`);
    
    criteria.forEach((criterion, index) => {
      console.log(`  ${index + 1}. ${criterion.id}: ${criterion.name_en}`);
    });
  }
}

// Run the test
testCriteriaLoading()
  .catch(console.error);
