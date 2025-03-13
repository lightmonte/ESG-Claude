/**
 * esg-criteria.js
 * 
 * This module defines ESG criteria and industry mappings.
 * Each industry has exactly 7 criteria as per requirements.
 * 
 * This module now uses the IndustryCriteriaSimple.csv data format.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { criteriaDescriptions } from './data/criteria-descriptions.js';

// Default criteria (fallback)
const defaultCriteria = [
  { id: "carbon_footprint", name_en: "Carbon Footprint" },
  { id: "energy_efficiency", name_en: "Energy efficiency" },
  { id: "renewable_energies", name_en: "Renewable energies" },
  { id: "waste_management", name_en: "Waste management" },
  { id: "water_management", name_en: "Water management" },
  { id: "diversity_inclusion", name_en: "Diversity and inclusion" },
  { id: "social_responsibility", name_en: "Social responsibility" }
];

// Path to the CSV file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const criteriaFilePath = path.join(__dirname, '../../data/IndustryCriteriaSimple.csv');

// Cached industry criteria
let industrySimpleCriteria = {};
let isLoaded = false;

/**
 * Load industry criteria data from the CSV file
 * @returns {Promise<void>}
 */
async function loadCriteriaFromCsv() {
  try {
    if (isLoaded) return;
    
    console.log(`Loading industry criteria from ${criteriaFilePath}`);
    
    // Read the CSV file
    const fileContent = await fs.readFile(criteriaFilePath, 'utf8');
    
    // Parse the CSV content (skip the header row)
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });
    
    // Transform the records into our format
    records.forEach(record => {
      const industry = record.Industry;
      if (!industry) return;
      
      // Create an array of 7 criteria for this industry using column values directly
      const criteria = [
        { id: `${industry.toLowerCase()}_1`, name_en: record["Criterion 1"] || "Carbon Footprint" },
        { id: `${industry.toLowerCase()}_2`, name_en: record["Criterion 2"] || "Energy efficiency" },
        { id: `${industry.toLowerCase()}_3`, name_en: record["Criterion 3"] || "Renewable energies" },
        { id: `${industry.toLowerCase()}_4`, name_en: record["Criterion 4"] || "Waste management" },
        { id: `${industry.toLowerCase()}_5`, name_en: record["Criterion 5"] || "Water management" },
        { id: `${industry.toLowerCase()}_6`, name_en: record["Criterion 6"] || "Diversity and inclusion" },
        { id: `${industry.toLowerCase()}_7`, name_en: record["Criterion 7"] || "Social responsibility" }
      ];
      
      // Store the criteria for this industry
      industrySimpleCriteria[industry.toLowerCase()] = criteria;
    });
    
    console.log(`Loaded criteria for ${Object.keys(industrySimpleCriteria).length} industries`);
    isLoaded = true;
  } catch (error) {
    console.error(`Error loading industry criteria: ${error.message}`);
    throw error;
  }
}

/**
 * Get all industries
 * @returns {Promise<Array<string>>} - Array of industry names
 */
export async function getAllIndustries() {
  await loadCriteriaFromCsv();
  return Object.keys(industrySimpleCriteria);
}

/**
 * Get the 7 criteria for a specific industry
 * @param {string} industryId - Industry identifier
 * @returns {Promise<Array>} - Array of exactly 7 criteria objects for that industry
 */
export async function getIndustryCriteria(industry) {
  // Make sure criteria are loaded
  await loadCriteriaFromCsv();
  
  // Clean up the input - convert to lowercase and trim
  const cleanIndustry = industry ? industry.toLowerCase().trim() : '';
  console.log(`Looking for industry criteria: '${cleanIndustry}'`);
  
  // Direct match
  if (cleanIndustry && industrySimpleCriteria[cleanIndustry]) {
    console.log(`Found direct match for '${cleanIndustry}'`);
    return industrySimpleCriteria[cleanIndustry];
  }
  
  // Case-insensitive match
  const industryKeys = Object.keys(industrySimpleCriteria);
  for (const key of industryKeys) {
    if (key.toLowerCase() === cleanIndustry) {
      console.log(`Found case-insensitive match for '${cleanIndustry}' as '${key}'`);
      return industrySimpleCriteria[key];
    }
  }
  
  // Partial match (if industry is part of the key)
  if (cleanIndustry) {
    for (const key of industryKeys) {
      if (key.toLowerCase().includes(cleanIndustry)) {
        console.log(`Found partial match for '${cleanIndustry}' in '${key}'`);
        return industrySimpleCriteria[key];
      }
    }
  }

  // Try to match by specific industry codes for "11_telecommunication" format
  if (cleanIndustry.includes('_')) {
    const parts = cleanIndustry.split('_');
    const industryPart = parts[parts.length - 1];
    console.log(`Extracted industry part '${industryPart}' from '${cleanIndustry}'`);
    
    // Try to match the extracted part
    if (industrySimpleCriteria[industryPart]) {
      console.log(`Found match for extracted part '${industryPart}'`);
      return industrySimpleCriteria[industryPart];
    }
  }

  // Fall back to default criteria
  console.log(`No criteria found for '${cleanIndustry}', using default criteria`);
  return defaultCriteria;
}

/**
 * Get detailed information about an industry
 * @param {string} industryId - Industry identifier
 * @returns {Promise<Object>} - Industry details with criteria
 */
export async function getIndustryDetails(industryId) {
  // Get the criteria for this industry
  const criteria = await getIndustryCriteria(industryId);
  
  // Add descriptions to criteria if available
  const criteriaWithDescriptions = criteria.map(criterion => {
    const criterionId = criterion.id.toLowerCase();
    const description = criteriaDescriptions[criterionId];
    
    return {
      ...criterion,
      description: description ? description.description : undefined,
      keywords: description ? description.keywords : undefined
    };
  });
  
  return {
    id: industryId,
    criteria: criteriaWithDescriptions
  };
}

export default {
  getAllIndustries,
  getIndustryCriteria,
  getIndustryDetails
};