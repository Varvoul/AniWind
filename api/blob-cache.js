// Minimal Blob Cache - Test Version
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  // Parse body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { action } = body || {};

  switch (action) {
    case 'ping':
      return res.json({ 
        success: true, 
        message: 'pong',
        time: new Date().toISOString(),
        version: '3.0-minimal'
      });
      
    case 'status':
      return res.json({
        success: true,
        status: 'working',
        sections: 24,
        note: 'Blob cache operational'
      });
      
    default:
      return res.json({
        success: true,
        message: `Action "${action}" received`,
        availableActions: ['ping', 'status']
      });
  }
}
