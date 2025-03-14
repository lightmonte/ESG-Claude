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
05. Actions and solutions for each criterion - both INTERNAL actions within the company and SOLUTIONS offered to customers that improve sustainability
06. Carbon footprint data (scope 1, 2, 3 and totals) 
07. Climate standards compliance (ISO 14001, EMAS, ISO 50001, CDP, SBTi)
08. Other important sustainability initiatives
09. Any sustainability-related controversies and company responses

For each criterion, extract:
- Maximum ${maxActions} concrete actions/solutions the company is taking, including any supporting numbers, percentages, and specific technical details
- List solutions for customers first, followed by internal actions (actions = internal measures implemented by the company, while solutions are products/services offered to customers that improve sustainability)
- For each action/solution, identify relevant direct text excerpts from the document that support it
- Format each action/solution as a bullet point with "# " followed by a concise description with specific details
- Keep each action/solution under 150 characters using original phrasing, terminology, and numerical values from the document
- Include quantitative information wherever available (numbers, percentages, years, etc.)
 
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
  "abstract": "Summary of business and sustainability strategy (max 500 characters)",
  "highlights": {
    "courage": "Most courageous sustainability initiative showing entrepreneurial courage (max 400 characters)",
    "action": "Most important internal sustainability action with biggest progress (max 400 characters)",
    "solution": "Most important customer sustainability solution with biggest impact (max 400 characters)"
  },
${criteriaStructure},
  "carbonFootprint": {
    "scope1_2022": "x.xxx t CO2e",
    "scope2_2022": "x.xxx t CO2e",
    "scope3_2022": "x.xxx t CO2e",
    "total_2022": "x.xxx t CO2e",
    "scope1_2023": "x.xxx t CO2e",
    "scope2_2023": "x.xxx t CO2e",
    "scope3_2023": "x.xxx t CO2e",
    "total_2023": "x.xxx t CO2e",
    "scope1_2024": "x.xxx t CO2e",
    "scope2_2024": "x.xxx t CO2e",
    "scope3_2024": "x.xxx t CO2e",
    "total_2024": "x.xxx t CO2e"
  },
  "climateStandards": {
    "iso14001": "Yes/No",
    "iso50001": "Yes/No",
    "emas": "Yes/No",
    "cdp": "Yes/No",
    "sbti": "Yes/No"
  },
  "otherInitiatives": "Other important sustainability initiatives not covered by criteria (max 1000 chars)",
  "controversies": "Any sustainability-related controversies in the last five years and company responses (max 1000 chars)"
}

FORMATTING REQUIREMENTS (CRITICAL):
1. Include EXACTLY the ${relevantCriteria.length} criteria listed above with their exact IDs as shown - do not add or remove any criteria
2. Include up to ${maxActions} actions/solutions per criterion - more is better if they are substantive and detailed
3. For criteria with no information, include an action with "# No specific actions found for [CRITERION NAME]"
4. Include ONLY information explicitly stated in the document
5. Look carefully for company information such as legal entity name, business description, address, founding year, employee count, and revenue
6. Generate the results in the document's original language (German or English) - don't translate
7. Use original wording from the document wherever possible
8. For carbon emissions, use x.xxx t CO2e format (calculate if needed)
9. Carbon footprint data is typically found in sections related to climate protection, emissions reporting, or environmental indicators
10. Format actions/solutions like this example: "# Reduktion der Temperatur in allen Fertigungshallen von 18–20°C um 4°C" or this example: "# Über 2.500 DGNB-zertifizierte Kundenhäuser bis Ende 2018 mit Gold- oder Platin-Status"
11. Each action/solution should include specific details, numbers and technical information from the document
12. For highlights, select the most impactful initiatives showing entrepreneurial courage, internal progress, and customer impact
13. For controversies, only include information if explicitly mentioned in the document
14. When a data point does not exist in the document, use "Not stated" or "Not found"

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
    // Example actions based on the Baufritz examples
    const exampleActions = [
      '"# Zentraler Baustoff der Voll-Werte-Häuser ist Holz: 100 % nachwachsender Rohstoff aus nachhaltig bewirtschafteten Wäldern"',
      '"# Bezug zu 100 % von kleinen/mittelständischen Betrieben aus Bayern, Baden Württemberg, Österreich, 80 % mit PEFC-/FSC-Zertifikaten"',
      '"# Bauelemente (Fenster/Türen/Treppen) ausschließlich von regionalen, mittelständischen Betrieben im Umkreis von 5 - 50 km"',
      '"# Reduktion der Temperatur in allen Fertigungshallen von 18–20°C um 4°C"',
      '"# Umstellung auf LED-Leuchtmittel im Betriebsurlaub Sommer 2023"',
      '"# Eigenstromproduktion von über 500.000 Kilowattstunden jährlich"',
      '"# 100% Ökostrom und Ökogas von Polarstern, Umstieg auf CO2-neutrales Propangas"',
      '"# 750 Tonnen CO2-Einsparung/Senke pro Jahr"'
    ];
    
    // Take the first maxActions example actions or all if less than maxActions
    const actionList = exampleActions.slice(0, maxActions).join(', ');
    
    // Format criterion structure with actions as direct array
    return `  "${criterion.id}": {
    "actions": [
      ${actionList}
    ]
  }`;
  }).join(',\n');
}

export default {
  createUserPrompt
};