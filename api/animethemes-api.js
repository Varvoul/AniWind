// t194 bisect F — probe under a different function name
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ ok: true, probe: 't194-bisect-F' });
};
