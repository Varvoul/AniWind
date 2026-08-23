// Test endpoint
export default async function handler(req, res) {
  res.json({ test: true, time: Date.now() });
}
