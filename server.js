const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// /work/:slug has no static file; serve the client-side shell
app.get('/work/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'work', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
