/**
 * user-prompt.js
 *
 * This module provides user prompts for Claude API interactions.
 */

import { getCriterionDescription } from '../lib/data/criteria-descriptions.js';

/**
 * Create a user prompt for ESG extraction
 * @param {string} documentUrl - URL of the document (PDF or website) to analyze
 * @param {Array} relevantCriteria - Array of relevant criteria for the industry
 * @param {Object} options - Additional options
 * @returns {string} - User prompt
 */
export function createUserPrompt(documentUrl, relevantCriteria, options = {}) {
  const { 
    includeCriteriaDescriptions = true,
    maxActions = 5,
    isBatch = false,
    contentType = 'pdf',  // 'pdf' or 'website'
    websiteContent = null // For website content extraction
  } = options;
  
  // Format criteria list for the prompt with descriptions and keywords
  const criteriaList = formatCriteriaList(relevantCriteria, includeCriteriaDescriptions);
  
  // Create the criteria structure for the JSON
  const criteriaStructure = createCriteriaStructure(relevantCriteria, maxActions);
  
  // Different intro based on content type
  let promptIntro;
  if (contentType === 'pdf') {
    promptIntro = `Extract ESG information from the sustainability report at URL: ${documentUrl}`;
  } else {
    promptIntro = `Extract ESG information from the website at URL: ${documentUrl}

The website content has been extracted and is provided below:`;
    
    // If we have website content, append it to the prompt
    if (websiteContent) {
      promptIntro += `\n\n${websiteContent}`;
    }
  }
  
  return `${promptIntro}

Extract information for EXACTLY the following ${relevantCriteria.length} ESG criteria (no more, no less):
${criteriaList}

Your goal is to extract the following information:
01. Detailed company information:
   - Legal entity name (full legal name of the company)
   - Business description (what the company does)
   - Sector and detailed industry classification
   - Address (street, zip/postal code, city, country)
   - Contact information (phone number, email address, website)
   - Founding year (when the company was established)
   - Employee range (number of employees or range)
   - Revenue range (annual revenue or range)
02. Company name, report year/period, and title
03. Overall sustainability abstract (max 500 characters)
04. Three highlights:
   - Highest entrepreneurial courage (max 400 characters)
   - Most important internal sustainability action (max 400 characters)
   - Most important customer sustainability solution (max 400 characters)
05. Actions and solutions for each criterion
06. Carbon footprint data (scope 1, 2, 3 and totals) for available years
07. Climate standards compliance (ISO 14001, EMAS, ISO 50001, CDP, SBTi)
08. Other important sustainability initiatives
09. Any sustainability-related controversies and company responses

For each criterion, extract:
- Maximum ${maxActions} concrete actions/solutions the company is taking, including any supporting numbers
- For each action/solution, identify relevant direct text excerpts from the document that support it
 
Format your response as a JSON object with this structure:
{
  "companyDetails": {
    "legalEntityName": "Full legal name of the company",
    "businessDescription": "Description of the company's business",
    "sector": "Main sector",
    "address": {
      "street": "Street address",
      "zipCode": "Postal/zip code",
      "city": "City",
      "country": "Country"
    },
    "contactInfo": {
      "phoneNumber": "Company phone number",
      "emailAddress": "Company email",
      "website": "Company website"
    },
    "foundingYear": "Year the company was founded",
    "employeeRange": "Number of employees or range",
    "revenueRange": "Annual revenue or range"
  },
  "basicInformation": {
    "companyName": "Name",
    "reportYear": "Year",
    "reportTitle": "Title"
  },
  "abstract": "Summary of business and sustainability strategy",
  "highlights": {
    "courage": "Most courageous initiative",
    "action": "Most important internal action",
    "solution": "Most important customer solution"
  },
${criteriaStructure},
  "carbonFootprint": {
    "scope1": "x.xxx t CO2e (year)",
    "scope2": "x.xxx t CO2e (year)",
    "scope3": "x.xxx t CO2e (year)",
    "total": "x.xxx t CO2e (year)"
  },
  "climateStandards": {
    "iso14001": "Yes/No",
    "iso50001": "Yes/No",
    "emas": "Yes/No",
    "cdp": "Yes/No",
    "sbti": "Yes/No"
  },
  "otherInitiatives": "Other important sustainability initiatives (max 1000 chars)",
  "controversies": "Any controversies and responses (max 1000 chars)"
}

FORMATTING REQUIREMENTS (CRITICAL):
1. Include EXACTLY the ${relevantCriteria.length} criteria listed above with their exact IDs as shown - do not add or remove any criteria
2. Include a MAXIMUM of ${maxActions} actions/solutions per criterion (less if fewer are mentioned in the document). These should be the TOP actions of the company in this criterion.
3. Keep each action under 150 characters
4. Format each action/solution as a bullet point starting with "#"
5. Rank actions by importance (customer solutions first, then internal actions)
6. For the "extracts" field, include direct quotes from the document that supports the actions

CONTENT REQUIREMENTS:
1. YOUR RESPONSE MUST INCLUDE ALL ${relevantCriteria.length} CRITERIA LISTED ABOVE WITH THEIR EXACT IDs, even if there's limited or no information for some criteria
2. For criteria with no information, include an action with "# No specific actions found for [CRITERION NAME]" and note "No relevant information found in the report for [CRITERION NAME]" in extracts
3. Include ONLY information explicitly stated in the document
4. Look carefully for company information such as legal entity name, business description, address, founding year, employee count, and revenue
5. Generate the results in the document's original language (German or English) - don't translate
6. Use original wording from the document where possible
7. For carbon emissions, use x.xxx t CO2e format (calculate if needed)
8. When a data point does not exist in the document, say "Not stated" in the extracts field

FINAL VERIFICATION:
Before submitting, verify that:
1. You've included only information explicitly stated in the document
2. All actions/solutions are formatted correctly with "#" and under 150 characters
3. You've addressed all ${relevantCriteria.length} required criteria
4. Your output is valid, parseable JSON
5. You've preserved the original language of the document

Your response MUST be valid JSON that can be parsed with JSON.parse().`;
}

/**
 * Format a list of criteria for the prompt
 * @param {Array} criteria - Array of criteria objects
 * @param {boolean} includeDescriptions - Whether to include descriptions
 * @returns {string} - Formatted criteria list
 */
function formatCriteriaList(criteria, includeDescriptions = false) {
  return criteria.map(criterion => {
    const description = getCriterionDescription(criterion.id);
    let item = `- ${criterion.id}: ${criterion.name_en}`;
    
    if (includeDescriptions && description) {
      item += `\n  Description: ${description.description}`;
      item += `\n  Typical keywords: ${description.keywords.join(', ')}`;
    }
    
    return item;
  }).join('\n\n');
}

/**
 * Create criteria structure for JSON example
 * @param {Array} criteria - Array of criteria objects
 * @param {number} maxActions - Maximum number of actions per criterion
 * @returns {string} - Formatted criteria structure
 */
function createCriteriaStructure(criteria, maxActions = 5) {
  return criteria.map(criterion => {
    // Create example actions
    const exampleActions = Array.from({ length: maxActions }, (_, i) => `"# Action ${i + 1}"`).join(', ');
    
    return `  "${criterion.id}": {
    "actions": [
      ${exampleActions}
    ],
    "extracts": "Key supporting evidence from the document for the actions listed above."
  }`;
  }).join(',\n');
}

export default {
  createUserPrompt
};