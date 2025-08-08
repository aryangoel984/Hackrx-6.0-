// // server.js
// const express = require('express');
// const path = require('path');
// const fs = require('fs');

// const app = express();
// const port = 3000;

// // Middleware to parse JSON
// app.use(express.json());

// // Serve the HTML manually
// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'index.html'));
// });

// // Handle sum API
// app.post('/api/v1/sum', (req, res) => {
//     const a = parseFloat(req.body.a);
//     const b = parseFloat(req.body.b);

//     const sum = a + b;
//     res.json({ sum });
// });

// // Start server
// app.listen(port, () => {
//     console.log(`Server running at http://localhost:${port}`);
// });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const pdf = require('pdf-parse');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
// app.use(express.static('public'));

// Serve the frontend 
app.get('/api/v1', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// LLM Configuration (placeholder for API key)
const LLM_CONFIG = {
  // Use the new environment variable for your Gemini key
  apiKey: process.env.GEMINI_API_KEY,
  // Update the endpoint with a valid model name
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
};

// Helper function to extract text from PDF URL
async function extractTextFromPDF(pdfUrl) {
  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer'
    });
    
    const pdfBuffer = Buffer.from(response.data);
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

// Helper function to query LLM
// Helper function to query Gemini LLM
// New function to handle all questions in one API call
async function getAnswersFromLLM(documentText, questions) {
  const fullEndpoint = `${LLM_CONFIG.endpoint}?key=${LLM_CONFIG.apiKey}`;

  // Format the questions into a numbered list for clarity in the prompt
  const formattedQuestions = questions.map((q, index) => `${index + 1}. ${q}`).join('\n');

  // Create a single, powerful prompt asking the model to answer all questions at once
  // and to format the output as a JSON array for easy parsing.
  const combinedPrompt = `You are an expert document analyst. Your task is to answer a series of questions based strictly on the provided document content.

DOCUMENT CONTEXT:
---
${documentText}
---

Based *only* on the document context provided above, answer the following questions.
Provide your response as a single, valid JSON array of strings, where each string is the answer to a question in the corresponding order.

For example, for 2 questions, the output should be a JSON block like:
["Answer to question 1.", "Answer to question 2."]

If the information for a question is not available in the document, the string for that answer must be "The information is not available in the document."

Do not include any text, explanation, or markdown formatting (like \`\`\`json) before or after the JSON array. Your entire response must be the JSON array itself.

QUESTIONS:
${formattedQuestions}
`;

  // The Gemini API request body
  const requestBody = {
    contents: [{
      parts: [{ text: combinedPrompt }]
    }],
    generationConfig: {
      // Increase max output tokens to ensure there's enough room for all answers
      maxOutputTokens: 2048, 
      temperature: 0.1,
      // Instruct the model to output JSON directly
      responseMimeType: "application/json",
    }
  };

  try {
    console.log("Sending a single batch request for all questions to the LLM...");
    const response = await axios.post(fullEndpoint, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });

    // The Gemini API, when asked for JSON, places the parsed object directly in the response
    const candidates = response.data?.candidates;
    if (candidates && candidates.length > 0) {
      const responseText = candidates[0].content.parts[0].text;
      console.log("Received raw JSON string from LLM:", responseText);
      
      // The response should be a clean JSON string, so we parse it.
      const answers = JSON.parse(responseText);

      if (Array.isArray(answers) && answers.length === questions.length) {
        console.log("Successfully parsed answers.");
        return answers;
      } else {
        throw new Error("Parsed response is not a valid array or has a mismatched number of answers.");
      }
    } else {
        const blockReason = response.data.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(`Request was blocked by the API. Reason: ${blockReason}.`);
        }
        throw new Error('The API returned an empty or invalid response structure.');
    }
  } catch (error) {
    if (error.response) {
      console.error('Error querying LLM - API responded with:', error.response.status, error.response.data);
      throw new Error(`LLM API error: ${error.response.status} - ${JSON.stringify(error.response.data.error?.message)}`);
    } else {
      console.error('Error parsing LLM response or sending request:', error.message);
      throw new Error(`Failed to process questions with LLM. Details: ${error.message}`);
    }
  }
}
// Main API endpoint
app.post('/api/v1/hackrx/run', async (req, res) => {
  try {
    // 1. Validate authorization token
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.AUTH_TOKEN;
    
    if (!authHeader || authHeader !== expectedToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing authorization token'
      });
    }

    // 2. Validate the incoming request body
    const { documents, questions } = req.body;
    
    if (!documents || typeof documents !== 'string' || !questions || !Array.isArray(questions)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing or invalid `documents` URL or `questions` array'
      });
    }

    // 3. Extract text content from the provided PDF URL
    console.log('Step 1: Extracting text from PDF...');
    const documentText = await extractTextFromPDF(documents);
    console.log('PDF text extracted successfully.');

    // 4. Send the document text and all questions to the LLM in a single call
    console.log('Step 2: Processing all questions with LLM in a single batch...');
    const answers = await getAnswersFromLLM(documentText, questions);
    console.log('Received answers from LLM.');

    // 5. Return the final answers in the specified JSON format
    res.status(200).json({
      answers: answers
    });

  } catch (error) {
    // Catch any errors that occur during the process and send a detailed server error response
    console.error('Error in /hackrx/run endpoint:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process the request',
      details: error.message // Provide the specific error message for easier debugging
    });
  }
});

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'LLM Query Retrieval System'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 LLM Query Retrieval System running on http://localhost:${PORT}`);
  console.log(`📋 API endpoint: http://localhost:${PORT}/api/v1/hackrx/run`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/v1/health`);
});

module.exports = app;
