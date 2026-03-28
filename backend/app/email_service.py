"""
Email notification service for security alerts.
Uses Gmail SMTP with App Password.
"""

import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import List, Optional
from .config import get_settings


def send_email_async(to_emails: List[str], subject: str, body_html: str) -> None:
    """Send email in background thread to avoid blocking the API."""
    thread = threading.Thread(
        target=_send_email_sync,
        args=(to_emails, subject, body_html)
    )
    thread.daemon = True
    thread.start()


def _send_email_sync(to_emails: List[str], subject: str, body_html: str) -> bool:
    """Synchronous email sending - called by async wrapper."""
    settings = get_settings()
    
    if not settings.ALERT_EMAIL_ENABLED:
        print("[EMAIL] Alerts disabled - skipping email")
        return False
    
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        print("[EMAIL] SMTP credentials not configured")
        return False
    
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_USER
        msg["To"] = ", ".join(to_emails)
        
        # Plain text fallback
        body_text = body_html.replace("<br>", "\n").replace("</p>", "\n")
        import re
        body_text = re.sub(r'<[^>]+>', '', body_text)
        
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))
        
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, to_emails, msg.as_string())
        
        print(f"[EMAIL] Alert sent to {to_emails}")
        return True
        
    except Exception as e:
        print(f"[EMAIL] Failed to send: {e}")
        return False


def send_breakin_alert(
    recipient_emails: List[str],
    house_name: str,
    failed_attempts: int,
    last_method: Optional[str] = None,
) -> None:
    """Send break-in alert email to house admins."""
    
    if not recipient_emails:
        print("[EMAIL] No recipients for break-in alert")
        return
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    subject = f"🚨 Security Alert: {house_name} - Possible Break-in Attempt"
    
    body_html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; border: 2px solid #dc3545; border-radius: 10px; padding: 20px;">
            <h1 style="color: #dc3545; margin-top: 0;">🚨 Security Alert</h1>
            
            <p style="font-size: 16px;">
                <strong>{failed_attempts} consecutive failed unlock attempts</strong> 
                have been detected at your property.
            </p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>House:</strong></td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{house_name}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Time:</strong></td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{timestamp}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Failed Attempts:</strong></td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{failed_attempts}</td>
                </tr>
                {f'<tr><td style="padding: 10px;"><strong>Last Method:</strong></td><td style="padding: 10px;">{last_method}</td></tr>' if last_method else ''}
            </table>
            
            <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 15px; margin: 20px 0;">
                <strong>⚠️ Recommended Actions:</strong>
                <ul style="margin: 10px 0;">
                    <li>Check your security cameras if available</li>
                    <li>Enable lockdown mode from the dashboard</li>
                    <li>Contact local authorities if suspicious activity continues</li>
                </ul>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-bottom: 0;">
                This is an automated alert from your MFA Security System.
            </p>
        </div>
    </body>
    </html>
    """
    
    send_email_async(recipient_emails, subject, body_html)
