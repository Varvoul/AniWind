// t194 bisect E — trivial probe function
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ ok: true, probe: 't194-bisect-E' });
};
