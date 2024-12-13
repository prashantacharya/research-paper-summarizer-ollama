import fs from 'fs/promises';
import path from 'path';
import pdf from 'pdf-parse';
import os from 'os';
import crypto from 'crypto';
import ollama from 'ollama';

interface PaperSummary {
    title: string;
    authors: string[];
    tags: string[];
    researchQuestions: string[];
    methodology: string;
    keyFindings: string[];
    processedDate: string;
    fileHash: string;
    markdownContent: string;
    paperName: string;
}

interface ProcessedLog {
    [fileHash: string]: {
        path: string;
        processedDate: string;
        summaryPath: string;
    };
}

const LOGS_FILE = 'processed_papers_log.json';


async function getFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
}

async function loadProcessedLogs(): Promise<ProcessedLog> {
    try {
        const logContent = await fs.readFile(LOGS_FILE, 'utf-8');
        return JSON.parse(logContent);
    } catch (error) {
        // If file doesn't exist, return empty log
        return {};
    }
}

async function saveProcessedLogs(logs: ProcessedLog): Promise<void> {
    await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2));
}

async function callOllama(prompt: string): Promise<string> {
    const systemPrompt = `
    You are a helpful assistant that can summarize research papers.
    You will be given a research paper that you will need to summarize in the following format:
    
    # [Title of the paper]
    
    ## Authors
    - [Author 1]
    - [Author 2]
    ...

    ## Tags
    - [Tag 1]
    - [Tag 2]
    ...

    ## Research Questions
    - [Question 1]
    - [Question 2]
    ...

    ## Methodology
    [Detailed explanation of how the research was conducted]

    ## Key Findings
    - [Finding 1]
    - [Finding 2]
    ...
    `

    try {
        const response = await ollama.chat({
            model: 'llama3.2:3b',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: prompt
                }
            ]
        });

        return response.message.content;
    } catch (error) {
        console.error('Error calling Ollama:', error);
        throw error;
    }
}

async function generatePaperSummary(text: string, fileName: string = ''): Promise<PaperSummary> {
    const prompt = `
    Please analyze this research paper and provide a summary in the following markdown format:

    # [Title of the paper]
    
    ## Authors
    - [Author 1]
    - [Author 2]
    ...

    ## Tags
    - [Tag 1]
    - [Tag 2]
    ...

    ## Research Questions
    - [Question 1]
    - [Question 2]
    ...

    ## Methodology
    [Detailed explanation of how the research was conducted]

    ## Key Findings
    - [Finding 1]
    - [Finding 2]
    ...

    Here's the paper content:
    ${text}
    `;

    const response = await callOllama(text);

    const summary: PaperSummary = {
        title: '', // Extract from response
        authors: [], // Extract from response
        tags: [], // Extract from response
        researchQuestions: [], // Extract from response
        methodology: '', // Extract from response
        keyFindings: [], // Extract from response
        processedDate: new Date().toISOString(),
        fileHash: '',
        markdownContent: response,
        paperName: fileName
    };

    return summary;
}

async function readPDFs() {
    try {
        const zoteroPath = path.join(os.homedir(), 'Zotero', 'storage');
        const exportPath = path.join(process.cwd(), 'exports');
        await fs.mkdir(exportPath, { recursive: true });

        // Load the processing logs
        const processedLogs = await loadProcessedLogs();

        // Keep track of processed files in this run
        let processedCount = 0;
        let skippedCount = 0;

        const directories = await fs.readdir(zoteroPath);
        for (const dir of directories) {
            if (processedCount == 1) {
                break;
            }

            const dirPath = path.join(zoteroPath, dir);
            const stats = await fs.stat(dirPath);

            if (stats.isDirectory()) {
                const files = await fs.readdir(dirPath);

                for (const file of files) {
                    if (file.toLowerCase().endsWith('.pdf')) {
                        const pdfPath = path.join(dirPath, file);
                        const fileHash = await getFileHash(pdfPath);

                        // Check if file has already been processed
                        if (processedLogs[fileHash]) {
                            console.log(`Skipping already processed file: ${file}`);
                            skippedCount++;
                            continue;
                        }

                        try {
                            console.log(`Processing ${file}...`);

                            const dataBuffer = await fs.readFile(pdfPath);
                            const data = await pdf(dataBuffer);

                            const summary = await generatePaperSummary(data.text, file);
                            summary.fileHash = fileHash;

                            // Create unique filename based on the paper title or directory name
                            const baseFileName = dir;
                            const summaryPath = path.join(exportPath, `${baseFileName}_summary.json`);
                            const markdownPath = path.join(exportPath, `${baseFileName}_summary.md`);

                            // Save JSON summary
                            await fs.writeFile(
                                summaryPath,
                                JSON.stringify(summary, null, 2),
                                'utf-8'
                            );

                            // Save Markdown summary
                            await fs.writeFile(
                                markdownPath,
                                summary.markdownContent,
                                'utf-8'
                            );

                            // Update processing logs
                            processedLogs[fileHash] = {
                                path: pdfPath,
                                processedDate: new Date().toISOString(),
                                summaryPath: markdownPath
                            };

                            await saveProcessedLogs(processedLogs);
                            processedCount++;

                            console.log(`Created summary for ${file}`);
                        } catch (error) {
                            console.error(`Error processing ${file}:`, error);
                        }
                    }
                }
            }
        }

        console.log('\nProcessing Summary:');
        console.log(`Processed ${processedCount} new papers`);
        console.log(`Skipped ${skippedCount} already processed papers`);
        console.log(`Total papers in log: ${Object.keys(processedLogs).length}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

readPDFs();
