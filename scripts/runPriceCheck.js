const { processAllDueFlights } = require('../services/priceCheckService');
const { pool } = require('../database');

// --- Enhanced Debugging: High-precision timer ---
const { performance } = require('perf_hooks');

const runJob = async () => {
  const startTime = performance.now();
  console.log('================================================================');
  console.log(`[Cron Job Runner] Starting job at ${new Date().toISOString()}`);
  console.log(`[Cron Job Runner] Process ID: ${process.pid}`);
  console.log('================================================================');

  // --- Enhanced Debugging: Environment Variable Verification ---
  console.log('[Debug] Verifying essential environment variables...');
  const essentialVars = ['DATABASE_URL', 'AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'];
  let allVarsPresent = true;
  for (const v of essentialVars) {
    if (process.env[v]) {
      // For secrets, we only confirm presence, we NEVER log the value.
      const value = (v.includes('SECRET')) ? 'Loaded (value withheld for security)' : process.env[v];
      console.log(`  ✅ ${v}: ${value}`);
    } else {
      console.error(`  ❌ CRITICAL: Environment variable ${v} is NOT loaded.`);
      allVarsPresent = false;
    }
  }
  if (!allVarsPresent) {
    console.error('[Debug] Halting execution due to missing environment variables.');
    return; // Exit if critical variables are missing
  }
  console.log('[Debug] All essential environment variables are present.');
  
  try {
    console.log('[Debug] Attempting to process all due flights...');
    await processAllDueFlights();
    console.log('[Debug] Successfully completed the processAllDueFlights function call.');

  } catch (error) {
    // --- Enhanced Debugging: Detailed Error Logging ---
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[Cron Job Runner] A CRITICAL and unexpected error occurred during the job run:');
    console.error(`[Error Details] Message: ${error.message}`);
    console.error(`[Error Details] Name: ${error.name}`);
    console.error('[Error Details] Stack Trace:');
    console.error(error.stack);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

  } finally {
    // Gracefully close the database connection pool to allow the script to exit cleanly.
    console.log('[Debug] Entering finally block. Attempting to close database pool...');
    await pool.end();
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('[Debug] Database pool has been closed.');
    console.log('================================================================');
    console.log(`[Cron Job Runner] Job finished at ${new Date().toISOString()}.`);
    console.log(`[Cron Job Runner] Total execution time: ${duration} seconds.`);
    console.log('================================================================');
  }
};

// Execute the job
runJob();