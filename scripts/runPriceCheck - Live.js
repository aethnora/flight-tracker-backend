const { processAllDueFlights } = require('../services/priceCheckService');
const { pool } = require('../database');

const runJob = async () => {
  console.log(`[Cron Job Runner] Starting job at ${new Date().toISOString()}`);
  
  try {
    await processAllDueFlights();
  } catch (error) {
    console.error('[Cron Job Runner] An unexpected error occurred during the job run:', error);
  } finally {
    // Gracefully close the database connection pool to allow the script to exit cleanly.
    await pool.end();
    console.log(`[Cron Job Runner] Job finished at ${new Date().toISOString()}. Database pool closed.`);
  }
};

// Execute the job
runJob();