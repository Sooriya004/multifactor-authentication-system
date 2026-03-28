"""
Test script to simulate a break-in alert email.
Run this from the backend folder: python test_email.py
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Email configuration (same as .env)
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "idkcozik@gmail.com"
SMTP_PASSWORD = "qiphnzajtubzmpxz"

def test_email():
    print("=" * 50)
    print("Email Configuration Test")
    print("=" * 50)
    print(f"SMTP Host: {SMTP_HOST}")
    print(f"SMTP Port: {SMTP_PORT}")
    print(f"SMTP User: {SMTP_USER}")
    print("=" * 50)
    
    test_recipient = SMTP_USER
    
    print(f"\n📧 Sending test alert to: {test_recipient}")
    print("Please wait...")
    
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "🚨 TEST: MFA Security Alert"
        msg["From"] = SMTP_USER
        msg["To"] = test_recipient
        
        body_html = """
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; border: 2px solid #28a745; border-radius: 10px; padding: 20px;">
                <h1 style="color: #28a745;">✅ Email Test Successful!</h1>
                <p>This is a <strong>test email</strong> from your MFA Security System.</p>
                <p>If you received this, email alerts are working correctly.</p>
                <hr>
                <p style="color: #666; font-size: 12px;">
                    When a real break-in attempt is detected (3 consecutive failed unlocks),
                    you will receive a similar alert with details about the incident.
                </p>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body_html, "html"))
        
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, [test_recipient], msg.as_string())
        
        print("✅ Test email sent successfully!")
        print(f"   Check your inbox at: {test_recipient}")
        
    except Exception as e:
        print(f"❌ Failed to send email: {e}")

if __name__ == "__main__":
    test_email()
