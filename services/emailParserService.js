const cheerio = require('cheerio');
const { pool } = require('../database');

/**
 * Finds a user in the database by their email address.
 * @param {string} email - The email address to look for.
 * @returns {object|null} The user object or null if not found.
 */
const findUserByEmail = async (email) => {
    // The 'from' field in the webhook might be "Sender Name <email@example.com>"
    // We need to extract just the email address.
    const emailMatch = email.match(/<(.+)>/);
    const cleanEmail = emailMatch ? emailMatch[1] : email.trim();

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    return result.rows.length > 0 ? result.rows[0] : null;
};

/**
 * Scrapes flight details from an email's HTML body.
 * NOTE: This is a simplified example. You will need to add specific selectors
 * for each airline you want to support.
 * @param {string} htmlBody - The HTML content of the email.
 * @returns {object} A structured object with flight details.
 */
const scrapeFlightDetails = (htmlBody) => {
    const $ = cheerio.load(htmlBody);

    // --- This section requires extensive testing with real emails ---
    // Example for a fictional "Galaxy Airlines" confirmation
    const bookingReference = $('td:contains("Booking Reference")').next().text().trim() || 'Not Found';
    const departureAirport = $('span[data-test-id="departure-airport-code"]').text().trim(); // Example selector
    const arrivalAirport = $('span[data-test-id="arrival-airport-code"]').text().trim(); // Example selector

    // Logic to find dates and distinguish one-way vs roundtrip
    const flightSegments = $('.flight-segment'); // A container for each flight
    const all_dates = [];
    const all_times = [];
    flightSegments.each((i, segment) => {
        const date = $(segment).find('.flight-date').text().trim(); // e.g., "2025-12-10"
        const time = $(segment).find('.flight-time').text().trim(); // e.g., "10:30"
        if (date) all_dates.push(date);
        if (time) all_times.push(time);
    });

    const isRoundTrip = all_dates.length > 1;

    const totalPriceText = $('strong:contains("Total Price")').parent().text().replace(/[^0-9.]/g, '');
    const totalPrice = parseFloat(totalPriceText) || 0;
    // --- End of airline-specific section ---

    // Standardize the output to match your database schema
    return {
        bookingReference,
        departureAirport,
        arrivalAirport,
        departureDate: all_dates[0] || null,
        departureTime: all_times[0] || null,
        arrivalDate: isRoundTrip ? all_dates[1] : null, // Assumes non-stop
        arrivalTime: isRoundTrip ? all_times[1] : null, // Assumes non-stop
        allDates: all_dates,
        allTimes: all_times,
        totalPrice,
        // ... add other fields like airline, flightNumber, etc.
    };
};

/**
 * Main function to process an inbound email.
 * @param {object} parsedEmail - The JSON object from SendGrid's webhook.
 * @returns {object} The newly created flight record.
 */
const processInboundEmail = async (parsedEmail) => {
    const fromEmail = parsedEmail.from;
    const user = await findUserByEmail(fromEmail);

    if (!user) {
        throw new Error(`User not found for email: ${fromEmail}`);
    }

    const htmlBody = parsedEmail.html || '';
    if (!htmlBody) {
        throw new Error('Email has no HTML body to parse.');
    }

    const flightData = scrapeFlightDetails(htmlBody);

    // Attach the user ID to the scraped data
    flightData.userId = user.user_id;
    flightData.email = user.email; // Useful for creating the user if they don't exist

    // You can now pass this structured data to your existing trip creation logic
    return flightData;
};

module.exports = { processInboundEmail };