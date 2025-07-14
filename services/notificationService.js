const sgMail = require('@sendgrid/mail');

// Set the API key from environment variables
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

/**
 * Sends a professionally formatted price drop alert email.
 * @param {object} emailData - The data needed to build the email.
 */
const sendPriceDropEmail = async (emailData) => {
    const {
        userEmail,
        flightDetails, // e.g., { departureAirport, arrivalAirport, airline, departureDate }
        newPrice,
        savingsThisDrop
    } = emailData;

    const subject = `💰 Price Drop Alert! Your flight to ${flightDetails.arrivalAirport} is now cheaper!`;

    // Professional HTML Email Template
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f7; }
                .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; text-align: center; }
                .header h1 { margin: 0; font-size: 28px; }
                .content { padding: 30px 40px; color: #333; line-height: 1.6; }
                .flight-info { background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 20px; margin-bottom: 20px; text-align: center; }
                .flight-info h2 { margin: 0 0 10px 0; font-size: 22px; color: #343a40; }
                .price-box { border: 2px solid #28a745; border-radius: 6px; padding: 20px; text-align: center; }
                .price-box .label { font-size: 16px; color: #6c757d; margin-bottom: 5px; }
                .price-box .price { font-size: 36px; font-weight: bold; color: #28a745; margin-bottom: 5px; }
                .price-box .savings { font-size: 18px; color: #28a745; font-weight: 500; }
                .button { display: inline-block; background-color: #667eea; color: #ffffff; padding: 12px 25px; border-radius: 5px; text-decoration: none; font-weight: bold; margin-top: 25px; }
                .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Great News!</h1>
                </div>
                <div class="content">
                    <p>We found a significant price drop for your upcoming trip:</p>
                    <div class="flight-info">
                        <h2>${flightDetails.departureAirport} → ${flightDetails.arrivalAirport}</h2>
                        <p style="margin:0; color: #495057;">${flightDetails.airline} - ${new Date(flightDetails.departureDate).toDateString()}</p>
                    </div>
                    <div class="price-box">
                        <div class="label">New Lower Price</div>
                        <div class="price">$${newPrice.toFixed(2)}</div>
                        <div class="savings">That's a new saving of $${savingsThisDrop.toFixed(2)}!</div>
                    </div>
                    <p style="text-align:center;">You can claim this difference from the airline. Log in to your dashboard to see more details and manage your trips.</p>
                    <div style="text-align: center;">
                        <a href="${CLIENT_URL}/dashboard" class="button">View My Dashboard</a>
                    </div>
                </div>
                <div class="footer">
                    <p>You are receiving this email because you are tracking this flight on FareAware.</p>
                    <p>&copy; ${new Date().getFullYear()} FareAware. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const msg = {
        to: userEmail,
        from: {
            name: 'FareAware Alerts',
            email: FROM_EMAIL,
        },
        subject: subject,
        html: htmlContent,
    };

    try {
        await sgMail.send(msg);
        console.log(`Price drop email sent successfully to ${userEmail} for flight to ${flightDetails.arrivalAirport}.`);
    } catch (error) {
        console.error(`Error sending email via SendGrid to ${userEmail}:`, error);
        if (error.response) {
            // Log detailed error from SendGrid
            console.error(JSON.stringify(error.response.body, null, 2));
        }
    }
};

module.exports = {
    sendPriceDropEmail,
};
